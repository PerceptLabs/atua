# Catalyst Implementation Roadmap

**Purpose**: This is the entry document for CC. Read this first. It tells you the implementation order, which spec docs to read per phase, which source files to touch, and resolves any ambiguities between docs.

**Architecture**: V8 + unenv + browser APIs as core runtime, targeting Cloudflare Workers and Deno deployment. Rolldown-WASM primary bundler (via WASI host module, Phase 6), esbuild-wasm fallback. Three-tier package resolution: JSR direct → npm registry direct → esm.sh fallback. Execution: Worker sandbox with Worker.terminate() (replaces former QuickJS Tier 0 — see `atua-runtime-execution-spec.md`), AtuaBox (v86 + Alpine) for native binaries. OPFS primary filesystem, IndexedDB fallback. WASI host (`@aspect/atua-wasi`) provides sync I/O for WASM tool binaries only.

---

## Document Set

Read these docs when referenced by a phase below. Do not read them all upfront — they're large. Each phase tells you exactly which sections to read.

| Doc | Path | Lines | What It Covers |
|-----|------|-------|----------------|
| **ARCH** | `atua-unified-spec.md` | 1,670 | Kernel, WASI, Rolldown, process model, syscalls, OPFS — canonical architecture |
| **ENGINE** | `catalyst-tiered-engine-spec.md` | ~720 | Engine tiers, Native Worker bootstrap, fallback cascades, implementation phases A-F |
| **PKG** | `catalyst-deno-alignment.md` | ~600 | npm+JSR resolution, CORS proxy, bundler plugin architecture, lockfile, migration |
| **WIRE** | `atua-wiring-spec.md` | 3,235 | Per-file, per-function wiring for all subsystems |
| **ADDENDUM** | `catalyst-tiered-engine-addendum.md` | 906 | Deno API mapping, addon alternatives, IWA networking, npm registry client detail |
| **DENO-PKG** | `deno-ecosystem-audit.md` | 252 | Package-by-package assessment of @std/* libraries to adopt |

---

## System-Wide Principle: Graceful Fallback Cascades

Every Catalyst subsystem follows the same pattern:

```
Primary   → Best capability, may require platform features (SAB, COOP/COEP, etc.)
Fallback  → Universal, works everywhere, reduced capability
Fast path → Optional optimized path for the common case
```

Detection happens **once at boot** via a `capabilities` object. No per-operation feature checking.

### The Full Cascade Map

| Subsystem | Primary | Fallback | Fast Path |
|-----------|---------|----------|-----------|
| **Bundler** | Rolldown-WASM (SAB, Vite plugin compat) | esbuild-wasm (universal) | SWC-wasm (single-file hot reload) |
| **Engine** | Native V8 via WorkerContext (browser's own JIT) | InlineContext (same-thread, future ShadowRealm) | Worker.terminate() timeout |
| **Package Resolution** | JSR direct + npm registry direct | esm.sh CDN | Lockfile cache hit |
| **Filesystem** | OPFS (3-4x faster) | IndexedDB | In-memory (emergency) |
| **Sync Transport** | SAB + Atomics.wait/notify | JSPI | MessageChannel async |
| **CSS Compilation** | oxide-wasm (Tailwind v4 JIT) | Tailwind CDN play script | Raw CSS variables |
| **Minification** | Oxc (Rolldown built-in) | Oxc standalone WASM | terser (JS) |
| **File Watching** | FileSystemObserver (Chrome 129+) | Polling | — |

Full details in ENGINE doc §System-Wide Fallback Cascades.

---

## Phase 0: Swap Primitives

**Risk**: Low — drop-in replacements for hand-rolled code.

**Read**: DENO-PKG (full doc, 252 lines — it's a quick reference)

**Source files to touch** (in `packages/shared/core/src/pkg/`):
- `NpmResolver.ts` — swap `Semver.ts` import to `@std/semver`
- `Semver.ts` — **delete** (replaced by `@std/semver`)
- `PackageFetcher.ts` — swap tar parser to `@std/tar` or `untar-sync`
- `NpmRegistryClient.ts` — **delete** (duplicate of NpmResolver)
- MIME maps (find both locations) — consolidate to `@std/media-types`

**New dependencies to add**:
- `@std/semver` (JSR, MIT, browser-compatible)
- `@std/media-types` (JSR, MIT, browser-compatible)
- `@std/tar` or `untar-sync` (test browser compat of @std/tar first)
- `resolve.exports` (npm, MIT, tiny)

**Success criteria**:
- All existing tests pass with new library imports
- NpmResolver.resolveDependencyTree() works with @std/semver
- Package tarball extraction works with new tar library
- resolve.exports correctly reads package.json exports fields

---

## Phase 1: Capabilities Detection + Bundler Tier

**Risk**: Medium — new bundler integration, but esbuild stays as fallback.

**Read**: 
- ARCH §3 (Rolldown — Primary Bundler), §6 (WASI Layer)
- ENGINE §Bundler Tier Cascade
- PKG §Bundler Plugin Architecture, §Plugin Selection at Build Time

**Source files to touch**:
- `packages/core/src/build/` — new directory for bundler tier logic
- `packages/core/src/capabilities.ts` — **new**: boot-time feature detection (SAB, JSPI, COOP/COEP)
- `packages/core/src/build/BundlerTier.ts` — **new**: Rolldown/esbuild/SWC selection
- `packages/core/src/build/RolldownPlugin.ts` — **new**: Rolldown resolver plugin (Rollup API)
- `packages/core/src/build/EsbuildPlugin.ts` — **new**: esbuild resolver plugin (existing logic, new shape)
- `packages/core/src/build/SharedResolver.ts` — **new**: shared resolution functions (bundler-agnostic)

**Architecture**:
```
Boot → detect capabilities → store in global capabilities object
Build → check capabilities.hasSAB
  YES → load Rolldown-WASM via @rolldown/binding-wasm32-wasi + browser_wasi_shim
  NO  → load esbuild-wasm (already in pipeline)
Both use SharedResolver for JSR/npm/https/import-map resolution
```

**Key decisions**:
- Rolldown-WASM loads as WASI guest process through the kernel (see ARCH §6)
- The Tokio deadlock is solved by kernel's separate-thread syscall dispatch (ARCH §Tokio Deadlock)
- Rolldown's shipped `rolldown-binding.wasi-browser.js` handles Worker pool and SAB setup — don't rebuild it

**Success criteria**:
- capabilities.ts correctly detects SAB/JSPI/COOP+COEP at boot
- Rolldown-WASM loads and bundles a multi-file TypeScript project (SAB mode)
- esbuild-wasm still works as before (fallback mode)
- Same resolver plugin logic handles both bundlers via SharedResolver

---

## Phase 2: Package Resolution Tiers

**Risk**: Medium — new resolution paths, but esm.sh stays as fallback.

**Read**:
- PKG (full doc — this is the primary reference for this phase)
- DENO-PKG §Layer 1 (@std packages), §Layer 2 (Deno resolution)

**Source files to touch** (in `packages/shared/core/src/pkg/`):
- `JsrResolver.ts` — **new**: ~100 lines, fetch meta.json from jsr.io, resolve version, download TS source
- `ImportMapResolver.ts` — **new**: parse deno.json imports, rewrite bare specifiers
- `NpmResolver.ts` — wire to CORS proxy URL config, add OPFS extraction
- `PackageFetcher.ts` — add CORS proxy support for tarball downloads
- `LockfileManager.ts` — **new**: generate and read `deno.lock` compatible lockfiles

**New infrastructure**:
- CORS proxy Cloudflare Worker — deploy to `npm-proxy.catalyst.dev` (~20 lines, see PKG §CORS Problem)

**Resolution cascade** (implemented in `SharedResolver.ts` from Phase 1):
```
jsr:@std/semver@1   → JsrResolver (direct JSR fetch, CORS-friendly)
npm:react@18        → NpmResolver (registry via CORS proxy → tarball → OPFS extract)
  ↳ CORS proxy down → esm.sh CDN fallback
react (bare)        → ImportMapResolver (deno.json imports → rewrites to jsr:/npm:)
https://deno.land/… → Direct fetch + OPFS cache
```

**Success criteria**:
- `jsr:@std/semver@1` resolves, downloads, and bundles correctly
- `npm:react@18` resolves through CORS proxy, extracts tarball to OPFS, bundles
- Import maps rewrite bare specifiers correctly
- Lockfile generated on first build, deterministic rebuild from lockfile
- esm.sh fallback activates when CORS proxy is unreachable

---

## Phase 3: Native Engine Implementation

**Risk**: High — new execution model, core architectural change.

**Read**:
- ENGINE §The Tiered Engine Architecture (all three tiers)
- ENGINE §The Native Engine Worker Bootstrap (full bootstrap sequence)
- ENGINE §Phase A: Native Engine Implementation
- ENGINE §Phase B: Tier 0 Validation Layer
- ENGINE §Resolving the Stubs (http.createServer, child_process, vm, worker_threads)

**Source files to touch**:
- `packages/core/src/engines/NativeEngine.ts` — **new**: implements IEngine using Web Workers
- `packages/core/src/engines/WorkerBootstrap.ts` — **new**: bootstrap script inside each Worker
- `packages/core/src/engines/GlobalScope.ts` — **new**: scope shadowing + Node.js global setup
- `packages/core/src/engines/NativeModuleLoader.ts` — **new**: require() for native context
- `packages/core/src/validation/StaticAnalysis.ts` — **new**: syntax check via `new Function()` + optional OXC AST scan (replaces former QuickJS Tier 0 — see `atua-runtime-execution-spec.md`)
- `packages/core/src/execution/ContextRouter.ts` — **new**: routes to WorkerContext, AtuaBoxContext, or InlineContext based on trust level
- `packages/core/src/CatalystProc.ts` — **modify**: use WorkerContext instead of TieredEngine

**Architecture**:
```
User code → Static analysis (<1ms syntax check, advisory warnings)
  VALID → ContextRouter picks execution tier:
    → WorkerContext (default: V8 Worker + Worker.terminate() timeout)
    → AtuaBoxContext (native binaries, untrusted npm postinstall)
    → InlineContext (trivial expressions, zero overhead)
  INVALID → Syntax error returned immediately

Worker Bootstrap:
  1. Import unenv polyfills
  2. Import CatalystFS bridge (MessagePort → OPFS)
  3. Import CatalystNet bridge (MessagePort → fetch proxy)
  4. Build require() with three-tier package resolution
  5. Set up Node.js globals (process, Buffer, __dirname, etc.)
  6. Shadow browser globals (indexedDB, caches, etc.)
  7. Execute user code via new Function()
```

**IEngine interface** (both engines implement this — see ENGINE §The IEngine Interface):
```typescript
interface IEngine {
  create(config: EngineConfig): Promise<void>;
  eval(code: string): Promise<unknown>;
  evalFile(path: string): Promise<unknown>;
  destroy(): void;
  on(event: 'console' | 'exit' | 'error' | 'timeout' | 'oom', handler: Function): void;
}
```

**Success criteria**:
- engine.eval('1 + 1') returns 2 on native V8
- require('crypto').createHash('sha256').update('hello').digest('hex') returns correct hash
- Tier 0 blocks eval() abuse, prototype pollution, browser global access
- Clean code passes Tier 0 in under 50ms
- CatalystProc spawns Workers with either engine via factory pattern

---

## Phase 4: HTTP Server + Process Pipelines

**Risk**: Medium — extends existing infrastructure.

**Read**:
- ENGINE §Phase C: HTTP Server via MessagePort
- ENGINE §Phase D: Process Pipelines
- ENGINE §http.createServer() — Now Possible
- ENGINE §child_process.spawn() — Full Pipeline

**Source files to touch**:
- `packages/core/src/net/HttpServer.ts` — **new**: virtual HTTP server via MessagePort
- `packages/core/src/net/PortRouter.ts` — **new**: maps port numbers to Worker MessagePorts
- `packages/core/src/net/RequestAdapter.ts` — **new**: Web Request/Response ↔ Node IncomingMessage/ServerResponse
- `packages/core/src/proc/StdioPipe.ts` — **new**: MessagePort-based stdio streams
- `packages/core/src/proc/ProcessGroup.ts` — **new**: parent-child relationships, signal propagation
- `packages/core/src/CatalystNet.ts` — **modify**: add server-side routing
- `packages/core/src/CatalystProc.ts` — **modify**: add stdio routing, pipe support

**Architecture**:
```
http.createServer(handler):
  User code → unenv http polyfill → registers handler with Worker message system
  Request arrives via MessagePort (from Preview SW or another Worker)
  → Wrapped as Node IncomingMessage → handler processes → ServerResponse → MessagePort back

spawn('node', ['script.js']):
  → New Web Worker with bootstrap + script
  → stdin/stdout/stderr via MessagePort
  → Parent can pipe: child.stdout.pipe(process.stdout)
```

**Success criteria**:
- Express middleware chains execute correctly
- Hono apps serve via MessagePort routing
- Preview iframe loads content from virtual server
- spawn() with child.stdout.on('data') works
- Pipe chains work: a.stdout.pipe(b.stdin)
- Exit codes and SIGTERM propagate

---

## Phase 5: Workers Compliance + Deno Compat

**Risk**: Medium — validation layer, not new execution.

**Read**:
- ENGINE §Phase E: Workers Compliance Gate
- ADDENDUM §Deno API Mapping (full section)
- ADDENDUM §Addon Alternatives (section on native package replacements)

**Source files to touch**:
- `packages/core/src/compliance/WorkersGate.ts` — **new**: Tier 2 validation
- `packages/core/src/compliance/WorkersFixtures.ts` — **new**: test fixtures for Workers API
- `packages/core/src/compat/DenoAPIs.ts` — **new**: Deno.* namespace mapping to Catalyst equivalents
- `packages/core/src/compat/DenoURLImports.ts` — **new**: URL import resolution with TS compilation

**Success criteria**:
- Code passing Workers gate deploys successfully to Cloudflare
- Actionable error messages: "This code uses fs.readFileSync which is not available in Cloudflare Workers"
- Deno.readTextFile() maps to CatalystFS
- Deno.serve() maps to CatalystNet HTTP server
- https:// URL imports resolve and compile TS

---

## Phase 6: WASI + Guest Processes

**Risk**: High — kernel integration, WASI hosting.

**Read**:
- ARCH §5 (WASI Layer — full section)
- ARCH §6 (Build Pipeline — Rolldown as guest process)
- ARCH §Beyond Rolldown (wa-sqlite, Pyodide, other WASI guests)
- WIRE §Phase 4 (WASI Shim + Rolldown Integration wiring)

**Source files to touch**:
- `packages/core/src/wasi/` — WASI P1 integration with `@bjorn3/browser_wasi_shim`
- `packages/core/src/wasi/CatalystFd.ts` — **new/modify**: file descriptor routing through kernel
- `packages/core/src/kernel/` — hyperkernel syscall dispatch integration

**Architecture** (from ARCH §Tokio Deadlock):
```
Rolldown-WASM (Process Worker):
  Tokio schedules task → std::fs::read → WASI fd_read → Atomics.wait() (blocks)

Kernel Worker (separate thread):
  Atomics.waitAsync() detects blocked process → reads OPFS → writes result → Atomics.notify()

Different threads = no deadlock. Same pattern WebContainers uses.
```

**What to use (not build):**
- `@rolldown/binding-wasm32-wasi` — Rolldown's official WASM+WASI build, ships browser loader
- `@bjorn3/browser_wasi_shim` — WASI P1 shim for browser (Rolldown itself uses this)

**Success criteria**:
- Rolldown-WASM loads as kernel guest process
- Rolldown bundles multi-file TypeScript project via WASI → kernel → OPFS
- Rolldown thread spawning works via kernel Worker pool
- wa-sqlite runs as WASI guest (second guest process after Rolldown)

---

## Phase Dependencies

```
Phase 0 ──→ Phase 1 ──→ Phase 2
                │              
                └──→ Phase 6 (WASI enables Rolldown, but esbuild fallback works without it)
                
Phase 0 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
```

- Phase 0 (swap primitives) blocks everything — do this first
- Phases 1-2 (bundler + packages) and Phases 3-5 (engine + server) can run in parallel
- Phase 6 (WASI) depends on Phase 1 (bundler tier) and can run after Phase 3 is stable
- Phase 6 is what makes Rolldown primary actually work — until then, esbuild fallback is the bundler

---

## Conflict Resolutions

These statements resolve any ambiguities between the spec docs:

1. **Bundler**: Rolldown-WASM is primary. esbuild-wasm is fallback. The ENGINE doc's §System-Wide Fallback Cascades is authoritative. Any doc that says "esbuild stays" or "esbuild-wasm transpiler" means the esbuild fallback path.

2. **Package resolution**: Three-tier (JSR → npm registry → esm.sh fallback). PKG doc is authoritative. Any doc that says "esm.sh resolution" or "via esm.sh" means the esm.sh fallback tier.

3. **Plugin API**: Resolution logic is shared, plugin wrappers are bundler-specific. PKG doc §Bundler Plugin Architecture is authoritative. Rolldown uses Rollup-compatible `resolveId`/`load`. esbuild uses `onResolve`/`onLoad`.

4. **Engine**: IEngine interface is in ENGINE doc §The IEngine Interface. Both QuickJSEngine and NativeEngine implement it. CatalystProc uses engineFactory — never hardcodes QuickJS.

5. **WASI shim**: Use `@bjorn3/browser_wasi_shim` (Rolldown itself uses it). Do not hand-roll. ARCH doc is authoritative on WASI integration.

6. **Lockfile**: `deno.lock` compatible format. PKG doc §Lockfile is authoritative.

7. **CORS proxy**: Cloudflare Worker proxy for npm registry + tarballs. PKG doc §CORS Problem is authoritative.
