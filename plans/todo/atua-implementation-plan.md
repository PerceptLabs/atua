# Atua — Implementation Plan

**Companion to:** `atua-unified-spec.md`
**Purpose:** Execution guide for CC. The spec defines *what* to build. This defines *how* — file order, exact blockers, pre-flight checks, and the boundary conditions that will stop a phase dead if missed.

---

## Pre-Flight Checklist

Run before CC writes a single line:

```bash
# Node toolchain (required for all phases)
pnpm --version     # must be present
node --version     # >= 20

# Rust toolchain (only required for WASI host — Phase 6+, skip for Phases 0-5)
# rustup target list --installed | grep wasm32-unknown-unknown
# cargo install wasm-pack
# wasm-opt --version

# Count Catalyst references — Phase 0 target
grep -r "Catalyst" src/ --include="*.ts" | wc -l

# Check existing test config
cat vitest.config.ts   # note whether browser mode is already set up
```

---

## Phase 0 — Rename

**Spec ref:** §15.1
**Depends on:** Nothing
**CC constraint:** Zero behavior change. If any test fails after rename, the rename broke something — do not proceed.

**Execution order:**
1. List every file containing `Catalyst`: `grep -r "Catalyst" src/ packages/ apps/ --include="*.ts" --include="*.tsx" --include="*.rs" -l`
2. Rename package directories: `packages/catalyst-*` → `packages/atua-*`
3. Update `package.json` `name` fields in every renamed package
4. Update all `import`/`from` paths referencing old package names throughout codebase
5. TypeScript identifier replacements (global search-replace, case-sensitive):
   - `CatalystFS` → `AtuaFS`
   - `CatalystProc` → `AtuaProc`
   - `CatalystD1` → `AtuaD1`
   - `CatalystPkg` → `AtuaPkg`
   - `CatalystBuild` → `AtuaBuild`
   - `@aspect/catalyst-` → `@aspect/atua-`
6. CSS classnames, string literals, JSDoc comments
7. `tsconfig.json` path aliases
8. `pnpm tsc --noEmit` — fix all broken imports before running tests
9. `pnpm test` — all existing tests pass

**Hard gate:** `grep -r "Catalyst" src/ packages/ apps/ --include="*.ts"` returns zero results. Do not proceed until clean.

---

## Phase 1 — Test Infrastructure

**Spec ref:** §15.2
**Depends on:** Phase 0
**CC constraint:** Every subsequent phase writes browser tests against this infrastructure. Flaky setup here poisons everything downstream.

**Execution order:**
1. `vite.config.ts` — COOP/COEP headers in dev server plugin:
   ```ts
   {
     name: 'coop-coep',
     configureServer(server) {
       server.middlewares.use((_, res, next) => {
         res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
         res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
         next()
       })
     }
   }
   ```
2. `vitest.config.ts` — add browser mode block:
   ```ts
   browser: { enabled: true, provider: 'playwright', name: 'chromium', headless: true }
   ```
3. `tests/helpers/browser.ts` — helpers: `waitFor(fn, timeoutMs)`, `withWorker(fn)`, `assertCrossOriginIsolated()`
4. `tests/sanity.browser.test.ts` — three tests:
   - `expect(self.crossOriginIsolated).toBe(true)`
   - `expect(typeof SharedArrayBuffer).toBe('function')`
   - `const root = await navigator.storage.getDirectory(); expect(root).toBeTruthy()`

**Hard gate:** All three sanity tests green. `crossOriginIsolated === true` is the critical one. If false, COOP/COEP headers are not applying — every SAB-dependent phase (3, 4, 9) will fail. Do not move forward.

---

## Phase 2 — Kernel Core

**Spec ref:** §4
**Depends on:** Nothing — pure Rust, fully independent
**CC constraint:** `cargo test` only. No browser. No Playwright. The Rust structs in §4 are the source of truth — use them verbatim, not paraphrased.

**Execution order:**
1. `crates/hyperkernel/Cargo.toml`:
   ```toml
   [lib]
   crate-type = ["cdylib"]
   [dependencies]
   slab = { version = "0.4", default-features = false }
   wasm-bindgen = "0.2"
   js-sys = "0.3"
   wee_alloc = "0.4"
   bitflags = "2"
   [profile.release]
   opt-level = "z"
   lto = true
   ```
2. `crates/hyperkernel/src/lib.rs` — `#![no_std]`, `extern crate alloc`, `#[global_allocator] static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;`, module declarations
3. `crates/hyperkernel/src/resource.rs` — `Resource` trait, `ResourceTable` (slab-backed)
4. `crates/hyperkernel/src/process.rs` — `ProcessState`, `Process`, `ProcessTable`
5. `crates/hyperkernel/src/signal.rs` — `SignalTable`
6. `crates/hyperkernel/src/syscall.rs` — `Syscall` enum (20 entries), `SyscallAction` enum
7. `crates/hyperkernel/src/kernel.rs` — `Kernel`, `pub fn syscall(&mut self, pid: u32, nr: u32, args: &[u32]) -> (SyscallAction, i32)`
8. `crates/hyperkernel/src/bindings.rs` — `#[wasm_bindgen]` exports
9. `crates/hyperkernel/tests/kernel_tests.rs` — write ALL unit tests before implementing (TDD):
   ```
   resource_table_add_returns_valid_rid
   resource_table_get_returns_resource
   resource_table_close_removes_resource
   resource_table_slab_reuses_closed_slots
   process_table_spawn_assigns_pid
   process_table_kill_sets_zombie_state
   syscall_close_removes_fd_from_process
   syscall_read_returns_opfs_action
   syscall_write_returns_opfs_write_action
   syscall_spawn_returns_spawn_worker_action
   syscall_unknown_nr_returns_enosys
   ```

**Build + size verification:**
```bash
cd crates/hyperkernel
cargo test
wasm-pack build --target web --release
wasm-opt -Oz pkg/hyperkernel_bg.wasm -o pkg/hyperkernel_bg.wasm
ls -lh pkg/hyperkernel_bg.wasm   # must be < 50KB
```

**Blockers:**
- Missing `#[global_allocator]` in `lib.rs` → linker error. Add before anything else.
- `no_std` + `slab` requires `default-features = false` in Cargo.toml — slab's std feature uses `Vec` from std.

**Hard gate:** `cargo test` passes AND `wasm-opt` output < 50KB. Both required before Phase 3.

---

## Phase 3 — Transport Layer

**Spec ref:** §5
**Depends on:** Phase 1 (browser tests), Phase 2 (WASM)

**Execution order:**
1. `kernel/constants.ts` — `SAB_REGION_SIZE = 256`, `MAX_PROCESSES = 64`, status codes `IDLE=0 PENDING=1 DONE=2 ERROR=3`
2. `kernel/sab-transport.ts` — SAB region layout (exact offsets from §5), `Atomics.waitAsync` monitor loop, write syscall args, read result
3. `kernel/mc-transport.ts` — `Comlink.expose(kernelSyscallInterface)` in Worker, `Comlink.wrap(port)` in host — use Comlink (MIT, Google Chrome Labs), do not hand-roll UUID correlation
4. `kernel/kernel-host.ts` — mode detection `self.crossOriginIsolated ? 'sab' : 'mc'`, loads hyperkernel.wasm, routes `SyscallAction` results to OPFS/SW/Worker handlers
5. `kernel/kernel-worker.ts` — Worker entry: instantiates Kernel WASM, starts transport listener, exports via Comlink
6. `tests/transport.browser.test.ts` — tests for SAB mode
7. `vitest.mc.config.ts` — separate config WITHOUT COOP/COEP headers for MC mode tests
8. `tests/transport-mc.browser.test.ts` — same test cases, MC mode

**SAB region layout (implement exactly — do not improvise):**
```
Offset  Size  Field
0       4     status i32 (0=IDLE 1=PENDING 2=DONE 3=ERROR)
4       4     syscall_nr i32
8       4     arg0 i32
12      4     arg1 i32
16      24    arg2–arg7 (6 × i32)
40      4     result i32
44      212   data buffer
```

**Tests (run both SAB and MC configs):**
```
SYS_OPEN (nr=1) → action === SyscallAction.OpfsRead
SYS_CLOSE (nr=4) → action === Complete, result === 0
SYS_READ (nr=2) → action === OpfsRead
SYS_WRITE (nr=3) → action === OpfsWrite
SYS_SPAWN (nr=6) → action === SpawnWorker
```

**Critical distinction:** Worker uses `Atomics.wait()` (blocking). Kernel host uses `Atomics.waitAsync()` (non-blocking Promise). Reversing these hangs the main thread. Double-check which side uses which before writing.

---

## Phase 4 — WASI + Rolldown

**Spec ref:** §6
**Depends on:** Phase 3

**Pre-check before writing code:** Visit `github.com/rolldown/rolldown/discussions/3391` and confirm `@rolldown/binding-wasm32-wasi` browser status. If browser WASM is blocked on the threading fix (issue #898), implement esbuild-wasm as the bundler for Phase 4 and note Rolldown as a future swap. The spec documents esbuild as the MC-mode fallback (§13) — it is acceptable for Phase 4 if Rolldown WASM is not yet stable.

**Execution order:**
1. `kernel/atuafs.ts` — `AtuaFS` OPFS wrapper. **All methods must run inside a Worker** — `createSyncAccessHandle()` does not exist on main thread. Structure: `class AtuaFS { private handles: Map<string, FileSystemSyncAccessHandle>; async open(path); readSync(fd, buf); writeSync(fd, buf, offset); closeSync(fd) }`
2. `kernel/catalyst-fd.ts` — `CatalystFd extends Fd` (import from `@bjorn3/browser_wasi_shim`): implements `fd_read`, `fd_write`, `fd_seek` routing to AtuaFS
3. `kernel/wasi-host.ts` — `WASI` instantiation from browser_wasi_shim, CatalystFd preloads, `get wasiImport()` for WASM
4. `engines/rolldown-worker.ts` (or `engines/esbuild-worker.ts`) — Worker: loads bundler WASM, wires WASI host, `Comlink.expose({ bundle })`
5. `engines/bundler-engine.ts` — main thread: `Comlink.wrap` the bundler Worker, exposes `bundle(config): Promise<Uint8Array>`
6. `tests/bundler.browser.test.ts`

**End-to-end test (real files, real bundle, real execution):**
```ts
const fs = new AtuaFS()
await fs.writeFile('/src/math.ts', 'export const add = (a: number, b: number) => a + b')
await fs.writeFile('/src/index.ts', "import { add } from './math'; export const result = add(2, 3)")

const bundle = await bundler.bundle({ input: '/src/index.ts', outfile: '/dist/bundle.js', fs })

const objectUrl = URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }))
const mod = await import(/* @vite-ignore */ objectUrl)
expect(mod.result).toBe(5)
```

---

## Phase 5 — Worker Execution

**Spec ref:** §7
**Depends on:** Phase 1

**Execution order:**
1. `engines/native/worker-bootstrap.ts` — Worker entry: `import { expose } from 'comlink'; expose({ eval: (code: string) => eval(code) })`
2. `engines/native/native-engine.ts` — spawns Worker, `Comlink.wrap`, exposes `eval(code): Promise<unknown>`
3. `engines/sandbox/quickjs-engine.ts` — loads `quickjs-emscripten`, sets interrupt handler: `vm.runtime.setInterruptHandler(() => Date.now() > deadline)`
4. `validation/sandbox-runner.ts` — `runInSandbox(code, { timeout, memoryLimit })` → uses QuickJS, returns `{ result?, error?, timeoutExceeded?: true }`
5. `tests/execution.browser.test.ts`

**Tests (no mocks — real Workers, real QuickJS):**
```
NativeEngine.eval('1 + 1') === 2
NativeEngine.eval('(() => 42)()') === 42
runInSandbox('1 + 1').result === 2
runInSandbox('while(true){}', { timeout: 200 }).timeoutExceeded === true
  (and fires within 250ms wall clock — not 400ms+)
runInSandbox large allocation .error contains 'memory'
```

**Blocker:** Very tight `while(true){}` loops may not trigger QuickJS's interrupt between "ticks." If the timeout test takes > 500ms, switch from polling-based interrupt to deadline-based: `runtime.setInterruptHandler(() => { /* check frequently */ })` — QuickJS calls this between every opcode, but only in the active context. Ensure the context is not sharing a runtime with another eval.

---

## Phase 6 — Package Resolution

**Spec ref:** §8
**Depends on:** Phase 1

**Execution order:**
1. `pkg/npm-registry-client.ts` — `getPackageMetadata(name: string)`: `fetch('https://registry.npmjs.org/' + name)`, return `{ 'dist-tags', versions }`
2. `pkg/semver-resolver.ts` — `resolveVersion(range: string, versions: string[]): string` using `semver` package
3. `pkg/tarball-pipeline.ts` — `downloadAndExtract(tarballUrl, fs, targetDir)`:
   ```ts
   const res = await fetch(tarballUrl)
   const decompressed = res.body!.pipeThrough(new DecompressionStream('gzip'))
   const buf = await new Response(decompressed).arrayBuffer()
   const files = untarSync(new Uint8Array(buf))
   for (const file of files) {
     const dest = targetDir + '/' + file.name.replace(/^package\//, '')
     await fs.writeFile(dest, file.data)
   }
   ```
4. `pkg/package-installer.ts` — `install(name, range, fs)`: metadata → resolve → tarball → extract → write to `/node_modules/{name}`
5. `pkg/exports-resolver.ts` — `resolveExports(pkg, importPath, conditions)` wrapping `resolve.exports`
6. `tests/packages.browser.test.ts`

**Test against real npm registry:**
```ts
const fs = new AtuaFS()
await install('is-odd', 'latest', fs)
const src = await fs.readFile('/node_modules/is-odd/index.js', 'utf8')
expect(src).toContain('module.exports')
const mod = await importFromString(src)
expect(mod(3)).toBe(true)
expect(mod(4)).toBe(false)
```

**Scope limit:** Single-package install only. Do NOT implement recursive transitive dependency resolution — explicitly deferred in §19.

---

## Phase 7 — HTTP & Service Worker

**Spec ref:** §9
**Depends on:** Phase 1

**Execution order:**
1. `net/atua-http.ts` — `AtuaHTTPServer`: `register(path, handler: (req: Request) => Response | Promise<Response>)`, `dispatch(req: Request): Promise<Response>`
2. `net/preview-sw.ts` — Service Worker: intercepts fetch, routes via Comlink MessagePort, falls through for unregistered paths
3. `net/service-worker-bridge.ts` — registers SW at `/`, waits for `.ready`, creates MessageChannel, transfers port2 to SW via `postMessage({ type: 'INIT_PORT' }, [port2])`
4. `tests/http.browser.test.ts`

**Tests:**
```
register('/api/hello', () => Response.json({ hello: 'world' }))
→ fetch('/api/hello') returns { hello: 'world' } with status 200

register('/api/echo', async (req) => new Response(await req.text()))
→ fetch('/api/echo', { method: 'POST', body: 'ping' }) returns 'ping'

fetch('/unregistered') → 404

registered handler throws → 500 with error message
```

**Blocker:** SW scope. `navigator.serviceWorker.register('/preview-sw.js')` defaults to scope `'/'` only if the SW file is served from the origin root. Check `registration.scope === 'http://localhost:5173/'`. If Vite doesn't serve it from root, add to `publicDir`.

---

## Phase 8 — Integration: Atua.run()

**Spec ref:** §14
**Depends on:** Phases 4, 5, 6, 7

**Execution order:**
1. `atua.ts` — add `run(entry: string): Promise<{ previewUrl: string, stop(): void }>` to `AtuaInstance`
2. `run()` sequence (implement in this order, each step testable independently):
   - Scan `entry` file for bare specifier imports → install each via `PackageInstaller` if missing from `/node_modules`
   - `BundlerEngine.bundle({ input: entry, outfile: '/.atua/dist/bundle.js' })`
   - Ensure SW registered and `.ready` resolved
   - `NativeEngine.eval(bundle)` → capture Worker port from app's `http.listen()` call
   - Register SW route `/*` → proxy to Worker port
   - Return `{ previewUrl: window.location.origin + '/preview/' + uid, stop }`
3. `tests/integration.browser.test.ts`

**The critical test (criterion 9, §17 — do not mock any part of this):**
```ts
const atua = await AtuaInstance.create()

await atua.fs.writeFile('/src/index.ts', `
  import { Hono } from 'hono'
  const app = new Hono()
  app.get('/api/hello', c => c.json({ hello: 'world' }))
  export default app
`)

const { previewUrl } = await atua.run('/src/index.ts')

const res = await fetch(previewUrl + '/api/hello')
expect(res.status).toBe(200)
const data = await res.json()
expect(data.hello).toBe('world')
```

---

## Phase 9 — Process Lifetime

**Spec ref:** §11 (lifetime section)
**Depends on:** Phase 3

**Execution order:**
1. `proc/web-lock.ts` — `acquireKernelLock()`: holds Web Lock for kernel Worker's entire lifetime:
   ```ts
   navigator.locks.request('atua-kernel', { mode: 'exclusive' }, async () => {
     await new Promise(() => {}) // never resolves — holds lock
   })
   ```
2. `proc/broadcast-keepalive.ts` — heartbeat via `BroadcastChannel('atua-kernel')`: ping every 10s, detect competing tabs
3. `proc/opfs-checkpoint.ts` — `saveCheckpoint(kernel)`: serialize kernel state → `/.atua/checkpoint.json`. `loadCheckpoint()`: deserialize and restore
4. `proc/process-monitor.ts` — watchdog: if no heartbeat from kernel Worker for > 30s, call `loadCheckpoint()` and restart
5. `tests/lifetime.browser.test.ts` — Playwright: hide tab with `page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true }))`, wait 60s, verify kernel still responds

**Cold restart benchmark:**
```ts
await atua.saveCheckpoint()
const t0 = performance.now()
await atua.restart()  // reads checkpoint, restores state
const elapsed = performance.now() - t0
expect(elapsed).toBeLessThan(1000)
```

---

## Phase 10 — Cluster

**Spec ref:** §11 (cluster section)
**Depends on:** Phase 5

**Execution order:**
1. `proc/atua-cluster.ts` — `AtuaCluster.fork(n: number)`: spawn N NativeEngine Workers, `private counter = 0`, `dispatch(code)` → `workers[this.counter++ % n].eval(code)`
2. `tests/cluster.browser.test.ts`

**Test — confirm round-robin distribution:**
```ts
const cluster = await AtuaCluster.fork(2)
// Each worker returns its own unique ID
const ids = await Promise.all(Array.from({ length: 4 }, () => cluster.eval('self.__workerId')))
// Worker 0 gets requests 0 and 2, Worker 1 gets 1 and 3
expect(ids[0]).toBe(ids[2])  // same worker
expect(ids[1]).toBe(ids[3])  // same worker
expect(ids[0]).not.toBe(ids[1])  // different workers
```

---

## Phase 11 — TCP Relay

**Spec ref:** §10
**Depends on:** Nothing (independent Cloudflare deployment)

**Execution order:**
1. `packages/relay/wrangler.toml`:
   ```toml
   name = "atua-relay"
   main = "src/index.ts"
   compatibility_date = "2025-01-01"
   ```
2. `packages/relay/src/index.ts` — three route handlers:
   - `wss://relay.atua.dev/tcp/{host}/{port}` → TCP bridge via Cloudflare `connect()`
   - `wss://relay.atua.dev/llm/{provider}` → rewrite `Origin` header, proxy to provider API
   - `POST /mcp` → StreamableHTTP bridge to browser tab MCP endpoint
3. Deploy: `wrangler deploy`
4. Smoke test: `wscat -c 'wss://relay.atua.dev/llm/anthropic'` → verify connection opens

**Criterion 11 (§17):** WSS round-trips data end-to-end. Verify manually before marking complete.

---

## Phase 12 — WASI Guests (wa-sqlite)

**Spec ref:** §12
**Depends on:** Phase 4 (WASI layer exists)

**Execution order:**
1. `db/wa-sqlite-loader.ts` — loads `wa-sqlite` WASM, configures OPFS backend via kernel WASI guest interface
2. `db/catalyst-d1.ts` — `CatalystD1`: `open(path)`, `exec(sql)`, `query<T>(sql, params?): Promise<T[]>`, `close()`
3. `tests/sqlite.browser.test.ts`

**Persistence test (close + reopen simulates page reload):**
```ts
const db = await CatalystD1.open('/.atua/test.db')
await db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
await db.exec("INSERT INTO users VALUES (1, 'Alice')")
await db.close()

const db2 = await CatalystD1.open('/.atua/test.db')
const rows = await db2.query<{ name: string }>('SELECT * FROM users')
expect(rows).toHaveLength(1)
expect(rows[0].name).toBe('Alice')
await db2.close()
```

---

## Final Verification Gate

All 19 §17 criteria in a fresh Playwright session before handing off to Conductor:

```bash
# Criteria 17-18: static checks
grep -r "Catalyst" src/ packages/ apps/ --include="*.ts"
grep -rE "@stackblitz|@webcontainers|@nodebox" package.json packages/*/package.json

# All remaining criteria
pnpm test --reporter=verbose
```

Zero grep matches + all tests green = Atua complete. Conductor can begin.
