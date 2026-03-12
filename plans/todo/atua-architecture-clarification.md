# Atua Architecture Clarification

**Status:** Addendum — corrects framing in `atua-unified-spec.md` and `atua-hyperkernel-spec.md`
**Date:** 2026-03-09

---

## What This Corrects

Both `atua-unified-spec.md` and `atua-hyperkernel-spec.md` open with "The hyperkernel is its core." This is wrong. The core of Atua is the browser's own V8 engine + unenv + browser APIs. The component called "hyperkernel" is a WASI host and SAB sync protocol for specific WASM tool binaries. It is not a kernel. User code never touches it.

The roadmap (`catalyst-roadma2p.md`) already reflects the correct architecture — Phases 0-5 build a complete, working runtime without any Rust WASM kernel. Phase 6 adds WASI guest process support as an optimization (Rolldown replaces esbuild as primary bundler). The specs were written as if Phase 6 is the foundation when it's actually the last thing built.

This addendum establishes the correct framing. Everything in the existing specs remains technically valid — the SAB protocol, the WASI shim, the Rolldown integration, the CatalystFd routing — all of that is real infrastructure that works as described. What changes is where it sits in the architecture: it's a support module, not the foundation.

---

## The Actual Architecture

### Core: Deno-Aligned Browser Runtime

Atua is a browser-native runtime targeting Cloudflare Workers and Deno deployment. The browser already provides the same engine (V8) and event loop that production uses. unenv bridges the API surface — same role as `nodejs_compat` on Workers, same role as `node:` specifiers on Deno. Same subset, same gaps, same behavior.

Apps built in Atua deploy to Workers or Deno unchanged. Code that works in Atua works in production. Code that doesn't work on Workers doesn't need to work in Atua.

```
Browser's V8 ──── same engine as Workers and Deno
     +
unenv ─────────── same API bridge as Workers nodejs_compat
     +
OPFS ──────────── persistent filesystem (AtuaFS)
Workers ───────── process isolation (AtuaProc)
ServiceWorker ─── HTTP virtualization (Hono dev server)
fetch ─────────── networking (AtuaNet)
WebCrypto ─────── crypto
```

This is the runtime. This is what user code runs on. This is what the agent (Pi) lives in. 95% of everything happens here.

### WASM Tools: Where WASM Earns Its Place

Specific tools are better as WASM than as JavaScript. They run alongside the runtime, not underneath it:

| Tool | Why WASM | What it does |
|---|---|---|
| Rolldown | Rust bundler, faster than JS alternatives | Bundles JS/TS projects. Vite 8 default. |
| wa-sqlite | Real SQLite, not a JS reimplementation | Database with OPFS persistence. D1-compatible. |
| esbuild-wasm | Proven Go bundler | Fallback bundler when SAB unavailable. |
| Oxc | Rust parser/linter, faster than any JS parser | Lint, format, minify. |
| squoosh-wasm | Google image codecs | Image resize/compress/convert. Post-launch. |

Each loaded lazily. Zero bytes until needed. Each talks to OPFS through `@bjorn3/browser_wasi_shim` + CatalystFd.

### SAB Sync Protocol: The Real Infrastructure

The one genuinely novel piece of engineering. WASI tools (Rolldown, wa-sqlite) need synchronous I/O — `fd_read` must block and return data. Browsers are async. The SAB protocol bridges this:

```
WASI tool calls fd_read()
     → Atomics.wait() blocks the tool's Worker thread
     → Kernel-side Worker detects via Atomics.waitAsync()
     → Reads from OPFS
     → Writes result to SAB
     → Atomics.notify() unblocks the tool
```

This is ~200 lines of TypeScript. It exists so Rolldown's Tokio event loop doesn't deadlock (Tokio calls fd_read on the same thread — needs a separate thread doing the actual I/O). It also enables wa-sqlite's synchronous access patterns.

User code does NOT go through this protocol. User code runs on V8 with unenv's async APIs. The SAB protocol is internal plumbing for WASM tool binaries.

### AtuaBox: Linux Escape Hatch

When the agent needs something outside the Workers/Deno surface — `gcc`, `imagemagick`, `ffmpeg`, `git` with SSH, native compilation — AtuaBox provides real Alpine Linux via v86 (BSD, x86 JIT, proven by Apptron).

AtuaBox is a build tool. It produces artifacts and gets out of the way. Pi stays in the V8 runtime and drives AtuaBox through Fabric MCP tools (`box.exec`). The 9p filesystem bridge shares AtuaFS between both runtimes — no file copying.

```
Pi (V8 runtime) ──── always here, always running
  │
  ├── normal work ──→ V8 + unenv + browser APIs
  │
  └── needs native tool ──→ box.exec() via Fabric
                              │
                         AtuaBox (v86 + Alpine)
                              │
                         output in AtuaFS
                              │
                         Pi picks it up ←──────┘
```

Apps always deploy as standard JS/TS to Workers or Deno. AtuaBox is never the production runtime. It's like Docker in CI — used during development, absent in production.

---

## What the "Hyperkernel" Actually Is

Rename: **`@aspect/atua-wasi`** — a WASI host module.

It provides:
1. SAB sync protocol (~200 lines TS) — Atomics.wait/waitAsync monitoring loop
2. CatalystFd (~100 lines TS) — subclass of browser_wasi_shim's `Fd`, routes WASI file ops through SAB to OPFS
3. Rolldown thread pool (~200 lines TS) — manages Worker threads for Rolldown's `wasi_thread_spawn`, shared WASM memory

It does NOT provide:
- A kernel that user code runs through
- Process management (browser manages Workers)
- File management (OPFS manages files)
- Resource tracking (browser_wasi_shim manages WASI fds)

The Rust `no_std` kernel (ResourceTable, ProcessTable, SignalTable, 20-syscall dispatch, ~1,760 lines Rust, ~30KB WASM) described in the existing specs is over-engineered for what the module actually does. The browser already manages the resources the Rust kernel re-tracks. The ~500 lines of TypeScript described above accomplish the same functional goals.

Whether to keep the Rust implementation or replace it with TypeScript is an implementation decision. The architecture doesn't depend on the language — it depends on the SAB protocol working correctly.

---

## Corrections to Existing Specs

### `atua-unified-spec.md`

**§1 opening:** "The hyperkernel is its core" → The core is the browser's V8 + unenv + browser APIs. The WASI host module (`@aspect/atua-wasi`) is infrastructure for specific WASM tools.

**§1 full stack diagram:** The diagram shows "Atua Runtime — Hyperkernel" as the top-level container. Correct framing: the runtime IS V8 + unenv + Workers + ServiceWorker + OPFS. The WASI host sits alongside as a module for WASM tools.

**§3 dependency manifest:** Remove `quickjs-emscripten` from core dependencies. QuickJS stays in `@aspect/atua-embedded` for NanoClaw deployment targets, not in the browser runtime.

**§4 "Kernel Core":** This section describes real, working infrastructure (SAB protocol, WASI shim, thread pool). The code is valid. The framing ("The hyperkernel is a `no_std` Rust crate... The kernel IS the OS") is wrong. It's a WASI host module, not an OS.

### `atua-hyperkernel-spec.md`

**§1 "Problem Statement":** "Atua ships with the hyperkernel. There is no pre-kernel version." → The roadmap shows Phases 0-5 working without it. esbuild-wasm is the bundler until Phase 6 adds Rolldown via the WASI host.

**Title:** "Hyperkernel Specification" → "WASI Host & SAB Sync Protocol Specification" (or similar). The document's technical content is valid — the Rolldown integration, Tokio deadlock solution, wa-sqlite hosting, SAB protocol — all correct. The naming creates the wrong mental model.

### `catalyst-roadma2p.md`

**Already correct.** The roadmap builds Phases 0-5 as a complete runtime, then adds Phase 6 (WASI + Guest Processes) as an enhancement. The roadmap matches the actual architecture. The specs don't match the roadmap.

### New content needed

**AtuaBox** — not mentioned in any existing spec. The `atuabox-spec.md` produced in this conversation covers it. Needs to be added to the roadmap as a post-Phase 6 track.

**Deployment targets** — Workers + Deno as the compatibility surface. This is implied but never stated explicitly. Apps built in Atua target these platforms. The browser runtime matches their API surface. This should be in §1 of the unified spec.

**Runtime execution model** — the `atua-runtime-execution-spec.md` produced in this conversation covers the WorkerContext / AtuaBoxContext / InlineContext model and the removal of QuickJS Tier 0. Needs to be reconciled with the tiered engine plan.

---

## The Correct Mental Model

```
┌──────────────────────────────────────────────────────┐
│                    Atua Runtime                        │
│                                                        │
│  V8 (browser's own) + unenv + browser APIs             │
│  ├── AtuaFS (OPFS)                                     │
│  ├── AtuaProc (Workers)                                │
│  ├── AtuaNet (ServiceWorker + fetch + relay)           │
│  ├── AtuaPkg (JSR + npm + esm.sh)                      │
│  ├── AtuaBuild (Rolldown or esbuild)                   │
│  └── Pi (agent, lives here permanently)                │
│                                                        │
│  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │  @aspect/atua-wasi │  │  @aspect/atua-box        │  │
│  │                    │  │                          │  │
│  │  SAB sync protocol │  │  v86 + Alpine Linux      │  │
│  │  CatalystFd        │  │  9p bridge to AtuaFS     │  │
│  │  Rolldown thread   │  │  Serial console          │  │
│  │  pool              │  │  Snapshots               │  │
│  │                    │  │                          │  │
│  │  For: WASM tools   │  │  For: native Linux       │  │
│  │  that need sync IO │  │  binaries                │  │
│  └────────────────────┘  └──────────────────────────┘  │
│                                                        │
│  All three communicate through Fabric (MCP hub)        │
│  All three read/write AtuaFS (OPFS)                    │
│  Apps deploy to Workers or Deno unchanged              │
└──────────────────────────────────────────────────────┘
```
