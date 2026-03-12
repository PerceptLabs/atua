# Atua: Unified Architecture & Implementation Specification

**Status:** Single source of truth. Replaces `atua-hyperkernel-spec.md` and `atua-make-it-real.md`. Every subsystem is specified from architecture through implementation with named dependencies, CC kickoff prompts, and test requirements.

**CC Directive:** You are NOT writing stubs, placeholders, test-mode fallbacks, or "TODO" comments. Every deliverable in this spec MUST work when opened in Chrome 120+. If a test uses `vi.fn().mockImplementation()` to fake the thing being tested, that test is useless — write tests that exercise real behavior.

---

## §1 — Vision & Competitive Position

Atua is a browser-native runtime for executing JavaScript/TypeScript projects entirely in the browser, targeting Cloudflare Workers and Deno deployment. The core is the browser's V8 engine + unenv (Node.js API → browser API mapping) + browser platform APIs (OPFS, Workers, ServiceWorker, fetch, WebCrypto). Apps built in Atua deploy to Workers or Deno unchanged.

The WASI host module (`@aspect/atua-wasi`, ~500 lines TS) provides synchronous I/O infrastructure for specific WASM tool binaries:

1. **SAB sync protocol** — WASI tools (Rolldown, wa-sqlite) call `fd_read` → `Atomics.wait()` blocks → kernel-side Worker reads OPFS → `Atomics.notify()` unblocks. Solves Rolldown's Tokio deadlock.
2. **WASI guest process hosting** — WASM binaries compiled to `wasm32-wasip1-threads` (Rolldown, wa-sqlite, Pyodide) run via `@bjorn3/browser_wasi_shim` + CatalystFd.
3. **Multi-threaded WASM execution** — Guest processes get real parallelism via Worker thread pools with shared memory.

> **User code does NOT run through the WASI host.** User code runs on V8 with unenv's async APIs. The WASI host is internal plumbing for WASM tool binaries only. See `atua-architecture-clarification.md`.

### Full Stack

```
Developer writes code in Atua (browser IDE)
     │
Atua Runtime — V8 + unenv + Browser APIs
  ├─ AtuaFS → OPFS (W3C standard)
  ├─ AtuaProc → Web Workers (process isolation)
  ├─ ServiceWorker (HTTP virtualization via Hono)
  ├─ fetch + WebCrypto + IndexedDB
  └─ @aspect/atua-wasi (~500 lines TS, for WASM tools only)
       ├─ browser_wasi_shim + CatalystFd → Rolldown-WASM (~12.5MB)
       └─ SAB sync protocol (Atomics.wait/notify)
     │ Rolldown = Vite 8 default bundler → Vite plugin compat
     │
vinext (Cloudflare) — Reimplements Next.js on Vite → Workers
     │
Cloudflare Workers — Zero cold starts, global edge
```

### Atua vs WebContainers

**Equal:** JS execution speed, sync fs APIs, CommonJS, ESM, process piping, HTTP virtualization.

**Atua wins:** No vendor lock-in, dual-mode degradation (MC + esbuild fallback when no COOP/COEP), OPFS filesystem (W3C standard), transparent architecture, Deno/edge alignment, Worker.terminate() security model (no separate validation engine needed), WASI guest hosting for non-JS tools, AtuaBox (v86 + Alpine) for native binaries, Web Lock process persistence, cold restart < 1s.

**WebContainers wins:** Maturity (4+ years production), Turbo npm client (proprietary CDN), Node.js API breadth, ecosystem/docs, battle-testing at scale.

**Gap to close (engineering, not architecture):** npm client speed for large trees, Node API long-tail coverage beyond unenv's ~85%, battle-testing top 100 packages.

---

## §2 — IP & Prior Art Defense

### StackBlitz Patent — What It Covers

StackBlitz's patent (USPTO) is specific to their **networking virtualization mechanism**: an invisible iframe + invisible window relay for cross-origin communication. Specific claims involve instantiating a relay mechanism with an iFrame, installing a service worker on the invisible window, and communicatively connecting between domains using the relay.

### What the Patent Does NOT Cover

SharedArrayBuffer, Atomics.wait/notify, WASM kernels, process/fd tables, syscall dispatch, ServiceWorker for HTTP, COOP/COEP headers, WASI runtime implementation. All are W3C standards, OS design fundamentals, or open-source prior art.

### Prior Art Predating WebContainers (May 2021)

1. **Browsix** (UMass, 2016) — Academic paper + open-source Unix kernel in browser. Workers as processes, SAB for sync syscalls, full process model. Published as "BROWSIX: Bridging the Gap Between Unix and the Browser" (Powers, Vilk, Berger). MIT license. **Prior art defense only — NOT an implementation reference.** Browser APIs have fundamentally changed since 2016.
2. **Deno's ResourceTable & Ops Dispatch** (2018+) — Open-source (MIT) typed fd table, numbered ops dispatch. Direct ancestor of Atua's kernel design.
3. **Atomics.wait for synchronous IPC** — W3C Web Platform API. Not an invention.

### Atua's Architectural Distinctions

| Dimension | WebContainers | Atua |
|---|---|---|
| **Kernel** | Proprietary WASM kernel | Rust `no_std` crate, OS textbook patterns from Deno (MIT) |
| **Compatibility** | Node.js (V8 C++ → WASM) | Deno-compatible (unenv polyfills, no C++ compilation) |
| **Filesystem** | Custom WASM block store | OPFS via AtuaFS — W3C standard |
| **Networking** | Invisible iframe relay (patented) | ServiceWorker fetch interception — standard PWA pattern |
| **Bundler** | Rolldown-WASM via proprietary WASI | Rolldown-WASM via open-source browser_wasi_shim |
| **Degradation** | No COOP/COEP = nothing works | No COOP/COEP = async fallback with esbuild-wasm |

---

## §3 — Dependency Manifest

This is the single source of truth for what Atua uses vs builds. If a library is listed here, use it. If it's not listed, check here before hand-rolling.

### Rust Crates (no_std kernel)

| Crate | What | License | no_std |
|---|---|---|---|
| `slab` (0.4, default-features=false) | Pre-allocated arena — ResourceTable + ProcessTable | MIT | ✅ |
| `wasm-bindgen` + `js-sys` | Rust ↔ JS FFI, SAB/Atomics/Int32Array access | MIT/Apache-2.0 | ✅ |
| `wasm_rs_shared_channel` | SAB message channel for WASM threads | Apache-2.0 | ✅ |
| `wasm_thread` | std::thread for wasm32 — Worker spawning from Rust | MIT/Apache-2.0 | ✅ |
| `web-sys` | Web API bindings (Worker, MessagePort) | MIT/Apache-2.0 | — |
| `wee_alloc` | Tiny WASM allocator (~1KB) | MPL-2.0 | ✅ |
| `console_error_panic_hook` | Debug panics → console.error | MIT/Apache-2.0 | — |
| `bitflags` | Typed flag sets (process flags, open modes) | MIT/Apache-2.0 | ✅ |
| `hashbrown` | HashMap without std (fallback if slab insufficient) | MIT/Apache-2.0 | ✅ |

### JavaScript/TypeScript Dependencies

| Package | What | Why not hand-roll | Size |
|---|---|---|---|
| `@bjorn3/browser_wasi_shim` | WASI preview1 for browsers | 20+ syscalls with correct errno codes, pax headers, fd preallocation. Runs against wasi-testsuite. | ~15KB |
| `@rolldown/binding-wasm32-wasi` | Rolldown WASM+WASI browser build | Ships browser loader handling Worker pool, SAB setup, WASM loading. Don't rebuild upstream. | ~12.5MB |
| `comlink` | Worker RPC via ES6 Proxy over postMessage | Transfer handlers, SharedWorker/SW/iframe support, TypeScript types. Google Chrome Labs. | 1.1KB brotli |
| `semver` | npm's own semver resolution | Pre-release, build metadata, hyphen/X-ranges, tilde/caret. Reference implementation. | ~16KB |
| `resolve.exports` | Package.json exports/imports resolution | Subpath patterns, wildcards, nested conditions. Shared approach across tools/bundlers. | 952B |
| `untar-sync` | Synchronous tar extraction | ustar format, filename prefixes, all tar edge cases. Sync API for Worker context. | ~3KB |
| `unenv` | Node.js API polyfills for browser | fs→kernel→OPFS, crypto→WebCrypto, path, buffer, stream, http→fetch. UnJS maintained. | varies |
| `esbuild-wasm` | Fallback bundler (MC mode) | Production bundler, works without SAB. | ~9MB |
| ~~`quickjs-emscripten`~~ | ~~Removed from core~~ | Replaced by Worker.terminate() + static analysis. Stays in `@aspect/atua-embedded` for NanoClaw only. | 0 |

### Browser Platform APIs (zero dependency)

| API | Used for |
|---|---|
| OPFS (`createSyncAccessHandle()`) | AtuaFS — persistent filesystem with sync access in Workers |
| `SharedArrayBuffer` + `Atomics` | Kernel ↔ process syscall protocol (SAB mode) |
| `MessageChannel` | Kernel ↔ process fallback transport (MC mode) |
| `Web Locks API` | Single-writer guarantee, prevents Worker GC |
| `BroadcastChannel` | Cross-tab process coordination, keepalive |
| `ServiceWorker` | HTTP virtualization (Hono dev server in fetch handler) |
| `DecompressionStream` | Browser-native gzip for npm tarball extraction |
| `WebAssembly.compileStreaming` | Streaming WASM compilation |

### What We Actually Build From Scratch

- **Hyperkernel** — Rust `no_std` WASM kernel: ResourceTable, ProcessTable, 20-syscall dispatch (~1,760 lines Rust, ~30KB WASM)
- **CatalystFd** — Extends browser_wasi_shim's `Fd` to route file ops through kernel syscalls to OPFS
- **Dual-mode transport** — SAB vs MC detection + routing (~200 lines)
- **Kernel host layer** — JS orchestrator: SAB monitor, OPFS bridge, Worker management
- **Build pipeline integration** — Rolldown trigger, HMR wiring, esbuild fallback
- **ServiceWorkerBridge** — SW registration, port transfer, HTTP routing to AtuaHTTPServer
- **TCP relay** — Cloudflare Worker: WSS ↔ TCP bridge
- **AtuaCluster** — Real Worker forking with round-robin distribution
- **`Atua.run()`** — End-to-end orchestrator: deps → build → SW → execute → preview

---

## §4 — Kernel Core

### Architecture

The WASI host module (`@aspect/atua-wasi`) manages state and dispatches syscalls for WASM tool binaries (Rolldown, wa-sqlite). It never does I/O — real work happens in the JS host layer. This is a support module for WASM tools, not the core runtime. User code runs on V8 + unenv and never touches this layer.

**Design Principles:**
1. Kernel is state + dispatch only. Manages tables and routes syscalls. Never does I/O.
2. Real work happens in JavaScript. OPFS reads, SW networking, Worker spawning — all JS host.
3. No Tokio, no std, no OS dependencies. Pure `no_std` + `alloc`. The WASI host provides sync I/O for WASM tools only — the browser IS the OS for everything else.
4. WASI-compatible interface. Guest WASM processes see standard WASI syscalls via the shim.
5. Dual-mode IPC. SAB + Atomics.wait when cross-origin isolated; MessageChannel + Comlink when not.
6. Pattern lineage from open-source. ResourceTable (Deno MIT), syscall dispatch (OS fundamentals, Browsix MIT prior art), capability mediation (Wasmosis MIT).

**Component Architecture:**

```
┌──────────────────────────────────────────────────────────────────┐
│                        Kernel Worker                              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              hyperkernel.wasm (~20-40KB)                    │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │  │
│  │  │ ResourceTable│  │ ProcessTable │  │ SignalTable  │      │  │
│  │  │  (slab-based)│  │ (slab-based) │  │              │      │  │
│  │  │  files, pipes│  │ pid, parent, │  │ pending sigs │      │  │
│  │  │  sockets     │  │ state, fds   │  │ per process  │      │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘      │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐   │  │
│  │  │            Syscall Dispatch Table (20 syscalls)       │   │  │
│  │  │  SYS_OPEN=1  SYS_READ=2  SYS_WRITE=3  SYS_CLOSE=4  │   │  │
│  │  │  SYS_STAT=5  SYS_SPAWN=6 SYS_KILL=7   SYS_PIPE=8   │   │  │
│  │  │  SYS_CONNECT=9  SYS_DUP=10  SYS_MKDIR=11  ...      │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          ↕ wasm-bindgen                           │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              JS Host Layer (kernel-host.ts)                 │  │
│  │  SAB Monitor:  Atomics.waitAsync → detect syscalls          │  │
│  │  OPFS Bridge:  kernel says "read fd 3" → AtuaFS → OPFS     │  │
│  │  SW Bridge:    kernel says "connect" → ServiceWorker        │  │
│  │  Worker Mgmt:  kernel says "spawn" → new Worker()           │  │
│  │  WASI Shim:    browser_wasi_shim + CatalystFd               │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ Kernel Syscall SAB
               ┌────────────┼────────────┐
               ▼            ▼            ▼
    ┌────────────────┐ ┌──────────┐ ┌──────────────────────┐
    │ JS Process W1  │ │ JS Proc  │ │  Rolldown-WASM       │
    │ (Ralph, shell)  │ │ W2       │ │  (guest process)     │
    │ SAB syscall()   │ │ SAB      │ │ WASM Linear Memory   │
    │ Atomics.wait()  │ │ syscall()│ │ (own SAB for threads)│
    └────────────────┘ └──────────┘ │ WASI shim → kernel   │
                                    │ ┌──────┐ ┌──────┐    │
                                    │ │Thrd 1│ │Thrd 2│    │
                                    │ │Worker│ │Worker│    │
                                    │ └──────┘ └──────┘    │
                                    └──────────────────────┘
```

**Rust Structure:**

```rust
#![no_std]
extern crate alloc;

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec::Vec;
use slab::Slab;

pub trait Resource: core::any::Any {
    fn name(&self) -> &str;
    fn close(&mut self) {}
}

pub struct ResourceTable {
    resources: Slab<Box<dyn Resource>>,
}

impl ResourceTable {
    pub fn new() -> Self { Self { resources: Slab::new() } }
    pub fn add(&mut self, resource: Box<dyn Resource>) -> u32 {
        self.resources.insert(resource) as u32
    }
    pub fn get(&self, rid: u32) -> Option<&dyn Resource> {
        self.resources.get(rid as usize).map(|r| r.as_ref())
    }
    pub fn close(&mut self, rid: u32) -> Option<Box<dyn Resource>> {
        self.resources.try_remove(rid as usize)
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum ProcessState { Running, Blocked, Zombie, Stopped }

pub struct Process {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub state: ProcessState,
    pub resources: ResourceTable,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub exit_code: Option<i32>,
}

pub struct ProcessTable { processes: Slab<Process> }

#[repr(u32)]
pub enum Syscall {
    Open = 1, Read = 2, Write = 3, Close = 4, Stat = 5,
    Spawn = 6, Kill = 7, Pipe = 8, Connect = 9, Dup = 10,
    Mkdir = 11, Readdir = 12, Unlink = 13, Waitpid = 14,
    Getcwd = 15, Chdir = 16, Lseek = 17, Fstat = 18,
    Rename = 19, Exit = 20,
}

#[repr(u32)]
pub enum SyscallAction {
    Complete = 0,
    OpfsRead = 1, OpfsWrite = 2, OpfsStat = 3, OpfsMkdir = 4,
    OpfsReaddir = 5, OpfsUnlink = 6, OpfsRename = 7,
    SpawnWorker = 8, NetConnect = 9, NetSend = 10,
}

pub struct Kernel { processes: ProcessTable, next_pid: u32 }

impl Kernel {
    pub fn syscall(&mut self, pid: u32, nr: u32, args: &[u32])
        -> (SyscallAction, i32)
    {
        match Syscall::try_from(nr) {
            Ok(Syscall::Close) => {
                let fd = args[0];
                let process = self.processes.get_mut(pid);
                process.resources.close(fd);
                (SyscallAction::Complete, 0)
            }
            Ok(Syscall::Read) => {
                let fd = args[0];
                (SyscallAction::OpfsRead, fd as i32)
            }
            _ => (SyscallAction::Complete, -1) // ENOSYS
        }
    }
}
```

**Estimated Binary Size:**

| Component | Lines Rust | Est. WASM |
|---|---|---|
| ResourceTable | ~80 | ~2KB |
| ProcessTable | ~120 | ~3KB |
| SignalTable | ~60 | ~1KB |
| Syscall Dispatch | ~400 | ~10KB |
| Resource types (File, Pipe, Socket stubs) | ~200 | ~5KB |
| wasm-bindgen glue | ~100 | ~5KB |
| slab + wee_alloc | ~800 | ~4KB |
| **Total** | **~1,760** | **~30KB** |

After `wasm-opt -Oz`: **20-40KB** final binary.

### Implementation

**Phase:** 0-2 (Crate setup → Core Tables → Syscall Dispatch)

1. Create `crates/hyperkernel` with `#![no_std]` + `alloc`
2. Cargo.toml: slab, wasm-bindgen, js-sys, wee_alloc, bitflags
3. Target: `wasm32-unknown-unknown`, build: `wasm-pack build --target web`
4. Implement ResourceTable (add/get/close), ProcessTable (spawn/kill/get)
5. File, Pipe, Socket resource type stubs
6. 20-syscall dispatch table
7. `kernel.syscall(pid, nr, args) → (action, result)` entry point
8. SyscallAction enum, wasm-bindgen exports

### Tests

1. Native Rust unit tests: ResourceTable add/get/close lifecycle
2. Native Rust unit tests: ProcessTable spawn/kill, process state transitions
3. Native Rust unit tests: Syscall dispatch routes to correct handlers
4. Native Rust unit tests: slab key reuse after close

### CC Kickoff
```
Create crates/hyperkernel as a no_std Rust crate targeting wasm32-unknown-unknown.
Read §4 of docs/plans/atua-unified-spec.md for the full Rust structure.
Implement ResourceTable, ProcessTable, and 20-syscall dispatch.
Do NOT implement I/O — kernel returns SyscallAction telling JS host what to do.
Run cargo test (native Rust, no browser needed for this phase).
```

---

## §5 — Transport Layer

### Architecture

The kernel uses dual-mode IPC. Mode detected at runtime:

```typescript
const mode = self.crossOriginIsolated ? 'sab' : 'mc';
```

**SAB mode (primary):** Full capability. Rolldown, sync fs, ~95% npm compat.
**MC mode (fallback):** Async-only. esbuild-wasm. No sync fs. ~70% npm compat. Still functional.

**SharedArrayBuffer Protocol (SAB mode):**

Each process gets a 256-byte region in the Kernel Syscall SAB:

```
Process Syscall Region (256 bytes per process):
┌──────────┬──────────┬──────────┬──────────┬──────────────────┐
│ status   │ syscall# │ arg0     │ arg1     │ arg2-arg7        │
│ (i32)    │ (i32)    │ (i32)    │ (i32)    │ (6 × i32)        │
├──────────┼──────────┴──────────┴──────────┴──────────────────┤
│ result   │ data buffer (for read/write payloads)             │
│ (i32)    │ (remaining bytes)                                 │
└──────────┴───────────────────────────────────────────────────┘

Status: 0=IDLE, 1=PENDING, 2=DONE, 3=ERROR

Process Worker:
  1. Write syscall_nr + args → SAB region
  2. Atomics.store(status, PENDING) + Atomics.notify(status)
  3. Atomics.wait(status, PENDING) ← blocks
  4. Read result, continue

Kernel Worker:
  1. Atomics.waitAsync(status, IDLE) detects PENDING
  2. Read syscall_nr + args, call kernel.syscall(pid, nr, args)
  3. Perform I/O via JS host (OPFS/ServiceWorker/Worker spawn)
  4. Write result → SAB, Atomics.store(status, DONE) + Atomics.notify
```

**MessageChannel mode (MC, fallback):**

Uses [Comlink](https://github.com/GoogleChromeLabs/comlink) (1.1kB brotli, Google Chrome Labs) for Worker RPC instead of hand-rolling request/response correlation over MessagePort. Comlink provides ES6 Proxy over `postMessage` with transfer handlers, TypeScript types, and support for Workers/SharedWorkers/ServiceWorkers/iframes.

All Worker communication in MC mode goes through Comlink — the kernel host `Comlink.expose()`s the syscall interface, process Workers `Comlink.wrap()` it. No manual UUID correlation, no pendingRequests maps.

```typescript
class KernelHost {
  private sab: SharedArrayBuffer | null;
  constructor() {
    this.sab = self.crossOriginIsolated
      ? new SharedArrayBuffer(REGION_SIZE * MAX_PROCESSES)
      : null;
  }
  get mode(): 'sab' | 'mc' { return this.sab ? 'sab' : 'mc'; }
}
```

**Thread Memory — Two SAB Regions (SAB mode only):**

1. **WASM Linear Memory** (Rolldown's heap) — `SharedArrayBuffer` backing `WebAssembly.Memory`. All Rolldown "threads" (Workers) share this. Kernel doesn't manage it.
2. **Kernel Syscall SAB** — the hyperkernel's SAB with per-process 256-byte regions. Each Rolldown thread gets a region.

When `wasi_thread_spawn` fires:
1. Kernel JS host creates a new Worker
2. Passes: same WASM module, same WASM shared memory (#1), new region in kernel SAB (#2)
3. Registers thread in ProcessTable
4. New Worker instantiates WASM module with shared memory and starts executing

### Implementation

**Phase:** 3 (SAB Protocol) + 5 (MessageChannel Fallback)

SAB mode:
1. SAB layout implementation — allocate 256-byte regions per process
2. `Atomics.waitAsync` loop in kernel Worker — detect PENDING, dispatch syscall
3. Process-side `syscall()` function — write args, set PENDING, `Atomics.wait`, read result
4. End-to-end: `readFileSync()` → SAB → kernel → OPFS → SAB → unblock

MC mode:
1. `npm install comlink`
2. Kernel host: `Comlink.expose(kernelInterface, port)` where `kernelInterface` has `syscall(nr, args)`
3. Process Worker: `const kernel = Comlink.wrap(port); await kernel.syscall(SYS_READ, args)`
4. Same syscall dispatch, just async instead of blocking
5. Feature-detect: `self.crossOriginIsolated ? 'sab' : 'mc'`

### Tests

1. Browser test (SAB mode): Process Worker calls syscall, blocks, receives result from kernel Worker
2. Browser test (MC mode): Process Worker calls syscall via Comlink, receives async result
3. Browser test: Mode auto-detection works correctly
4. Browser test: Multiple concurrent syscalls from different process Workers don't interfere

### CC Kickoff
```
Read §5 of docs/plans/atua-unified-spec.md.
Implement SAB protocol: layout, Atomics.waitAsync kernel loop, process-side syscall().
Then implement MC fallback using Comlink (npm install comlink).
Feature-detect mode via self.crossOriginIsolated.
Write browser tests for both modes.
```

---

## §6 — WASI Layer

### Architecture

Atua uses `@bjorn3/browser_wasi_shim` (MIT/Apache-2.0) rather than hand-rolling `wasi_snapshot_preview1`. The library provides `File`, `OpenFile`, `ConsoleStdout`, `PreopenDirectory`, and a `WASI` class that generates the full `wasiImport` object. It handles 20+ syscalls including `clock_time_get`, `environ_get`, `args_get`, `proc_exit`, `random_get`.

Atua's custom work is **CatalystFd** — a subclass of browser_wasi_shim's `Fd` that routes file operations through the kernel syscall interface to OPFS:

```javascript
import { Fd, WASI } from "@bjorn3/browser_wasi_shim";

class CatalystFd extends Fd {
  constructor(kernelSyscall, fd) {
    super();
    this.kernelSyscall = kernelSyscall;
    this.kernelFd = fd;
  }
  fd_read(view8, iovs) {
    return this.kernelSyscall(SYS_READ, this.kernelFd, iovs);
  }
  fd_write(view8, iovs) {
    return this.kernelSyscall(SYS_WRITE, this.kernelFd, iovs);
  }
  fd_seek(offset, whence) {
    return this.kernelSyscall(SYS_LSEEK, this.kernelFd, offset, whence);
  }
  fd_close() {
    return this.kernelSyscall(SYS_CLOSE, this.kernelFd);
  }
}

// CatalystPreopenDirectory extends PreopenDirectory to
// intercept path_open → kernel SYS_OPEN → return CatalystFd
```

The integration is generic. Any WASM binary compiled to `wasm32-wasip1` or `wasm32-wasip1-threads` runs as a kernel guest process using the same pattern: browser_wasi_shim provides the WASI interface, CatalystFd routes file ops through kernel syscalls to OPFS.

### Guest Process Lifecycle

```typescript
async function loadGuestProcess(wasmUrl: string, processName: string) {
  // 1. Fetch WASM binary
  const wasmBytes = await fetch(wasmUrl).then(r => r.arrayBuffer());

  // 2. Create WASI imports from browser_wasi_shim + CatalystFd
  const fds = [
    new OpenFile(new File([])),                    // stdin
    ConsoleStdout.lineBuffered(console.log),       // stdout
    ConsoleStdout.lineBuffered(console.error),     // stderr
    new CatalystPreopenDirectory("/", kernelSyscall), // root fs
  ];
  const wasi = new WASI([], [], fds);

  // 3. Instantiate in Worker (process isolation)
  const worker = new Worker(guestWorkerUrl);
  worker.postMessage({
    type: 'init',
    wasm: wasmBytes,
    wasiImports: wasi.wasiImport,
    sabRegion: kernel.allocateProcessRegion(),
    pid: kernel.spawn(processName),
  });

  // 4. Guest makes WASI syscalls → shim → kernel → OPFS
}
```

### Implementation

**Phase:** 4 (WASI Shim + Rolldown Integration)

1. `npm install @bjorn3/browser_wasi_shim`
2. Implement CatalystFd subclass routing to kernel syscalls
3. Implement CatalystPreopenDirectory extending PreopenDirectory
4. Load @rolldown/binding-wasm32-wasi using Rolldown's shipped `rolldown-binding.wasi-browser.js` loader
5. Wire CatalystFd into the loader's WASI fds array
6. `wasi_thread_spawn` → SYS_SPAWN → Worker with shared WASM memory
7. End-to-end: OPFS source → Rolldown reads via WASI → kernel → bundles → OPFS

### Tests

1. Browser test: browser_wasi_shim with CatalystFd reads a file from OPFS through kernel
2. Browser test: Rolldown-WASM loads and bundles a simple TypeScript file
3. Browser test: Rolldown thread spawning works via kernel Worker pool
4. Browser test: Guest process stdout routes to console via ConsoleStdout

### CC Kickoff
```
Read §6 of docs/plans/atua-unified-spec.md.
npm install @bjorn3/browser_wasi_shim.
Create CatalystFd and CatalystPreopenDirectory in the WASI layer.
Load @rolldown/binding-wasm32-wasi using its shipped browser loader.
Wire CatalystFd so Rolldown reads/writes through kernel → OPFS.
Write browser tests proving Rolldown bundles a real TypeScript project.
```

---

## §7 — Worker Execution Engine

### Architecture

NativeEngine provides JavaScript execution in isolated Web Workers. Two modes:

**Mode A — Worker Execution (browser, default):**
Spawns real `new Worker()` via blob URL. Code executes in a separate V8 thread. Communication via Comlink-wrapped MessagePorts for eval requests, stdio, and FS proxy.

**Mode B — Inline Execution (Node.js tests, SSR):**
Existing `_evalInline()` via `new Function()`. Only used when `typeof Worker === 'undefined'`.

### Implementation — NativeEngine Worker Mode

**What currently exists:** `NativeEngine._evalInline()` calls `new Function(code)` on the main thread. `WorkerBootstrap.ts` and `GlobalScope.ts` generate Worker bootstrap source, but nothing ever calls `new Worker()`.

**What must change in NativeEngine.ts:**

The private constructor accepts `mode: 'worker' | 'inline'`. `static create()` auto-detects. Worker mode fields:
- `private worker: Worker | null`
- `private blobUrl: string | null`

Worker spawn on `create()`:
1. Detect: `typeof Worker !== 'undefined'`
2. Generate bootstrap source via `getWorkerBootstrapSource()`
3. `new Blob([source])` → `URL.createObjectURL()` → `new Worker(blobUrl)`
4. Use Comlink to expose eval interface on the Worker side, wrap it on the main thread side

The `eval()` method in Worker mode uses Comlink proxy:

```typescript
// Main thread (NativeEngine)
import { wrap, expose } from 'comlink';

// After Worker spawns:
this.workerProxy = wrap<WorkerInterface>(this.worker);

async eval(code: string, filename: string): Promise<any> {
  return this.workerProxy.exec(code, filename);
}
```

Worker side (WorkerBootstrap.ts):
```javascript
import { expose } from 'comlink';

const workerInterface = {
  exec(code, filename) {
    const mod = { exports: {} };
    const fn = new Function('module', 'exports', 'require', ...globalNames, code);
    fn(mod, mod.exports, self.require, ...globalValues);
    return mod.exports;
  }
};

expose(workerInterface);
```

On `destroy()`: `worker.terminate()`, revoke blob URL.

### Implementation — FS Proxy in Worker

The Worker has no direct access to AtuaFS. Use Comlink to proxy FS operations:

```typescript
// Main thread: expose AtuaFS via Comlink on a MessagePort
const channel = new MessageChannel();
expose(atuaFs, channel.port1);
// Transfer port2 to Worker
worker.postMessage({ fsPort: channel.port2 }, [channel.port2]);

// Worker side: wrap the port to get a transparent FS proxy
const fsProxy = wrap(fsPort);
// fsProxy.readFileSync(path) → async call to main thread AtuaFS
```

The `require('fs')` module inside the Worker delegates to this Comlink proxy. Since Comlink makes everything async, the Worker must either pre-load known files or use `Atomics.wait` + SAB for sync-over-async when cross-origin isolated.

**Recommended approach:** Pre-load known files during init. For runtime fs access, use async proxy and document that `require('fs').readFileSync()` returns a Promise in Worker mode, or use Atomics.wait if cross-origin headers are present.

### Implementation — Sandbox Validation

**What currently exists:** `runInSandbox()` tries to import `quickjs-emscripten`, falls back to `new Function(code)` which is a syntax check only. No CPU timeout. No infinite loop protection.

**What must change:**

```typescript
export async function runInSandbox(
  code: string,
  config: SandboxRunConfig = {},
): Promise<SandboxRunResult> {
  const timeout = config.timeout ?? 100;
  const start = Date.now();

  if (config.engine) {
    return runWithEngine(config.engine, code, timeout, start);
  }

  try {
    const { AtuaEngine } = await import('../engine/AtuaEngine.js');
    const engine = await AtuaEngine.create({ timeout });
    try {
      return await runWithEngine(engine, code, timeout, start);
    } finally {
      await engine.destroy();
    }
  } catch {
    return syntaxCheckOnly(code, start);
  }
}

async function runWithEngine(engine, code, timeout, start) {
  try {
    await Promise.race([
      engine.eval(code),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      ),
    ]);
    return { passed: true, durationMs: Date.now() - start };
  } catch (err) {
    if (err.message === 'TIMEOUT') {
      return { passed: false, error: `CPU timeout: exceeded ${timeout}ms`,
               durationMs: Date.now() - start, timeoutExceeded: true };
    }
    return { passed: false, error: `Runtime error: ${err.message}`,
             durationMs: Date.now() - start };
  }
}
```

### Tests

**Worker Execution:**
1. Browser test: NativeEngine spawns a Worker, eval returns correct result from Worker thread
2. Browser test: Worker console.log arrives to main thread handler
3. Browser test: Worker times out after configured timeout
4. Browser test: `worker.terminate()` on destroy() kills the thread
5. Browser test: Two NativeEngine instances run in parallel without interference
6. Node test: Falls back to inline mode
7. Browser test: AtuaFS proxy reads/writes files from Worker context

**Sandbox:**
8. Browser test: `while(true){}` is killed by timeout
9. Browser test: Clean code passes in under 100ms
10. Browser test: Runtime error returns `passed: false` with error message
11. Browser test: Two concurrent validations don't interfere

### CC Kickoff — Worker Execution
```
Read §7 "Worker Execution Engine" of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/engines/native/NativeEngine.ts and WorkerBootstrap.ts.
npm install comlink.
Implement dual-mode: Worker (browser, using Comlink) and inline (Node).
Use Comlink for eval RPC and FS proxy — do NOT hand-roll MessagePort correlation.
Write browser tests proving eval() runs in a real Worker.
```

### CC Kickoff — Sandbox
```
Read §7 "Sandbox Validation" of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/validation/SandboxRunner.ts.
Replace new Function() fallback with real QuickJS execution via AtuaEngine.
Write browser test verifying while(true){} is killed by timeout.
```

---

## §8 — Package Resolution

### Architecture

Two-tier strategy:

**Tier 1: esm.sh CDN (fast path, development)**

```typescript
// Ralph writes:
import { motion } from "motion/react";
// Build plugin rewrites to:
import { motion } from "https://esm.sh/motion@12/react";
```

Covers ~90% of packages. Limitations: complex export maps, Node.js assumptions, CDN dependency.

**Tier 2: Deno-style npm resolution (full path, production)**

```
User writes import { z } from "zod"
     │
     ▼
Registry fetch: GET https://registry.npmjs.org/zod
     │ (public API, no auth for public packages)
     ▼
Version resolution: semver.maxSatisfying() (npm's own `semver` package)
     │
     ▼
Dependency tree: recursive resolution of all transitive deps
     │
     ▼
Tarball download: GET https://registry.npmjs.org/zod/-/zod-3.22.4.tgz
     │
     ▼
Extraction: DecompressionStream API (browser-native gzip)
     │ + untar-sync (tar extraction, runs sync in Worker context)
     ▼
Write to OPFS: kernel SYS_WRITE → AtuaFS → OPFS
     │ Content-addressable: /packages/zod@3.22.4/...
     ▼
Module resolution: resolve.exports (952B, by lukeed) for exports/imports fields
     │ + resolve.legacy for main/browser/module fallback
     │ + unenv polyfills for Node built-ins (fs, path, crypto, etc.)
     ▼
Available to import
```

**Key browser APIs:** `fetch()` for registry/tarballs. `DecompressionStream` for gzip (browser-native, no WASM). OPFS via kernel for persistence. `unenv` for Node API polyfills.

### Implementation

**What currently exists:** `NpmRegistryClient.install()` resolves a version, creates a directory, writes a package.json, then writes `module.exports = {};` as index.js. It never downloads tarballs. It never decompresses. It never extracts. The "installed" package is an empty shell.

**What must change — real tarball pipeline:**

**Step 1 — Download tarball:**
```typescript
async downloadTarball(tarballUrl: string): Promise<ArrayBuffer> {
  const response = await this.fetchWithTimeout(tarballUrl);
  if (!response.ok) throw new Error(`Tarball download failed: ${response.status}`);
  return response.arrayBuffer();
}
```

**Step 2 — Decompress gzip (browser-native):**
```typescript
async decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(new Uint8Array(compressed));
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
```

**Step 3 — Extract tar (use `untar-sync`):**
```typescript
import { untarSync } from 'untar-sync';

function extractTar(tarBuffer: ArrayBuffer): TarEntry[] {
  const files = untarSync(new Uint8Array(tarBuffer));
  return files.map(f => ({
    path: f.name.startsWith('package/') ? f.name.slice(8) : f.name,
    content: f.buffer,
    type: f.type === '5' ? 'directory' : 'file',
  }));
}
```

Do NOT hand-roll a tar parser. `untar-sync` handles ustar format, filename prefixes, pax extended headers, and GNU long name extensions. The `NpmRegistryClient` is TypeScript bundled by Vite at build time — `untar-sync` is a normal build dependency, not a circular dependency.

**Step 4 — Write to AtuaFS:**
```typescript
async extractToFs(fs: AtuaFS, entries: TarEntry[], targetDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = `${targetDir}/${entry.path}`;
    if (entry.type === 'directory') {
      ensureDir(fs, fullPath);
    } else {
      ensureDir(fs, fullPath.substring(0, fullPath.lastIndexOf('/')));
      if (isTextFile(entry.path)) {
        fs.writeFileSync(fullPath, new TextDecoder().decode(entry.content));
      } else {
        fs.writeFileSync(fullPath, entry.content);
      }
      files.push(fullPath);
    }
  }
  return files;
}
```

**Step 5 — Wire into install():**
```typescript
async install(name: string, versionRange: string, fs: AtuaFS): Promise<InstallResult> {
  const version = await this.resolveVersion(name, versionRange); // uses semver.maxSatisfying()
  const metadata = await this.getVersionMetadata(name, version);
  const targetDir = `/node_modules/${name}`;

  if (!metadata.dist?.tarball) throw new Error(`No tarball URL for ${name}@${version}`);

  const compressed = await this.downloadTarball(metadata.dist.tarball);
  const tarBuffer = await this.decompressGzip(compressed);
  const entries = extractTar(tarBuffer);
  const files = await this.extractToFs(fs, entries, targetDir);
  const deps = Object.keys(metadata.dependencies ?? {});

  return { name, version, dependencies: deps, files };
}
```

**Step 6 — Module resolution with `resolve.exports`:**
```typescript
import { resolve, legacy } from 'resolve.exports';

function resolvePackageEntry(pkgJson: object, specifier: string): string | null {
  // Try exports field first (modern packages)
  const resolved = resolve(pkgJson, specifier, { browser: true, conditions: ['import', 'browser'] });
  if (resolved) return resolved[0];

  // Fallback to main/browser/module fields (legacy packages)
  return legacy(pkgJson, { browser: true });
}
```

### Tests

1. Integration test (real network): Install `is-odd`, verify files in AtuaFS match real package
2. Integration test: Install scoped `@sindresorhus/is`, verify path encoding
3. Unit test: `decompressGzip()` with known buffer
4. Unit test: `extractTar()` via untar-sync produces correct entries
5. Browser test: Full flow — download, decompress, extract, `require()` module, call function
6. Unit test: `resolvePackageEntry()` with various exports field configurations

### CC Kickoff
```
Read §8 of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/pkg/NpmRegistryClient.ts.
npm install semver untar-sync resolve.exports.
Replace stub install() with real tarball pipeline: download → DecompressionStream → untar-sync → AtuaFS.
Use semver.maxSatisfying() for version resolution.
Use resolve.exports for package entry resolution.
Do NOT hand-roll a tar parser — use untar-sync.
Write browser integration test that installs is-odd from real npm registry and requires it.
```

---

## §9 — HTTP & Service Worker

### Architecture

Full request flow:
```
Browser fetch('/api/hello')
    → Service Worker intercepts (fetch event)
    → SW sends serialized request via Comlink to main thread
    → Main thread routes to AtuaHTTPServer.handleRequest()
    → Handler runs user code (Hono/Express/etc)
    → Response serialized back via Comlink
    → SW creates Response object, returns to browser
```

### Implementation

**What currently exists:** `AtuaHTTPServer._setupMessageChannel()` creates a MessageChannel and wires `port1.onmessage`, but port2 is never sent anywhere. `handleRequest()` works via direct function calls, but real browser `fetch()` never reaches it.

**ServiceWorkerBridge (new file):**

```typescript
export class ServiceWorkerBridge {
  private registration: ServiceWorkerRegistration | null = null;

  async register(fs: AtuaFS, httpServer?: AtuaHTTPServer): Promise<void> {
    if (!navigator?.serviceWorker) throw new Error('Service Workers not available');

    const swSource = getPreviewSWSource();
    const blob = new Blob([swSource], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);

    this.registration = await navigator.serviceWorker.register(swUrl, {
      scope: '/', type: 'classic',
    });

    await this.waitForActivation();
    this.sendFsPort(fs);
    if (httpServer) this.sendHttpPort(httpServer);
  }

  private sendFsPort(fs: AtuaFS): void {
    const channel = new MessageChannel();
    // Use Comlink to expose AtuaFS on port1
    Comlink.expose(fs, channel.port1);
    this.registration!.active!.postMessage(
      { type: 'atua-fs-port', port: channel.port2 },
      [channel.port2]
    );
  }

  private sendHttpPort(httpServer: AtuaHTTPServer): void {
    const channel = new MessageChannel();
    // Expose handleRequest via Comlink
    Comlink.expose({ handleRequest: httpServer.handleRequest.bind(httpServer) }, channel.port1);
    this.registration!.active!.postMessage(
      { type: 'atua-http-port', port: channel.port2 },
      [channel.port2]
    );
  }

  async unregister(): Promise<void> {
    await this.registration?.unregister();
  }
}
```

**Service Worker fetch handler (updated PreviewSW):**

The SW receives the HTTP port, wraps it with Comlink, and routes `/api/*` requests through it:

```javascript
let httpProxy = null;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'atua-http-port') {
    httpProxy = Comlink.wrap(event.data.port);
  }
  if (event.data?.type === 'atua-fs-port') {
    fsProxy = Comlink.wrap(event.data.port);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') && httpProxy) {
    event.respondWith(routeToHttpServer(event.request, url));
    return;
  }
  // Static files served from AtuaFS via fsProxy
});

async function routeToHttpServer(request, url) {
  const body = request.method !== 'GET' && request.method !== 'HEAD'
    ? await request.text() : undefined;
  const serialized = {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers.entries()),
    body,
  };
  const resp = await httpProxy.handleRequest(serialized);
  return new Response(resp.body, {
    status: resp.status, statusText: resp.statusText, headers: resp.headers,
  });
}
```

### Tests

1. Browser test: Register Service Worker from blob URL, verify activation
2. Browser test: Send FS port, read a file from AtuaFS through the SW
3. Browser test: Register HTTP handler, `fetch('/api/test')`, receive response routed through SW → main thread → handler → SW → browser
4. Browser test: POST request with JSON body routed correctly
5. Browser test: Static file served from AtuaFS when no API route matches
6. Browser test: Unregister cleans up SW and ports

### CC Kickoff
```
Read §9 of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/net/PreviewSW.ts and AtuaHTTP.ts.
Create packages/shared/core/src/net/ServiceWorkerBridge.ts.
Use Comlink for all port communication — do NOT hand-roll MessagePort correlation.
Modify PreviewSW to accept HTTP and FS ports via Comlink.wrap().
Write browser test that registers a handler and fetches through the SW.
```

---

## §10 — Network (TCP Relay)

### Architecture & Implementation

Browser JavaScript cannot open raw TCP connections. AtuaTCPSocket connects via a WebSocket relay that bridges WSS ↔ TCP.

**Cloudflare Worker relay:**

```typescript
// packages/relay/src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/connect') return new Response('Atua TCP Relay', { status: 200 });

    const host = url.searchParams.get('host');
    const port = parseInt(url.searchParams.get('port') || '0');
    if (!host || !port) return new Response('Missing host or port', { status: 400 });
    if (!isAllowed(host, port)) return new Response('Host not allowed', { status: 403 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const [clientWs, serverWs] = Object.values(new WebSocketPair());
    serverWs.accept();

    const tcpSocket = connect({ hostname: host, port });

    serverWs.addEventListener('message', (event) => {
      const writer = tcpSocket.writable.getWriter();
      writer.write(event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new TextEncoder().encode(event.data as string));
      writer.releaseLock();
    });

    const reader = tcpSocket.readable.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          serverWs.send(value);
        }
      } catch {} finally { serverWs.close(); }
    })();

    serverWs.addEventListener('close', () => tcpSocket.close());
    return new Response(null, { status: 101, webSocket: clientWs });
  },
};

function isAllowed(host: string, port: number): boolean {
  if (host.startsWith('127.') || host === 'localhost' ||
      host.startsWith('10.') || host.startsWith('192.168.')) return false;
  const allowedPorts = [5432, 3306, 6379, 27017, 9092, 4222];
  return allowedPorts.includes(port) || port >= 1024;
}
```

Default relay URL: `wss://relay.atua.dev/connect`

File as: `packages/relay/src/index.ts` with own `package.json` and `wrangler.toml`.

### Tests

1. Unit test: Relay validates host/port allowlist correctly
2. Integration test: AtuaTCPSocket connects through relay to a test echo server
3. Integration test: Data round-trips correctly through WSS → TCP → WSS

### CC Kickoff
```
Read §10 of docs/plans/atua-unified-spec.md.
Create packages/relay/ with src/index.ts, package.json, wrangler.toml, tsconfig.json.
Implement TCP relay Worker using Cloudflare's connect() API.
Write unit tests for the allowlist validation.
```

---

## §11 — Process Management

### Architecture

#### Long-Running Services

Browsers actively work against long-running processes (tab throttling, Worker GC, SW idle timeout). Goal: keep processes alive for the development session.

| Service | Lifetime | Mechanism |
|---|---|---|
| **Hyperkernel** | Session | Web Lock + dedicated Worker |
| **Rolldown** | Per-build | Process Worker, spawned per bundle, pool reused |
| **Dev server (Hono)** | Session | ServiceWorker fetch handler |
| **HMR server** | Session | ServiceWorker + BroadcastChannel |
| **File watcher** | Session | Kernel Worker + Web Lock |
| **wa-sqlite** | Per-query | Process Worker, optional connection pooling |
| **Pyodide** | Per-session | Process Worker + Web Lock (heavy init ~5s) |
| **Ralph** | Per-iteration | Short-lived, fresh context per cycle |

**Web Locks (primary):**
```typescript
navigator.locks.request('atua-dev-server', { mode: 'exclusive' }, async (lock) => {
  await runDevServer();
  // Lock released on tab close or explicit stop
});
```

**BroadcastChannel keepalive (anti-throttling):**
```typescript
const channel = new BroadcastChannel('atua-keepalive');
setInterval(() => channel.postMessage({ type: 'ping', timestamp: Date.now() }), 15_000);
```

**ProcessMonitor health checks:**
```typescript
class ProcessMonitor {
  checkHealth(pid: number): boolean {
    const process = kernel.getProcess(pid);
    if (process.state === ProcessState.Running) {
      const alive = this.probe(pid, { timeout: 5000 });
      if (!alive) {
        kernel.markZombie(pid);
        if (process.restartable) this.respawn(pid);
      }
      return alive;
    }
    return false;
  }
}
```

**Tab close:** Everything dies. Correct behavior. State (files, DB, git) persists in OPFS. Cold restart: kernel boot (~50ms) + AtuaFS reconnect (~10ms) + dev server restart (~100ms) + preview rebuild (~500ms) = **under 1 second**.

#### Cluster Forking

**What currently exists:** `fork()` calls `processManager.exec()` which runs code inline. No persistent Workers, no round-robin.

**What must change:**

1. On `fork()`, spawn a Worker that stays alive (not exec-and-exit)
2. Worker runs user server code with `cluster.isWorker = true`
3. Primary distributes HTTP requests round-robin across live Workers

Worker "long-running serve" mode:
```javascript
if (cmd.type === 'serve') {
  ctx.evalCode(cmd.code);
  controlPort.postMessage({ type: 'serving' });
  // Worker stays alive, waiting for 'request' messages
}
```

Round-robin in AtuaCluster:
```typescript
private roundRobinIndex = 0;

distributeRequest(request: SerializedHTTPRequest): Promise<SerializedHTTPResponse> {
  const workers = Array.from(this._workers.values()).filter(w => !w.isDead());
  if (workers.length === 0) throw new Error('No workers available');
  const worker = workers[this.roundRobinIndex % workers.length];
  this.roundRobinIndex++;
  return worker.handleRequest(request); // via Comlink proxy
}
```

### Tests

**Process Lifetime:**
1. Browser test: Kernel Worker survives tab backgrounding via Web Lock + keepalive
2. Browser test: Dev server stays alive for 60+ seconds of inactivity

**Cluster:**
3. Browser test: Fork 2 workers, both report `cluster.isWorker === true`
4. Browser test: 4 requests through cluster, round-robin 2 per worker
5. Browser test: Kill a worker, requests route to survivor
6. Browser test: `worker.send()` → `process.on('message')` works

### CC Kickoff — Process Lifetime
```
Read §11 "Long-Running Services" of docs/plans/atua-unified-spec.md.
Implement Web Lock acquisition for kernel Worker.
Implement BroadcastChannel keepalive between main thread and Workers.
Implement ProcessMonitor health checks.
```

### CC Kickoff — Cluster
```
Read §11 "Cluster Forking" of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/proc/AtuaCluster.ts.
Implement real Worker forking with long-running serve mode and round-robin.
Use Comlink for request distribution to Workers.
Write browser tests verifying round-robin distribution.
```

---

## §12 — WASI Guest Targets

| Native Package | WASM Alternative | Size | Priority |
|---|---|---|---|
| Rolldown (bundler) | `@rolldown/binding-wasm32-wasi` | ~12.5MB | **Launch** |
| `better-sqlite3` | `wa-sqlite` | ~400KB | **Launch** |
| `better-sqlite3` (alt) | `sql.js` | ~1.2MB | **Launch** |
| `sharp` | `squoosh-wasm` | ~300KB | **Post-launch** |
| `bcrypt` (native) | `bcryptjs` (pure JS) | ~50KB | **Launch** |
| Python | `Pyodide` | ~12MB | **Post-launch** |
| Ruby | `ruby.wasm` | ~15MB | **Future** |
| Oxc (standalone) | `@oxc/wasm` | ~2MB | **Contingency** |
| `node-canvas` | Browser `<canvas>` API | 0KB | **Launch** |

### wa-sqlite — Most Important After Rolldown

```
App SQL → wa-sqlite WASM (guest process) → WASI fd_read/fd_write
    → browser_wasi_shim + CatalystFd → kernel syscalls → OPFS
    → Database persists across sessions via SyncAccessHandle
```

Unlocks: local-first apps, D1 emulation (same SQL/schema), Hono full-stack (wa-sqlite dev → D1 prod), data-driven prototyping with real relational data.

### Pyodide — Data Science

Full CPython 3.12+ with NumPy, Pandas, scikit-learn, matplotlib. File I/O through WASI → kernel → OPFS. Post-launch but architecturally enabled from day one.

### Generic Guest Process Loader

All targets use the same lifecycle from §6. The kernel doesn't care what language compiled the WASM — Rust, C, C++ all make the same WASI syscalls.

---

## §13 — Build Pipeline

### Architecture

**SAB mode:** Rolldown-WASM as kernel guest process. Full Vite plugin compat. Primary path.
**MC mode:** esbuild-wasm (works without SAB). Slower, no Vite plugin compat. Functional fallback.

```typescript
const bundler = self.crossOriginIsolated
  ? await loadRolldownWasm(kernelSyscall)
  : await loadEsbuildWasm();
```

### Why Rolldown

1. **Rust → WASM > Go → WASM.** Evan You: "esbuild's wasm build is actually significantly slower than Rollup in web containers." Rolldown-WASM with thread pooling is faster.
2. **Vite plugin compatibility.** Rolldown supports Rollup plugin API. Vite 8 default.
3. **Ecosystem convergence.** Vite 8 → Rolldown → Oxc. One Rust toolchain.
4. **The hyperkernel enables it.** Atua becomes the only open-source Rolldown-in-browser runtime.

### The Tokio Deadlock

Rolldown uses Tokio internally. Tokio schedules task → `std::fs::read` → WASI `fd_read` → naive polyfill does `Atomics.wait()` on same thread as Tokio event loop → deadlock.

Kernel solves this: process Worker (Rolldown) blocks on `Atomics.wait()`, kernel Worker (separate thread) handles syscall via `Atomics.waitAsync()`, performs I/O, writes result, calls `Atomics.notify()`. Blocker and resolver on different threads.

### Rolldown Loading

Use Rolldown's shipped `rolldown-binding.wasi-browser.js` loader (126 lines) which handles Worker pool creation, SAB setup, and WASM loading. Custom work: wire CatalystFd into the loader's WASI fds array so Rolldown reads/writes through kernel → OPFS.

### Implementation

Covered in §6 (WASI Layer). Build pipeline is Rolldown-as-guest-process with the WASI integration.

---

## §14 — Integration: `Atua.run()`

### Architecture

The end-to-end orchestrator that takes an entry point and produces a running preview.

### Implementation

**What currently exists:** Individual modules that pass unit tests in isolation. No path from "user writes Express app" to "browser shows running app."

```typescript
async run(entryPoint: string, options?: RunOptions): Promise<RunResult> {
  // 1. Install dependencies
  const pkgJsonPath = '/package.json';
  if (this.fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(this.fs.readFileSync(pkgJsonPath, 'utf-8') as string);
    const deps = pkgJson.dependencies ?? {};
    for (const [name, range] of Object.entries(deps)) {
      await this.packages.install(name, range as string);
    }
  }

  // 2. Build
  const buildResult = await this.buildPipeline.build({ entryPoint, outDir: '/dist' });
  if (buildResult.errors.length > 0) throw new Error(`Build failed: ${buildResult.errors[0].message}`);

  // 3. Register Service Worker
  const bridge = new ServiceWorkerBridge();
  await bridge.register(this.fs);

  // 4. Execute server code via engine
  const engine = await this.getEngine();
  const builtSource = this.fs.readFileSync('/dist/index.js', 'utf-8') as string;
  await engine.eval(builtSource, entryPoint);

  // 5. Return preview info
  return { url: window.location.origin, bridge, engine, buildResult };
}
```

### Tests

1. Browser integration: Write minimal Express app to AtuaFS, `run('server.js')`, `fetch('/')`, verify HTML
2. Browser integration: Write Hono app, `run('index.ts')`, `fetch('/api/hello')`, verify JSON
3. Browser integration: App with npm dependency, install, build, run, verify dependency works at runtime

### CC Kickoff
```
Read §14 of docs/plans/atua-unified-spec.md.
Read packages/shared/core/src/atua.ts.
Add run() method: dependency install → build → SW register → engine eval.
Write browser integration test running a Hono app end-to-end.
This depends on §7-§9 being complete. Do not stub their functionality.
```

---

## §15 — Cross-Cutting Concerns

### 15.1 Rename: Catalyst → Atua

Phase 0 — done first, before any subsystem work. Clean rename, zero behavior change.

**Package Names:**

| Before | After |
|--------|-------|
| `@aspect/catalyst-core` | `@aspect/atua-core` |
| `@aspect/catalyst` | `@aspect/atua` |
| `@aspect/catalyst-workers` | `@aspect/atua-workers` |
| `@aspect/catalyst-workers-d1` | `@aspect/atua-workers-d1` |
| `@aspect/reaction` | `@aspect/atua-deno` |
| `nitro-preset-catalyst` | `nitro-preset-atua` |

**Class Renames:**

| Before | After |
|--------|-------|
| `CatalystFS` | `AtuaFS` |
| `CatalystEngine` | `AtuaEngine` |
| `CatalystHTTP` / `CatalystHTTPServer` | `AtuaHTTP` / `AtuaHTTPServer` |
| `CatalystDNS` | `AtuaDNS` |
| `CatalystTCP` / `CatalystTCPSocket` / `CatalystTCPServer` | `AtuaTCP` / `AtuaTCPSocket` / `AtuaTCPServer` |
| `CatalystTLS` | `AtuaTLS` |
| `CatalystCluster` | `AtuaCluster` |
| `CatalystWASI` | `AtuaWASI` |
| `CatalystSync` | `AtuaSync` |
| `CatalystShell` | `AtuaShell` |
| `CatalystTerminal` | `AtuaTerminal` |
| `CatalystProcess` | `AtuaProcess` |
| `Catalyst` (factory) | `Atua` |

`createRuntime` stays unchanged — it's generic.

**Directory Renames:**
```
packages/distributions/catalyst/       → packages/distributions/atua/
packages/workers/catalyst-workers/     → packages/workers/atua-workers/
packages/workers/catalyst-workers-d1/  → packages/workers/atua-workers-d1/
packages/workers/nitro-preset-catalyst/→ packages/workers/nitro-preset-atua/
packages/shared/core/src/catalyst.ts   → packages/shared/core/src/atua.ts
```

**Global find/replace** across `.ts`, `.json`, `.md`, `.toml`, `.yaml`:
```
CatalystFS → AtuaFS, CatalystEngine → AtuaEngine, CatalystHTTP → AtuaHTTP,
CatalystDNS → AtuaDNS, CatalystTCP → AtuaTCP, CatalystTLS → AtuaTLS,
CatalystCluster → AtuaCluster, CatalystWASI → AtuaWASI, CatalystSync → AtuaSync,
CatalystShell → AtuaShell, CatalystTerminal → AtuaTerminal,
CatalystProcess → AtuaProcess, CatalystConfig → AtuaConfig,
catalyst-core → atua-core, catalyst-workers → atua-workers,
@aspect/catalyst → @aspect/atua, "catalyst" → "atua" (package.json name fields ONLY)
```

**Exclusions:** Do not rename `catalyst-tiered-engine-spec.md` or `catalyst-tiered-engine-addendum.md` — historical planning docs.

**Verify:**
```bash
grep -r "CatalystFS\|CatalystEngine\|CatalystHTTP\|CatalystDNS" packages/ --include="*.ts" | grep -v "catalyst-tiered"
# Should return zero lines
pnpm test && pnpm tsc --noEmit
```

### 15.2 Browser Test Infrastructure

Before any subsystem work, test infra must support real browser testing with real Workers and real network.

**Vitest Browser Config:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
    testTimeout: 30000,
    include: [
      'packages/**/*.browser.test.ts',
      'packages/**/*.integration.test.ts',
    ],
  },
});
```

**Cross-Origin Isolation Headers (for SAB support):**
```typescript
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
}
```

**Test File Naming:**
```
*.test.ts              — Node/unit tests (mocks acceptable)
*.browser.test.ts      — Browser tests (real Workers, real DOM)
*.integration.test.ts  — Real network, real SWs, real installs
```

**Test Helper:**
```typescript
export async function createBrowserAtua(name?: string): Promise<Atua> {
  return await createRuntime({ name: name ?? `test-${Date.now()}` }, 'native');
}

export async function cleanupAtua(runtime: Atua): Promise<void> {
  runtime.dispose();
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name?.startsWith('test-')) indexedDB.deleteDatabase(db.name);
  }
}
```

### 15.3 Anti-Simplification Rules

1. **No `// TODO` comments.** If you can't build it now, say so and stop.
2. **No mock-only tests.** Every test file must have at least one test exercising real behavior in a real browser.
3. **No `module.exports = {};` as "installed" package content.** If tarball download fails, throw.
4. **No `if (typeof Worker === 'undefined') return;` in browser tests.** Workers exist. Test them.
5. **No silent degradation to non-functional state.** If Worker mode fails, throw. If relay unreachable, throw.
6. **Every MessagePort transfer must have a receiving end.** If you postMessage a port, code on the other side must handle it. Same commit.
7. **Do not refactor unrelated code.** Touch only what the spec requires.
8. **Use named dependencies.** If §3 lists a library, use it. Do not hand-roll equivalents.
9. **No hand-rolled MessagePort correlation.** Use Comlink. No UUID maps, no pendingRequests.

### 15.4 What "Real Tests" Look Like

**BAD (current):**
```typescript
globalThis.fetch = vi.fn().mockImplementation(async () => ({
  ok: true, json: async () => MOCK_DATA
}));
const metadata = await client.getPackageMetadata('lodash');
expect(metadata.name).toBe('lodash');
```
This tests that the mock works, not that the client works.

**GOOD (required):**
```typescript
const client = new NpmRegistryClient();
const metadata = await client.getPackageMetadata('is-odd');
expect(metadata.name).toBe('is-odd');
expect(metadata['dist-tags'].latest).toBeDefined();
expect(metadata.versions[metadata['dist-tags'].latest].dist.tarball).toContain('.tgz');
```

Unit tests with mocks are acceptable for error handling and edge cases. But every module MUST have at least one browser integration test exercising real behavior with no mocks.

---

## §16 — Implementation Phases

Dependencies dictate order. Each phase fully working before the next begins.

### Phase 0: Rename (§15.1)
**Depends on:** Nothing
**Produces:** Clean codebase with Atua naming
**Verify:** `pnpm test` passes, `pnpm tsc --noEmit` passes, zero `Catalyst` references
**CC Kickoff:**
```
Rename entire codebase from Catalyst to Atua.
Follow §15.1 of docs/plans/atua-unified-spec.md exactly.
Only names — zero behavior change.
Run pnpm test after to verify nothing broke.
```

### Phase 1: Test Infrastructure (§15.2)
**Depends on:** Phase 0
**Produces:** Working vitest browser config, COOP/COEP headers, test helpers
**Verify:** `expect(typeof Worker).toBe('function')` passes in Playwright chromium

### Phase 2: Kernel Core (§4)
**Depends on:** Nothing (Rust, independent)
**Produces:** `hyperkernel.wasm` with ResourceTable, ProcessTable, 20-syscall dispatch
**Verify:** `cargo test` passes, WASM < 50KB

### Phase 3: Transport Layer (§5)
**Depends on:** Phase 1 (browser tests), Phase 2 (kernel)
**Produces:** SAB protocol + Comlink MC fallback
**Verify:** Browser test — syscall round-trips through both modes

### Phase 4: WASI + Rolldown (§6)
**Depends on:** Phase 3 (transport)
**Produces:** browser_wasi_shim + CatalystFd, Rolldown bundles real project
**Verify:** Browser test — Rolldown-WASM bundles TypeScript through kernel → OPFS

### Phase 5: Worker Execution (§7)
**Depends on:** Phase 1 (browser tests)
**Produces:** NativeEngine with real Workers, sandbox with timeout enforcement
**Verify:** Browser test — eval in Worker, `while(true){}` killed by timeout

### Phase 6: Package Resolution (§8)
**Depends on:** Phase 1 (browser tests)
**Produces:** Real tarball download → extract → AtuaFS
**Verify:** Browser test — install `is-odd`, `require('is-odd')(3)` returns `true`

### Phase 7: HTTP & Service Worker (§9)
**Depends on:** Phase 1 (browser tests)
**Produces:** ServiceWorkerBridge routing `fetch()` to AtuaHTTPServer
**Verify:** Browser test — register handler, `fetch('/api/test')`, correct response

### Phase 8: Integration (§14)
**Depends on:** Phases 5, 6, 7
**Produces:** `Atua.run()` end-to-end
**Verify:** Browser test — Hono app, `fetch('/api/hello')`, JSON response

### Phase 9: Process Lifetime (§11)
**Depends on:** Phase 3 (kernel transport)
**Produces:** Web Lock persistence, BroadcastChannel keepalive, ProcessMonitor
**Verify:** Kernel Worker survives 60s background, cold restart < 1s

### Phase 10: Cluster (§11)
**Depends on:** Phase 5 (real Workers)
**Produces:** `AtuaCluster.fork()` with round-robin
**Verify:** 4 requests → 2 workers → 2 per worker

### Phase 11: TCP Relay (§10)
**Depends on:** Nothing (independent infrastructure)
**Produces:** Deployed Cloudflare Worker at `relay.atua.dev`
**Verify:** WSS round-trips data through relay

### Phase 12: WASI Guest Targets (§12)
**Depends on:** Phase 4 (WASI layer)
**Produces:** wa-sqlite on OPFS, generic guest loader
**Verify:** SQLite CREATE/INSERT/SELECT, data survives page refresh

---

## §17 — Success Criteria

All must pass in a real browser (Playwright chromium, no mocks):

| # | Test | Proves |
|---|------|--------|
| 1 | `hyperkernel.wasm` compiles, < 50KB | §4: Kernel works |
| 2 | `readFileSync()` blocks via `Atomics.wait`, returns data from OPFS | §5: SAB transport works |
| 3 | MC mode syscall via Comlink returns correct result | §5: MC fallback works |
| 4 | Rolldown-WASM bundles multi-file TypeScript via WASI → kernel → OPFS | §6: WASI + Rolldown works |
| 5 | `NativeEngine.eval('module.exports = 1+1')` returns `2` from Worker | §7: Workers work |
| 6 | `runInSandbox('while(true){}')` returns `timeoutExceeded: true` within 200ms | §7: Sandbox works |
| 7 | `install('is-odd', 'latest', fs)` writes real files, `require('is-odd')(3)` returns `true` | §8: Packages work |
| 8 | Register handler, `fetch('/api/x')` returns handler's response | §9: SW routing works |
| 9 | Hono app via `atua.run('index.ts')`, `fetch('/api/hello')` returns JSON | §14: E2E works |
| 10 | `AtuaCluster.fork()` 2 workers, 4 requests → 2-2 | §11: Cluster works |
| 11 | `wss://relay.atua.dev/connect` round-trips data | §10: Relay works |
| 12 | wa-sqlite CREATE/INSERT/SELECT, data survives refresh | §12: SQLite works |
| 13 | Kernel survives 60s tab backgrounding via Web Lock | §11: Process lifetime works |
| 14 | Cold restart from OPFS cache < 1s | §11: Fast restart |
| 15 | MC + esbuild fallback bundles and runs without COOP/COEP | §5/§13: Degradation works |
| 16 | npm resolution works end-to-end (registry → tarball → extract → importable) | §8: Full resolver works |
| 17 | Zero `Catalyst` references in source (excluding historical docs) | §15.1: Rename complete |
| 18 | No StackBlitz code, no WebContainers code, no proprietary deps | §2: IP clean |
| 19 | All patterns traceable to open-source prior art | §2: IP clean |

---

## §18 — File Inventory

| File | Section | Action | Description |
|------|---------|--------|-------------|
| `crates/hyperkernel/` | §4 | CREATE | Rust no_std kernel crate |
| `engines/native/NativeEngine.ts` | §7 | MODIFY | Add Worker spawn mode via Comlink |
| `engines/native/WorkerBootstrap.ts` | §7 | MODIFY | Add Comlink.expose for exec interface |
| `pkg/NpmRegistryClient.ts` | §8 | MODIFY | Real tarball pipeline with untar-sync |
| `net/ServiceWorkerBridge.ts` | §9 | CREATE | SW registration, Comlink port transfer |
| `net/PreviewSW.ts` | §9 | MODIFY | Comlink.wrap for HTTP/FS ports |
| `net/AtuaHTTP.ts` | §9 | MODIFY | Wire to ServiceWorkerBridge |
| `validation/SandboxRunner.ts` | §7 | MODIFY | Real QuickJS via AtuaEngine |
| `packages/relay/src/index.ts` | §10 | CREATE | TCP relay Cloudflare Worker |
| `packages/relay/wrangler.toml` | §10 | CREATE | Relay deployment config |
| `proc/AtuaCluster.ts` | §11 | MODIFY | Real Worker forking + round-robin |
| `atua.ts` | §14 | MODIFY | Add run() method |
| Test files (per section) | All | CREATE | Browser integration tests, no mocks |

**Removed from original inventory:** `pkg/TarParser.ts` — use `untar-sync` instead.

---

## §19 — What This Spec Does NOT Cover

- **Dependency tree resolution** — `install()` installs single packages. Recursive transitive dependency installation is future work.
- **esm.sh ↔ registry mode switching** — Merging PackageManager (esm.sh) with NpmRegistryClient (registry) is future work.
- **OPFS migration** — AtuaFS currently uses LightningFS + IndexedDB. ZenFS/OPFS migration is `zenfs-migration-plan.md`.
- **Deno API surface completion** — Deno shims exist but are out of scope for browser wiring.
- **Production deployment pipeline** — `atua deploy` to Cloudflare Workers is future work.
- **Performance optimization** — Worker pool reuse, tarball caching, pre-resolved deps. All later.
- **Landing page / npm publish** — Marketing, domain, npm scope. Separate effort.

---

## §20 — References

| Resource | URL | Relevance |
|---|---|---|
| Browsix | github.com/plasma-umass/browsix | Prior art: browser Unix kernel (MIT) |
| Browsix paper | "BROWSIX: Bridging the Gap Between Unix and the Browser" | Academic paper |
| Deno core | github.com/denoland/deno → core/resources.rs | ResourceTable pattern (MIT) |
| Wasmosis | github.com/bvibber/wasmosis | Capability-passing WASM microkernel (MIT) |
| k23 / Nebulet / TakaraOS | Various | WASM microkernel validation (MIT) |
| Rolldown | github.com/rolldown/rolldown | Rust JS bundler, Vite 8 default (MIT) |
| @rolldown/binding-wasm32-wasi | npm | Rolldown WASM binary (MIT) |
| Rolldown WASI discussion | github.com/rolldown/rolldown/discussions/3391 | Browser WASM status |
| Rolldown WASI issue #898 | github.com/rolldown/rolldown/issues/898 | Tokio deadlock, threading |
| Evan You on Rolldown WASM | x.com/youyuxi | esbuild slower than Rollup; threading fix |
| vinext | github.com/cloudflare/vinext | Vite Next.js reimplementation (MIT) |
| Vite 8 Beta | vite.dev | Rolldown as default Vite bundler |
| StackBlitz patent | Justia Patents | Covers invisible iframe relay ONLY |
| @bjorn3/browser_wasi_shim | github.com/aspect/browser_wasi_shim | WASI preview1 for browsers (MIT/Apache-2.0) |
| Comlink | github.com/GoogleChromeLabs/comlink | Worker RPC (MIT) |
| semver | npmjs.com/package/semver | npm's semver implementation |
| resolve.exports | npmjs.com/package/resolve.exports | Package.json exports resolution |
| untar-sync | npmjs.com/package/untar-sync | Synchronous tar extraction |
| slab | crates.io/crates/slab | Arena allocator (MIT) |
| wasm_rs_shared_channel | crates.io/crates/wasm_rs_shared_channel | SAB channel (Apache-2.0) |
| wa-sqlite | github.com/rhashimoto/wa-sqlite | SQLite WASM + OPFS (MIT) |
| sql.js | github.com/sql-js/sql.js | SQLite via Emscripten (MIT) |
| Pyodide | github.com/pyodide/pyodide | CPython WASM (MPL-2.0) |
| unenv | github.com/unjs/unenv | Node.js API polyfills (MIT) |
| Hono service-worker | hono.dev | Hono SW adapter |
| Web Locks API | MDN Web Docs | Prevents Worker GC (W3C) |
| DecompressionStream | MDN Web Docs | Browser-native gzip (W3C) |
