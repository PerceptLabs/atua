# Catalyst — Implementation Roadmap

> **Companion doc:** `catalyst-spec.md` (architecture, decisions, cleanroom protocol)  
> **Repo:** This is a standalone library. It has no consumer code. It builds, tests, and publishes on its own.  
> **Total estimated:** 28–42 days across 13 phases.

---

## CLEANROOM NOTICE — APPLIES TO ALL PHASES

```
This project implements a browser-native runtime from catalyst-spec.md only.
Do NOT reference, examine, search for, or draw from: WebContainers source
code, @webcontainer/api internals, StackBlitz proprietary code, bolt.new
source, or any decompiled/reverse-engineered code from competing products.
Implement from the spec, public API documentation for ZenFS, quickjs-emscripten,
esbuild-wasm, and Hono, and standard web platform docs (MDN).
```

---

## PHASE MAP

```
Phase 0:  Project Scaffolding + Spike               (1-2 days)
Phase 1:  CatalystFS — Filesystem                   (2-3 days)
Phase 2:  CatalystFS — Multi-Mount + File Watching  (2-3 days)
Phase 3:  Preview Service Worker                    (1-2 days)
Phase 4:  CatalystEngine — QuickJS Integration      (3-5 days)
Phase 5:  CatalystNet — Fetch Proxy                 (2-3 days)
Phase 6:  CatalystProc — Process Management         (2-3 days)
Phase 7:  CatalystPkg — Package Management          (3-5 days)
Phase 8:  CatalystDev — Build Pipeline + HMR        (2-3 days)
Phase 9:  Integration Tests + Example App           (2-3 days)
Phase 10: CatalystWASI — Non-JS Binary Execution    (3-5 days)
Phase 11: CatalystSync — Deno Server Protocol       (3-5 days)
Phase 12: Hono Backend Integration                  (2-3 days)
```

### Dependency Graph

```
Phase 0 (Scaffold + Spike)
    |
    v
Phase 1 (CatalystFS core)
    |
    +-- Phase 2 (Multi-mount + FileSystemObserver)
    |       |
    |       v
    |   Phase 3 (Preview Service Worker)
    |       |
    |       +-- Phase 12 (Hono Backend)
    |
    +-- Phase 4 (CatalystEngine - QuickJS)
            |
            +-- Phase 5 (CatalystNet)
            +-- Phase 6 (CatalystProc)
            |       |
            |       +-- Phase 10 (WASI)
            +-- Phase 7 (CatalystPkg)
                    |
                    v
               Phase 8 (CatalystDev)
                    |
                    v
               Phase 9 (Integration + Example App)
                    |
                    v
               Phase 11 (Deno Sync)
```

### Testing Convention

**Every phase produces two kinds of tests:**

- `*.test.ts` — runs in **Node** via `pnpm test`. Pure logic: data structures, algorithms, serialization, config parsing. Fast, no browser needed.
- `*.browser.test.ts` — runs in **real Chromium** via `pnpm test:browser` (Vitest browser mode + Playwright). Browser APIs: OPFS, Service Workers, WASM, MessageChannel, FileSystemObserver, Workers.

**Rule:** If the code touches a browser API that doesn't exist in Node, the test goes in `.browser.test.ts`. If it's pure TypeScript logic, `.test.ts`. Many modules have both.

After every phase, run `pnpm test:all` (both suites). Browser tests catch real integration issues that Node tests miss — a WASM binary that loads in Node might fail in browser. OPFS that works in unit tests might fail under concurrent access. Service Worker registration that looks correct might not intercept fetches properly.

---

## PHASE 0: PROJECT SCAFFOLDING + SPIKE (1-2 days)

**Goal:** Set up the monorepo, install dependencies, configure dual test infrastructure (Node + Browser), prove OPFS + QuickJS + JSPI work together in a real browser.

**What gets built:**

```
catalyst/
├── packages/
│   ├── core/                    <- @aspect/catalyst-core
│   │   ├── src/
│   │   │   ├── fs/              <- CatalystFS (Phase 1)
│   │   │   ├── engine/          <- CatalystEngine (Phase 4)
│   │   │   ├── net/             <- CatalystNet (Phase 5)
│   │   │   ├── proc/            <- CatalystProc (Phase 6)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── pkg/                     <- @aspect/catalyst-pkg (Phase 7)
│   └── dev/                     <- @aspect/catalyst-dev (Phase 8)
├── examples/
│   └── basic/                   <- Example consumer app (Phase 9)
├── spike/                       <- Throwaway spike tests (this phase)
│   └── spike.browser.test.ts
├── package.json                 <- Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts             <- Node tests (pure logic)
├── vitest.browser.config.ts     <- Browser tests (OPFS, SW, WASM, MessageChannel)
├── playwright.config.ts
├── catalyst-spec.md
├── catalyst-roadmap.md
└── README.md
```

**Tasks:**

1. Initialize pnpm workspace monorepo
2. Create `packages/core/` with TypeScript config
3. Install dependencies:
   - `@zenfs/core`, `@zenfs/dom` (filesystem)
   - `quickjs-emscripten`, `@jitl/quickjs-wasmfile-release-async` (JS engine)
   - `vitest`, `typescript` (dev)
   - `@vitest/browser`, `playwright` (dev — browser test infrastructure)
4. Configure dual test infrastructure:
   - `vitest.config.ts` — Node environment, runs `*.test.ts` files. For pure logic: path resolution, semver parsing, lockfile serialization, conflict resolution, etc.
   - `vitest.browser.config.ts` — Browser environment via Playwright Chromium, runs `*.browser.test.ts` files. For browser APIs: OPFS, Service Workers, MessageChannel, WASM, FileSystemObserver.
   - `package.json` scripts:
     ```json
     "test": "vitest run",
     "test:browser": "vitest run --config vitest.browser.config.ts",
     "test:all": "pnpm test && pnpm test:browser",
     "test:watch": "vitest --config vitest.browser.config.ts"
     ```
5. Create `spike/spike.browser.test.ts` — runs in real Chromium via Playwright:
   - Configure ZenFS with OPFS backend (not IndexedDB — test the real thing)
   - Write/read file round-trip via OPFS
   - Verify SyncAccessHandle works in Worker context
   - Boot QuickJS-WASM, eval `1 + 1`, verify result === 2
   - Test JSPI detection: `typeof WebAssembly.Suspending`
   - If JSPI available: test `@jitl/quickjs-wasmfile-release-sync` variant
   - Register a Service Worker, intercept a fetch, verify response
   - Create a MessageChannel, send/receive message between contexts
   - Measure and log: QuickJS boot time, WASM binary size, memory usage, OPFS read/write latency
   - Test FileSystemObserver detection: `typeof FileSystemObserver`
6. Create README.md with ZenFS attribution (LGPL requirement):
   > [ZenFS](https://github.com/zen-fs/core), Licensed under the [LGPL 3.0 or later](https://www.gnu.org/licenses/lgpl-3.0.html) and [COPYING.md](https://github.com/zen-fs/core/blob/main/COPYING.md), Copyright (c) James Prevett and other ZenFS contributors

**Verification:**
- [ ] `pnpm install` succeeds
- [ ] `pnpm build` succeeds (even if packages are empty stubs)
- [ ] `pnpm test` runs (Node tests, nothing to run yet, but config works)
- [ ] `pnpm test:browser` launches Chromium and runs spike tests
- [ ] Spike: OPFS round-trips files correctly in real browser
- [ ] Spike: QuickJS boots and evals JS in real browser
- [ ] Spike: JSPI detection runs (reports true or false — log which variant CC's Chromium supports)
- [ ] Spike: Service Worker registers and intercepts fetch
- [ ] Spike: MessageChannel sends/receives between contexts
- [ ] Spike: binary sizes logged, within ~600KB budget for JSPI variant
- [ ] Spike: OPFS read/write latency logged (target: <1ms write, <0.5ms read for 1KB)

**Exit criteria:** If spike passes all browser checks, proceed. If JSPI doesn't work with quickjs-emscripten in CC's Chromium, use Asyncify-only. If OPFS has issues, fall back to IndexedDB via ZenFS and note which browsers need the fallback.

---

## PHASE 1: CATALYSTFS — FILESYSTEM (2-3 days)

**Goal:** Build the core filesystem layer. Node.js `fs` API surface backed by ZenFS/IndexedDB (OPFS comes in Phase 2).

**What gets built:**

1. `packages/core/src/fs/CatalystFS.ts`
   - Static factory: `CatalystFS.create(name: string): Promise<CatalystFS>`
   - All sync methods: readFileSync, writeFileSync, mkdirSync (recursive), readdirSync (withFileTypes), statSync, unlinkSync, rmdirSync, renameSync, existsSync, copyFileSync
   - All async methods: readFile, writeFile, mkdir, readdir, stat, unlink, rmdir, rename, copyFile
   - `rawFs` getter: returns ZenFS fs object for libraries that need raw access (isomorphic-git, etc.)
   - Delegates all operations to `@zenfs/core`

2. `packages/core/src/fs/types.ts` — CatalystFSConfig, MountConfig, WatchCallback, FileEntry

3. `packages/core/src/fs/index.ts` — barrel exports

4. `packages/core/src/fs/CatalystFS.test.ts` (Node — pure logic via ZenFS InMemory backend)
   - Write/read round-trip (string and Buffer)
   - mkdir recursive + readdir
   - stat returns correct type info
   - rename moves files
   - unlink deletes files
   - readdir with withFileTypes
   - existsSync returns true/false correctly
   - Error cases: read non-existent file, mkdir over existing file
   - rawFs getter returns usable fs object

5. `packages/core/src/fs/CatalystFS.browser.test.ts` (Browser — OPFS via Playwright)
   - Same test cases as above but running against OPFS backend in real Chromium
   - OPFS persistence: write file, destroy CatalystFS instance, recreate, verify file exists
   - OPFS performance: time 100 sequential writes, verify <1ms average per 1KB write
   - Concurrent access: two CatalystFS instances reading/writing same OPFS store

**CC notes:**
- ZenFS `configure()` is async — that's why the factory is async
- ZenFS supports `readdir` with `withFileTypes` natively
- For Phase 1 use IndexedDB backend (`@zenfs/dom` IndexedDB). OPFS comes in Phase 2.
- `@zenfs/core` provides `fs` and `fs.promises` after `configure()` — delegate directly

**Verification:**
- [ ] `pnpm test` passes (Node tests against InMemory backend)
- [ ] `pnpm test:browser` passes (browser tests against OPFS)
- [ ] Write file -> read file returns identical content (both backends)
- [ ] Files persist across CatalystFS.create() calls in OPFS
- [ ] Error handling: meaningful errors for missing files
- [ ] rawFs works with isomorphic-git (`git.init({ fs: catalystFs.rawFs, dir: '/test' })`)

---

## PHASE 2: CATALYSTFS — MULTI-MOUNT + FILE WATCHING (2-3 days)

**Goal:** Multiple storage backends per mount path. Native file watching with fallback.

**What gets built:**

1. Update `CatalystFS.create()` to accept mount configuration:
   - `opfs` -> `@zenfs/dom` WebAccess backend (feature-detect, fall back to IndexedDB)
   - `memory` -> `@zenfs/core` InMemory backend

2. `packages/core/src/fs/FileWatcher.ts`
   - Feature-detect FileSystemObserver
   - If available: native observer with recursive watching
   - If not: polling fallback with content-hash comparison, 500ms interval
   - Unified callback: `watch(path, options, callback) -> unsubscribe`
   - Debounce: 50ms

3. Expose `fs.watch()` on CatalystFS

4. Tests for multi-mount and file watching (both native and polling paths)

**CC notes:**
- OPFS detection: `typeof navigator?.storage?.getDirectory === 'function'`
- FileSystemObserver detection: `typeof FileSystemObserver !== 'undefined'`
- For OPFS: `@zenfs/dom` WebAccess backend
- For memory: `@zenfs/core` InMemory backend

**Verification:**
- [ ] `pnpm test` passes (multi-mount config logic, polling fallback with mocked timer)
- [ ] `pnpm test:browser` passes:
  - [ ] OPFS backend serves /project path, InMemory serves /tmp
  - [ ] Write to /tmp, destroy, recreate — file is gone (volatile)
  - [ ] Write to /project, destroy, recreate — file persists (OPFS)
  - [ ] FileSystemObserver: write triggers callback in Chromium (log whether native or polling)
  - [ ] Polling fallback: mock FileSystemObserver absence, verify polling still fires callbacks
  - [ ] Debounce: 10 rapid writes produce ≤2 callback batches
- [ ] All Phase 1 tests still pass

---

## PHASE 3: PREVIEW SERVICE WORKER (1-2 days)

**Goal:** A Service Worker that serves files from CatalystFS as HTTP responses.

**What gets built:**

1. `packages/core/src/net/PreviewSW.ts` — SW source
   - Receives MessagePort via postMessage
   - Configures ZenFS Port backend on port — full fs.readFileSync() access
   - Intercepts fetch: static files from CatalystFS, SPA fallback, /api/* passthrough

2. `packages/core/src/net/mime.ts` — extension -> MIME type mapping (~30 types)

3. `packages/core/src/net/preview-client.ts` — helper: register SW, create MessageChannel, send port

4. `packages/core/src/net/types.ts`, `packages/core/src/net/index.ts`

**CC notes:**
- Port backend: ZenFS feature giving SW full fs access over MessagePort
- SW must be a separate file entry point
- MIME: .html, .js, .mjs, .css, .json, .png, .jpg, .jpeg, .gif, .svg, .woff, .woff2, .wasm, .ico, .txt, .map, .ts, .tsx, .jsx, etc.

**Verification (all browser tests — SW only exists in browser):**
- [ ] `pnpm test:browser` passes:
  - [ ] SW registers without errors
  - [ ] Write file to CatalystFS -> fetch via SW -> correct content returned
  - [ ] MIME types correct: .html → text/html, .js → application/javascript, .css → text/css, .json → application/json
  - [ ] SPA fallback: request `/about` returns `/dist/index.html` content
  - [ ] `/api/test` is not intercepted (passes through to network)
  - [ ] SW receives MessagePort and gets full CatalystFS access via Port backend
- [ ] `pnpm test` passes (MIME mapping unit tests, pure logic)

---

## PHASE 4: CATALYSTENGINE — QUICKJS INTEGRATION (3-5 days)

**Goal:** QuickJS-WASM running user code with host bindings to CatalystFS. The core runtime.

**What gets built:**

1. `packages/core/src/engine/CatalystEngine.ts`
   - JSPI/Asyncify variant detection + dynamic import
   - Factory: `CatalystEngine.create(config)`
   - `eval(code)`, `evalFile(path)` methods
   - Memory limit + execution timeout

2. `packages/core/src/engine/host-bindings/`
   - fs.ts, path.ts, process.ts, console.ts, buffer.ts, timers.ts, events.ts, url.ts, assert.ts, crypto.ts, util.ts

3. `packages/core/src/engine/require.ts` — CJS module loader:
   1. Built-in modules -> return host binding
   2. Relative paths -> resolve against CatalystFS, eval
   3. /node_modules/{name} -> read from CatalystFS
   4. Not found -> throw MODULE_NOT_FOUND (Phase 7 wires auto-fetch)

4. Tests: eval, require('fs'), require('path'), console capture, timeout, memory limit, relative require, MODULE_NOT_FOUND

**CC notes:**
- JSPI: `typeof WebAssembly.Suspending === 'function'`
- JSPI -> `@jitl/quickjs-wasmfile-release-sync`
- Asyncify -> `@jitl/quickjs-wasmfile-release-async`
- Host bindings inject into QuickJS globalThis, NOT the browser's
- require() reads source from CatalystFS, evals with module/exports/__filename/__dirname wrappers
- quickjs-emscripten API: `getQuickJS()` or `newQuickJSWASMModule()`, then `runtime.newContext()`, then `context.evalCode()`

**Verification:**
- [ ] `pnpm test` passes (require() resolution logic, path module, Buffer polyfill, EventEmitter, assert, util — pure JS, no WASM needed)
- [ ] `pnpm test:browser` passes — all QuickJS-WASM tests run in real Chromium:
  - [ ] QuickJS boots with correct variant (JSPI or Asyncify — log which one CC's Chromium picks)
  - [ ] eval("1 + 1") returns 2
  - [ ] eval with ES2023 features: optional chaining, nullish coalescing, async generators
  - [ ] require('fs').readFileSync reads from CatalystFS (OPFS backend)
  - [ ] require('fs').writeFileSync writes to CatalystFS, persists
  - [ ] require('path').join('a', 'b') returns 'a/b'
  - [ ] console.log captured by host callback
  - [ ] console.error captured separately from console.log
  - [ ] setTimeout fires (QuickJS event loop)
  - [ ] Infinite loop terminated by timeout (30s default)
  - [ ] Memory bomb terminated by limit (256MB default)
  - [ ] require('./relative') resolves from CatalystFS
  - [ ] require('nonexistent') throws MODULE_NOT_FOUND
  - [ ] QuickJS boot time <100ms
  - [ ] WASM binary size logged
- [ ] All Phase 1-3 tests still pass

---

## PHASE 5: CATALYSTNET — FETCH PROXY (2-3 days)

**Goal:** Code running in QuickJS can call fetch() through the main thread.

**What gets built:**

1. `packages/core/src/net/FetchProxy.ts` — MessageChannel proxy: QuickJS -> main thread -> real fetch -> response back
2. `packages/core/src/net/fetch-host-binding.ts` — inject fetch into QuickJS
3. Wire FetchProxy into CatalystEngine
4. Tests: fetch real URL, blocked domain, timeout, POST with body

**CC notes:**
- JSPI suspends QuickJS -> message to main thread -> async fetch -> message back -> JSPI resumes
- Request/response serialized across MessageChannel (structured clone)

**Verification:**
- [ ] `pnpm test` passes (request/response serialization logic, domain allowlist matching, timeout logic)
- [ ] `pnpm test:browser` passes:
  - [ ] QuickJS eval: `fetch('https://jsonplaceholder.typicode.com/todos/1')` returns JSON data via MessageChannel proxy
  - [ ] Blocked domain throws meaningful error
  - [ ] POST with JSON body works end-to-end
  - [ ] Request timeout fires for slow/hung requests
  - [ ] MessageChannel survives multiple sequential fetch calls

---

## PHASE 6: CATALYSTPROC — PROCESS MANAGEMENT (2-3 days)

**Goal:** child_process.exec() and spawn() via Worker isolation.

**What gets built:**

1. ProcessManager.ts — spawn, exec, kill, process tree
2. CatalystProcess.ts — pid, stdin, stdout, stderr, exitCode, kill, events
3. worker-template.ts — Worker entry: boots QuickJS + CatalystFS, executes command, streams stdio
4. Tests: exec returns stdout, spawn streams, kill terminates, process isolation

**CC notes:**
- Each process = new Worker with its own QuickJS-WASM instance
- Worker gets CatalystFS access via Port backend over MessagePort
- Stdio via MessageChannel

**Verification:**
- [ ] `pnpm test` passes (process tree logic, signal handling state machine, stdio buffering)
- [ ] `pnpm test:browser` passes:
  - [ ] exec runs code in separate Worker, returns stdout
  - [ ] spawn streams stdout chunks in real-time via MessageChannel
  - [ ] Process isolation: spawned process cannot access parent's variables
  - [ ] kill(SIGTERM) terminates gracefully (QuickJS handles exit)
  - [ ] kill(SIGKILL) terminates immediately (Worker.terminate())
  - [ ] Child process has CatalystFS access via Port backend (read/write files)
- [ ] All earlier tests still pass

---

## PHASE 7: CATALYSTPKG — PACKAGE MANAGEMENT (3-5 days)

**Goal:** Full package management. Read package.json, resolve dependency trees against the npm registry, fetch via esm.sh CDN transform layer, cache in OPFS. `require('express')` just works.

**Strategy:**
- **npm registry** is the source of truth (registry.npmjs.org — 3M+ packages, everything is here)
- **esm.sh** is the CDN transform layer (handles CJS→ESM conversion, TypeScript stripping, dependency bundling server-side, serves browser-ready code)
- **OPFS** is the local cache (download once, persist across sessions)
- **Deno alignment** for future server sync — Deno reads npm packages natively via `npm:` specifiers

**What gets built:**

1. `packages/pkg/src/PackageManager.ts`
   - `install(name: string, version?: string): Promise<PackageInfo>` — resolve + fetch + cache
   - `installAll(packageJsonPath?: string): Promise<PackageInfo[]>` — read package.json, install all deps
   - `resolve(name: string): string | null` — check if package exists in /node_modules/
   - `remove(name: string): Promise<void>` — remove from cache + lockfile
   - `clear(): Promise<void>` — wipe entire cache
   - `list(): Promise<PackageInfo[]>` — list installed packages with versions

2. `packages/pkg/src/NpmResolver.ts`
   - Fetches package metadata from registry.npmjs.org
   - `getPackageInfo(name, versionRange?)` → resolved version, dependency tree, tarball URL
   - Semver resolution: `^1.2.3` → latest compatible version
   - Transitive dependency resolution: walk the dependency tree, flatten
   - Circular dependency detection
   - Peer dependency handling (warn, don't fail)
   - Cache registry responses in memory (short TTL) to avoid re-fetching during tree walk

3. `packages/pkg/src/PackageFetcher.ts`
   - Primary: esm.sh CDN — `https://esm.sh/{name}@{version}?cjs` for CJS, `https://esm.sh/{name}@{version}` for ESM
   - esm.sh handles: CJS→ESM conversion, TypeScript compilation, dependency bundling, browser polyfills
   - Fallback: direct npm tarball (`https://registry.npmjs.org/{name}/-/{name}-{version}.tgz`) → extract with browser tar/gzip
   - Response validation: verify content-type, check for esm.sh error responses
   - Retry logic: 3 attempts with exponential backoff

4. `packages/pkg/src/PackageCache.ts`
   - OPFS-backed at `/node_modules/{name}/`
   - Content-addressable: `{name}@{version}` → cached files
   - Cache metadata: version, install date, integrity hash, source (esm.sh vs registry)
   - LRU eviction: configurable max cache size (default 500MB), evict least-recently-used
   - `isCached(name, version)` — check before fetch
   - `invalidate(name)` — force re-fetch on next install

5. `packages/pkg/src/Lockfile.ts`
   - Read/write `catalyst-lock.json` in project root
   - Per-package: name, version, resolved URL, integrity hash (SHA-256), dependencies
   - Deterministic installs: if lockfile exists, use pinned versions
   - `catalyst-lock.json` format:
     ```json
     {
       "lockfileVersion": 1,
       "packages": {
         "lodash": { "version": "4.17.21", "resolved": "https://esm.sh/lodash@4.17.21?cjs", "integrity": "sha256-...", "dependencies": {} },
         "express": { "version": "4.18.2", "resolved": "https://esm.sh/express@4.18.2?cjs", "integrity": "sha256-...", "dependencies": { "body-parser": "1.20.1" } }
       }
     }
     ```

6. `packages/pkg/src/PackageJson.ts`
   - Read and parse `/project/package.json`
   - Extract `dependencies`, `devDependencies`
   - Validate semver ranges
   - `installAll()` reads this and installs everything

7. Wire into CatalystEngine require() chain:
   - In `packages/core/src/engine/require.ts`:
     1. Built-in modules → host binding
     2. Relative paths → CatalystFS
     3. Check `/node_modules/{name}` → if cached, load
     4. If PackageManager configured → `install(name)` → retry load
     5. Not found → throw MODULE_NOT_FOUND

8. Tests:
   - Install a simple package (lodash) — verify writes to /node_modules/, require works in QuickJS
   - Install a package with dependencies (express) — verify transitive deps resolve
   - Lockfile generates with correct versions and hashes
   - Second install is instant (cache hit, no network)
   - Lockfile-pinned install doesn't hit registry for resolution
   - installAll() reads package.json and installs everything listed
   - Cache eviction: fill cache past limit, verify LRU eviction
   - Semver resolution: `^1.2.3` picks latest compatible
   - Offline: cached packages work without network
   - remove() cleans cache and lockfile entry

**CC notes:**
- npm registry API: `GET https://registry.npmjs.org/{package}` returns full metadata with all versions
- esm.sh `?cjs` flag returns CommonJS-compatible output — this is what QuickJS needs
- esm.sh `?bundle-deps` bundles transitive dependencies into a single file — reduces fetch count
- For packages that esm.sh can't handle: fall back to npm tarball, extract with DecompressionStream API (browser-native gzip) + a lightweight tar parser
- The wire-up in require.ts should be optional — no PackageManager = just throw
- Registry fetches go through CatalystNet's fetch proxy (domain allowlist should include registry.npmjs.org and esm.sh by default)

**Verification:**
- [ ] `pnpm test` passes (semver resolution logic, lockfile serialization/deserialization, dependency tree walking, circular dep detection, LRU eviction logic, package.json parsing)
- [ ] `pnpm test:browser` passes:
  - [ ] Install lodash from esm.sh, require in QuickJS, call _.chunk([1,2,3,4], 2) — end to end in real Chromium
  - [ ] Install express, verify transitive deps present in OPFS /node_modules/
  - [ ] Lockfile written to CatalystFS with versions + SHA-256 integrity hashes
  - [ ] Second install is instant (OPFS cache hit, no network traffic — verify via fetch spy)
  - [ ] installAll() reads package.json from CatalystFS, installs all listed deps
  - [ ] LRU eviction: fill cache past limit, verify least-recently-used package evicted
  - [ ] Offline test: install package, disconnect network (mock fetch to reject), require still works from OPFS cache
  - [ ] npm tarball fallback: mock esm.sh 500 error, verify fallback to registry.npmjs.org tarball + DecompressionStream extract
- [ ] All earlier tests still pass

---

## PHASE 8: CATALYSTDEV — BUILD PIPELINE + HMR (2-3 days)

**Goal:** File changes trigger esbuild rebuild, results served via preview SW, HMR notifies consumer.

**What gets built:**

1. `packages/dev/src/BuildPipeline.ts` — wraps esbuild-wasm, frontend + optional backend passes
2. `packages/dev/src/HMRManager.ts` — CatalystFS.watch() -> build -> emit update event
3. `packages/dev/src/ContentHashCache.ts` — SHA-256 cache, OPFS-backed, last 10 builds
4. Tests: build produces output, cache hit skips, file change triggers HMR, build errors reported

**CC notes:**
- esbuild-wasm is peer dependency
- Read source from CatalystFS, write output to CatalystFS /dist/
- HMR just signals "reload" — no React Fast Refresh
- Content hash: sort source paths, concatenate, SHA-256

**Verification:**
- [ ] `pnpm test` passes (content hash computation, build config validation, MIME types)
- [ ] `pnpm test:browser` passes:
  - [ ] Write TSX source to CatalystFS → build → /dist/app.js exists with valid JS
  - [ ] Content-hash cache: identical source → second build returns instantly (0ms, no esbuild invocation)
  - [ ] Modify source file → CatalystFS.watch() fires → rebuild triggers → HMR event emitted
  - [ ] Build error: write invalid TSX → build returns error with file, line, message
  - [ ] Backend pass: write Hono route to src/api/index.ts → build → /dist/api-sw.js exists
- [ ] All earlier tests still pass

---

## PHASE 9: INTEGRATION TESTS + COMPATIBILITY MATRIX + EXAMPLE APP (3-5 days)

**Goal:** End-to-end proof that all layers work together. Node.js API compatibility measured with real numbers. Cross-browser matrix. Example app consumers can reference.

**What gets built:**

1. `packages/core/src/index.ts` — main entry, re-exports all layers
2. `packages/core/src/catalyst.ts` — top-level Catalyst.create() factory
3. Finalized package.json files with correct exports, dependencies, peer deps

4. **Integration test suite** (`packages/core/src/integration.browser.test.ts`):
   - Full round-trip: create Catalyst → write React app source → build with esbuild → serve via SW → fetch rendered page → verify HTML content
   - Backend round-trip: write Hono API route → build → fetch /api/hello → verify JSON response
   - Package install + use: installAll from package.json → require('lodash') in QuickJS → verify
   - Process communication: spawn child → write to stdin → read stdout → verify
   - File watch + rebuild: modify source → verify HMR event fires and new build exists
   - Persistence: write files → destroy Catalyst → recreate with same name → verify files exist in OPFS
   - Sandbox security: eval code that tries `window.document` → verify blocked
   - Sandbox security: eval code that fetches blocked domain → verify rejected
   - Sandbox security: eval code that exceeds memory limit → verify terminated
   - Offline packages: install package → mock network offline → require still works

5. **Node.js compatibility matrix** (`packages/core/src/compat/node-compat.browser.test.ts`):

   A test file that runs ~200 Node.js API calls through CatalystEngine in real Chromium. Each test:
   - Calls a Node.js API method via `engine.eval("require('fs').readFileSync(...)")`
   - Checks: does it exist? Does it return the right type? Does it match Node.js behavior?
   - Reports: PASS / FAIL / NOT_IMPLEMENTED per method
   - Generates a compatibility report at the end:

   ```
   === Catalyst Node.js Compatibility Report ===
   fs:           22/26 methods (84.6%)
   path:         18/18 methods (100%)
   buffer:       15/17 methods (88.2%)
   events:       11/12 methods (91.7%)
   stream:        8/12 methods (66.7%)
   url:           6/6 methods (100%)
   util:         10/14 methods (71.4%)
   assert:       12/13 methods (92.3%)
   crypto:        5/10 methods (50.0%)
   child_process: 3/7 methods (42.9%)
   http:          4/8 methods (50.0%)
   os:            3/10 methods (30.0%)
   net:           0/8 methods (0% — not possible in browser)
   tls:           0/5 methods (0% — not possible in browser)
   dns:           0/4 methods (0% — not possible in browser)
   ---
   TOTAL:       117/170 testable methods (68.8%)
   ```

   This replaces the estimated "60-70%" with a real measured number.

   Test cases per module:
   - **fs:** readFileSync, readFile, writeFileSync, writeFile, mkdirSync, mkdir, readdirSync, readdir, statSync, stat, lstatSync, lstat, unlinkSync, unlink, rmdirSync, rmdir, renameSync, rename, existsSync, copyFileSync, copyFile, watchFile, createReadStream, createWriteStream, readdir withFileTypes, mkdir recursive
   - **path:** join, resolve, basename, dirname, extname, normalize, isAbsolute, relative, parse, format, sep, delimiter, posix.join, posix.resolve, posix.normalize, posix.basename, posix.dirname, posix.extname
   - **buffer:** Buffer.from (string, array, buffer), Buffer.alloc, Buffer.allocUnsafe, Buffer.concat, Buffer.isBuffer, Buffer.byteLength, .toString (utf8, hex, base64), .slice, .copy, .compare, .equals, .indexOf, .fill, .write, .readUInt8
   - **events:** on, once, emit, removeListener, removeAllListeners, listenerCount, listeners, prependListener, prependOnceListener, setMaxListeners, getMaxListeners, eventNames
   - **crypto:** randomBytes, createHash (sha256, sha1, md5), randomUUID, createHmac, timingSafeEqual
   - **child_process:** exec, execSync, spawn, fork (→ NOT_IMPLEMENTED), execFile, execFileSync
   - **process:** env, cwd(), argv, exit(), platform, version, hrtime, nextTick
   - **console:** log, error, warn, info, debug, table, time/timeEnd, assert, count, clear, dir, trace

6. **Cross-browser matrix** (`packages/core/src/compat/browser-compat.browser.test.ts`):

   Runs a feature detection suite and reports what each browser supports:

   ```
   === Catalyst Browser Compatibility Report ===
   Feature                    | Status    | Fallback
   OPFS                       | NATIVE    | —
   OPFS SyncAccessHandle      | NATIVE    | —
   FileSystemObserver         | NATIVE    | Polling (500ms)
   JSPI (WebAssembly.Suspending) | NATIVE | Asyncify (2x binary)
   Service Worker             | NATIVE    | —
   MessageChannel             | NATIVE    | —
   QuickJS-WASM               | OK        | —
   DecompressionStream        | NATIVE    | —
   WebCrypto                  | NATIVE    | —
   WASM linear memory (256MB) | OK        | —
   ```

   CC runs this against Chromium (the Playwright default). The same test can later run against Firefox and WebKit by changing Playwright config. The report documents exactly which features use native APIs vs fallbacks.

7. `examples/basic/` — minimal HTML page:
   - Imports @aspect/catalyst-core
   - Creates a Catalyst instance
   - Writes a React "Hello from Catalyst" app to virtual filesystem
   - Builds with CatalystDev
   - Serves in a preview iframe via Service Worker
   - Working demo: user opens page, sees rendered React app

8. Performance benchmarks (`packages/core/src/compat/perf.browser.test.ts`):
   - CatalystFS write 1KB: target <1ms (run 100x, report average + p95)
   - CatalystFS read 1KB: target <0.5ms
   - CatalystFS write 100KB: target <5ms
   - CatalystFS readdir 100 files: target <10ms
   - QuickJS boot (JSPI variant): target <100ms
   - QuickJS boot (Asyncify variant): target <200ms
   - QuickJS eval simple expression: target <1ms
   - QuickJS require('fs').readFileSync: target <5ms
   - esbuild-wasm rebuild (small app): target <500ms
   - Content-hash cache hit: target <5ms
   - Package install (lodash, cached): target <10ms
   - Package install (lodash, network): log actual time
   - Service Worker response (1KB file): target <5ms
   - MessageChannel round-trip: target <1ms

9. Bundle size audit:
   - @aspect/catalyst-core: target ~600KB (log actual)
   - @aspect/catalyst-pkg: target ~50KB
   - @aspect/catalyst-dev: target ~30KB

**Verification:**
- [ ] `pnpm test:all` passes — every Node and browser test from every phase
- [ ] Integration test: full round-trip works end to end in Chromium
- [ ] Node.js compat report generated with actual percentages per module
- [ ] Browser compat report generated showing native vs fallback per feature
- [ ] Performance benchmarks: all targets met or documented why not
- [ ] Bundle sizes within budget or documented trade-offs
- [ ] Example app: opens in browser, renders "Hello from Catalyst" in preview iframe
- [ ] README complete: ZenFS attribution, getting started guide, API overview, compat numbers

---

## PHASE 10: CATALYST-WASI — NON-JS BINARY EXECUTION (3-5 days)

**Goal:** Run programs compiled to wasm32-wasi inside Catalyst. Python scripts, Rust CLIs, Go tools — anything that compiles to WASI runs in the browser.

**Why this matters:** Node.js compatibility gets you JavaScript packages. WASI gets you everything else. A user can run a Python linter, a Rust formatter, a Go static analysis tool — all inside the browser sandbox with no server.

**What gets built:**

1. `packages/wasi/src/CatalystWASI.ts`
   - Wraps Wasmer-JS (`@aspect/catalyst-wasi` package, separate from core)
   - `CatalystWASI.create(config: WASIConfig): Promise<CatalystWASI>`
   - `exec(wasmBinary: Uint8Array, args: string[], env?: Record<string,string>): Promise<ExecResult>`
   - `execFile(path: string, args: string[]): Promise<ExecResult>` — read .wasm from CatalystFS, then exec
   - WASI filesystem mapping: WASI fd_read/fd_write → CatalystFS
   - WASI stdout/stderr capture → same pattern as CatalystProc

2. `packages/wasi/src/WASIBindings.ts`
   - Map WASI system calls to Catalyst layers:
     - `fd_read`, `fd_write`, `path_open`, `path_filestat_get` → CatalystFS
     - `clock_time_get` → Date.now()
     - `environ_get`, `environ_sizes_get` → config.env
     - `args_get`, `args_sizes_get` → config.args
     - `proc_exit` → resolve exec promise with exit code
     - `random_get` → crypto.getRandomValues()

3. `packages/wasi/src/BinaryCache.ts`
   - OPFS cache for compiled WASI binaries (same pattern as PackageCache)
   - Keyed by URL + hash
   - Pre-compiled binaries for common tools (Python WASI build, etc.) hosted on CDN

4. Wire into CatalystProc:
   - ProcessManager detects `.wasm` files → route to CatalystWASI instead of QuickJS
   - `catalyst.exec('python script.py')` → boots Python WASI → runs script

5. Tests:
   - Execute a simple WASI binary (compile a hello-world Rust program to wasm32-wasi)
   - WASI reads file from CatalystFS
   - WASI writes file to CatalystFS
   - stdout/stderr captured
   - Exit code returned
   - Environment variables passed through

**CC notes:**
- Wasmer-JS provides the WASI runtime: `@aspect/wasm` or `wasmer-js` npm package
- WASI preview1 is the stable ABI — target that, not preview2 yet
- The WASM binary must be compiled with `--target wasm32-wasi`
- Pre-compiled Python WASI: check https://github.com/nicekiwi/nicekiwi/nicekiwi for available builds, or build from cpython source
- CatalystFS mount points map to WASI preopened directories

**Verification:**
- [ ] Hello-world WASI binary runs, stdout captured
- [ ] WASI binary reads from CatalystFS
- [ ] WASI binary writes to CatalystFS
- [ ] Environment variables accessible inside WASI
- [ ] Exit code correct
- [ ] Binary cache: second run is instant

---

## PHASE 11: CATALYST-SYNC — DENO SERVER PROTOCOL (3-5 days)

**Goal:** Bidirectional filesystem sync between Catalyst (browser OPFS) and a Deno server (disk). Browser-only works completely. Connect a server to unlock real databases, native modules, production builds. Disconnect — back to browser-only. No mode switch, no data loss.

**Why Deno:**
- Native npm package support via `npm:` specifiers (same packages Catalyst resolves)
- Built-in TypeScript (no compilation step)
- Edge deployment (Deno Deploy, Cloudflare Workers)
- Permission-based security model (explicit filesystem/network access)
- Hono runs natively in Deno

**What gets built:**

1. `packages/sync/src/SyncClient.ts` (browser-side)
   - WebSocket connection to Deno server
   - `connect(url: string): Promise<void>`
   - `disconnect(): void`
   - `push(): Promise<SyncResult>` — send local changes to server
   - `pull(): Promise<SyncResult>` — get server changes to local
   - Auto-sync mode: push on CatalystFS.watch() events, pull on server notification
   - Connection state: connected, disconnected, syncing, error

2. `packages/sync/src/OperationJournal.ts` (browser-side)
   - Append-only log of filesystem mutations: write, rename, delete, mkdir
   - Persisted in OPFS (survives disconnect)
   - On reconnect: replay journal entries to server
   - Compaction: collapse write→write→write to single write

3. `packages/sync/src/SyncServer.ts` (Deno-side, published as separate package)
   - Deno HTTP server with WebSocket upgrade
   - Receives filesystem operations, applies to disk
   - Watches disk for changes (Deno.watchFs), pushes to browser
   - Conflict resolution: last-write-wins with conflict markers for true conflicts
   - Serves as the canonical store (browser is working copy)

4. `packages/sync/src/ConflictResolver.ts`
   - Strategy: `'local' | 'remote' | 'merge' | 'ask'`
   - Default: last-write-wins (timestamp comparison)
   - For text files: three-way merge attempt, fall back to conflict markers
   - Consumer can hook `onConflict(path, local, remote)` to prompt user

5. `packages/sync/src/protocol.ts`
   - Shared types between client and server
   - Message format:
     ```typescript
     type SyncMessage =
       | { type: 'push', operations: FileOperation[] }
       | { type: 'pull', since: number }
       | { type: 'changes', operations: FileOperation[] }
       | { type: 'conflict', path: string, local: string, remote: string }
       | { type: 'ack', operationIds: string[] }
     ```

6. `examples/sync/` — example: browser editor + Deno server, files sync bidirectionally

7. Tests:
   - Write file in browser → appears on Deno disk
   - Write file on Deno disk → appears in browser OPFS
   - Disconnect → write files → reconnect → journal replays, files sync
   - Conflict: both sides edit same file → conflict resolution fires
   - Large file sync (100KB+)
   - Rapid changes debounce properly

**CC notes:**
- WebSocket for real-time bidirectional communication
- The operation journal is the key to offline support — it buffers changes during disconnection
- Journal compaction prevents unbounded growth: if file X is written 5 times before sync, only the final state matters
- Deno server is a separate entry point / package — consumers who don't need server sync don't pull it in
- `Deno.watchFs()` for server-side file watching
- Protocol should be versioned from day one (version field in handshake)

**Verification:**
- [ ] Browser write → server file appears
- [ ] Server write → browser file appears
- [ ] Offline: journal captures operations
- [ ] Reconnect: journal replays successfully
- [ ] Conflict detection fires
- [ ] Large file sync works
- [ ] Connection state transitions are correct

---

## PHASE 12: HONO BACKEND INTEGRATION (2-3 days)

**Goal:** Write backend API routes using Hono. In browser-only mode, Hono runs in the Service Worker. With Deno server, Hono runs on real Deno. Same code, both environments.

**Why Hono:**
- 18KB, MIT license
- Official Service Worker adapter (runs in Catalyst's preview SW)
- Official Deno adapter (runs on the sync server)
- Same route definitions work in both environments
- Middleware ecosystem: CORS, JWT, zod-validator, etc.

**What gets built:**

1. `packages/dev/src/HonoIntegration.ts`
   - Detect if `/project/src/api/` directory exists
   - If yes: build backend pass with esbuild → `/dist/api-sw.js` (IIFE format)
   - Inject into preview Service Worker as the `/api/*` handler
   - Hono routes handle API requests, CatalystFS provides the data layer

2. `packages/dev/src/hono-sw-adapter.ts`
   - Adapter that connects Hono's fetch handler to the preview SW's fetch event
   - Routes: `/api/*` → Hono handler, everything else → static file serving (existing)
   - Hono gets a `context.env` with CatalystFS access for reading/writing data

3. Update preview Service Worker (from Phase 3):
   - Load api-sw.js if it exists in /dist/
   - Route /api/* through Hono
   - Fall through to static file serving for non-API routes

4. `examples/fullstack/` — example full-stack app:
   - Frontend: React app with fetch('/api/todos')
   - Backend: Hono routes that read/write todos to CatalystFS as JSON files
   - All running in browser, no server
   - Same backend code works on Deno server when sync is connected

5. Tests:
   - Write Hono route → build → fetch('/api/hello') returns response
   - Hono route reads from CatalystFS
   - Hono route writes to CatalystFS
   - Middleware works (CORS headers present)
   - Frontend fetches from backend, displays data
   - Same route code runs in Deno (via sync server)

**CC notes:**
- Hono's Service Worker adapter: `import { handle } from 'hono/service-worker'`
- The backend build is IIFE format (not ESM) because SW `importScripts()` needs it
- CatalystFS is injected into Hono's env, not imported globally — keeps routes testable
- esbuild external: mark `hono` as external for the SW build, bundle it separately

**Verification:**
- [ ] Backend routes respond to /api/* requests
- [ ] Routes read/write CatalystFS
- [ ] Frontend + backend work together in preview
- [ ] Same routes work on Deno (manual test)
- [ ] All earlier tests still pass

---

## CC SESSION SUMMARY

| Session | Phase | Est. Time |
|---------|-------|-----------|
| 1 | Phase 0 (Scaffold + Spike) | 2-3 hrs |
| 2 | Phase 1 (CatalystFS core) | 4-6 hrs |
| 3 | Phase 2 (Multi-mount + Watcher) | 4-6 hrs |
| 4 | Phase 3 (Preview SW) | 3-4 hrs |
| 5 | Phase 4 (CatalystEngine) | 6-10 hrs |
| 6 | Phase 5 (CatalystNet) | 4-6 hrs |
| 7 | Phase 6 (CatalystProc) | 4-6 hrs |
| 8 | Phase 7 (CatalystPkg) | 6-10 hrs |
| 9 | Phase 8 (CatalystDev) | 4-6 hrs |
| 10 | Phase 9 (Integration + Compat + Example) | 6-10 hrs |
| 11 | Phase 10 (WASI) | 6-10 hrs |
| 12 | Phase 11 (Deno Sync) | 6-10 hrs |
| 13 | Phase 12 (Hono Backend) | 4-6 hrs |

**Total: 13 CC sessions**

Commit after each phase: `git add -A && git commit -m "Phase {N}: {description}"`

---

## RISK ASSESSMENT

| Risk | Level | Mitigation |
|------|-------|-----------|
| ZenFS API gaps | Low | Our needs are a strict subset of Node fs |
| Bundle size | Low | Under 600KB budget |
| FileSystemObserver missing | Low | Polling fallback from Phase 2 |
| JSPI not in Safari | Medium | Asyncify fallback, same API |
| QuickJS ES2023 gaps | Medium | No WeakRef, no Intl — neither blocks us |
| OPFS quota | Medium | LRU cache eviction for packages (Phase 7) |
| esm.sh CJS transform fails for some packages | Medium | Fallback to npm tarball direct download + extract |
| Transitive dependency resolution complexity | Medium | Use esm.sh `?bundle-deps` to let server handle it when possible |
| WASI binary availability | Medium | Pre-compiled Python/Ruby WASI builds exist. Rust/Go compile easily. Niche tools may not have WASI builds. |
| Deno sync WebSocket reliability | Medium | Operation journal survives disconnects. Reconnect with journal replay. |
| StackBlitz patent | High | Different at every layer. Patent attorney FTO before commercial release. |
| QuickJS vs V8 perf | High | I/O-bound use case. Benchmark in Phase 0. |
| Scope creep | High | Phases strictly ordered. Each independently useful. |

---

## MILESTONES

**M1 "Real filesystem"** (Phase 2): OPFS, multi-mount, file watching. Usable standalone.  
**M2 "Preview server"** (Phase 3): Write files → serve via SW. Visual output.  
**M3 "Code execution"** (Phase 4): QuickJS runs user code with host bindings.  
**M4 "Full runtime"** (Phase 8): All layers operational. Package management with npm registry + esm.sh CDN.  
**M5 "Shippable library"** (Phase 9): Tested, documented, example app, benchmarked. Consumers can build on it.  
**M6 "Polyglot"** (Phase 10): WASI runs Python, Rust, Go — any wasm32-wasi binary in the browser.  
**M7 "Connected"** (Phase 11): Browser ↔ Deno server sync. Offline works, online unlocks real backend.  
**M8 "Full-stack"** (Phase 12): Hono routes in SW + Deno. Same code, browser or server. Complete product.
