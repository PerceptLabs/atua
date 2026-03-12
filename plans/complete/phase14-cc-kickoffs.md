# Phase 14 — CC Kickoff Prompts

> **Pattern:** Direct execution. Spec IS the reviewed plan. No intermediate plan-review cycle.  
> **Docs:** `catalyst-workers-plan.md` (architecture), `catalyst-workers-roadmap.md` (phases + gates)

---

## Session 1: Phase 14a-1 — CatalystKV + CatalystR2

```
Read catalyst-workers-plan.md top to bottom.
Read catalyst-workers-roadmap.md Phase 14a-1 section.
Read packages/core/src/ to understand existing CatalystFS OPFS patterns.

Execute Phase 14a-1: CatalystKV + CatalystR2.

Create packages/catalyst-workers/ with package.json, tsconfig.json.
Implement src/bindings/types.ts — shared types (D1Result, R2Object, KVListResult, etc).
Implement src/bindings/kv.ts — CatalystKV class wrapping IndexedDB with exact Cloudflare KV API.
Implement src/bindings/r2.ts — CatalystR2 class wrapping OPFS directory with exact Cloudflare R2 API.
Implement src/index.ts — re-exports.
Write browser tests for both.

CatalystKV specifics:
- IDB database per namespace: catalyst-kv-{namespace}
- get() supports text/json/arrayBuffer/stream return types
- put() supports expiration (absolute) and expirationTtl (relative)
- TTL: lazy check on get (delete + return null if expired), 60s background sweep
- list() with prefix filtering via IDB key range cursor
- list() with cursor-based pagination (encoded key offset)
- getWithMetadata() returns both value and metadata

CatalystR2 specifics:
- OPFS directory per bucket: /catalyst-r2/{bucketName}/
- Metadata sidecar: .meta/{key}.json alongside each object
- put() accepts string, ArrayBuffer, ReadableStream, Blob
- get() returns R2Object with body as ReadableStream
- list() with prefix, delimiter, and cursor pagination
- head() returns metadata without body

Do NOT implement D1 (Session 2), runtime shell (14b), or Nitro (14c).

Commit: "Phase 14a-1: CatalystKV + CatalystR2 — KV and R2 bindings emulation"
```

---

## Session 2: Phase 14a-2 — CatalystD1

```
Read catalyst-workers-plan.md Section 4.2 (CatalystD1).
Read catalyst-workers-roadmap.md Phase 14a-2 section.
Read packages/catalyst-workers/src/bindings/ to understand KV/R2 patterns from Session 1.

Execute Phase 14a-2: CatalystD1.

Create packages/catalyst-workers-d1/ — separate package (940KB WASM, lazy-loaded).
Install wa-sqlite dependency.
Use JSPI build: wa-sqlite/dist/wa-sqlite-jspi.mjs
Use OPFSSAHPoolVFS for OPFS persistence (no SharedArrayBuffer, no COOP/COEP).

Implement src/d1.ts:
- CatalystD1 class with async _init (load WASM, register VFS, open DB)
- prepare(sql) returns CatalystD1PreparedStatement
- exec(sql) for raw DDL
- batch(statements) in BEGIN/COMMIT transaction, ROLLBACK on any error
- dump() exports entire DB as ArrayBuffer
- destroy() closes DB handle

Implement CatalystD1PreparedStatement:
- bind(...values) stores params, returns this (chainable)
- first(column?) — execute, return first row or null
- all() — execute, return { results, success, meta: { changes, duration, ... } }
- raw() — execute, return array of value arrays
- run() — execute mutation, return meta with changes count

Wire lazy loading: packages/catalyst-workers should dynamically import
catalyst-workers-d1 when a D1 binding is requested. Don't bundle wa-sqlite
into the main package.

Fall back to IDBBatchAtomicVFS if OPFSSAHPoolVFS initialization fails.

Write browser tests covering:
- Full CRUD with prepared statements
- batch() atomic commit and rollback
- Multiple tables, foreign keys, indexes
- All column types (NULL, integer, float, text, blob)
- Persistence: write → destroy → recreate → read succeeds
- Large result sets (1000+ rows)
- Dynamic import path works

Commit: "Phase 14a-2: CatalystD1 — SQLite database via wa-sqlite + OPFS"
```

---

## Session 3: Phase 14b — CatalystWorkers Runtime Shell

```
Read catalyst-workers-plan.md Section 5 (CatalystWorkers Runtime Shell).
Read catalyst-workers-roadmap.md Phase 14b section.
Read packages/catalyst-workers/src/bindings/ (all bindings from 14a).

Execute Phase 14b: CatalystWorkers Runtime Shell.

Implement src/runtime.ts — CatalystWorkers class:
- static create(config) constructs instance, loads all workers
- _loadWorker(name, config) — dynamic import of script, env construction
- _createBinding(config) — instantiate CatalystKV/D1/R2/secret/var per type
- handleFetch(event) — route matching → Worker fetch handler → respondWith
- destroy() — cleanup all bindings

Implement src/context.ts — CatalystExecutionContext:
- waitUntil(promise) delegates to event.waitUntil
- passThroughOnException() sets fallthrough flag

Implement src/globals.ts — injectWorkersGlobals():
- Patch any gaps between SW globals and workerd globals
- Most handled by unenv (Phase 13a), document what's added here

Implement src/wrangler-config.ts — parseWranglerConfig():
- Parse TOML format (use a small TOML parser, e.g., @iarna/toml or smol-toml)
- Extract kv_namespaces → { type: 'kv', namespace } bindings
- Extract d1_databases → { type: 'd1', database } bindings
- Extract r2_buckets → { type: 'r2', bucket } bindings
- Extract [vars] → { type: 'var', value } bindings
- Also support wrangler.jsonc (strip comments, JSON.parse)

Create test fixtures:
- test/fixtures/minimal-worker.js — simplest Worker (returns Hello World)
- test/fixtures/kv-worker.js — reads from env.MY_KV
- test/fixtures/d1-worker.js — queries env.MY_DB
- test/fixtures/multi-route-worker.js — different responses for different paths
- test/fixtures/sample-wrangler.toml — all binding types

Route matching rules:
- Exact: "/api/health" matches only that path
- Prefix: "/api/*" matches /api/ and anything under it
- Wildcard: "/**" matches everything

Worker error isolation: if Worker throws, return Response(500) with error message.
Do NOT crash the Service Worker.

Commit: "Phase 14b: CatalystWorkers — runtime shell loads and executes Worker bundles"
```

---

## Session 4: Phase 14c — Nitro Preset + Unstorage Driver

```
Read catalyst-workers-plan.md Section 6 (Nitro Preset).
Read catalyst-workers-roadmap.md Phase 14c section.
Read packages/catalyst-workers/src/runtime.ts (from 14b).
Reference https://github.com/unjs/nitro-preset-starter for preset structure.
Reference https://nitro.build/deploy/custom-presets for docs.

Execute Phase 14c: Nitro Preset + Unstorage Driver.

Create packages/nitro-preset-catalyst/:

src/preset.ts — NitroPreset:
- entry: points to ./entry.ts
- node: false (use unenv polyfills)
- rollupConfig.output.format: 'es'
- rollupConfig.output.inlineDynamicImports: true
- hooks.compiled: generate catalyst-workers.json config mapping storage → bindings

src/entry.ts — Runtime entry:
- import "#internal/nitro/virtual/polyfill"
- const nitroApp = useNitroApp()
- export default { async fetch(request, env, ctx) { ... } }
- Call nitroApp.localFetch() with context.catalyst = { env, ctx }
- Error handling: catch → Response(500)

src/storage-driver.ts — Unstorage driver:
- defineDriver backed by CatalystKV instance
- getItem → kv.get(key, 'json')
- setItem → kv.put(key, JSON.stringify(value))
- removeItem → kv.delete(key)
- getKeys → kv.list({ prefix })
- clear → list all keys, delete each

Create test fixture: test/fixtures/nitro-basic/
- nitro.config.ts with preset: 'catalyst'
- routes/index.ts (GET / → HTML response)
- routes/api/hello.ts (GET /api/hello → { hello: 'world' })
- Build externally with npx nitropack build
- Commit .output/ directory

Browser test: load .output/server/index.mjs into CatalystWorkers, verify:
- GET / returns HTML
- GET /api/hello returns JSON
- useStorage works via CatalystKV

Commit: "Phase 14c: nitro-preset-catalyst — Nuxt/SolidStart/Analog run in browser"
```

---

## Session 5: Phase 14d + 14e — Framework Adapters + Integration

```
Read catalyst-workers-plan.md Sections 7 and 8.
Read catalyst-workers-roadmap.md Phase 14d and 14e sections.
Read packages/catalyst-workers/src/runtime.ts (from 14b).
Read packages/nitro-preset-catalyst/ (from 14c).

PART 1 — Phase 14d: Astro + SvelteKit Adapters.

Create packages/catalyst-astro/:
- src/index.ts: Astro integration (astro:config:setup + astro:config:done hooks)
  - Set vite.ssr.target: 'webworker', noExternal: true
  - Set adapter with serverEntrypoint, exports: ['default']
- src/server.ts: createExports(manifest) wrapping App in { fetch }
  - Route matching via app.match(request)
  - Pass bindings via locals: { catalyst: { env, ctx } }

Create packages/catalyst-sveltekit/:
- src/index.ts: adapter function using builder.writeServer()
  - Wrap server bundle in { fetch } export

Create test fixtures:
- test/fixtures/astro-basic/ (minimal SSR page + API route, pre-built)
- test/fixtures/sveltekit-basic/ (minimal page + API route, pre-built)

Verify each framework's bundle loads in CatalystWorkers and responds correctly.

PART 2 — Phase 14e: Integration Tests.

Create test/fixtures/nuxt-fullstack/:
- Nuxt app with D1 (todos table), KV (sessions), R2 (uploads)
- server/api/todos.get.ts, todos.post.ts, todos.[id].put.ts, todos.[id].delete.ts
- server/api/upload.post.ts, upload.[key].get.ts
- wrangler.toml defining all three binding types
- Pre-build with nuxt build, commit .output/

Create test/fixtures/raw-worker/:
- Pure Workers code (no framework) using KV + D1
- wrangler.toml

Write integration tests:
- full-stack-nuxt.browser.test.ts: CRUD todos, session KV, file R2
- workers-compat.browser.test.ts: raw Worker with bindings
- Verify wrangler.toml auto-configures bindings
- Verify OPFS persistence across destroy/recreate

Commit 1: "Phase 14d: Astro + SvelteKit adapters"
Commit 2: "Phase 14e: Integration tests + full-stack Nuxt example"
```
