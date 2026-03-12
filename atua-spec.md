# Atua — Specification

> **Standalone browser-native runtime engine.**  
> Provides filesystem, JS execution, networking, process management, package resolution, and dev tooling inside a browser tab. Any application can consume it.  
> **License:** MIT (ZenFS dependency is LGPL with web application exception — link to repo, bundle freely)  
> **Package scope:** `@aspect/atua-*`  
> **Companion doc:** `atua-roadmap.md`

---

## TABLE OF CONTENTS

1. [What Is Atua](#1-what-is-catalyst)
2. [Why Build This](#2-why-build-this)
3. [Architecture Overview](#3-architecture-overview)
4. [AtuaFS — Filesystem](#4-catalystfs--filesystem)
5. [AtuaEngine — JS Execution](#5-catalystengine--js-execution)
6. [AtuaNet — Networking](#6-catalystnet--networking)
7. [AtuaProc — Process Management](#7-catalystproc--process-management)
8. [AtuaPkg — Package Management](#8-catalystpkg--package-management)
9. [AtuaDev — Dev Server + Build + HMR](#9-catalystdev--dev-server--build--hmr)
10. [Security Model](#10-security-model)
11. [Node.js Compatibility Surface](#11-nodejs-compatibility-surface)
12. [Consumer API](#12-consumer-api)
13. [SaaS Superpowers](#13-saas-superpowers)
14. [Testing Strategy](#14-testing-strategy)
15. [Performance Targets](#15-performance-targets)
16. [Patent Differentiation](#16-patent-differentiation)
17. [Cleanroom Protocol](#17-cleanroom-protocol)
18. [Packaging & Distribution](#18-packaging--distribution)

---

## 1. WHAT IS CATALYST

Atua is a browser-native operating system for code execution, distributed as an npm library. It provides a complete runtime environment — filesystem, JS engine, networking, process management, package resolution, and dev tooling — all running inside a browser tab with zero server requirements.

Any application can consume it:

```typescript
import { Atua } from '@aspect/atua';

const runtime = await Atua.create({
  fs: { '/project': 'opfs', '/tmp': 'memory' },
  engine: { memoryLimit: 256, timeout: 30000 },
  net: { allowlist: ['api.example.com'] },
});

await runtime.fs.writeFile('/project/index.js', 'console.log("hello")');
const result = await runtime.engine.eval('require("fs").readFileSync("/project/index.js", "utf8")');
runtime.dev.start({ entry: '/project/index.js', port: 3000 });
```

An IDE uses it. A tutorial platform uses it. A documentation site with live examples uses it. A coding bootcamp uses it. It is a library, not a product.

**The name:** A catalyst accelerates a chemical reaction without being consumed by it. Atua accelerates the transformation from code to running application. The runtime enables the transformation but is not the product.

### Core Principles

**Standalone.** Zero knowledge of any consumer application. No assumptions about UI, workflow, or use case. A runtime library — the consumer decides what to build on top.

**Browser-native, not browser-shimmed.** Built on OPFS, JSPI, FileSystemObserver, Service Workers, MessageChannels — 2024-2026 web standards, not polyfills from 2020.

**Explicit over magic.** Every layer has a clear API. No hidden framework behavior. AI agents, human developers, and automated tooling can reason about what is happening.

**Progressive enhancement.** Browser-only works completely. Connect to a SaaS backend to unlock real databases, native modules, deployment pipelines, and collaboration. Disconnect — back to browser-only. No mode switch, no data loss.

**Secure by default.** WASM sandbox isolation. No DOM access from user code. Network allowlists. Memory limits. Execution timeouts. User code is untrusted.

---

## 2. WHY BUILD THIS

### The WebContainers Problem

WebContainers (StackBlitz, 2021) proved browser-based development is viable. But it has fundamental constraints:

**Cross-origin isolation is mandatory.** WebContainers requires SharedArrayBuffer for sync execution. SAB requires COOP/COEP headers. These headers break third-party iframes, OAuth popups, payment widgets, and cannot be set on GitHub Pages. StackBlitz uses a Chrome origin trial workaround.

**Proprietary and locked.** Licensed, not open. Cannot self-host, fork, or inspect internals.

**2021 technology.** In-memory filesystem with IndexedDB polling. No native file watching. No JSPI.

### What Changed Since 2021

| Capability | 2021 | 2026 |
|-----------|------|------|
| Sync WASM-JS bridge | SharedArrayBuffer + Atomics (requires COOP/COEP) | **JSPI** — W3C Phase 4 standard. No headers required. |
| Filesystem | In-memory + IndexedDB polling | **OPFS** + SyncAccessHandle — real sync I/O, 3-4x faster |
| File watching | Polling (500ms+) | **FileSystemObserver** — native OS-level notifications |
| Lightweight JS engine | None suitable for browser WASM | **QuickJS-WASM** — 505KB, MIT, ES2023, native CJS |

Every foundational technology in Atua either did not exist or was not production-ready when WebContainers was designed.

### The Opportunity

A standalone, MIT-licensed, browser-native runtime that requires no special headers, uses real filesystem APIs, is a library (not a service), is open, and gets stronger with a server.


---

## 3. ARCHITECTURE OVERVIEW

```
+------------------------------------------------------------------+
|  @aspect/atua                                                 |
|                                                                   |
|  +-------------------------------------------------------------+ |
|  |  AtuaEngine (QuickJS-WASM)                               | |
|  |  JS execution - require() - CJS/ESM - WASM sandbox          | |
|  |  JSPI sync bridge (Asyncify fallback for Safari)             | |
|  +-------------+-----------------------------------------------+ |
|                 | host bindings                                   |
|  +--------------+----------------------------------------------+  |
|  |  AtuaFS             |  AtuaNet                      |  |
|  |  OPFS + SyncAccess      |  MessageChannel fetch proxy       |  |
|  |  FileSystemObserver     |  Service Worker HTTP server       |  |
|  |  Node fs API            |  Domain allowlist/blocklist        |  |
|  +-------------------------+-----------------------------------+  |
|  |  AtuaProc           |  AtuaPkg                      |  |
|  |  Worker processes       |  esm.sh + npm resolution          |  |
|  |  child_process API      |  OPFS package cache               |  |
|  |  Stdio streaming        |  Lockfile management              |  |
|  +-------------------------+-----------------------------------+  |
|  |  AtuaDev                                                |  |
|  |  esbuild-wasm compilation - FileSystemObserver HMR          |  |
|  |  Content-hash build cache - Preview serving                 |  |
|  +-------------------------------------------------------------+  |
|                                                                   |
|  +-------------------------------------------------------------+  |
|  |  [Optional] SaaS Sync Layer                                 |  |
|  |  Real databases - Native modules - Git push - Deployment    |  |
|  +-------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

### Package Structure

```
@aspect/atua           — Full runtime (re-exports everything)
@aspect/atua-fs        — Filesystem only (OPFS, watching, Node fs API)
@aspect/atua-engine    — QuickJS-WASM execution engine
@aspect/atua-net       — Fetch proxy + Service Worker HTTP server
@aspect/atua-proc      — Worker-based process management
@aspect/atua-pkg       — Package resolution + OPFS cache
@aspect/atua-dev       — Build pipeline + HMR + preview serving
```

Consumers install what they need. A playground that just needs a filesystem installs `@aspect/atua-fs`. An IDE that needs everything installs `@aspect/atua`. Tree-shaking handles the rest.

### Data Flow

```
Consumer application
    |
    v
Atua.create(config)
    |
    v
runtime.engine.eval("const http = require('http'); ...")
    |
    +-- require('fs')            -> AtuaFS    -> OPFS SyncAccessHandle
    +-- require('path')          -> Pure JS       -> No I/O
    +-- require('http')          -> AtuaNet   -> MessageChannel -> main thread fetch
    +-- require('child_process') -> AtuaProc  -> spawn Worker + QuickJS instance
    +-- require('express')       -> AtuaPkg   -> OPFS cache or esm.sh fetch
    +-- console.log(...)         -> Host binding  -> callback to consumer
```

---

## 4. CATALYSTFS — FILESYSTEM

The foundation. Every other layer depends on this.

### OPFS (Origin Private File System)

Real filesystem semantics natively in the browser: SyncAccessHandle for synchronous read/write in Worker contexts, 3-4x faster than IndexedDB, persistent across sessions, per-origin isolated storage.

### Mount System

```typescript
const fs = await AtuaFS.create({
  mounts: {
    '/project':      { backend: 'opfs', persistent: true },
    '/tmp':          { backend: 'memory', persistent: false },
    '/node_modules': { backend: 'opfs', persistent: true },
    '/home':         { backend: 'opfs', persistent: true },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024,       // 10MB per file
    maxTotalStorage: 500 * 1024 * 1024,   // 500MB total
  },
});
```

ZenFS provides the mount system with pluggable backends. OPFS via `@zenfs/dom` WebAccess backend. In-memory via `@zenfs/core` InMemory. IndexedDB fallback for older browsers.

### File Watching

Native FileSystemObserver (Chrome 129+) with automatic polling fallback (500ms, content-hash comparison) for other browsers. Unified API: `fs.watch(path, options, callback)`.

### Node.js fs API Surface

Both sync and async variants: readFile, writeFile, mkdir (recursive), readdir (withFileTypes), stat, unlink, rmdir (recursive), rename, copyFile, exists, appendFile, chmod, watchFile, createReadStream, createWriteStream, realpath, mkdtemp. Coverage ~90% sync, ~80% async.

### ZenFS License

LGPL-3.0 with web application exception in COPYING.md: bundling is permitted for web applications, just link to ZenFS GitHub repo in credits. Resolved.

---

## 5. CATALYSTENGINE — JS EXECUTION

User code runs inside QuickJS compiled to WebAssembly — not in the browser V8/SpiderMonkey engine.

### Why QuickJS-WASM

WASM linear memory sandbox (stronger than Worker isolation), native require() with CJS module loading, ES2023 support, 505KB JSPI / ~1MB Asyncify, MIT licensed, battle-tested at val.town and Cloudflare.

### JSPI Sync Bridge

QuickJS runs sync code (fs.readFileSync). OPFS is async. JSPI bridges them: suspends WASM execution, host performs async operation, resumes WASM with result. Zero code transformation, constant-time overhead. Asyncify fallback for Safari (2x binary, works everywhere).

Automatic detection — consumer does not choose:

```typescript
const engine = await AtuaEngine.create({
  fs: catalystFS,
  memoryLimit: 256,  // MB
  timeout: 30000,    // ms
});
```

### Host Bindings

All standard Node.js built-in modules reimplemented as host bindings injected into QuickJS scope:

fs (AtuaFS), path (pure JS), buffer (polyfill), process (shim), events (EventEmitter), stream (Readable/Writable/Transform), url (browser URL bridge), querystring (pure JS), util (format/inspect/promisify), assert (full), crypto (WebCrypto bridge: randomBytes, createHash, randomUUID, createHmac), os (shimmed: platform, cpus, homedir), http/https (AtuaNet), child_process (AtuaProc), console (capture+forward), timers (QuickJS event loop), string_decoder (pure JS), fetch (global, AtuaNet).

### Execution API

```typescript
const result = await engine.eval('1 + 1');
const result = await engine.evalFile('/project/index.js');
engine.on('console', (level, ...args) => { });
engine.on('exit', (code) => { });
engine.on('error', (err) => { });
engine.on('timeout', () => { });
engine.on('oom', () => { });
```

---

## 6. CATALYSTNET — NETWORKING

### Outbound: MessageChannel Fetch Proxy

User code calls fetch() or http.request(). Routes through MessageChannel to main browser thread which performs real network request. Configurable domain allowlist/blocklist with wildcard support, rate limiting, response size limits, per-request timeout.

### Inbound: Service Worker HTTP Server

SW intercepts preview iframe requests, serves from AtuaFS with correct MIME types. Route resolution: static file match, /api/* dispatch to backend handler, SPA fallback to index.html, 404. Built-in MIME mapping for 50+ extensions.

The SW receives a MessagePort for AtuaFS access via ZenFS Port backend. Standard fetch-interceptor pattern — same as any PWA.

---

## 7. CATALYSTPROC — PROCESS MANAGEMENT

Each process is a separate Web Worker with its own QuickJS-WASM instance. True memory isolation.

```typescript
const { stdout, stderr, exitCode } = await runtime.proc.exec('node build.js');

const proc = runtime.proc.spawn('node', ['server.js']);
proc.stdout.on('data', (chunk) => terminal.write(chunk));
proc.kill('SIGTERM');
```

Process tree tracking (parent kill cascades), PID allocation, max concurrent processes (default 8), per-process memory limits.

---

## 8. CATALYSTPKG — PACKAGE MANAGEMENT

### Architecture

```
require('express')
    |
    v
AtuaEngine require() chain:
  1. Built-in module? (fs, path, etc.) -> host binding
  2. Relative path? (./foo) -> AtuaFS -> eval
  3. In /node_modules/? -> OPFS cache -> load
  4. PackageManager? -> resolve from npm registry -> fetch via esm.sh -> cache -> load
  5. Not found -> MODULE_NOT_FOUND
```

### Registry: npm (source of truth)

3M+ packages. Atua resolves metadata from `registry.npmjs.org` — versions, dependency trees, tarball URLs. Semver range resolution (`^1.2.3` → latest compatible). Transitive dependency tree walking with circular dependency detection.

### CDN: esm.sh (transform layer)

esm.sh handles CJS→ESM conversion, TypeScript compilation, and dependency bundling server-side. Atua fetches browser-ready code. `?cjs` flag for QuickJS CommonJS. `?bundle-deps` for bundled transitive dependencies.

Fallback: npm tarball direct download, extract with browser-native DecompressionStream + tar parser.

### Cache: OPFS (persistent local)

Content-addressable: `{name}@{version}` → `/node_modules/`. LRU eviction at configurable size limit (default 500MB). Download once, persist across sessions. Offline: cached packages work without network.

### Lockfile: atua-lock.json

Deterministic installs. Per-package: name, version, resolved URL, SHA-256 integrity hash, dependency map. Lockfile exists → use pinned versions, no registry re-resolution.

### package.json Support

Read `/project/package.json`, install all `dependencies` and `devDependencies` via `installAll()`.

### Deno Alignment

Deno reads npm packages natively via `npm:` specifiers. Same packages work on both Atua (browser) and Deno (server) when sync protocol connects.

---

## 9. CATALYSTDEV — DEV SERVER + BUILD + HMR

esbuild-wasm (peer dependency) handles compilation. Frontend pass: entry TSX/TS to /dist/. Backend pass (optional): API entry to /dist/api-sw.js.

FileSystemObserver triggers rebuild (50ms debounce). Content-hash cache: SHA-256 of sources, skip build on match, keep 10 cached builds in OPFS. HMR client injected into preview iframe, notified via postMessage.

```typescript
const dev = await AtuaDev.create({ fs, engine, net });
await dev.start({ entry: '/project/src/index.tsx', outdir: '/dist' });
dev.on('build:success', ({ duration, modules }) => { });
const previewUrl = dev.getPreviewUrl(); // put in iframe
```


---

## 10. SECURITY MODEL

Atua assumes all user code is untrusted. Defense in depth across five layers:

**Layer 1 — WASM Sandbox:** QuickJS runs inside WebAssembly linear memory. User code physically cannot access browser DOM (window, document, navigator), browser storage (localStorage, cookies), other tabs/origins, the host application's JS context, or Atua internals. The only interaction with outside world is through explicitly injected host bindings.

**Layer 2 — Filesystem Isolation:** User code sees only mounted paths. No access to host OPFS namespace. Path traversal prevention (normalize, reject ../ escapes, null bytes, overlong paths). Configurable max file size and total storage limits.

**Layer 3 — Network Isolation:** Default: no network access. Consumer must explicitly configure allowed domains. Domain allowlist/blocklist with wildcard support. Rate limiting. Response size limits. Request timeout. No raw socket access.

**Layer 4 — Execution Limits:** WASM linear memory cap (default 256MB). Per-eval timeout (default 30s). Max concurrent processes (default 8). QuickJS stack size limit. Interrupt callback terminates infinite loops.

**Layer 5 — Process Isolation:** Each process in a separate Worker with separate WASM instance. One process crashing cannot corrupt another or the host.

### Security Events

```typescript
runtime.on('security:timeout', (details) => { });
runtime.on('security:oom', (details) => { });
runtime.on('security:network-blocked', (details) => { });
runtime.on('security:fs-limit', (details) => { });
```

### What Atua Does NOT Protect Against

Side-channel attacks via WASM timing (theoretical, low risk). Resource exhaustion of browser tab itself. Social engineering through displayed output. Exfiltration through allowed domains. The consumer application is responsible for configuring appropriate allowlists and presenting output safely.

---

## 11. NODE.JS COMPATIBILITY SURFACE

| Module | Coverage | Implementation |
|--------|---------|---------------|
| fs | ~90% sync, ~80% async | AtuaFS (OPFS) |
| path | ~100% | Pure JS posix |
| buffer | ~95% | Polyfill |
| stream | ~70% | Readable/Writable/Transform/pipeline |
| events | ~95% | Pure JS EventEmitter |
| http/https | ~60% | AtuaNet (no raw sockets) |
| crypto | ~50% | WebCrypto bridge |
| child_process | ~40% | Worker processes |
| url, querystring | ~100% | Browser native / pure JS |
| util | ~80% | Pure JS |
| assert | ~95% | Pure JS including strict |
| os | ~30% | Shimmed |
| timers | ~90% | setTimeout/setInterval/setImmediate |
| string_decoder | ~95% | Pure JS |
| zlib | ~60% | WASM deflate/inflate/gzip |
| net, tls, dns, cluster | 0% | Not possible in browser |

Estimated total: 60-70% of the Node.js API surface that web developers actually use.

**Not possible (browser limitation):** Raw TCP/UDP sockets, DNS resolution, filesystem symlinks, native addons (N-API), cluster/worker_threads (use AtuaProc).

---

## 12. CONSUMER API

```typescript
import { Atua } from '@aspect/atua';

const runtime = await Atua.create({
  fs: {
    mounts: {
      '/project': { backend: 'opfs', persistent: true },
      '/tmp': { backend: 'memory' },
      '/node_modules': { backend: 'opfs', persistent: true },
    },
    limits: { maxFileSize: 10_000_000, maxTotalStorage: 500_000_000 },
  },
  engine: { memoryLimit: 256, timeout: 30_000 },
  net: { allowlist: ['api.github.com'], rateLimit: { requestsPerMinute: 60 } },
  proc: { maxProcesses: 8 },
  dev: { esbuild: true, hmr: true },
});

// Access layers
runtime.fs       // AtuaFS
runtime.engine   // AtuaEngine
runtime.net      // AtuaNet
runtime.proc     // AtuaProc
runtime.pkg      // AtuaPkg
runtime.dev      // AtuaDev

// Events (all layers bubble up)
runtime.on('engine:console', (level, args) => { });
runtime.on('fs:change', (path, event) => { });
runtime.on('dev:build', (result) => { });
runtime.on('security:*', (details) => { });

// Partial initialization — only create what you use
import { AtuaFS } from '@aspect/atua-fs';
const fs = await AtuaFS.create({ mounts: { '/data': { backend: 'opfs' } } });

// Lifecycle
await runtime.destroy(); // kill processes, close watchers, release handles
```

---

## 13. SAAS SUPERPOWERS — DENO SERVER SYNC

Browser-only works completely. Connected mode (opt-in via `@aspect/atua-sync`) adds: production builds (real esbuild on Deno), git push/pull (real git with SSH keys), real databases (Postgres/SQLite/Redis via Deno), native npm modules, WebSocket servers, deployment pipelines, real-time collaboration.

### Why Deno

Deno aligns with Atua's philosophy: explicit, standards-based, no node_modules hell. Native npm support via `npm:` specifiers means the same packages Atua resolves from the npm registry work on Deno without any translation. TypeScript runs natively. Edge deployment via Deno Deploy. Permission-based security model.

### Sync Protocol

Bidirectional filesystem sync between Atua OPFS (working copy) and Deno server disk (canonical). Operation journal in OPFS buffers changes during disconnection, replays on reconnection. Conflict resolution: last-write-wins default, three-way merge for text files, consumer-hookable for user prompts. Progressive — start browser-only, connect later, disconnect anytime, no mode switch, no data loss.

### Hono Backend (both environments)

Write Hono API routes once. In browser-only mode: Hono runs in the preview Service Worker, reads/writes AtuaFS. With Deno server connected: same Hono routes run on real Deno, with real databases and network. Same code, two environments, zero changes.

Ships as `@aspect/atua-sync` (browser client) + `@aspect/atua-server` (Deno). Core runtime is complete without either.

---

## 14. TESTING STRATEGY

Every layer has its own test suite. Integration tests prove layers work together. An example consumer app proves the whole stack works end-to-end. See roadmap for complete test file listings per phase.

### Integration Tests (Phase 7)

1. Full round-trip: write files -> build -> serve -> verify output
2. Node.js server: write Hono app -> build -> serve -> fetch API -> verify JSON
3. Package install + use: install lodash -> require -> verify
4. Process communication: spawn -> stdin -> stdout -> verify
5. File watch + rebuild: modify source -> verify HMR fires
6. Persistence: write -> destroy -> recreate -> verify files exist
7. Security boundaries: attempt DOM access / blocked network -> verify blocked
8. Browser fallback: Asyncify mode, polling watcher
9. Memory pressure: 100MB files + builds
10. Concurrent operations: parallel writes + builds + installs

### Browser Compatibility

| Feature | Chrome 129+ | Firefox 139+ | Safari 18+ |
|---------|-------------|-------------|------------|
| OPFS SyncAccessHandle | Yes | Yes | Yes |
| JSPI | Yes (137+) | Yes (139+) | No -> Asyncify fallback |
| FileSystemObserver | Yes (129+) | No -> polling | No -> polling |
| Service Worker | Yes | Yes | Yes |
| MessageChannel | Yes | Yes | Yes |
| QuickJS-WASM | Yes | Yes | Yes |

---

## 15. PERFORMANCE TARGETS

### Cold Start

| Metric | Target |
|--------|--------|
| Atua.create() | <500ms |
| QuickJS WASM load (JSPI) | <100ms |
| QuickJS WASM load (Asyncify) | <200ms |
| First file write | <5ms |
| First esbuild build | <1s |

### Warm Start

| Metric | Target |
|--------|--------|
| Atua.create() | <200ms |
| File write 1KB | <1ms |
| File read 1KB | <0.5ms |
| esbuild rebuild (no change) | <5ms |
| esbuild rebuild (one file) | <100ms |
| esbuild rebuild (full) | <300ms |
| require() cached module | <1ms |
| Process spawn | <50ms |

### Size Budget

| Package | Target |
|---------|--------|
| @aspect/atua (full) | <800KB |
| @aspect/atua-fs | <40KB |
| @aspect/atua-engine | <600KB (QuickJS 505KB) |
| @aspect/atua-net | <15KB |
| @aspect/atua-proc | <10KB |
| @aspect/atua-pkg | <20KB |
| @aspect/atua-dev | <30KB (esbuild-wasm is external peer dep) |

Benchmarks run in CI on every PR. Regressions beyond 20% automatically block merge.

---

## 16. PATENT DIFFERENTIATION

StackBlitz holds at least one patent covering cross-origin relay: iFrame + invisible window + Service Worker on invisible window bridging two local domains.

**Atua never communicates across origins.** No relay, no iFrame bridge, no invisible window. Single origin, standard browser APIs. Every layer uses a fundamentally different mechanism: JSPI instead of SAB, OPFS instead of in-memory+IDB, FileSystemObserver instead of polling, QuickJS-WASM instead of proprietary kernel, MessageChannel (same-origin) instead of cross-origin relay, Workers instead of threads.

Both use Service Workers, but differently: WebContainers SW participates in cross-origin relay. Atua SW is a standard fetch interceptor reading OPFS via same-origin MessagePort. Same pattern as any PWA.

**Recommendation:** Patent attorney FTO search before commercial release.

---

## 17. CLEANROOM PROTOCOL

All competitive knowledge from public sources: StackBlitz blog posts, Justia patent filings, MDN, webcontainers.io public docs. Zero access to @webcontainer/api source, StackBlitz internals, decompiled code, bolt.new source.

CC implementation rule: Do not reference, examine, or search for WebContainers source code, @webcontainer/api, StackBlitz proprietary code, or bolt.new source. Implement from this spec, the roadmap, and public API docs for open-source dependencies only.

---

## 18. PACKAGING & DISTRIBUTION

```
@aspect/atua-core      Engine + FS + Net + Proc        ~600KB
@aspect/atua-pkg       Package management (npm + esm.sh) ~50KB
@aspect/atua-dev       Build pipeline + HMR              ~30KB
@aspect/atua-wasi      WASI binary execution             ~200KB (Wasmer-JS)
@aspect/atua-sync      Browser-side Deno sync client     ~20KB
@aspect/atua-server    Deno server (sync + Hono)         ~40KB (Deno-only)
```

Published to npm under `@aspect` scope. CDN via esm.sh. Full TypeScript definitions. Tree-shakeable. ESM + CJS output.

**Minimum requirements:** Chrome 129+, Firefox 139+, Safari 18+. HTTPS required (OPFS/SW need secure context). No special headers (COOP/COEP not required).

**License:** Atua is MIT. ZenFS is LGPL with web app exception — bundle freely, link to repo:

> [ZenFS](https://github.com/zen-fs/core), Licensed under the [LGPL 3.0 or later](https://www.gnu.org/licenses/lgpl-3.0.html) and [COPYING.md](https://github.com/zen-fs/core/blob/main/COPYING.md), Copyright James Prevett and other ZenFS contributors

---

## APPENDIX: DECISION LOG

| Decision | Chosen | Why |
|----------|--------|-----|
| Name | Atua | Evocative, marketable |
| JS engine | QuickJS-WASM | MIT, 505KB, battle-tested, native CJS |
| Sync bridge | JSPI + Asyncify | W3C Phase 4, no COOP/COEP |
| Filesystem | ZenFS + OPFS | Pluggable backends, Node fs compat |
| File watching | FileSystemObserver + polling | Native when available, fallback |
| Architecture | Standalone library | Product-agnostic, any app can consume |
| Process model | Workers | No COOP/COEP, true isolation |
| ZenFS license | Bundle with attribution | Web app exception permits it |
| Build tool | esbuild-wasm (peer dep) | Fast, consumer controls version |
| Package registry | npm (registry.npmjs.org) | 3M+ packages, universal source of truth |
| Package CDN | esm.sh | CJS→ESM transform, TypeScript stripping, dependency bundling, browser-ready output |
| Package fallback | npm tarball + DecompressionStream | When esm.sh can't transform a package |
| Server alignment | Deno | Native npm support, TypeScript-first, edge deploy, explicit philosophy matches Atua |
| Backend framework | Hono | 18KB, MIT, official SW adapter + Deno adapter, same code both environments |
| WASI runtime | Wasmer-JS | WASI preview1 support, runs any wasm32-wasi binary |
| Sync transport | WebSocket | Bidirectional real-time, reconnectable |
| Monorepo tool | pnpm workspaces | Simple, fast, proven |
| Test framework | Vitest | Fast, browser mode for OPFS/SW tests |
| Bundler | tsup | esbuild-based, ESM+CJS+dts |
