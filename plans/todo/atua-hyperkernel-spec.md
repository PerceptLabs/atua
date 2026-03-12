# Atua WASI Host Specification

## Research & Architecture for Browser-Native WASM Tool Hosting (formerly "Hyperkernel")

> **Naming note:** This document was originally titled "Hyperkernel Specification." The component is a WASI host module (`@aspect/atua-wasi`), not an OS kernel. The technical content is valid. The framing has been corrected. See `atua-architecture-clarification.md`.

---

## 1. Problem Statement

Atua is a browser-native runtime for executing JavaScript/TypeScript projects entirely in the browser. The core is V8 + unenv + browser APIs (OPFS, Workers, ServiceWorker, fetch, WebCrypto). The WASI host module described in this document provides synchronous syscalls via SharedArrayBuffer + Atomics for specific WASM tool binaries (Rolldown, wa-sqlite). It is not the core runtime — it is infrastructure added in Phase 6 of the roadmap.

The roadmap builds a complete working runtime (Phases 0-5) without this module. esbuild-wasm is the bundler until this module enables Rolldown. The WASI host provides three capabilities for WASM tools:

1. **Genuine synchronous I/O** — `readFileSync()` blocks via `Atomics.wait()`, unblocks when the kernel completes the OPFS read. Real Node.js/Deno semantics, not async wrappers.
2. **WASI guest process hosting** — WASM binaries compiled to `wasm32-wasip1-threads` (like Rolldown) run as kernel-managed processes with syscalls routed through the kernel.
3. **Multi-threaded WASM execution** — Guest processes that use threading (Tokio, Rayon, etc.) get real parallelism via kernel-managed Worker thread pools with shared memory.

---

## 2. Patent Landscape

### StackBlitz's Patent — What It Actually Covers

StackBlitz filed a patent (USPTO, inventors: Eric Simons, Albert Pai, Dominic Elm, Kwinten Pisman, Tomek Sulkowski, Sam Denty). The patent is specific to their **networking virtualization mechanism**:

**Abstract:** "An improved computing system is arranged for cross-origin network communications on a single computing device."

**Specific claims (from Justia Patents):**
1. Operate a local computing server resource on a first local domain
2. Instantiate a relay mechanism that has an iFrame and an invisible window
3. Instantiate a local web server on a second local domain
4. Install a service worker on the invisible window
5. Receive a request for information at the local web server
6. Verify a presence of the local computing server resource on the first local domain
7. Communicatively connect the second local domain to the iFrame
8. Directly communicate via the networking module between domains using the relay mechanism

### What the Patent Does NOT Cover

- SharedArrayBuffer usage (W3C Web Platform API)
- Atomics.wait/notify (W3C Web Platform API)
- WASM kernels (open-source prior art: Browsix 2016, Deno 2018+)
- Process tables, fd tables, syscall dispatch (OS design fundamentals, 1960s)
- ServiceWorker for HTTP virtualization (W3C standard, used by every PWA)
- COOP/COEP headers (browser security policy)
- WASI runtime implementation (W3C standard)

### Why Atua's Hyperkernel Is Architecturally Distinct

| Dimension | WebContainers | Atua Hyperkernel |
|---|---|---|
| **Kernel origin** | Custom proprietary WASM kernel | Rust `no_std` crate compiled to `wasm32-unknown-unknown`, using OS design textbook patterns (ResourceTable, ops dispatch) from Deno's open-source architecture |
| **Compatibility target** | Node.js (V8 C++ internals compiled to WASM) | Deno-compatible (unenv JS polyfills + host bindings, no C++ compilation) |
| **Filesystem** | Custom WASM-managed block store | OPFS via CatalystFS/ZenFS — W3C standard API, browser vendors actively optimizing |
| **Networking** | Invisible iframe + invisible window relay (patented) | ServiceWorker networking via standard dispatch — no relay mechanism, no cross-domain iframe trick |
| **Bundler** | Hosts Rolldown-WASM via proprietary WASI layer | Hosts Rolldown-WASM via open-source WASI shim on hyperkernel |
| **Validation tier** | None | QuickJS pre-validation — no equivalent in WebContainers |
| **Architecture lineage** | Proprietary, patent-pending networking | Derived from Deno's ResourceTable (Apache 2.0), Browsix's academic prior art (UMass, 2016, MIT), OS design fundamentals |
| **Vendor dependency** | npm ToS requires StackBlitz hosted proxies | Zero vendor dependency — fully self-hosted |
| **Degradation** | No COOP/COEP = nothing works | No COOP/COEP = async fallback with esbuild-wasm (reduced capability, still functional) |

### Prior Art That Predates WebContainers (May 2021)

1. **Browsix** (UMass, 2016) — Academic paper + open-source Unix kernel in browser. Workers as processes, SAB for sync syscalls, full process model with fork/spawn/exec/wait/pipe/signals. Published as "BROWSIX: Bridging the Gap Between Unix and the Browser" by Powers, Vilk, Berger. MIT license. Ran SPEC CPU2006 benchmarks in browser.

2. **Deno's ResourceTable & Ops Dispatch** (2018+) — Open-source (MIT) typed fd table via `HashMap<u32, Box<dyn Resource>>`, numbered ops dispatch. Direct ancestor of Atua's kernel design.

3. **Atomics.wait for synchronous IPC** — Web Platform API documented by WebAssembly Community Group, wasm-bindgen Rust book, Tweag's threading guide. Not an invention.

**Bottom line:** StackBlitz's patent covers their invisible iframe networking relay. Atua doesn't use that pattern. The kernel architecture (SAB syscalls, process tables, WASI hosting, Worker threading) is built entirely from public browser APIs, open-source patterns, and OS design fundamentals.

---

## 3. Rolldown — Primary Bundler

### Why Rolldown, Not esbuild

Atua ships with Rolldown as its bundler. Rolldown is a Rust-based JavaScript/TypeScript bundler (MIT license) that is Rollup-compatible and becoming the default bundler for Vite 8.

1. **Rust → WASM is better than Go → WASM.** Evan You (Vite/Rolldown creator): "esbuild's wasm build is actually significantly slower than Rollup in web containers. This may have to do with Go wasm compilation and de-optimized parallelization." Rolldown-WASM with proper Worker thread pooling is significantly faster.

2. **Vite plugin compatibility.** Rolldown supports the Rollup plugin API. Vite 8 uses Rolldown as its default bundler. Vite plugins work in Atua. vinext (Cloudflare's Vite-based Next.js reimplementation) works in Atua.

3. **The ecosystem is converging.** Vite 8 → Rolldown → Oxc (parser/transformer/minifier). One Rust-based toolchain maintained by VoidZero. Atua aligns with where the JavaScript ecosystem is going.

4. **The hyperkernel enables it.** Rolldown-WASM requires a WASI runtime with SAB threading. Without a kernel, you can't run it in the browser (unless you use WebContainers). The hyperkernel IS the missing WASI runtime. Atua becomes the only open-source, vendor-independent environment where Rolldown runs in the browser.

### Rolldown-WASM Architecture

The `@rolldown/binding-wasm32-wasi` npm package (~12.5 MB, MIT) contains the Rolldown bundler compiled to `wasm32-wasip1-threads`. It ships with browser glue code (`rolldown-binding.wasi-browser.js`) that creates SharedArrayBuffer for WASM linear memory, instantiates the module with WASI imports, and manages a Worker thread pool.

**What Rolldown-WASM needs from the host:**
1. **WASI syscall imports** — `fd_read`, `fd_write`, `fd_seek`, `path_open`, `clock_time_get`, etc.
2. **SharedArrayBuffer** — for WASM linear memory (all "threads" share the same heap)
3. **Thread spawning** — `wasi_thread_spawn` creates new Workers sharing the same WASM memory
4. **Filesystem** — Rolldown reads source files and writes bundles via WASI fd operations

**What blocks Rolldown-WASM in a raw browser:**

The Tokio deadlock: Rolldown uses Tokio internally. Tokio schedules a task that calls `std::fs::read` → WASI `fd_read` → naive polyfill does `Atomics.wait()` on same thread as Tokio's event loop → event loop frozen → response can never be processed → **deadlock**.

The kernel solves this because the process Worker (where Rolldown runs) blocks on `Atomics.wait()`, while the kernel Worker (separate thread, no Tokio, no async runtime, pure synchronous dispatch) handles the syscall via `Atomics.waitAsync()`, performs I/O through the JS host, writes result, calls `Atomics.notify()`. Blocker and resolver on different threads. No deadlock. Same solution WebContainers uses — Atua just does it with an open-source kernel.

### The WASI Shim — `@bjorn3/browser_wasi_shim` + CatalystFS Adapter

Atua uses `@bjorn3/browser_wasi_shim` (MIT/Apache-2.0, 343 GitHub stars) rather than hand-rolling the `wasi_snapshot_preview1` interface. This library is battle-tested, runs against the official wasi-testsuite, and handles edge cases (errno codes, pax headers, fd preallocation) that a hand-rolled shim would miss.

The library provides `File`, `OpenFile`, `ConsoleStdout`, `PreopenDirectory`, and a `WASI` class that generates the full `wasiImport` object. Atua's custom work is a **CatalystFd** subclass that routes file operations through the kernel syscall interface to OPFS, replacing the library's default in-memory `File` storage:

```javascript
// catalyst-fd.js — extends browser_wasi_shim's Fd to route through kernel
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

This gives us the full WASI interface (20+ syscalls including `clock_time_get`, `environ_get`, `args_get`, `proc_exit`, `random_get`) with only the filesystem operations needing custom routing. The shim handles everything else correctly out of the box.
```

### Thread Memory Architecture

Rolldown-WASM requires two distinct shared memory regions:

1. **WASM Linear Memory** (Rolldown's heap) — a `SharedArrayBuffer` backing `WebAssembly.Memory`. All Rolldown "threads" (Workers) share this memory. This is Rolldown's internal concern — the kernel doesn't manage it.

2. **Kernel Syscall SAB** — the hyperkernel's `SharedArrayBuffer` with per-process 256-byte syscall regions. Each Rolldown thread gets a region. The kernel monitors all regions via `Atomics.waitAsync()`.

When `wasi_thread_spawn` fires:
1. Kernel's JS host creates a new Worker
2. Passes: same WASM module, same WASM shared memory (#1), new region in kernel SAB (#2)
3. Registers thread in ProcessTable
4. New Worker instantiates WASM module with shared memory and starts executing

### Dual-Bundler Fallback Strategy

**SAB mode (cross-origin isolated):** Rolldown-WASM runs as kernel guest process. Full parallelism, Vite plugin compatibility. Primary path.

**MC mode (no cross-origin isolation):** Rolldown cannot run — requires synchronous WASI syscalls via `Atomics.wait()`. Fallback to **esbuild-wasm** (works without SAB, hand it code, get a bundle). Slower, no Vite plugin compat, but functional.

```typescript
const bundler = self.crossOriginIsolated
  ? await loadRolldownWasm(kernelSyscall)  // Rolldown via WASI shim
  : await loadEsbuildWasm();               // esbuild fallback
```

Preserves Atua's distribution advantage: any website embeds Atua without COOP/COEP headers. Experience degrades (slower bundler, ~70% npm coverage vs ~95%), but works. WebContainers without headers = nothing works. Same ceiling, higher floor.

esbuild-wasm is thin fallback only. Not the primary bundler.

### Rolldown Minification Note

Rolldown's minifier (via Oxc) is in alpha. Actively developed, expected to stabilize. If not ready at launch: use Oxc standalone minifier as post-bundling step, or terser as JS fallback. Not an architectural concern.

---

## 4. Vite 8 & vinext Convergence

### The Full Stack

```
┌─────────────────────────────────────────────────┐
│                   Developer                      │
│         Writes code in Atua (browser IDE)         │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│                 Atua Runtime                     │
│  Hyperkernel (Rust WASM, ~30KB)                  │
│  ├─ WASI shim → Rolldown-WASM (Rust, ~12.5MB)   │
│  ├─ CatalystFS → OPFS (W3C standard)            │
│  ├─ Process Workers (SAB + Atomics)              │
│  └─ ServiceWorker (HTTP virtualization)          │
└────────────────────┬────────────────────────────┘
                     │ Rolldown provides:
                     │ Rollup plugin compat → Vite plugin compat
┌────────────────────▼────────────────────────────┐
│                Vite 8 Ecosystem                  │
│  Rolldown is Vite 8's default bundler            │
│  @vitejs/plugin-rsc for React Server Components  │
│  Full Vite plugin ecosystem works                 │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              vinext (Cloudflare)                  │
│  Reimplements Next.js API surface on Vite         │
│  ~94% coverage, deploy to Cloudflare Workers      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Cloudflare Workers                     │
│  Zero cold starts, global edge, Deno-compat APIs  │
└─────────────────────────────────────────────────┘
```

**Build in Atua → Deploy to Workers.** Code written in the browser IDE runs on the same runtime target it deploys to.

### What We Borrow from vinext

1. **Module shimming pattern.** Intercepts all `next/*` imports → shim modules. Same as Atua's `unenv` polyfills. 94% coverage on Next.js validates the approach.
2. **Multi-environment build separation.** RSC/SSR as separate module graphs with explicit state passing. Maps to Atua's process isolation.
3. **AGENTS.md / skills pattern.** Ships `.agents/skills/` — file-based AI agent guidance. Same as Wiggum's Ralph skills. Independent validation.
4. **Workers deployment pipeline.** `vinext deploy` is reference implementation for Vite → Workers. Relevant to Atua's Hono full-stack story.

---

## 5. Package Resolution — Deno's npm Approach

### Why Deno, Not a Custom npm Client

The single biggest gap between Atua and WebContainers is package management. WebContainers built Turbo — a custom, browser-optimized npm client that serves pre-resolved dependency trees from a proprietary CDN. Building an equivalent from scratch would be the largest engineering effort in the project.

Atua doesn't need to. Atua targets Deno compatibility, and Deno has built-in npm support. Deno's approach is simpler, open-source, and already designed for non-Node environments.

### How Deno's npm Resolution Works

Deno supports npm packages via `npm:` specifiers:

```typescript
import express from "npm:express@4";
import { z } from "npm:zod@3.22";
```

Under the hood, Deno:
1. Reads the npm registry API (`registry.npmjs.org/{package}`) to get version metadata
2. Resolves the full dependency tree using npm's semver resolution algorithm
3. Downloads package tarballs (`.tgz` files)
4. Extracts them to a global cache (content-addressable by package@version)
5. Rewrites `require()` and `import` calls at runtime to point into the cache

No `node_modules` directory. No `package-lock.json` needed (though it can read one). No `npm install` step — resolution happens on first import, then caches.

### How Atua Implements This

Atua uses a **two-tier resolution strategy**:

**Tier 1: esm.sh CDN (fast path, development)**

For development iteration, esm.sh provides instant package resolution with zero install step:

```typescript
// Ralph writes this:
import { motion } from "motion/react";

// Atua's build plugin rewrites to:
import { motion } from "https://esm.sh/motion@12/react";
```

esm.sh handles CommonJS → ESM conversion, dependency bundling, TypeScript types, and browser compatibility on their CDN. This is what Wiggum uses today. It works for ~90% of packages. Limitations: some packages with complex export maps or Node.js assumptions break, and you're dependent on esm.sh's CDN availability.

**Tier 2: Deno-style npm resolution (full path, production)**

For full npm compatibility, Atua implements Deno's resolution behavior against OPFS:

```
User writes import { z } from "zod"
     │
     ▼
Registry fetch: GET https://registry.npmjs.org/zod
     │ (public API, no authentication needed for public packages)
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
Write to OPFS: kernel SYS_WRITE → CatalystFS → OPFS
     │ Content-addressable: /packages/zod@3.22.4/...
     ▼
Module resolution: resolve.exports (952B, by lukeed) for exports/imports fields
     │ + resolve.legacy for main/browser/module fallback
     │ + unenv polyfills for Node built-ins (fs, path, crypto, etc.)
     ▼
Available to import
```

**Key browser APIs that make this work:**

- `fetch()` — downloads registry metadata and tarballs. Public npm registry requires no auth for public packages.
- `DecompressionStream` — browser-native gzip decompression. No WASM or JS polyfill needed for extracting .tgz tarballs.
- OPFS via kernel — extracted packages written to filesystem through kernel syscalls, persisted across sessions.
- `unenv` — Node.js API polyfills. When a package does `require('fs')` or `import path from 'path'`, unenv provides browser-compatible implementations.

**What unenv covers (Node API compatibility):**

| Module | Status | Implementation |
|---|---|---|
| `fs` / `fs/promises` | ✅ Polyfilled | Routes through kernel syscalls → OPFS |
| `path` | ✅ Polyfilled | Pure JS path manipulation |
| `crypto` | ✅ Polyfilled | WebCrypto API (SHA-256, randomBytes, etc.) |
| `buffer` | ✅ Polyfilled | Pure JS Buffer implementation |
| `stream` | ✅ Polyfilled | Web Streams API bridge |
| `url` | ✅ Native | Browser has URL/URLSearchParams |
| `util` | ✅ Polyfilled | Common utilities (promisify, inspect, etc.) |
| `events` | ✅ Polyfilled | EventEmitter implementation |
| `http` / `https` | ✅ Polyfilled | fetch-based, routes through ServiceWorker |
| `os` | ✅ Polyfilled | Returns browser-appropriate values |
| `querystring` | ✅ Polyfilled | URLSearchParams bridge |
| `zlib` | ✅ Polyfilled | DecompressionStream/CompressionStream |
| `child_process` | ⚠️ Partial | `exec`/`spawn` → kernel SYS_SPAWN for JS/WASM processes only |
| `net` / `dgram` | ❌ No | Raw TCP/UDP sockets don't exist in browsers |
| `cluster` | ❌ No | No OS-level process forking |
| `worker_threads` | ⚠️ Partial | Maps to Web Workers, but API surface differs |
| `v8` | ❌ No | V8 internals not exposed |

This gives Atua ~85-90% Node API coverage. The missing pieces (raw sockets, cluster, v8 module) are things that inherently cannot exist in a browser. For a development interface building web applications, the coverage is sufficient — the packages people actually use (React, Vue, Svelte, Hono, Zod, Drizzle, date-fns, lodash, etc.) don't need raw TCP sockets.

### Caching Strategy

```
OPFS Package Cache Layout:
/packages/
  registry-cache.json          ← npm registry metadata, TTL-based
  zod@3.22.4/
    package.json
    lib/
      index.js
      ...
  react@19.0.0/
    package.json
    ...
  .content-hash/
    sha512-abc123... → zod@3.22.4   ← content-addressable dedup
```

First resolution of a package: registry fetch + tarball download + extraction (~1-3 seconds per package, parallelized). Subsequent imports: OPFS cache hit via kernel SYS_STAT + SYS_READ (~1ms). Cache persists across sessions, tabs, and page refreshes.

For large dependency trees (Next.js-scale, 500+ packages), first install is slow (~30-60 seconds). Solutions: pre-bundled dependency snapshots for common templates, background resolution while user writes code, or a CDN that serves pre-resolved trees (future optimization, not launch-blocking).

---

## 6. WASI Guest Process Targets

### Beyond Rolldown — What Else the Kernel Can Host

The `@bjorn3/browser_wasi_shim` integration is generic. Any WASM binary compiled to `wasm32-wasip1` or `wasm32-wasip1-threads` can run as a kernel guest process using the same pattern as Rolldown: browser_wasi_shim provides the WASI interface, CatalystFd routes file operations through kernel syscalls to OPFS. This opens Atua to hosting tools that traditionally require native binaries.

### Priority Targets

| Native Package | WASM Alternative | Size | What It Does | Priority |
|---|---|---|---|---|
| Rolldown (bundler) | `@rolldown/binding-wasm32-wasi` | ~12.5MB | JavaScript/TypeScript bundling. Vite 8 default. Already covered in Section 3. | **Launch** |
| `better-sqlite3` | `wa-sqlite` | ~400KB | SQLite database with OPFS persistence. Enables local-first apps, D1 emulation, data-driven prototypes. Uses OPFS VFS for durable storage across sessions. | **Launch** |
| `better-sqlite3` (alt) | `sql.js` | ~1.2MB | SQLite compiled via Emscripten. In-memory only (no OPFS persistence). Simpler API, good for ephemeral queries. | **Launch** |
| `sharp` | `squoosh-wasm` / `@aspect/image-wasm` | ~300KB | Image processing — resize, compress, convert formats. Squoosh is Google Chrome team's image codec library compiled to WASM. | **Post-launch** |
| `bcrypt` (native) | `bcryptjs` | ~50KB | Password hashing. Pure JS, no native addon. Drop-in replacement. Not WASI — just a JS package that works directly. | **Launch** (just works) |
| Python | `Pyodide` | ~12MB | Full CPython interpreter compiled to WASM. Runs Python scripts, Jupyter-style notebooks, data science workflows (NumPy, Pandas, scikit-learn included). | **Post-launch** |
| Ruby | `ruby.wasm` | ~15MB | Ruby interpreter compiled to WASM. Run Ruby scripts, Rails prototyping. | **Future** |
| Oxc (standalone) | `@oxc/wasm` | ~2MB | Linter, formatter, minifier. If Rolldown's built-in Oxc minifier isn't ready at launch, standalone Oxc provides minification as a post-bundle step. | **Contingency** |
| `node-canvas` | Browser `<canvas>` API | 0KB | Canvas rendering. The browser HAS this natively — no WASM needed. Code that imports `canvas` gets polyfilled to the browser's built-in Canvas API. | **Launch** (polyfill) |

### wa-sqlite — The Most Important Target After Rolldown

wa-sqlite deserves special attention because it unlocks an entire category of applications:

```
App writes SQL:
  const db = new SQLite('/data/app.db');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec('INSERT INTO users (name) VALUES (?)', ['Alice']);
     │
     ▼
wa-sqlite WASM binary (guest process on kernel):
  SQLite C code compiled to wasm32-wasip1
  fd_read/fd_write calls for database file I/O
     │
     ▼
WASI shim → kernel syscalls:
  SYS_OPEN('/data/app.db') → fd
  SYS_READ(fd, buf, len)   → page data
  SYS_WRITE(fd, buf, len)  → write page
     │
     ▼
CatalystFS → OPFS:
  Database file persisted to Origin Private File System
  Survives page refresh, tab close, browser restart
  SyncAccessHandle for synchronous I/O in Workers
```

**Why this matters:**

1. **Local-first apps.** User builds an app with a real database that persists in the browser. No backend needed for prototyping.
2. **D1 emulation.** Cloudflare D1 is SQLite. wa-sqlite in Atua behaves identically to D1 in Workers. Same SQL, same schema, same queries. Code developed in Atua deploys to D1 with zero changes — swap the storage adapter.
3. **Hono full-stack story.** Hono route handlers query wa-sqlite in development, query D1 in production. The storage seam is one line: `const db = env === 'dev' ? localSQLite('/data/app.db') : env.DB`.
4. **Data-driven prototyping.** Build dashboards, admin panels, CRUD apps with real relational data, not just localStorage JSON blobs.

### Pyodide — Data Science in the Browser

Pyodide runs full CPython 3.12+ in the browser with the scientific stack pre-compiled to WASM:

- **NumPy, Pandas, scikit-learn, matplotlib** — all available
- **Jupyter-style execution** — run Python cells, see output inline
- File I/O through WASI shim → kernel → OPFS (Python reads/writes files that persist)
- Can import JavaScript modules and vice versa (Pyodide has JS↔Python bridge)

For Atua, Pyodide as a kernel guest process means someone can write a data analysis pipeline in Python, read CSV files from OPFS, generate charts, and export results — all in the browser. This is post-launch scope but architecturally enabled by the kernel from day one.

### How Guest Processes Are Loaded

All WASI guest processes follow the same lifecycle:

```typescript
async function loadGuestProcess(wasmUrl: string, processName: string) {
  // 1. Fetch the WASM binary
  const wasmBytes = await fetch(wasmUrl).then(r => r.arrayBuffer());
  
  // 2. Create WASI imports from the kernel's syscall interface
  const wasiImports = createWasiImports(kernelSyscall);
  
  // 3. Instantiate in a new Worker (process isolation)
  const worker = new Worker(guestWorkerUrl);
  worker.postMessage({
    type: 'init',
    wasm: wasmBytes,
    imports: wasiImports,
    sabRegion: kernel.allocateProcessRegion(), // SAB syscall region
    pid: kernel.spawn(processName),
  });
  
  // 4. Guest process runs, makes WASI syscalls → kernel handles I/O
  // 5. On completion: kernel.exit(pid), Worker terminated or returned to pool
}
```

The kernel doesn't care what language the WASM was compiled from. Rust (Rolldown), C (SQLite), C++ (Pyodide/CPython) — they all make the same WASI syscalls, the shim translates identically, the kernel handles I/O the same way.

---

## 7. Process Lifetime & Long-Running Services

### The Browser's Constraints

Browsers are not servers. They actively work against long-running background processes:

- **Tab throttling** — backgrounded tabs get CPU reduced to ~1% after 5 minutes
- **Worker termination** — inactive Workers can be garbage collected
- **Service Worker lifecycle** — SW goes idle after ~30 seconds of no fetch events, browser may terminate it
- **No daemon model** — closing the tab kills everything

For a development interface, this is manageable. Nobody expects their dev server to survive closing the browser. The goal is: **keep processes alive for the duration of the development session.**

### Strategies for Process Persistence

**Web Locks API (primary mechanism):**

```typescript
// Dev server Worker acquires a lock — browser won't GC it while held
navigator.locks.request('atua-dev-server', { mode: 'exclusive' }, async (lock) => {
  // This callback runs as long as the lock is held
  // Start Hono dev server, file watcher, HMR server
  await runDevServer();
  // Lock released when callback returns (tab close, explicit stop)
});
```

While a Web Lock is held, the browser guarantees the execution context stays alive. The lock is released when the tab closes, the callback returns, or the lock is explicitly released. This is the most reliable mechanism for keeping Workers alive during a dev session.

**ServiceWorker for HTTP virtualization (persistent by design):**

The ServiceWorker handling Atua's HTTP requests (preview iframe, Hono API routes) already survives page navigation and tab switches within the same origin. It has its own lifecycle:

- Installed once, persists until explicitly unregistered
- Wakes up on `fetch` events (any request from the preview iframe triggers it)
- Goes idle between events but restarts instantly
- Survives page refresh — the preview iframe continues to work after F5

The dev server's HTTP layer lives here. HMR WebSocket connections go through the SW. API route handlers (Hono) execute in the SW's fetch handler.

**BroadcastChannel keepalive (anti-throttling):**

```typescript
// Main thread sends periodic pings to prevent tab throttling
const channel = new BroadcastChannel('atua-keepalive');
setInterval(() => {
  channel.postMessage({ type: 'ping', timestamp: Date.now() });
}, 15_000); // Every 15 seconds

// Kernel Worker responds, proving it's alive
channel.onmessage = (e) => {
  if (e.data.type === 'ping') {
    channel.postMessage({ type: 'pong', pid: process.pid });
  }
};
```

Regular message exchange between main thread and Workers prevents the browser from marking them as idle. Combined with Web Locks, this keeps the kernel and process Workers alive even when the tab is backgrounded.

**Kernel-level process management:**

The hyperkernel's ProcessTable tracks every running process with state (`Running`, `Blocked`, `Zombie`, `Stopped`). The JS host layer monitors Worker health:

```typescript
class ProcessMonitor {
  // Periodic health check — detect crashed/terminated Workers
  checkHealth(pid: number): boolean {
    const process = kernel.getProcess(pid);
    if (process.state === ProcessState.Running) {
      // Send a no-op syscall to verify Worker responds
      const alive = this.probe(pid, { timeout: 5000 });
      if (!alive) {
        // Worker was GC'd or crashed — restart if restartable
        kernel.markZombie(pid);
        if (process.restartable) this.respawn(pid);
      }
      return alive;
    }
    return false;
  }
}
```

### What Runs Long-Lived

| Service | Lifetime | Mechanism | Notes |
|---|---|---|---|
| **Hyperkernel** | Session | Web Lock + dedicated Worker | Core of everything. If kernel dies, everything dies. Lock prevents GC. |
| **Rolldown** | Per-build | Process Worker, spawned per bundle operation | Short-lived. Kernel spawns for build, terminates on completion. Pool Workers reused. |
| **Dev server (Hono)** | Session | ServiceWorker fetch handler | Wakes on request. Naturally persistent — SW lifecycle handles this. |
| **HMR server** | Session | ServiceWorker + BroadcastChannel | File change → broadcast → preview iframe hot-reloads |
| **File watcher** | Session | Kernel Worker + Web Lock | Monitors OPFS for changes. Triggers rebuilds. Lock keeps it alive. |
| **wa-sqlite** | Per-query | Process Worker, can be pooled | Opens DB file → runs query → returns result. Persistent connection pooling optional. |
| **Pyodide** | Per-session | Process Worker + Web Lock | Heavy init (~5s). Keep alive for session. Lock prevents GC after expensive startup. |
| **Ralph (AI agent)** | Per-iteration | Short-lived process per loop iteration | Fresh context per cycle. No persistence needed between iterations. |

### What Happens When the Tab Closes

Everything dies. This is correct behavior for a development interface. The state that matters (source files, database, git history) is persisted in OPFS. When the user reopens Atua:

1. Kernel boots (~50ms — load 30KB WASM, initialize tables)
2. CatalystFS reconnects to OPFS (~10ms — files are already there)
3. Dev server restarts in ServiceWorker (~100ms)
4. Preview rebuilds from cached sources (~500ms with Rolldown, longer first time)
5. Back to where they left off, minus any in-memory state

Total cold start: under 1 second for a warm OPFS cache. The user's project, database, and git history survive indefinitely — only runtime processes restart.

---

## 8. Existing Projects & Crates — Building Block Inventory

### Tier 1: Direct Building Blocks

| Crate | What | Why | License | no_std |
|---|---|---|---|---|
| `slab` | Pre-allocated arena with stable integer keys | ResourceTable + ProcessTable. O(1) insert/lookup/remove, automatic key reuse | MIT | ✅ |
| `wasm-bindgen` + `js-sys` | Rust ↔ JS FFI | Kernel exports syscalls, JS host calls in. js-sys gives SAB, Atomics, Int32Array | MIT/Apache-2.0 | ✅ |
| `wasm_rs_shared_channel` | SAB message channel for WASM threads | Ready-made SAB + Atomics abstraction. Use directly or reference ~500 lines | Apache-2.0 | ✅ |
| `wasm_thread` | std::thread for wasm32 | Spawns Web Workers from Rust. Reference for thread→Worker mapping | MIT/Apache-2.0 | ✅ |

### Tier 2: Architectural Reference

| Project | Relevance | License |
|---|---|---|
| **Browsix** (UMass, 2016) | **Prior art defense only.** Proves SAB syscall pattern is published academic work predating WebContainers by 5 years. Do NOT use as implementation reference — Browsix is TypeScript, uses IndexedDB (not OPFS), lacks Atomics.waitAsync, predates WASI standard. The hyperkernel solves the same problem with entirely different (modern) APIs. | MIT |
| **Deno core** | ResourceTable pattern (`HashMap<u32, Box<dyn Resource>>`), ops dispatch. Can't use crate (v8/tokio deps), reimplement pattern using `slab` (~50-100 lines). The pattern is OS fundamentals, not Deno-specific. | MIT |
| **Wasmosis** (Wikimedia) | Capability-handle pattern for resource access, kernel-as-mediator | MIT |
| **k23 / Nebulet / TakaraOS** | Validate WASM microkernel architecture pattern | MIT/Apache-2.0 |

### Tier 3: Supporting Crates

| Crate | Purpose | License |
|---|---|---|
| `web-sys` | Web API bindings (Worker, MessagePort) | MIT/Apache-2.0 |
| `wee_alloc` | Tiny WASM allocator (~1KB) | MPL-2.0 |
| `console_error_panic_hook` | Debug panics → console.error | MIT/Apache-2.0 |
| `bitflags` | Typed flag sets (process flags, open modes) | MIT/Apache-2.0 |
| `hashbrown` | HashMap without std (fallback if slab insufficient) | MIT/Apache-2.0 |

### JavaScript/TypeScript Dependencies

These are battle-tested libraries used instead of hand-rolling equivalents. Each was selected because the "simple" hand-rolled version breaks on real-world edge cases.

| Package | What | Why not hand-roll | Size |
|---|---|---|---|
| `@bjorn3/browser_wasi_shim` | WASI preview1 implementation for browsers | 20+ syscalls with correct errno codes, pax headers, fd preallocation. Runs against wasi-testsuite. | ~15KB |
| `@rolldown/binding-wasm32-wasi` | Rolldown's official WASM+WASI browser build | Ships its own browser loader (`rolldown-binding.wasi-browser.js`) handling Worker pool, SAB setup, WASM loading. Don't rebuild what upstream provides. | ~12.5MB (WASM binary) |
| `comlink` | Worker RPC via ES6 Proxy over postMessage | Transfer handlers, SharedWorker/ServiceWorker/iframe support, TypeScript types. Google Chrome Labs maintained. | 1.1KB brotli |
| `semver` | npm's own semver resolution | Pre-release tags, build metadata, hyphen ranges, X-ranges, tilde/caret. Reference implementation — what npm itself uses. | ~16KB |
| `resolve.exports` | Package.json exports/imports field resolution | Subpath patterns, wildcards, nested conditions (browser/node/import/require). Shared approach across tools and bundlers. | 952B |
| `untar-sync` | Synchronous tar extraction | Handles ustar format, filename prefixes, all tar edge cases. Sync API works in Worker context where kernel runs. | ~3KB |
| `unenv` | Node.js API polyfills for browser | fs→kernel→OPFS, crypto→WebCrypto, path, buffer, stream, http→fetch, events, url, os, zlib. UnJS maintained. | varies |
| `esbuild-wasm` | Fallback bundler (MessageChannel mode) | Production bundler, works without SAB. Used when cross-origin isolation unavailable. | ~9MB (WASM binary) |

**Browser Platform APIs (no dependency needed):**

| API | Used for |
|---|---|
| OPFS (`createSyncAccessHandle()`) | CatalystFS — persistent filesystem with sync access in Workers |
| `SharedArrayBuffer` + `Atomics` | Kernel ↔ process syscall protocol (SAB mode) |
| `MessageChannel` | Kernel ↔ process fallback transport (MC mode) |
| `Web Locks API` | Single-writer guarantee for kernel state |
| `BroadcastChannel` | Cross-tab process coordination, keepalive |
| `ServiceWorker` | HTTP virtualization (Hono dev server in fetch handler) |
| `DecompressionStream` | Browser-native gzip for npm tarball extraction |
| `WebAssembly.compileStreaming` | Streaming WASM compilation |

---

### Design Principles

1. **Kernel is state + dispatch only.** Manages tables and routes syscalls. Never does I/O.
2. **Real work happens in JavaScript.** OPFS reads, ServiceWorker networking, Worker spawning — JS host layer.
3. **No Tokio, no std, no OS dependencies.** Pure `no_std` + `alloc` Rust → `wasm32-unknown-unknown`. The kernel IS the OS.
4. **WASI-compatible interface.** Guest WASM processes see standard WASI syscalls via the shim.
5. **Dual-mode IPC.** SAB + Atomics.wait when cross-origin isolated; MessageChannel when not.
6. **Pattern lineage from open-source.** ResourceTable (Deno, MIT), syscall dispatch (OS design fundamentals, validated by Browsix MIT prior art), capability mediation (Wasmosis, MIT).

### Modern Browser APIs (Implementation Stack)

The hyperkernel is built on browser APIs from 2021-2024, NOT on patterns from older projects like Browsix (2016). When implementing, use these specific modern APIs:

| Capability | Modern API (USE THIS) | Old Approach (DO NOT USE) |
|---|---|---|
| **Filesystem** | OPFS `createSyncAccessHandle()` — synchronous read/write/flush in Workers, no serialization overhead, W3C standard | IndexedDB (Browsix), custom block stores (WebContainers) |
| **Kernel monitoring** | `Atomics.waitAsync()` — non-blocking, monitors multiple process SAB regions from kernel Worker without spinning or blocking | Polling loops, `setInterval` checks, main-thread `Atomics.wait` |
| **Process blocking** | `Atomics.wait()` — blocks process Worker until kernel writes result. Standard since 2018, mature | `Atomics.wait` is correct here. No alternative needed. |
| **Guest process interface** | WASI `wasi_snapshot_preview1` — standard syscall interface that Rolldown, Python-WASM, Ruby-WASM all compile against | Custom syscall numbering, ad-hoc process APIs |
| **WASM threading** | `WebAssembly.Memory({ shared: true })` + `wasi_thread_spawn` → Worker pool with shared linear memory. napi-rs has production Worker pooling | Manual Worker coordination, message-passing between isolated WASM instances |
| **Kernel binary** | `wasm32-unknown-unknown` + `wasm-bindgen` — no_std Rust compiled to browser WASM, JS host calls via generated bindings | TypeScript kernel (Browsix), in-process Rust via v8 bindings (Deno) |
| **HTTP virtualization** | ServiceWorker `fetch` event interception — standard PWA pattern | Invisible iframe relay (StackBlitz patent), custom proxy servers |
| **Worker RPC (MC fallback)** | [Comlink](https://github.com/GoogleChromeLabs/comlink) (1.1kB brotli, Google Chrome Labs) — ES6 Proxy over `postMessage`, typed, supports Workers/SharedWorkers/ServiceWorkers/iframes, transfer handlers for efficient data movement | Raw postMessage with manual serialization/deserialization |

**Key point for implementors:** Browsix appears in this spec as prior art defense (proves the pattern predates WebContainers). It is NOT an implementation template. Do not reference Browsix source code. The browser platform has fundamentally different capabilities now than in 2016.

### Component Architecture

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
│  │  OPFS Bridge:  kernel says "read fd 3" → CatalystFS → OPFS │  │
│  │  SW Bridge:    kernel says "connect" → ServiceWorker        │  │
│  │  Worker Mgmt:  kernel says "spawn" → new Worker()           │  │
│  │  WASI Shim:    translates WASI imports ↔ kernel syscalls    │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ Kernel Syscall SAB
               ┌────────────┼────────────┐
               ▼            ▼            ▼
    ┌────────────────┐ ┌──────────┐ ┌──────────────────────┐
    │ JS Process W1  │ │ JS Proc  │ │  Rolldown-WASM       │
    │ (Ralph, shell)  │ │ W2       │ │  (guest process)     │
    │                 │ │          │ │                      │
    │ SAB syscall()   │ │ SAB      │ │ WASM Linear Memory   │
    │ Atomics.wait()  │ │ syscall()│ │ (own SAB for threads)│
    └────────────────┘ └──────────┘ │ WASI shim → kernel   │
                                    │ ┌──────┐ ┌──────┐    │
                                    │ │Thrd 1│ │Thrd 2│    │
                                    │ │Worker│ │Worker│    │
                                    │ └──────┘ └──────┘    │
                                    └──────────────────────┘
```

### SharedArrayBuffer Protocol

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

### Dual-Mode Transport

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

**SAB mode:** Full capability. Rolldown. Sync fs. ~95% npm compat.
**MC mode:** Async-only. esbuild-wasm fallback. No sync fs. ~70% npm compat. Still functional.

### Kernel Rust Structure

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

### Estimated Binary Size

| Component | Lines of Rust | Estimated WASM |
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

---

## 10. Implementation Phases

### Phase 0: Kernel Crate Setup
- Create `crates/hyperkernel`
- `#![no_std]` + `alloc`, deps: slab, wasm-bindgen, js-sys, wee_alloc, bitflags
- Target: `wasm32-unknown-unknown`, build: `wasm-pack build --target web`

### Phase 1: Core Tables
- ResourceTable (add/get/close), ProcessTable (spawn/kill/get)
- File, Pipe, Socket resource type stubs
- Unit tests (native Rust, no browser)

### Phase 2: Syscall Dispatch
- 20-syscall dispatch table
- `kernel.syscall(pid, nr, args) → (action, result)` entry point
- SyscallAction enum, wasm-bindgen exports

### Phase 3: SAB Protocol
- SAB layout, Atomics.waitAsync loop (kernel), Atomics.wait (process)
- End-to-end: readFileSync() → SAB → kernel → OPFS → SAB → unblock

### Phase 4: WASI Shim + Rolldown Integration
- `@bjorn3/browser_wasi_shim`: provides wasi_snapshot_preview1 implementation. Extend with CatalystFd subclass routing file ops to kernel syscalls → OPFS.
- Load @rolldown/binding-wasm32-wasi using Rolldown's shipped `rolldown-binding.wasi-browser.js` loader (handles Worker pool, SAB setup, WASM loading)
- Wire CatalystFd into the loader's WASI fds array so Rolldown reads/writes through kernel
- `wasi_thread_spawn` → SYS_SPAWN → Worker with shared WASM memory
- Two SAB regions: kernel syscall SAB + Rolldown WASM linear memory SAB
- End-to-end: OPFS source → Rolldown reads via WASI → kernel → bundles → OPFS

### Phase 5: MessageChannel Fallback + esbuild
- Same syscall() over postMessage when SAB unavailable
- Feature-detect: `self.crossOriginIsolated ? 'sab' : 'mc'`
- esbuild-wasm loaded as fallback bundler in MC mode
- Rolldown SAB-only, esbuild works everywhere

### Phase 6: Package Resolution
- Tier 1: esm.sh CDN integration in build plugin (rewrite bare imports to esm.sh URLs)
- Tier 2: Deno-style npm resolver using tested libraries:
  - `semver` (npm's own package) for `semver.maxSatisfying(versions, range)`
  - `untar-sync` for tarball extraction (sync, runs in Worker context)
  - `DecompressionStream` (browser-native) for gzip decompression
  - Registry fetch via `fetch()` to public npm registry API
  - Write to OPFS via kernel syscalls
- Content-addressable cache in OPFS (`/packages/{name}@{version}/`)
- unenv integration for Node API polyfills (fs, path, crypto, buffer, stream, http, events, url, os, zlib)
- `resolve.exports` (952B, by lukeed) for package.json exports/imports field resolution + `resolve.legacy` for main/browser/module fallback

### Phase 7: WASI Guest Targets
- wa-sqlite as WASI guest process — SQLite database on OPFS, sync access handles for I/O
- Generic guest process loader: fetch WASM binary → create WASI imports → spawn in Worker → register in ProcessTable
- Oxc standalone minifier as contingency if Rolldown's built-in isn't ready
- Squoosh-wasm for image processing (post-launch)
- Pyodide integration research (post-launch — large binary, complex init)

### Phase 8: Process Lifetime
- Web Locks for kernel Worker and critical process Workers
- ServiceWorker as Hono dev server host (fetch handler, naturally persistent)
- BroadcastChannel keepalive between main thread and Workers
- ProcessMonitor health checks — detect crashed/GC'd Workers, respawn if restartable
- Cold restart path: kernel boot → CatalystFS reconnect → dev server restart < 1 second

### Phase 9: Integration with Atua
- Replace ProcessManager MessageChannel plumbing with kernel
- CatalystFS → kernel syscalls → OPFS
- Worker lifecycle managed by kernel host
- Ralph shell commands unchanged (fs APIs → syscalls)
- Build pipeline: Ralph writes code → kernel fs → Rolldown → kernel fs → preview

---

## 11. Exit Criteria

1. ✅ `hyperkernel.wasm` compiles from `no_std` Rust to `wasm32-unknown-unknown`
2. ✅ Binary < 50KB after `wasm-opt`
3. ✅ Zero deps beyond slab, wasm-bindgen, js-sys, bitflags, wee_alloc
4. ✅ `readFileSync()` blocks via `Atomics.wait` in SAB mode
5. ✅ All 20 core syscalls dispatch correctly
6. ✅ WASI shim loads and runs Rolldown-WASM as guest process
7. ✅ Rolldown bundles multi-file TypeScript project via WASI → kernel → OPFS
8. ✅ Rolldown thread spawning works (kernel Worker pool + shared WASM memory)
9. ✅ MC fallback works with esbuild-wasm (no cross-origin isolation)
10. ✅ Process spawn/kill lifecycle end-to-end
11. ✅ Pipe between processes (stdout A → stdin B)
12. ✅ wa-sqlite runs as WASI guest, persists database to OPFS, survives page refresh
13. ✅ npm package resolution works: fetch registry → download tarball → extract to OPFS → importable
14. ✅ unenv polyfills provide ≥85% Node API coverage (fs, path, crypto, buffer, stream, http, events, url, os, zlib)
15. ✅ Dev server (Hono in ServiceWorker) stays alive for full dev session via Web Lock
16. ✅ Kernel Worker survives tab backgrounding via Web Lock + BroadcastChannel keepalive
17. ✅ Cold restart from OPFS cache < 1 second (kernel boot + CatalystFS reconnect + dev server restart)
18. ✅ No StackBlitz code, no WebContainers code, no proprietary deps
19. ✅ All patterns traceable to open-source prior art

---

## 12. Key Decisions & Rationale

### Why Rolldown instead of esbuild?
esbuild-wasm (Go→WASM) slower than JS Rollup in browsers (Evan You). Rolldown (Rust→WASM) with thread pooling is faster. Provides Rollup/Vite plugin compat. Default bundler for Vite 8 — ecosystem alignment. The hyperkernel enables it: Atua becomes only open-source Rolldown-in-browser runtime.

### Why keep esbuild as fallback?
Rolldown requires SAB. No headers = no Rolldown = no bundling. esbuild requires nothing. Keeping it preserves "higher floor" advantage over WebContainers. Distribution advantage: embed Atua anywhere without server config changes.

### Why Rust WASM kernel, not TypeScript?
~30KB WASM vs larger TS bundle. Type safety catches resource leaks at compile time. Faster dispatch for critical-path syscalls. WASM in Worker alongside other WASM, no JS engine overhead on hot path.

### Why `slab` not `HashMap`?
Integer keys = fd/pid numbers. O(1) ops. Automatic key reuse. No hashing overhead. `no_std`.

### Why dual-mode (SAB + MC)?
Not all contexts support COOP/COEP. Progressive enhancement: MC + esbuild → SAB + Rolldown. WebContainers is SAB-only. Same ceiling, higher floor.

### Why not Wasmer/Wasmtime in browser?
Browser already has WASM runtime (V8). Hyperkernel provides OS services (fs, processes, threads) to guest processes. Different problem.

---

## 13. Competitive Positioning

### Atua (with Rolldown + Hyperkernel) vs WebContainers

**Equal:** JS execution speed, sync fs APIs, CommonJS, ESM, process piping, HTTP virtualization.

**Atua wins:** No vendor lock-in, dual-mode degradation (MC + esbuild fallback), OPFS filesystem (W3C standard, browser-optimized), transparent kernel (syscall tracing, auditable), Deno/edge alignment, QuickJS validation tier, WASI guest hosting for non-JS tools (wa-sqlite, Pyodide), Web Lock-based process persistence, cold restart < 1 second from OPFS cache.

**WebContainers wins:** Maturity (4 years production), Turbo npm client (optimized CDN), Node.js API breadth, ecosystem/docs, C/C++ addon WASM ports, battle-tested at scale.

**Gap to close (engineering hours, not architecture):** npm client speed for large dependency trees (esm.sh fast path covers most cases, full resolver covers the rest but slower than Turbo), Node API long-tail coverage beyond unenv's ~85%, battle-testing top 100 packages, documentation.

### What Atua Runs

**Runs well (SAB mode):** Any Vite project (React, Vue, Svelte, Solid, Astro, vinext). SPAs, static sites. TypeScript/JSX natively via Rolldown/Oxc. Hono APIs targeting Workers. CSS preprocessing (PostCSS, Tailwind via oxide-wasm). SQLite databases (wa-sqlite on OPFS). Any npm package that's pure JavaScript.

**Runs with caveats:** npm packages with complex dependency trees (first install slow, cached fast). Node.js APIs via unenv (~85% coverage — common modules work, raw sockets don't). Testing frameworks (Vitest preferred, Jest needs shimming).

**Doesn't run:** Native C++ addons (sharp, bcrypt-native — use WASM alternatives). Real OS processes (gcc, docker, system shell scripts). Raw TCP/UDP (no `net`/`dgram` in browsers). Webpack projects (Rolldown is Rollup-compatible, not Webpack-compatible). Persistent background daemons beyond dev session.

**Degraded in MC mode:** esbuild-wasm instead of Rolldown. No Vite plugin compat. No sync fs. Slower bundling. ~70% npm coverage. Still functional for basic development.

---

## 14. References

| Resource | URL | Relevance |
|---|---|---|
| Browsix | github.com/plasma-umass/browsix | Prior art: browser Unix kernel, SAB syscalls (MIT) |
| Browsix paper | "BROWSIX: Bridging the Gap Between Unix and the Browser" | Academic paper |
| Deno core | github.com/denoland/deno → core/resources.rs | ResourceTable pattern (MIT) |
| Wasmosis | github.com/bvibber/wasmosis | Capability-passing WASM microkernel (MIT) |
| k23 / Nebulet / TakaraOS | Various | WASM microkernel validation (MIT) |
| Rolldown | github.com/rolldown/rolldown | Rust JS bundler, Vite 8 default (MIT) |
| @rolldown/binding-wasm32-wasi | npm | Rolldown WASM binary (~12.5MB, MIT) |
| Rolldown WASI discussion | github.com/rolldown/rolldown/discussions/3391 | Browser WASM status |
| Rolldown WASI issue #898 | github.com/rolldown/rolldown/issues/898 | Tokio deadlock, threading |
| Evan You on Rolldown WASM | x.com/youyuxi/status/1869608132386922720 | esbuild slower than Rollup; threading fix |
| vinext | github.com/cloudflare/vinext | Vite-based Next.js reimplementation (MIT) |
| Vite 8 Beta | vite.dev/blog/announcing-vite8-beta | Rolldown as default Vite bundler |
| StackBlitz patent | Justia Patents (StackBlitz, Inc.) | Covers invisible iframe relay ONLY |
| slab | crates.io/crates/slab | Arena allocator (MIT) |
| wasm_rs_shared_channel | crates.io/crates/wasm_rs_shared_channel | SAB channel (Apache-2.0) |
| wasm_thread | crates.io/crates/wasm_thread | std::thread for WASM (MIT) |
| wee_alloc | crates.io/crates/wee_alloc | Tiny WASM allocator (MPL-2.0) |
| wa-sqlite | github.com/rhashimoto/wa-sqlite | SQLite WASM with OPFS persistence (MIT) |
| sql.js | github.com/sql-js/sql.js | SQLite compiled to WASM via Emscripten (MIT) |
| Pyodide | github.com/pyodide/pyodide | CPython compiled to WASM, scientific stack (MPL-2.0) |
| ruby.wasm | github.com/aspect/ruby.wasm | Ruby interpreter compiled to WASM (MIT) |
| squoosh | github.com/aspect/libsquoosh | Google image codecs compiled to WASM (Apache-2.0) |
| unenv | github.com/unjs/unenv | Node.js API polyfills for non-Node environments (MIT) |
| Oxc | github.com/aspect/oxc | Rust-based JS linter/formatter/minifier (MIT) |
| esm.sh | esm.sh | CDN serving npm packages as ES modules |
| npm registry API | registry.npmjs.org | Public npm package registry, no auth for public packages |
| DecompressionStream | MDN Web Docs | Browser-native gzip decompression (W3C standard) |
| Web Locks API | MDN Web Docs | Prevents Worker GC during active operations (W3C standard) |
| BroadcastChannel | MDN Web Docs | Cross-context message passing (W3C standard) |
| Hono service-worker | hono.dev/docs/getting-started/service-worker | Hono adapter for ServiceWorker runtime |
