# Catalyst Codebase: Build-vs-Buy & Oversimplification Audit

**Date:** 2026-03-03  
**Scope:** `C:\Users\v1sua\Downloads\catalystlatest` — the existing Catalyst codebase  
**Method:** Same lens as the hyperkernel-spec and make-it-real doc audits: where did we hand-roll something a library handles better, and where did we oversimplify to the point of production breakage?

---

## CRITICAL — Hand-Rolled Where a Library Should Be Used

### 1. Semver: Hand-Rolled TWICE

**Files:**
- `packages/shared/core/src/pkg/Semver.ts` (160 lines)
- `packages/shared/core/src/pkg/NpmRegistryClient.ts` lines 220-260 (inline `satisfiesRange` + `compareVersions`)

**What's there:** Two separate, incomplete semver implementations. `Semver.ts` handles `^`, `~`, `>=`, `>`, `<=`, `<`, `x`-ranges, `*`, and exact versions. `NpmRegistryClient.ts` has its own `satisfiesRange()` that handles `^`, `~`, `>=`, `*`, and exact — a subset of the already-subset in `Semver.ts`. Neither talks to the other.

**What's missing from both:**
- Hyphen ranges (`1.0.0 - 2.0.0`)
- OR ranges (`>=1.0.0 <2.0.0 || >=3.0.0`)
- AND ranges (`>=1.0.0 <2.0.0`)
- Build metadata (`1.0.0+build.123`)
- Prerelease ordering beyond string comparison (spec requires numeric segment comparison)
- `^0.0.x` semantics (caret on `0.0.x` should pin to exact patch — `Semver.ts` gets this right but `NpmRegistryClient` doesn't handle `0.x` at all)

**Why it matters:** npm packages in the wild use OR ranges constantly (`>=1.2.0 <2.0.0`). The `NpmResolver` calls `Semver.maxSatisfying()` for dependency resolution — if that function can't parse `>=1.2.0 <2.0.0`, transitive dependency resolution silently picks wrong versions or fails entirely.

**Fix:** Replace both with `semver` (npm's own package, ~70KB, zero deps). Delete `Semver.ts`. Remove inline `satisfiesRange`/`compareVersions` from `NpmRegistryClient.ts`. Import `semver.maxSatisfying()` in `NpmResolver.ts`.

---

### 2. WASI Bindings: 550 Lines of Hand-Rolled wasi_snapshot_preview1

**Files:**
- `packages/shared/core/src/wasi/WASIBindings.ts` (550 lines)
- `packages/shared/core/src/wasi/CatalystWASI.ts` (wrapper)

**What's there:** A complete hand-rolled implementation of `wasi_snapshot_preview1` — fd management, path resolution, iovec read/write, preopens, filestat, readdir, clock, random, proc_exit. All backed by CatalystFS sync operations.

**What's missing:**
- `poll_oneoff` (returns ENOSYS — blocks any WASI program that does async I/O or sleep)
- `fd_pread`/`fd_pwrite` (returns ENOSYS — blocks programs using positioned reads)
- Symlink operations (`path_readlink`, `path_symlink` — ENOSYS)
- Socket operations (all ENOSYS, expected)
- `fd_write` to files: reads entire file, splices, writes entire file back. O(n²) for append-heavy workloads.
- `fd_readdir` cookie parameter ignored — `_cookie` is never used, so repeated readdir calls re-read from the start instead of continuing from where they left off
- No rights checking — `rights` field is stored but never validated against operations

**What exists:** `@bjorn3/browser_wasi_shim` (MIT/Apache-2.0, maintained, 2.5KB gzip). It provides:
- Complete `wasi_snapshot_preview1` with proper fd table
- `Fd` base class you subclass for custom filesystems (this is exactly what CatalystFd in the unified spec does)
- Correct iovec handling, rights enforcement, cookie-based readdir
- Well-tested against real WASI binaries

**The package.json situation:** `@bjorn3/browser_wasi_shim` is NOT in `package.json`. The unified spec says to use it. The codebase hand-rolls instead.

**Fix:** Add `@bjorn3/browser_wasi_shim` to dependencies. Replace `WASIBindings.ts` with a `CatalystFd extends Fd` class that routes filesystem calls through CatalystFS. Delete `WASIBindings.ts` entirely — it's 550 lines of reimplemented spec.

---

### 3. Tar Parser: Hand-Rolled in PackageFetcher

**File:** `packages/shared/core/src/pkg/PackageFetcher.ts` lines 95-140 (`extractMainFromTarball`)

**What's there:** A ~45-line tar parser inside `PackageFetcher.extractMainFromTarball()`. Reads 512-byte headers, extracts filename from bytes 0-100, file size from bytes 124-136 (octal), strips `package/` prefix.

**What's missing:**
- GNU long name extension (typeflag `L`) — filenames >100 chars are stored in a preceding header block. This parser reads them as regular file entries, corrupting extraction.
- Pax extended headers (typeflag `x`) — modern npm tarballs increasingly use these for long filenames and metadata.
- Filename prefix field (bytes 345-500 in ustar format) — the parser only reads bytes 0-100, missing the prefix that ustar uses for paths >100 chars.
- Only reads the `main` entry — no dependency extraction, no `package.json` subpath exports.

**What exists:** `untar-sync` handles ustar, GNU long names, pax headers, filename prefixes. It's a build-time dependency (bundled by Vite), not a runtime circular dependency.

**Fix:** `npm install untar-sync`. Replace the inline tar parser with `untar(decompressedBuffer)`. The DecompressionStream usage for gzip is correct — keep that.

---

### 4. MIME Type Map: Duplicated Twice, Missing Standard Approach

**Files:**
- `packages/shared/core/src/net/mime.ts` (80 lines)
- `packages/shared/core/src/net/PreviewSW.ts` lines 90-115 (`getMimeMapForSW()`)

**What's there:** Two separate hand-maintained MIME maps. One in `mime.ts`, another in `PreviewSW.ts`. They're mostly identical but will drift — `mime.ts` has `.avif`, `.eot`, `.mp3`, `.wav`, `.ogg`, `.tar`, `.gz`, `.webmanifest` that `getMimeMapForSW()` doesn't.

**This is minor compared to the others** — a hand-rolled MIME map is defensible for bundle size. But there are two of them, they're already drifting, and this is a solved problem.

**Fix:** Either use the `mime` package (tiny, well-maintained) or at minimum, make `PreviewSW.ts` import from `mime.ts` instead of maintaining its own copy. One source of truth.

---

### 5. WorkerBridge / PreviewSW: Hand-Rolled MessagePort Correlation

**Files:**
- `packages/shared/core/src/proc/WorkerBridge.ts` — `handleFsRequest()` uses `request.id` for correlation
- `packages/shared/core/src/net/PreviewSW.ts` — creates a fresh `MessageChannel()` per FS operation for correlation

**What's there:** Two different patterns for the same problem:
- `WorkerBridge` receives requests with `id` fields, dispatches to CatalystFS, responds with `{ id, result }` or `{ id, error }`. The Worker side (not shown) maintains a `pendingRequests` map.
- `PreviewSW` creates a new `MessageChannel()` per request — each `readFile`/`fileExists` call allocates a channel, sends via one port, listens on the other.

Neither is terrible, but both implement request-response-over-MessagePort which is exactly what Comlink does in 1.1KB. The PreviewSW approach is cleaner (no ID maps) but creates a new MessageChannel per call, which has allocation overhead.

**Fix:** Add `comlink` to dependencies. `WorkerBridge` becomes `Comlink.expose(fsApi)` on the main thread side and `Comlink.wrap(fsPort)` on the Worker side. PreviewSW can use the same pattern for its fs proxy.

---

## CONCERNING — Oversimplified Implementations

### 6. NpmRegistryClient.install() Doesn't Actually Install

**File:** `packages/shared/core/src/pkg/NpmRegistryClient.ts` lines 129-160

**What's there:** `install()` resolves a version, fetches metadata, writes `package.json`... then writes `module.exports = {};` as `index.js`. No tarball download. No file extraction. The installed "package" is an empty object.

```typescript
// Write a placeholder index.js if tarball not available in test env
if (!fs.existsSync(`${targetDir}/index.js`)) {
  fs.writeFileSync(`${targetDir}/index.js`, `module.exports = {};`);
}
```

The `installWithDependencies` method calls `install` recursively for deps, each writing `module.exports = {};`. This is a test stub pretending to be an implementation.

**Meanwhile:** `PackageFetcher.ts` has actual tarball download and extraction (via esm.sh and registry fallback). `PackageManager.ts` orchestrates resolution → fetch → cache correctly. So the real install path works through `PackageManager`, not `NpmRegistryClient.install()`.

**The problem:** `NpmRegistryClient.install()` and `NpmRegistryClient.installWithDependencies()` are public API that looks like a real implementation. Someone (or an AI agent) will call it expecting packages to actually be installed.

**Fix:** Either wire `NpmRegistryClient.install()` to actually fetch+extract tarballs (using `PackageFetcher`), or remove the install methods from `NpmRegistryClient` and make it a pure metadata/resolution client. The current state is a trap.

---

### 7. "unenv-bridge" Doesn't Actually Use unenv

**File:** `packages/shared/core/src/engine/host-bindings/unenv-bridge.ts` (~800 lines)

**What's there:** The file is named `unenv-bridge.ts`, comments say "Backed by unenv concepts (MIT, UnJS/Nuxt team)", the `PROVIDER_REGISTRY` marks modules as provider `'unenv'`, and `package.json` lists `"unenv": "^1.10.0"` as a dependency.

But the code doesn't import anything from `unenv`. Not a single import statement. It's 800 lines of hand-rolled source strings:
- Hand-rolled SHA-256 (~100 lines of bit manipulation)
- Hand-rolled SHA-1 (~60 lines)
- Hand-rolled MD5 (~80 lines)
- Hand-rolled HMAC (~30 lines)
- Hand-rolled Buffer-like randomBytes with xorshift PRNG
- Hand-rolled Readable/Writable/Transform/Duplex/PassThrough streams
- Hand-rolled querystring parse/stringify
- Hand-rolled StringDecoder

The `unenv` package (which is actually installed!) provides drop-in Node.js polyfills for exactly these modules. It's maintained by the UnJS/Nuxt team, battle-tested against real npm packages.

**Why it's hand-rolled anyway:** These are source code strings that get `eval()`'d inside QuickJS. QuickJS can't import from npm modules directly — it needs self-contained source strings. So you can't do `import { createHash } from 'unenv/node/crypto'` inside QuickJS.

**The nuance:** For the QuickJS sandbox path, hand-rolled source strings are justified — QuickJS genuinely needs self-contained JS strings. BUT: the NativeEngine path (V8 Web Workers, where Catalyst will run validated code at full speed) could use unenv's actual module outputs directly since they run in a real JS context. The codebase doesn't make this distinction — both engines get the same hand-rolled strings.

**Also:** The hand-rolled randomBytes uses xorshift PRNG seeded with `Date.now()`, which is cryptographically terrible. The code checks for `__hostRandomBytes` first (delegating to the host), but if that's not wired up, you get predictable "random" bytes. The comment says "FIPS 180-4" for SHA-256 which is likely correct, but a hand-rolled crypto implementation is exactly the kind of thing that passes tests but has subtle timing/correctness issues.

**Fix:** For QuickJS path — the hand-rolled strings are a necessary evil, but consider generating them from unenv's source at build time rather than maintaining parallel implementations. For NativeEngine path — actually import from unenv. The `unenv` dependency is already in `package.json` but unused.

---

### 8. Host Bindings: ~2,500 Lines of Node.js Reimplementation

**Files:**
- `host-bindings/path.ts` — 350 lines, hand-rolled `posix` path module
- `host-bindings/buffer.ts` — 600+ lines, hand-rolled Buffer with encoding support
- `host-bindings/events.ts` — 300 lines, hand-rolled EventEmitter
- `host-bindings/assert.ts`, `console.ts`, `process.ts`, `timers.ts`, `url.ts`, `util.ts` — various sizes

**Verdict: Mostly Justified — with caveats.**

These return source code strings for QuickJS's `eval()`. QuickJS can't import Node modules, so self-contained strings are the only option. The path module is a careful port of Node's own `normalizeStringPosix`. The Buffer implementation covers read/write for 8/16/32-bit ints in both endiannesses. The EventEmitter handles `once`, `prependListener`, `removeAllListeners`, `newListener` meta-events, async iterators.

**The concern:** These are all subtly different from Node's actual behavior. The Buffer doesn't extend Uint8Array (Node's does). The EventEmitter's `removeListener` behavior during emit differs from Node's. The path module is posix-only (fine for browser, but no win32 path).

These differences will cause packages that depend on exact Node semantics to break silently — tests pass because tests use simple cases, but real npm packages hit edge cases.

**For now:** Acceptable. Long-term, consider building these from Node's actual source or unenv's polyfills at build time.

---

### 9. resolve.exports: Missing Entirely

**The unified spec lists `resolve.exports`** in the dependency manifest for resolving `package.json` `exports` field. The codebase has no equivalent.

**File:** `packages/shared/core/src/pkg/PackageFetcher.ts` line 138:
```typescript
const mainFile = packageJson?.main || 'index.js';
const code = files.get(mainFile) || files.get('index.js') || files.get('dist/index.js');
```

This resolves packages using `main` field only. Modern npm packages use the `exports` field, which has conditional exports (`import` vs `require`), subpath exports (`"./utils"`), and pattern exports. Without `resolve.exports`, packages that use `exports` instead of `main` will fail to resolve.

**Fix:** `npm install resolve.exports`. Use it in `PackageFetcher` and `NpmModuleLoader` for proper entry point resolution.

---

## NOT AN ISSUE — Correctly Custom or Justified

| Component | Why it's fine |
|-----------|--------------|
| **CatalystFS** | Custom filesystem abstraction over ZenFS/@zenfs/dom. No off-the-shelf replacement for this specific API surface. |
| **CatalystDNS (DoH)** | DNS-over-HTTPS via fetch is genuinely custom — no npm package provides browser-native DoH with the CatalystDNS API shape. |
| **PreviewSW routing logic** | Service Worker fetch interception is inherently custom — it decides what to serve from CatalystFS vs passthrough. |
| **BuildPipeline** | Orchestration around esbuild-wasm is custom integration. |
| **ProcessManager / WorkerPool** | Process lifecycle management is application-specific. |
| **CatalystCluster** | Round-robin Worker distribution is custom application logic. |
| **QuickJS integration** | `quickjs-emscripten` is correctly used (in `package.json`, imported properly). |
| **DecompressionStream for gzip** | Browser-native API, correctly used in PackageFetcher. |
| **TieredEngine** | Custom orchestration between QuickJS (sandbox) and NativeEngine (V8). |
| **HonoIntegration** | Hono is correctly listed as a dependency and imported. |
| **ZenFS** | `@zenfs/core` and `@zenfs/dom` are correctly in dependencies. |

---

## Summary: Priority-Ordered Fix List

| # | Severity | Issue | Lines Affected | Library |
|---|----------|-------|---------------|---------|
| 1 | **CRITICAL** | Hand-rolled semver (×2) | 160 + 40 = 200 | `semver` |
| 2 | **CRITICAL** | Hand-rolled WASI bindings | 550 | `@bjorn3/browser_wasi_shim` |
| 3 | **CRITICAL** | Hand-rolled tar parser | 45 | `untar-sync` |
| 5 | **CRITICAL** | Hand-rolled MessagePort RPC (×2) | 80 + 40 = 120 | `comlink` |
| 9 | **CRITICAL** | Missing `exports` field resolution | 0 (absent) | `resolve.exports` |
| 6 | **HIGH** | NpmRegistryClient.install() is a stub | 30 | Remove or wire to PackageFetcher |
| 7 | **HIGH** | unenv dependency installed but unused | 800 | Actually import from `unenv` for NativeEngine |
| 4 | **MEDIUM** | Duplicated MIME maps | 80 × 2 | Consolidate to one source |
| 8 | **LOW** | Host binding source strings | ~2,500 | Justified for QuickJS, review for NativeEngine |

**Total hand-rolled code that should be library calls: ~1,000 lines**  
**Total oversimplified code that needs fixing: ~830 lines**

### Dependencies to Add to package.json

```json
{
  "semver": "^7.6.0",
  "@bjorn3/browser_wasi_shim": "^0.4.0",
  "untar-sync": "^1.0.0",
  "comlink": "^4.4.1",
  "resolve.exports": "^2.0.0"
}
```

Note: `unenv` is already in `package.json` but unused. Wire it in for NativeEngine.
