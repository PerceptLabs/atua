# Catalyst Tiered Engine Architecture

## The Problem Statement

Catalyst currently runs all user JavaScript through QuickJS-WASM — a separate JS interpreter running inside the browser's own JS engine. This means V8 interpreting QuickJS interpreting user code. Double interpretation. It works, but it's slow and limits compatibility.

Meanwhile, we discovered that WebContainers doesn't compile V8 to WASM either. They use the browser's native JS engine directly and built the OS layer (filesystem, networking, process management) in Rust compiled to WASM. The "hard problem" was never V8 — it was the infrastructure around it.

Catalyst already has most of that infrastructure. What it needs is to stop routing user code through QuickJS and instead run it on the browser's own engine, with QuickJS repurposed as a security validation layer.

This document resolves the current stubs and partial implementations, defines the tiered execution model, and maps the path to full compatibility across both targets: Cloudflare Workers and Deno.

---

## Current State Audit — What's Real, What's Stubbed

Post-Phase 13 (648 tests passing, 322 Node + 326 Browser), here is the honest status of every Catalyst subsystem.

### Solid — Working and Tested

**CatalystFS** — OPFS primary, IndexedDB fallback, multi-mount architecture, file watching via FileSystemObserver with polling fallback. This is production-quality. No changes needed.

**CatalystEngine (QuickJS integration)** — Boot, eval, require chain, JSPI detection, memory/CPU limits, console capture. The engine abstraction interface (create, eval, evalFile, events) is clean. The abstraction stays; the default implementation changes.

**unenv integration** — 96.2% Node.js API coverage (76/79 methods). Provider tagging (catalyst: 43, unenv: 33, not_possible: 3). SHA-256 litmus test passes. Real crypto via WebCrypto, real streams via readable-stream. This is the Node compat layer and it's solid.

**CatalystPkg** — esm.sh resolution, OPFS package caching, lockfile management (catalyst-lock.json), NpmResolver with semver resolution and circular dependency detection, LRU eviction in PackageCache. Works for the esm.sh path.

**BuildPipeline** — esbuild-wasm transpiler for JSX/TSX, HMR support, build caching. Real esbuild, not a shim.

**Security** — 29 security tests covering path traversal, null byte injection, sandbox escape attempts, domain spoofing. Proven baseline.

**WASI Bindings** — WASI Preview 1 implementation with fd table (0/1/2 + preopened dirs), cleanroom approach (not Wasmer-JS). Binary cache for WASM modules.

**SyncClient/SyncServer** — Versioned handshake protocol, operation journal, conflict resolution. Protocol versioning already implemented.

### Partial — Works But Incomplete

**ProcessManager (CatalystProc)** — Worker isolation exists (WorkerPool, Blob URL Workers, Worker.terminate() for SIGKILL). However:
- Hardcodes QuickJS-WASM per Worker instance
- No stdio piping between Workers (stdin/stdout/stderr routing)
- No signal propagation beyond SIGKILL
- Inline fallback works but lacks the pipe infrastructure for `process A | process B`

**CatalystNet (FetchProxy)** — MessageChannel-based fetch proxy with domain filtering works. However:
- No `http.createServer()` support — Express's `http.createServer(app)` fails
- No port binding / TCP virtualization
- No Service Worker request interception for "local servers"
- `require('http')` exists via unenv but only client-side, not server-side

**Hono Integration** — Phase 13b bundled real Hono (18KB) with official Service Worker adapter. Middleware chains, cors(), jwt(), zod-validator work. However:
- The Service Worker serves on a fixed path, not dynamic ports
- No inter-process routing (Worker A can't fetch Worker B's HTTP server)

**Node `http` module** — unenv provides the module, but `createServer()` returns a stub that doesn't actually listen. In a browser, there's no TCP listener. The native engine approach changes this (see below).

**Node `net` module** — Stub that throws helpful errors. Cannot work in any browser engine (no raw TCP). This is a permanent browser limitation, not a Catalyst gap.

**Node `child_process`** — `exec` and `spawn` map to Worker spawning. But the Worker currently boots a QuickJS instance, not native code. stdio is captured but not piped.

### Stubs / Not Implemented

**Node `tls` module** — Stub. Cannot work in browser (no raw TLS sockets). Permanent limitation.

**Node `dns` module** — Stub. Cannot work in browser (no DNS resolver access). Permanent limitation.

**Node `cluster` module** — Not implemented. Could map to Worker pool but low priority.

**Node `worker_threads`** — Not implemented. Could map to Web Workers but the semantics differ (SharedArrayBuffer-based communication vs MessagePort). Feasible but complex.

**Node `vm` module** — Not implemented. `vm.runInContext()` requires V8 context creation. In QuickJS mode, impossible. In native engine mode, feasible via `new Function()` or SES Compartments.

**Node `inspector` module** — Not implemented. In native engine mode, Chrome DevTools provides this for free.

**npm install as a process** — esm.sh handles package resolution, but there's no `npm install` CLI emulation. No postinstall script execution. No lifecycle hooks. Packages requiring native compilation or postinstall steps don't work.

**Dev server execution** — Cannot run `vite dev`, `next dev`, or `astro dev` as long-running processes. These depend on real `node:fs` watching, `node:http` serving, and `child_process` spawning at behavioral depth beyond API surface.

**packages/dev and packages/pkg** — Empty re-exports from core. Everything lives in packages/core. The monorepo split is structural, not functional.

---

## The Tiered Engine Architecture

### Three Execution Tiers

**Tier 0 — QuickJS Validation (WASM Sandbox)**

QuickJS-WASM becomes the security gate, not the runtime. User code enters QuickJS first for validation:

- Parse and walk the AST — detect `eval()`, `Function()` constructor abuse, prototype pollution, `import()` of unexpected modules
- Execute against stub APIs — does the code try to access things outside its scope?
- Validate the require/import graph — only known-good modules
- Enforce time and memory limits — QuickJS has built-in CPU tick limits and memory caps
- Check for infinite loops, memory bombs, resource exhaustion patterns

This tier runs in milliseconds. It's parsing and quick execution, not running the full application. If validation passes, the code is promoted.

**Tier 1 — Native Engine Execution (Browser V8/SpiderMonkey/JSC)**

Validated code runs in a Web Worker on the browser's native JS engine at full speed. The Worker bootstraps a Node.js-compatible environment before user code executes:

1. Inject `require()` backed by unenv polyfills + CatalystFS
2. Set up `process`, `global`, `__dirname`, `__filename`, `module`, `exports`
3. Wire `fs` operations to CatalystFS via MessagePort
4. Wire `fetch` through CatalystNet's MessageChannel proxy
5. Wire `console` to capture output back to host
6. Shadow dangerous globals (`self.indexedDB = undefined`, etc.)
7. Execute user code via `new Function()` or dynamic `import()`

User code runs at native V8 speed. Everything the browser provides — async/await, Promises, generators, WeakRef, FinalizationRegistry, all ES2024+ features — works natively. Chrome DevTools debugging works. Profiling works.

**Tier 2 — QuickJS Full Execution (Workers Compatibility Mode)**

For Cloudflare Workers deployment target, QuickJS remains the actual runtime. This is not a fallback — it's a deliberate product mode that matches the constrained Workers execution model:

- Strict Workers API surface only (no Node.js globals unless `nodejs_compat` flag)
- 128MB memory limit enforcement
- CPU time limits (mirrors Cloudflare's 10ms/50ms limits)
- No filesystem access in execution context (Workers don't have `fs`)
- fetch handler pattern: `export default { fetch(request, env, ctx) { ... } }`

This mode validates that code will actually deploy to Cloudflare Workers. If it runs here, it runs on Cloudflare.

### When Each Tier Activates

| Context | Tier | Why |
|---------|------|-----|
| Ralph generates new code | Tier 0 → Tier 1 | Validate AI output, then run at full speed |
| User edits code manually | Tier 1 (skip validation) | Trust the developer, maximize speed |
| Preview / dev server | Tier 1 | Native speed for interactive development |
| Workers deployment target | Tier 2 | Match the actual Cloudflare runtime constraints |
| Untrusted code (e.g., npm postinstall) | Tier 0 → Tier 1 | Validate before executing |
| Unit tests running | Tier 1 | Speed matters for test feedback loops |
| Workers compliance check | Tier 2 | "Will this deploy?" validation |

### Security Model — Defense in Depth

The tiered model gives two layers of sandboxing:

**Layer 1 — QuickJS WASM sandbox (Tier 0):** User code cannot access browser globals, cannot reach the network, cannot touch the filesystem. It's a jail. Application-level attacks (code trying to escape its role) are caught here.

**Layer 2 — Browser sandbox (Tier 1):** Even if code passes validation and runs natively, it's in a Web Worker with shadowed globals. The browser's own security sandbox prevents system-level escapes. No code can break out of the tab.

WebContainers has only Layer 2. Catalyst with tiered execution has both.

---

## The Native Engine Worker Bootstrap

The Worker template is the heart of Tier 1. It creates a Node.js-compatible environment using the browser's native engine.

### Bootstrap Sequence

```
Worker starts
  │
  ├─ 1. Import unenv polyfills (crypto, stream, http, os, zlib, etc.)
  │
  ├─ 2. Import CatalystFS bridge (MessagePort → OPFS operations)
  │
  ├─ 3. Import CatalystNet bridge (MessagePort → fetch proxy)
  │
  ├─ 4. Build `require()` function
  │     ├─ Built-in module? → return unenv polyfill
  │     ├─ Relative path? → read from CatalystFS → evaluate
  │     ├─ In /node_modules? → read from CatalystFS/OPFS cache → evaluate
  │     ├─ In PackageManager? → resolve via esm.sh → cache → evaluate
  │     └─ Not found → throw MODULE_NOT_FOUND
  │
  ├─ 5. Set up Node.js globals
  │     ├─ process (pid, env, argv, cwd, exit, nextTick)
  │     ├─ global / globalThis
  │     ├─ __dirname, __filename
  │     ├─ module, exports
  │     ├─ Buffer (from unenv)
  │     ├─ setTimeout, setInterval (native, no change needed)
  │     └─ console (intercepted, routed to host via MessagePort)
  │
  ├─ 6. Shadow browser-specific globals
  │     ├─ self.indexedDB = undefined
  │     ├─ self.caches = undefined
  │     ├─ self.WebSocket = CatalystWebSocket (controlled)
  │     ├─ self.fetch = catalystFetch (proxied through CatalystNet)
  │     ├─ self.importScripts = undefined
  │     └─ self.registration = undefined (prevent SW access)
  │
  └─ 7. Execute user code
        new Function('require', 'module', 'exports', '__dirname', '__filename', userCode)
          (require, module, exports, dirname, filename);
```

### What Changes vs What Stays

| Component | Changes? | Details |
|-----------|----------|---------|
| CatalystFS | No | OPFS + IndexedDB, unchanged. Workers access via MessagePort. |
| CatalystNet | Minor | Add server-side http.createServer() support via MessagePort request routing |
| CatalystPkg | No | esm.sh resolution, OPFS cache, lockfiles — all unchanged |
| BuildPipeline | No | esbuild-wasm stays for JSX/TSX/TS compilation |
| ProcessManager | Yes | Worker template changes from "load QuickJS" to "bootstrap Node env" |
| CatalystEngine | Yes | New `NativeEngine` implementation alongside existing `QuickJSEngine` |
| unenv polyfills | No | Already the Node compat layer, just loaded differently |
| Security tests | Minor | Add Tier 0 validation tests, existing Tier 1 security tests stay |
| WASI Bindings | No | Still needed for WASM modules (Python, Go, Rust compiled to WASM) |

---

## Resolving the Stubs — What the Native Engine Unlocks

### `http.createServer()` — Now Possible

In QuickJS mode, `http.createServer()` is a stub because there's no way to listen for incoming requests inside a WASM interpreter. In native engine mode, the Worker IS a real JavaScript context. The pattern:

1. User code calls `http.createServer(handler)` 
2. The unenv http polyfill registers the handler with the Worker's message system
3. When a request arrives (via MessagePort from the Preview Service Worker or from another Worker), it's wrapped as a Node `IncomingMessage`
4. The handler processes it and returns a `ServerResponse`
5. The response routes back through MessagePort

This isn't raw TCP. It's HTTP request/response over MessagePort. But it's exactly what Express, Fastify, Hono, and Koa actually need — they don't care about TCP sockets, they care about Request → Response.

### `child_process.spawn()` — Full Pipeline

Currently, CatalystProc spawns Workers but each loads QuickJS. With native engine Workers:

1. `spawn('node', ['script.js'])` creates a new Web Worker
2. The Worker bootstraps the Node environment (same bootstrap sequence)
3. It loads and executes script.js at native speed
4. stdin/stdout/stderr connect via MessagePort to the parent
5. Parent can pipe: `const child = spawn(...); child.stdout.pipe(process.stdout)`

This enables `npm install` as a real process, test runners as real processes, and build tools as real processes.

### `vm` Module — Feasible via SES

In QuickJS mode, `vm.createContext()` is impossible because you can't create isolated V8 contexts inside QuickJS. In native engine mode:

1. `vm.runInNewContext(code, sandbox)` → `new Function()` with controlled scope
2. For deeper isolation → SES `Compartment` (Agoric's Secure ECMAScript, available on npm)
3. `vm.Script` → wraps `new Function()` with caching

Not 100% of Node's `vm` API (no `vm.measureMemory()`), but the core use cases work.

### `worker_threads` — Maps to Web Workers

In native engine mode, `worker_threads` maps naturally:

1. `new Worker(filename)` → spawns a Web Worker with the bootstrap + user script
2. `parentPort` → the Worker's MessagePort back to spawner
3. `workerData` → passed via Worker constructor options
4. `SharedArrayBuffer` → works natively in the browser (with COOP/COEP or JSPI)

The semantics aren't identical (Web Workers have different thread lifecycle rules), but the common patterns work: offloading CPU work, parallel processing, shared memory.

### Chrome DevTools Integration — Free

In QuickJS mode, debugging user code requires custom tooling. In native engine mode, Chrome DevTools just works:

- Set breakpoints in user code
- Step through execution
- Inspect variables, call stacks, closures
- Profile CPU and memory usage
- Network panel shows proxied requests

This is what WebContainers touts as a major feature. With native engine execution, Catalyst gets it for free.

---

## Dual Target Architecture

Catalyst serves two deployment targets. The engine tier and runtime surface differ by target.

### Target 1: Cloudflare Workers

**Engine:** QuickJS (Tier 2) for deployment validation, Native (Tier 1) for development

**Runtime Surface:**
- Web standard APIs: fetch, Request, Response, Headers, URL, URLSearchParams, TextEncoder/Decoder, crypto.subtle, Streams API, AbortController, structuredClone
- Workers-specific bindings: KV, R2, D1, Durable Objects, Queues, AI (stubbed/proxied via CatalystWorkers)
- Optional `nodejs_compat`: Buffer, EventEmitter, assert, util, stream, crypto, path, StringDecoder (via unenv — the same polyfills Cloudflare uses)

**Entry Pattern:**
```javascript
export default {
  async fetch(request, env, ctx) {
    // Workers fetch handler
    return new Response('Hello');
  }
}
```

**What Catalyst provides:**
- CatalystWorkers wraps the Service Worker to present the Workers execution model
- Binding stubs (KV, R2, D1) backed by OPFS for local development
- Workers compliance gate — validates code runs within Workers constraints
- Wrangler-compatible configuration parsing

**Testing:** Tier 2 (QuickJS) runs the code with Workers constraints enforced. If it passes, it deploys to Cloudflare. Tier 1 (native) runs the same code during development for speed.

### Target 2: Deno / Full Node

**Engine:** Native (Tier 1) with QuickJS validation (Tier 0) for AI-generated code

**Runtime Surface:**
- Full Node.js API via unenv (96.2% coverage, expanding)
- Deno standard APIs where they overlap with web standards (fetch, crypto.subtle, Web Streams)
- npm package support via esm.sh + OPFS cache
- Full `http.createServer()` support via MessagePort routing
- `child_process.spawn()` via Worker spawning
- `fs` operations via CatalystFS (OPFS-backed)

**Entry Pattern:**
```javascript
// Node-style
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3000);

// or Deno-style
import { serve } from "https://deno.land/std/http/server.ts";
serve((req) => new Response("Hello"), { port: 3000 });

// or Hono (works in both)
import { Hono } from 'hono';
const app = new Hono();
app.get('/', (c) => c.text('Hello'));
export default app;
```

**What Catalyst provides:**
- Native engine execution at full V8 speed
- Complete Node.js environment bootstrap in each Worker
- Process management with stdio piping
- HTTP server via MessagePort + Service Worker request interception
- Package management with real dependency trees
- Build pipeline (esbuild-wasm) for TypeScript/JSX

**Testing:** Tier 1 runs everything at native speed. Tier 0 validates AI-generated code before execution. Node.js test suite subsets run as conformance checks.

### How They Share Infrastructure

```
                    ┌─────────────────────────────────┐
                    │        Shared Packages           │
                    │                                   │
                    │  catalyst-fs     (OPFS + IDB)    │
                    │  catalyst-net    (MessageChannel) │
                    │  catalyst-proc   (Worker pool)    │
                    │  catalyst-pkg    (esm.sh + OPFS)  │
                    │  catalyst-dev    (esbuild + HMR)  │
                    │  catalyst-wasi   (WASI P1)        │
                    │  catalyst-sync   (journal + CRDTs)│
                    │  engine-interface (IEngine)        │
                    │  unenv           (Node polyfills)  │
                    └────────┬──────────────┬───────────┘
                             │              │
                    ┌────────▼──────┐ ┌─────▼──────────┐
                    │  QuickJS Eng  │ │  Native Engine  │
                    │  (WASM jail)  │ │  (browser V8)   │
                    └────────┬──────┘ └─────┬──────────┘
                             │              │
              ┌──────────────▼──┐     ┌─────▼──────────────┐
              │  @aspect/catalyst│     │  @aspect/reaction   │
              │  (Workers target)│     │  (Deno/Node target) │
              └─────────────────┘     └────────────────────┘
```

### The IEngine Interface (Unchanged)

Both engines implement the same interface. The existing CatalystEngine abstraction stays:

```typescript
interface IEngine {
  create(config: EngineConfig): Promise<void>;
  eval(code: string): Promise<unknown>;
  evalFile(path: string): Promise<unknown>;
  destroy(): void;
  
  on(event: 'console', handler: (level: string, ...args: unknown[]) => void): void;
  on(event: 'exit', handler: (code: number) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'timeout', handler: () => void): void;
  on(event: 'oom', handler: () => void): void;
}

interface IModuleLoader {
  resolve(specifier: string, referrer: string): Promise<string>;
  load(resolvedPath: string): Promise<string>;
}
```

QuickJSEngine implements this by loading QuickJS-WASM and feeding code to it. NativeEngine implements this by bootstrapping a Worker environment and executing code directly.

---

## Implementation Phases

### Phase A: Native Engine Implementation

**What:** Create NativeEngine that runs user code on the browser's native JS engine via Web Workers.

**Files to create:**
- `packages/core/src/engines/NativeEngine.ts` — implements IEngine using Web Workers
- `packages/core/src/engines/WorkerBootstrap.ts` — the bootstrap script that runs inside each Worker
- `packages/core/src/engines/GlobalScope.ts` — scope shadowing and Node.js global setup
- `packages/core/src/engines/NativeModuleLoader.ts` — require() implementation for native context

**Files to modify:**
- `packages/core/src/CatalystProc.ts` — accept engineFactory parameter instead of hardcoding QuickJS
- `packages/core/src/index.ts` — export both engine implementations

**Success criteria:**
- `engine.eval('1 + 1')` returns 2 using browser's native engine
- `engine.eval('require("path").join("a", "b")')` returns `'a/b'`
- `engine.eval('require("crypto").createHash("sha256").update("hello").digest("hex")')` returns correct SHA-256
- Console output captured via MessagePort
- Timeout enforcement works (infinite loop detection via Worker.terminate())
- Memory reporting via `performance.measureUserAgentSpecificMemory()` where available

### Phase B: Tier 0 Validation Layer

**What:** QuickJS becomes the validation gate. Code enters QuickJS first, gets validated, then runs natively.

**Files to create:**
- `packages/core/src/validation/CodeValidator.ts` — orchestrates Tier 0 checks
- `packages/core/src/validation/ASTChecker.ts` — parse and walk AST for suspicious patterns
- `packages/core/src/validation/ImportGraphValidator.ts` — validate require/import targets
- `packages/core/src/validation/SandboxRunner.ts` — quick execution against stubs

**Validation checks:**
- No `eval()` or `Function()` constructor (configurable — some code legitimately uses these)
- No prototype pollution (`__proto__`, `constructor.constructor`)
- No access to browser globals (`window`, `document`, `navigator`, `self`)
- Import/require graph only references known modules
- No dynamic imports with computed paths (`import(variable)`)
- CPU time limit (kill after N milliseconds in QuickJS)
- Memory limit (kill after N bytes allocated in QuickJS)

**Success criteria:**
- Malicious code detected and blocked before reaching native engine
- Clean code passes validation in under 50ms
- False positive rate under 1% for legitimate code patterns

### Phase C: HTTP Server via MessagePort

**What:** Make `http.createServer()` work by routing HTTP requests through MessagePort + Service Worker.

**Architecture:**

```
Browser Tab
  │
  ├─ Service Worker (intercepts requests to localhost:PORT)
  │     │
  │     └─ Routes request via MessagePort to the correct Worker
  │
  ├─ Worker A (user's Express app on "port 3000")
  │     │
  │     └─ Receives MessagePort request → runs through Express middleware → returns response
  │
  └─ Preview iframe (makes requests to localhost:3000)
        │
        └─ Intercepted by Service Worker → routed to Worker A → response rendered
```

**Files to create:**
- `packages/core/src/net/HttpServer.ts` — virtual HTTP server that listens on a "port" via MessagePort
- `packages/core/src/net/PortRouter.ts` — maps port numbers to Worker MessagePorts
- `packages/core/src/net/RequestAdapter.ts` — converts between Web Request/Response and Node IncomingMessage/ServerResponse

**Files to modify:**
- `packages/core/src/CatalystNet.ts` — add server-side routing
- The unenv `http` polyfill shim — wire `createServer()` to HttpServer

**Success criteria:**
- `const server = http.createServer((req, res) => res.end('OK')); server.listen(3000);` works
- Preview iframe can load content from the virtual server
- Express middleware chains execute correctly
- Hono apps serve via this mechanism

### Phase D: Process Pipelines

**What:** Full stdio piping between Worker processes.

**Files to create:**
- `packages/core/src/proc/StdioPipe.ts` — MessagePort-based readable/writable streams connecting processes
- `packages/core/src/proc/ProcessGroup.ts` — manages parent-child relationships and signal propagation

**Files to modify:**
- `packages/core/src/CatalystProc.ts` — add stdio routing, pipe support, signal forwarding

**Success criteria:**
- `spawn('node', ['script.js'])` with `child.stdout.on('data', ...)` works
- Pipe chains work: `const a = spawn(...); const b = spawn(...); a.stdout.pipe(b.stdin);`
- SIGTERM propagation: killing parent sends signal to children
- Exit codes propagate correctly

### Phase E: Workers Compliance Gate

**What:** Formal validation that code meets Cloudflare Workers constraints.

**Files to create:**
- `packages/core/src/compliance/WorkersGate.ts` — runs code in Tier 2 (QuickJS with Workers constraints)
- `packages/core/src/compliance/WorkersFixtures.ts` — test fixtures for Workers API surface

**Validation checks:**
- Code exports a fetch handler
- No `require('fs')`, `require('net')`, `require('child_process')` unless nodejs_compat is enabled
- Memory stays under 128MB
- CPU time stays under configured limit
- Only Workers-compatible APIs accessed
- Bindings (KV, R2, D1) used correctly

**Success criteria:**
- Code that passes the gate deploys successfully to Cloudflare Workers
- Code that fails gets actionable error messages: "This code uses `fs.readFileSync` which is not available in Cloudflare Workers. Enable `nodejs_compat` or remove this dependency."

### Phase F: npm Process Runner

**What:** Run npm/pnpm install as a process inside the runtime, executing lifecycle scripts.

**Depends on:** Phase C (HTTP server), Phase D (process pipelines)

**Architecture:**
- Bundle a minimal npm CLI implementation (or port pnpm's resolver)
- Run it as a native engine Worker process
- It resolves dependencies against the npm registry (via CatalystNet fetch proxy)
- Downloads tarballs, extracts to CatalystFS
- Executes postinstall scripts in Tier 0 → Tier 1 (validate before running)

**Alternative (simpler, immediate):**
- Keep esm.sh for development (fast, no postinstall needed for most packages)
- Add a "full install" mode that fetches tarballs directly from registry.npmjs.org
- Extract to CatalystFS /node_modules
- Skip postinstall for security (document this limitation)
- Add postinstall support later when process pipelines are stable

---

## What This Achieves

### Compatibility Matrix After Full Implementation

| Capability | Current (QuickJS) | After (Native Engine) | WebContainers |
|-----------|-------------------|----------------------|---------------|
| JS execution speed | QuickJS (slow) | Native V8 (full speed) | Native V8 |
| Node.js API coverage | 96.2% surface | 96.2%+ behavioral | ~98% |
| `http.createServer()` | Stub | Working (MessagePort) | Working (SW) |
| `child_process.spawn()` | Basic (no pipes) | Full (stdio pipes) | Full |
| `fs` operations | CatalystFS (OPFS) | CatalystFS (OPFS) | In-memory |
| `vm` module | Not possible | SES Compartments | V8 contexts |
| `worker_threads` | Not possible | Web Workers | Web Workers |
| Chrome DevTools debug | Not possible | Free (native) | Free (native) |
| npm install | esm.sh (fast, limited) | esm.sh + real install | Real npm/pnpm |
| Dev servers (Vite, etc.) | Cannot run | Can run (native Workers) | Can run |
| Offline support | Yes (no V8 needed) | Yes (browser is offline-capable) | Requires SAB |
| Cross-origin isolation | Not required (JSPI) | Not required (JSPI) | Required (SAB) |
| Binary size overhead | 505KB (QuickJS WASM) | 0KB (browser provides engine) | 0KB (same) |
| Security layers | 1 (browser sandbox) | 2 (QuickJS validation + browser) | 1 (browser) |
| Workers compat testing | QuickJS matches constraints | QuickJS validates, native runs | N/A |
| Patent risk | None | None (different mechanism at every layer) | Patented |
| License | MIT | MIT | Proprietary |

### The "Never Possible" List — Browser Limitations, Not Catalyst Gaps

These cannot work in any browser-based runtime, including WebContainers:

- **Raw TCP sockets** (`net.createServer()`, `net.connect()`) — browsers don't expose TCP
- **Raw TLS** (`tls.createServer()`) — no TLS socket access
- **DNS resolution** (`dns.resolve()`, `dns.lookup()`) — no DNS API
- **Native C++ addons** (`.node` files) — cannot load native code in browser
- **`cluster` module** — no OS-level process forking
- **Raw UDP** (`dgram`) — no UDP socket access
- **Unix domain sockets** — no filesystem sockets
- **`os.cpus()` detailed info** — browser limits hardware fingerprinting

These are permanent browser security boundaries. Both Catalyst and WebContainers work around them the same way: HTTP over fetch/MessagePort instead of raw TCP, WebCrypto instead of OpenSSL, Web Workers instead of OS processes.

---

## Relationship to Existing Specs

This document supersedes the Geist V8-to-WASM compilation plan. The discovery that WebContainers uses the browser's native engine — not a compiled V8 — means Geist as a project is unnecessary. The Docker environment created for V8 compilation can be repurposed for building Rust-to-WASM components (the OS layer) if Reaction moves to compiled Rust modules.

This document extends the Catalyst monorepo plan. The dual distribution model (`@aspect/catalyst` for Workers, `@aspect/reaction` for Deno/Node) remains. The engine interface, shared packages, and module loader abstraction are unchanged. What changes is that Reaction's engine is not "Deno-in-WASM" (which would require compiling V8) but "browser's native engine + Node.js bootstrap" (which requires only TypeScript).

The tiered execution model is new. It was not in any previous spec. QuickJS as a validation layer is a novel contribution that gives Catalyst a security advantage over WebContainers.

The Workers compliance gate was specified in the monorepo plan but not detailed. Phase E above provides the full specification.

---

## Open Questions

**SES vs manual scope shadowing:** SES (Secure ECMAScript) provides stronger isolation guarantees than manual `self.indexedDB = undefined`. But SES adds ~50KB and has performance overhead from `lockdown()`. For Wiggum (where Ralph generates trusted code), manual shadowing is sufficient. For a public-facing runtime (arbitrary user code), SES is safer. Decision: start with manual shadowing, add SES as opt-in for high-security contexts.

**esm.sh vs real npm install:** esm.sh is faster and simpler for development. Real npm install handles edge cases (postinstall, native deps, complex lockfiles). Decision: keep esm.sh as default for development speed. Add real npm install as Phase F for production parity. Both paths use the same CatalystPkg resolution layer.

**Service Worker TCP proxy vs MessagePort routing:** WebContainers uses a Service Worker to intercept `localhost:PORT` requests and route them. Catalyst can use MessagePort directly (no Service Worker needed for inter-Worker communication). The Service Worker is only needed for the preview iframe's fetch requests. Decision: use MessagePort for Worker-to-Worker communication, Service Worker only for iframe preview routing. This avoids the patented relay mechanism.

**Deno standard library compatibility:** The Deno target implies support for `import { serve } from "https://deno.land/std/..."`. This requires URL imports, which esm.sh already handles. But Deno's standard library has its own conventions. Decision: support Deno-style URL imports via esm.sh proxy. Don't try to be a full Deno runtime — be a Node.js-compatible runtime that also supports Deno-style imports where they map to standard web APIs.
