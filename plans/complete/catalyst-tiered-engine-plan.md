# Catalyst Tiered Engine Plan

> CC execution plan. Specs: `catalyst-tiered-engine-spec.md` + `catalyst-tiered-engine-addendum.md` at repo root.
> One phase per CC session. Do not read ahead or work on future phases.

---

## Phase A: Native Engine

Build NativeEngine — runs user JS on the browser's native engine via Web Workers.

### A.1 — Engine Interface Extraction

**Read first:**
- `packages/core/src/CatalystEngine.ts` — current engine abstraction
- `packages/core/src/CatalystProc.ts` — where engine instances are created
- Spec §"The IEngine Interface"

**Create:**
- `packages/core/src/engines/IEngine.ts` — extract IEngine + IModuleLoader interfaces + EngineConfig types from CatalystEngine
- `packages/core/src/engines/index.ts` — re-export interfaces

**Modify:**
- `packages/core/src/CatalystEngine.ts` — rename to QuickJSEngine, implement IEngine interface. Keep all existing behavior.
- `packages/core/src/CatalystProc.ts` — accept `engineFactory: () => IEngine` parameter instead of hardcoding QuickJS. Default to QuickJS so nothing breaks.

**Verify:** All existing tests still pass. No behavior change — this is a refactor only.

```bash
npm test
git add -A && git commit -m "phase-a1: extract IEngine interface, QuickJSEngine implements it"
```

### A.2 — Worker Bootstrap

**Read first:**
- `packages/core/src/engines/IEngine.ts` (from A.1)
- Spec §"The Native Engine Worker Bootstrap" (full bootstrap sequence)
- Spec §"What Changes vs What Stays" table
- Current unenv integration in the codebase (search for `unenv`)

**Create:**
- `packages/core/src/engines/native/NativeEngine.ts` — implements IEngine using Web Workers
- `packages/core/src/engines/native/WorkerBootstrap.ts` — the script that runs inside each Worker: imports unenv polyfills, builds require(), sets up Node globals, shadows browser globals
- `packages/core/src/engines/native/GlobalScope.ts` — scope shadowing utilities (delete/replace dangerous browser globals)
- `packages/core/src/engines/native/NativeModuleLoader.ts` — implements IModuleLoader for native context: require() backed by unenv + CatalystFS
- `packages/core/src/engines/native/index.ts` — re-export NativeEngine

**Modify:**
- `packages/core/src/index.ts` — export both QuickJSEngine and NativeEngine

**Tests to write:**
- `engine.eval('1 + 1')` returns 2 on native engine
- `engine.eval('require("path").join("a", "b")')` returns `'a/b'`
- `engine.eval('require("crypto").createHash("sha256").update("hello").digest("hex")')` returns correct SHA-256
- Console output captured via MessagePort
- Timeout enforcement: infinite loop killed via Worker.terminate()
- Both QuickJSEngine and NativeEngine pass the same IEngine contract tests

```bash
npm test
git add -A && git commit -m "phase-a2: NativeEngine — browser-native JS execution via Web Workers"
```

### A.3 — Engine Swap Wiring

**Read first:**
- `packages/core/src/engines/native/NativeEngine.ts` (from A.2)
- `packages/core/src/CatalystProc.ts` — how child processes spawn
- Spec §"Dual Target Architecture" — how Catalyst vs Reaction wire differently

**Modify:**
- `packages/core/src/CatalystProc.ts` — child process spawning uses engineFactory to create either QuickJS or Native instances per Worker
- `packages/core/src/index.ts` — export a `createRuntime(config)` that accepts engine choice
- Add an integration test: create runtime with NativeEngine, spawn a child process, verify it runs JS at native speed

**Verify:** Can create a Catalyst runtime with either engine. Both work. Process spawning works with both.

```bash
npm test
git add -A && git commit -m "phase-a3: engine swap wiring — CatalystProc uses engineFactory"
```

---

## Phase B: Tier 0 Validation Layer

QuickJS becomes the security gate. Code enters QuickJS first, validated, then runs natively.

### B.1 — Code Validator

**Read first:**
- `packages/core/src/engines/IEngine.ts`
- Spec §"Tier 0 — QuickJS Validation"
- Spec §"Security Model — Defense in Depth"

**Create:**
- `packages/core/src/validation/CodeValidator.ts` — orchestrates Tier 0 checks: parse AST, check imports, run against stubs
- `packages/core/src/validation/ASTChecker.ts` — walk AST for suspicious patterns (eval, Function constructor, prototype pollution, browser globals access)
- `packages/core/src/validation/ImportGraphValidator.ts` — validate require/import targets against allowlist
- `packages/core/src/validation/SandboxRunner.ts` — quick execution in QuickJS against stubs, enforce CPU/memory limits
- `packages/core/src/validation/index.ts` — re-export

**Tests to write:**
- Malicious code: `eval('dangerous')` detected and blocked
- Malicious code: `Function('return this')()` detected and blocked
- Malicious code: `__proto__` pollution detected
- Clean code: standard Express app passes validation in under 50ms
- Import validation: `require('fs')` allowed, `require('/etc/passwd')` blocked
- CPU limit: `while(true){}` killed after timeout
- Memory limit: allocation bomb killed after limit

```bash
npm test
git add -A && git commit -m "phase-b1: Tier 0 code validator — QuickJS as security gate"
```

### B.2 — Tiered Execution Wiring

**Read first:**
- `packages/core/src/validation/CodeValidator.ts` (from B.1)
- `packages/core/src/engines/native/NativeEngine.ts` (from A.2)
- Spec §"When Each Tier Activates" table

**Create:**
- `packages/core/src/engines/TieredEngine.ts` — wraps CodeValidator + NativeEngine. Validates via Tier 0, then executes via Tier 1. Configurable: skip validation for trusted code.

**Modify:**
- `packages/core/src/index.ts` — export TieredEngine as the default for Reaction target

**Tests to write:**
- Malicious code blocked at Tier 0, never reaches Tier 1
- Clean code passes Tier 0, executes at native speed in Tier 1
- Validation skip flag works for trusted code (user-edited, not AI-generated)

```bash
npm test
git add -A && git commit -m "phase-b2: TieredEngine — Tier 0 validates, Tier 1 executes"
```

---

## Phase C: HTTP Server via MessagePort

Make `http.createServer()` work by routing HTTP requests through MessagePort + Service Worker.

**Read first:**
- `packages/core/src/CatalystNet.ts` — current FetchProxy
- Spec §"http.createServer() — Now Possible"
- Spec §Phase C architecture diagram

**Create:**
- `packages/core/src/net/HttpServer.ts` — virtual HTTP server that registers a handler for a "port" via MessagePort
- `packages/core/src/net/PortRouter.ts` — maps port numbers to Worker MessagePorts, routes incoming requests
- `packages/core/src/net/RequestAdapter.ts` — converts Web Request/Response ↔ Node IncomingMessage/ServerResponse

**Modify:**
- `packages/core/src/CatalystNet.ts` — add server-side routing alongside existing fetch proxy
- The unenv `http` shim — wire `createServer()` to HttpServer instead of returning a stub

**Tests to write:**
- `http.createServer((req, res) => res.end('OK')).listen(3000)` — server starts, responds to requests
- Express app with middleware chain (cors, json parsing, route handler) serves correctly
- Hono app serves via this mechanism
- Multiple servers on different ports coexist
- Server.close() cleans up MessagePort registration

```bash
npm test
git add -A && git commit -m "phase-c: HTTP server via MessagePort — createServer works"
```

---

## Phase D: Process Pipelines

Full stdio piping between Worker processes.

**Read first:**
- `packages/core/src/CatalystProc.ts` — current Worker spawning
- Spec §"child_process.spawn() — Full Pipeline"
- Spec §Phase D

**Create:**
- `packages/core/src/proc/StdioPipe.ts` — MessagePort-based readable/writable streams connecting parent↔child stdin/stdout/stderr
- `packages/core/src/proc/ProcessGroup.ts` — parent-child relationships, signal propagation, exit code tracking

**Modify:**
- `packages/core/src/CatalystProc.ts` — add stdio routing, pipe support, signal forwarding (SIGTERM → Worker message, SIGKILL → Worker.terminate())

**Tests to write:**
- `spawn('node', ['script.js'])` with `child.stdout.on('data')` captures output
- Pipe chains: `a.stdout.pipe(b.stdin)` passes data between processes
- Exit codes propagate: child exits 1, parent sees code 1
- SIGTERM: parent sends, child receives 'disconnect' event
- SIGKILL: Worker.terminate() kills immediately

```bash
npm test
git add -A && git commit -m "phase-d: process pipelines — stdio piping between Workers"
```

---

## Phase G: DNS Module

**Read first:**
- Addendum §1.2 — DNS-over-HTTPS
- `packages/core/src/CatalystNet.ts`

**Create:**
- `packages/core/src/net/CatalystDNS.ts` — DoH client using fetch to Cloudflare 1.1.1.1. Implements full dns module surface: resolve, resolve4, resolve6, resolveMx, resolveTxt, resolveCname, resolveNs, resolveSoa, resolveSrv, reverse, lookup, lookupService, getServers, setServers, Resolver class. In-memory cache with TTL.

**Modify:**
- The unenv `dns` shim — wire to CatalystDNS instead of stubs

**Tests to write (real network):**
- `dns.resolve4('example.com')` returns real IP addresses
- `dns.resolveMx('gmail.com')` returns MX records
- `dns.lookup('example.com')` returns first A record
- Cache hit: second resolve returns instantly without network
- TTL expiration: cached entry expires, re-fetches
- Offline: cached entries still resolve, new lookups fail with ENOTFOUND
- Custom resolver: `new dns.Resolver()` with different DoH provider

```bash
npm test
git add -A && git commit -m "phase-g: DNS module — DoH-backed dns.resolve/lookup"
```

---

## Phase H: npm Registry Client

**Read first:**
- Addendum §3 — npm At Scale (full two-mode architecture)
- `packages/core/src/CatalystPkg.ts` — current esm.sh resolution
- `packages/core/src/PackageManager.ts` (or equivalent — check codebase)

**Create:**
- `packages/core/src/pkg/CatalystRegistry.ts` — speaks npm registry HTTP API: getPackageMetadata, getVersionMetadata, downloadTarball. Configurable registry URL.
- `packages/core/src/pkg/CatalystResolver.ts` — dependency tree resolution: parse package.json, resolve semver, deduplicate (npm v7+ flat algorithm), detect peer conflicts
- `packages/core/src/pkg/CatalystExtractor.ts` — tarball extraction in browser: pako (gzip) + tar-stream (untar), verify integrity hash, write to CatalystFS /node_modules
- `packages/core/src/pkg/CatalystLockfile.ts` — read/write catalyst-lock.json with exact versions + integrity hashes

**Modify:**
- `packages/core/src/CatalystPkg.ts` — add Mode 2 (full registry client) alongside existing Mode 1 (esm.sh). Mode selected by config or by presence of package.json.

**Tests to write (real network):**
- Fetch metadata for `lodash` from registry.npmjs.org
- Resolve dependency tree for `express` (55+ packages)
- Download and extract `lodash` tarball to CatalystFS
- Lockfile: install once → generates lockfile → second install uses lockfile (no registry calls except verification)
- Integrity: tampered tarball rejected
- OPFS cache: second install skips download (cache hit)

```bash
npm test
git add -A && git commit -m "phase-h: npm registry client — full dependency resolution and install"
```

---

## Phase I: Addon Registry

**Read first:**
- Addendum §4 — Native Addon Strategy (all three tiers)

**Create:**
- `packages/core/src/pkg/AddonRegistry.ts` — maps native addon names to WASM/pure-JS/Web API alternatives. Lookup function, custom registration.
- `packages/core/src/pkg/addon-alternatives.json` — the registry data: sharp→wasm-vips, sqlite3→sql.js, bcrypt→bcryptjs, etc.

**Modify:**
- Module loader (NativeModuleLoader or NodeCompatLoader) — check addon registry before normal resolution. If native addon has alternative, load that instead. If no alternative and package has .node binary, throw helpful error.

**Tests to write:**
- `require('sharp')` transparently loads wasm-vips alternative
- `require('bcrypt')` transparently loads bcryptjs
- `require('unknown-native-addon')` with .node binary throws clear error message
- Custom registration: `addonRegistry.register('my-addon', { package: 'my-wasm-addon', type: 'wasm' })` works

```bash
npm test
git add -A && git commit -m "phase-i: addon registry — native addon to WASM/JS transparent redirection"
```

---

## Phase J: TCP Bridge

**Read first:**
- Addendum §1.1 — TCP Three Layers
- `packages/core/src/CatalystNet.ts`

**Create:**
- `packages/core/src/net/TCPBridge.ts` — WebSocket relay client. When user code calls `net.createConnection({ host, port })`, opens WSS to configured relay endpoint, relay opens TCP to target, pipes bytes bidirectionally. Auto-detect WebSocket-native endpoints (Neon, Supabase, etc.) and connect directly.
- `packages/core/src/net/TCPBridge.relay.ts` — reference relay implementation (Deno/Cloudflare Worker) for docs/self-hosting

**Modify:**
- The unenv `net` shim — wire `createConnection()` and `Socket` to TCPBridge
- `packages/core/src/CatalystNet.ts` — integrate TCP bridge alongside fetch proxy

**Tests to write:**
- `net.createConnection({ host: 'example.com', port: 80 })` opens connection via relay
- Data round-trip: send bytes, receive response
- Connection close: both sides clean up
- Error handling: relay unreachable → ECONNREFUSED
- Direct WebSocket mode: Neon-style endpoint bypasses relay

```bash
npm test
git add -A && git commit -m "phase-j: TCP bridge — WebSocket relay for database connections"
```

---

## Phase K: TLS Module

**Read first:**
- Addendum §1.3 — TLS
- `packages/core/src/net/TCPBridge.ts` (from Phase J)

**Modify:**
- The unenv `tls` shim — wire `tls.connect()` to open WSS connection through relay (relay handles TLS to target)
- TCPBridge — add TLS upgrade support: relay detects STARTTLS and upgrades its TCP connection

**Tests to write:**
- `tls.connect({ host: 'example.com', port: 443 })` works (relay handles TLS)
- `https.request()` works end-to-end
- Certificate info accessible on connection object (relay reports metadata)

```bash
npm test
git add -A && git commit -m "phase-k: TLS module — relay-mediated TLS connections"
```

---

## Phase L: Cluster Module

**Read first:**
- Addendum §2 — Cluster Module (full architecture)
- `packages/core/src/CatalystProc.ts`
- `packages/core/src/net/HttpServer.ts` (from Phase C)

**Create:**
- `packages/core/src/proc/CatalystCluster.ts` — implements Node `cluster` API: Primary Worker distributes requests round-robin to Worker pool via MessagePort. fork(), IPC via worker.send()/process.on('message'), disconnect, exit events.

**Modify:**
- The unenv `cluster` shim — wire to CatalystCluster

**Tests to write:**
- `cluster.fork()` spawns Web Worker with full bootstrap
- `cluster.isPrimary` / `cluster.isWorker` correct per context
- Round-robin distribution: 100 requests spread across 4 workers
- IPC: `worker.send({ type: 'ping' })` → worker receives message
- `worker.disconnect()` + `cluster.on('exit')` fires
- `navigator.hardwareConcurrency` used for default worker count

```bash
npm test
git add -A && git commit -m "phase-l: cluster module — Worker pool with round-robin distribution"
```

---

## Phase E: Workers Compliance Gate

**Read first:**
- Spec §"Target 1: Cloudflare Workers"
- Spec §Phase E
- Addendum §5 — compliance package

**Create:**
- `packages/core/src/compliance/WorkersGate.ts` — runs code in Tier 2 (QuickJS with Workers constraints): validates fetch handler export, no forbidden Node APIs without nodejs_compat, memory/CPU limits, correct binding usage
- `packages/core/src/compliance/WorkersFixtures.ts` — test fixtures for Workers API surface

**Tests to write:**
- Valid Workers code passes gate
- Code using `require('fs')` without nodejs_compat fails with actionable error
- Code exceeding 128MB memory limit fails
- Code not exporting fetch handler fails
- KV/R2/D1 binding usage validated

```bash
npm test
git add -A && git commit -m "phase-e: Workers compliance gate — validates Cloudflare deployment readiness"
```

---

## Phase M: Deno API Surface

**Read first:**
- Addendum §8 — Deno API Surface (full coverage table + DenoGlobal implementation)
- Existing CatalystFS, CatalystNet, CatalystProc, CatalystDNS implementations

**Create:**
- `packages/core/src/compat/DenoGlobal.ts` — the `Deno` namespace object: file ops delegate to CatalystFS, env delegates to process shim, serve() delegates to HttpServer, Command delegates to CatalystProc, resolveDns() delegates to CatalystDNS, permissions delegates to security layer
- `packages/core/src/compat/DenoURLImports.ts` — URL import resolution: fetch URL via CatalystNet, compile TS via esbuild-wasm, cache in OPFS

**Modify:**
- `packages/core/src/engines/native/WorkerBootstrap.ts` — inject `Deno` global alongside Node globals when in Reaction mode
- Module loader — add URL import path for `https://deno.land/`, `https://esm.sh/`, `jsr:` specifiers

**Tests to write:**
- `Deno.readTextFile('./test.txt')` reads from CatalystFS
- `Deno.writeTextFile('./out.txt', 'hello')` writes to CatalystFS
- `Deno.env.get('KEY')` reads from process.env
- `Deno.serve()` starts HTTP server via HttpServer
- URL import: `import { serve } from "https://deno.land/std/http/server.ts"` resolves and loads
- `npm:express@4` specifier resolves via CatalystPkg

```bash
npm test
git add -A && git commit -m "phase-m: Deno API surface — Deno global + URL imports"
```

---

## Phase N: Package Split

**Read first:**
- Addendum §5 — Package Splitting
- Monorepo plan: `catalyst-monorepo-plan.md` (if present)
- All `packages/core/src/` to understand current coupling

**Do:**
- Extract shared packages from core into `packages/shared/` following the target structure in the addendum
- Each package gets its own `package.json`, `tsconfig.json`, `index.ts`
- Distribution packages (`packages/distributions/catalyst/` and `packages/distributions/reaction/`) wire engine + loader + shared packages
- Verify size budgets per package (see addendum §5)

**Constraint:** Do not change behavior while restructuring. Every test that passed before must pass after. This is a move + rename operation.

```bash
npm test
git add -A && git commit -m "phase-n: monorepo package split — shared packages extracted from core"
```

---

## Phase F: npm Process Runner

**Read first:**
- Spec §Phase F
- Addendum §3 — lifecycle scripts section
- `packages/core/src/pkg/CatalystRegistry.ts` (from Phase H)
- `packages/core/src/proc/` (from Phase D)

**Modify:**
- CatalystPkg — add lifecycle script execution: postinstall/preinstall/install scripts run through Tier 0 validation then Tier 1 execution in isolated Worker with restricted filesystem and network access
- Default: lifecycle scripts OFF. Opt-in per-package or with `--scripts` flag.

**Tests to write:**
- Package with postinstall script: script runs when --scripts enabled
- Package with postinstall script: script skipped (warning) when --scripts disabled
- Malicious postinstall blocked by Tier 0 validation
- Postinstall filesystem access restricted to package directory
- Postinstall network access restricted to registry + known CDNs

```bash
npm test
git add -A && git commit -m "phase-f: npm process runner — lifecycle scripts with Tier 0 gating"
```

---

## Kickoff Prompt Template

For each phase, use this pattern:

```
Read the specs at repo root: `catalyst-tiered-engine-spec.md` and `catalyst-tiered-engine-addendum.md`.
Follow `catalyst-tiered-engine-plan.md`, Phase [X] only.
Do not work on any other phase.
```

That's it. The plan has the file paths, the specs have the architecture.
