# Catalyst Phase 0 — Hard Audit

**Branch:** `claude/catalyst-phase-0-SyoeR`  
**Commits:** 34 (Phase 0 → Phase 22)  
**Files:** 165 TypeScript source files, 34,160 lines  
**Tests:** 72 test files  
**Audited:** 2026-02-28

---

## Verdict Summary

The codebase is roughly 70% real, 15% scaffold, 15% hollow. The critical path — filesystem, QuickJS engine, Workers bindings, Workers runtime — is real and would work in a browser. The Reaction/Deno layer is correctly architectured but has no engine behind it. Several features have state-machine scaffolding but don't perform their actual function.

---

## Layer-by-Layer Assessment

### ✅ REAL — Working Implementations

These would function correctly in a browser environment.

**CatalystFS** (480 lines)  
Real ZenFS wrapper. OPFS → IndexedDB → InMemory fallback chain. Multi-mount support. FileWatcher with FileSystemObserver detection. All filesystem operations delegate to actual ZenFS APIs.

**CatalystEngine / QuickJS** (530 lines)  
Real `quickjs-emscripten` integration. Creates WASM runtime + context. Host bindings inject console, require(), filesystem functions into QuickJS using proper handle lifecycle management (dispose after use). The require() system is clever — pure JS function inside QuickJS calls a host bridge for source strings, avoiding handle lifetime issues. `evalAsync` uses a polling loop for pending jobs — correct pattern for async in QuickJS.

**NodeCompatLoader** (169 lines)  
Real IModuleLoader. Registers host bindings (path, events, buffer, process, assert, util, url, timers) + unenv-style polyfills + stub modules. Lazy initialization. File-based module resolution with extension guessing and package.json main field.

**FetchProxy** (155 lines)  
Clean. Domain allowlist/blocklist, timeout via AbortController, response size limits, proper error classes.

**ProcessManager** (300 lines)  
Real. Worker-based isolation with inline fallback. WorkerPool with configurable limits. Signal handling (SIGTERM via MessagePort, SIGKILL via Worker.terminate()). Process tree tracking. WASI binary execution integration.

**CatalystKV** (341 lines)  
Real IndexedDB-backed KV. Matches Cloudflare KV API shape. TTL with lazy expiration on get. Metadata support. List with prefix/cursor pagination.

**CatalystR2** (349 lines)  
Real IndexedDB-backed object storage. Matches Cloudflare R2 API. ETag generation, HTTP metadata, custom metadata, list with prefix/delimiter.

**CatalystD1** (wa-sqlite)  
Real. Lazy-loads wa-sqlite async build + IDBBatchAtomicVFS. Prepared statements with parameter binding. Batch operations in transactions. API matches Cloudflare D1 binding shape.

**CatalystWorkers Runtime** (298 lines)  
Real. Route matching (exact/prefix/wildcard). Module loading (pre-loaded or dynamic import). Binding construction from config (KV/R2/D1/var/secret). ExecutionContext with waitUntil + passThroughOnException. Proper cleanup on destroy.

**IEngine + IModuleLoader Interfaces** (133 lines)  
Clean separation. Engine owns execution, loader owns resolution. Factory types enable compile-time engine selection.

**CatalystTerminal** (xterm.js wrapper)  
Real architecture. Lazy-loads xterm.js + WebGL addon + fit addon + web-links addon in browser. Headless mode for Node tests. Input/output buffering. Resize support.

**CatalystShell** (541 lines)  
Real interactive shell. Character-by-character input handling with escape sequence processing. 10 builtins (cd, export, pwd, echo, exit, clear, env, which, alias, history). Tab completion for filenames and builtins. Environment variable expansion. Background job syntax (`&`). Aliases. History with up/down navigation.

**Sync Layer** (2,675 lines total)  
Real WebSocket sync client/server. OperationJournal with compaction. ConflictResolver with configurable strategies. Protocol versioning.

**Build Pipeline**  
Real pluggable transpiler system. PassthroughTranspiler for testing, EsbuildTranspiler uses actual `esbuild.transform()`. Content-hash caching. Import resolution and bundling.

**Hono Integration**  
Pre-bundled Hono v4 core (minified string) loaded at runtime. Hono route matching and middleware work inside the Catalyst environment.

**Workers Compliance Tests** (6 files)  
Real tests that validate: Runtime APIs (Request/Response/Headers/URL/TextEncoder/crypto), ExecutionContext (waitUntil/passThroughOnException), KV/R2/D1 bindings through CatalystWorkers, error isolation.

---

### ⚠️ SCAFFOLD — Structure Correct, Implementation Incomplete

**ViteRunner** (359 lines)  
State machine only. `start()` validates project structure and sets status to 'running' — does NOT actually start Vite. No transform pipeline, no module bundling, no dev server. `handleFileChange()` creates HMR update objects and emits events but doesn't transform code. Module resolution is file-path based, not Vite's resolver. Tests verify the state machine works correctly, not that Vite runs.

**FrameworkDevMode** (compatible layer)  
Framework detection is real (checks for nuxt.config.ts, astro.config.mjs, svelte.config.js, etc. in CatalystFS). But it delegates to ViteRunner, so the actual dev server doesn't start.

**unenv-bridge** (1,103 lines)  
Despite the name and `unenv` being listed as a dependency, this file never imports from unenv. It's 1,103 lines of hand-rolled polyfills as source strings that get eval'd inside QuickJS — pure JS implementations of SHA-256, SHA-1, MD5, HMAC, os module, stream classes, http stubs, querystring, string_decoder, zlib stubs. The polyfills themselves appear to be correct implementations, but they're not "unenv" — they're custom.

**Test Fixtures**  
The Nuxt/Astro/SvelteKit/Nitro fixtures are hand-crafted simulations, not real build outputs. They correctly use the Workers module format (`export default { fetch(req, env, ctx) {} }`) and exercise the bindings, but they don't validate that actual framework builds work through the Nitro preset.

---

### 🔴 HOLLOW — Wired Correctly, Nothing Behind It

**DenoEngine** (137 lines)  
Implements IEngine correctly. Wires to OpsBridge and WasmLoader. But when WASM is unavailable (always, since the binary doesn't exist), falls back to `(0, eval)(code)` — the browser's native eval. Every "Deno engine" test is actually testing the host browser's JS engine.

**DenoWasmLoader** (170 lines)  
Tries to fetch a WASM binary from a configurable URL. No URL configured → no binary fetched → status: `'unavailable'`. The `createInstance()` method has placeholder WASM imports (`__catalyst_ops_dispatch: () => {}`). The binary it expects (V8 jitless + Deno runtime compiled to WASM) doesn't exist anywhere.

**DenoNativeLoader** (84 lines)  
Claims `nodeCompat: 1.0` and lists 50+ builtins. But `getBuiltinSource()` returns `module.exports = globalThis.__deno_node_require("node:${name}")` — a global that doesn't exist because Deno isn't running. All builtins would throw at runtime.

**Reaction Distribution** (29 lines)  
Correctly wires DenoEngine + DenoNativeLoader via `Catalyst.create()`. Architecture is right. But since both the engine and loader are hollow, `@aspect/reaction` currently equals `@aspect/catalyst` with extra steps (both use browser eval).

**Dual-Engine Parity Tests**  
`evalBoth()` runs the same code through QuickJS and "Deno" engine. Both produce identical results because Deno's stub uses the same host JS engine that QuickJS results get compared against. The tests prove the interface works, not that two different engines produce equivalent results.

**OpsBridge** (232 lines)  
The ops bridge itself is real code — it maps op names to browser API handlers (op_read_file → CatalystFS, op_crypto_random → Web Crypto, op_timer → setTimeout, etc.). It's correctly implemented. But it's never called by the actual Deno engine because the engine is in stub mode. Tests verify the bridge in isolation, which is valid.

---

## Dependency Issues

| Import | Package | In `package.json`? | Status |
|--------|---------|-------------------|--------|
| `quickjs-emscripten` | core | ✅ Yes | Works |
| `@zenfs/core` | core | ✅ Yes | Works |
| `@zenfs/dom` | core | ✅ Yes | Works |
| `hono` | core | ✅ Yes | Works (pre-bundled) |
| `wa-sqlite` | d1 | ✅ Yes | Works |
| `unenv` | core | ✅ Listed | ❌ **Never imported** — dead dependency |
| `esbuild-wasm` | core | ❌ **Missing** | Lazy `import()` would fail |
| `xterm` | core | ❌ **Missing** | Lazy `import()` would fail |
| `@xterm/addon-fit` | core | ❌ **Missing** | Lazy `import()` would fail |
| `@xterm/addon-webgl` | core | ❌ **Missing** | Optional, fails gracefully |
| `@xterm/addon-web-links` | core | ❌ **Missing** | Optional, fails gracefully |

---

## Structural Concerns

**1. The 34-commits-in-one-session pattern**  
CC produced 34,160 lines across 165 files in a single session. The code quality is surprisingly consistent but the breadth means no layer got deep testing. Each phase was committed without running against the previous phase's tests. The risk is integration failures between layers.

**2. No CI pipeline**  
No GitHub Actions, no automated test runs. The only verification is CC's self-reported test counts in commit messages.

**3. Cross-package imports use relative paths**  
The Reaction distribution imports like `from '../../../../engines/deno/src/engine.js'`. This works in source but won't resolve after build unless tsup/rollup is configured to handle workspace references. The Catalyst distribution uses `from '@aspect/catalyst-core'` (correct).

**4. Missing build verification**  
There's no evidence that `pnpm build` was ever run across the monorepo. The packages have `tsup` configured but the output `dist/` directories aren't in the repo.

---

## Recommended Review Process

### What you can verify now (no browser needed)

1. **TypeScript compilation** — Run `pnpm install && pnpm build` across the monorepo. This will surface import resolution failures, type errors, and missing dependencies immediately.

2. **Node tests** — Run `pnpm test` (non-browser tests). These test pure logic: process management, sync protocol, shell parsing, build pipeline, module resolution, conflict resolver, lockfile operations.

3. **Fix missing dependencies** — Add `esbuild-wasm`, `xterm`, `@xterm/addon-fit` to core's package.json. Remove `unenv` or actually import from it.

4. **Fix Reaction relative imports** — Replace `../../../../shared/core/src/...` with `@aspect/catalyst-core` workspace references.

### What requires a browser

5. **Browser tests** — `pnpm test:browser` via vitest-browser. This tests OPFS, IndexedDB, Service Workers, QuickJS WASM, wa-sqlite, MessageChannel, Workers runtime. This is where the real validation happens.

6. **Integration smoke test** — Create a minimal app that does: create CatalystWorkers → load a Worker module → KV.put/get → D1 CREATE TABLE/INSERT/SELECT → verify responses. If this works end-to-end in a real browser, the core is solid.

### What you should defer

7. **ViteRunner** — It's scaffold. Don't try to make it work until Reaction has a real engine. The current approach of BuildPipeline (esbuild-wasm) for transpilation + Service Worker for preview is the correct path for Workers mode.

8. **Deno/Reaction** — The architecture is correct. Don't touch it. The blocker is compiling V8 jitless + Deno runtime to WASM, which is a multi-week research project separate from this codebase.

### Priority order for CC's next session

```
1. pnpm install && pnpm build  (fix what breaks)
2. Fix dependency declarations
3. Fix Reaction relative imports  
4. pnpm test                    (Node tests)
5. pnpm test:browser            (browser tests)
6. Report results
```
