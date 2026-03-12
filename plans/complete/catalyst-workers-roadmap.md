# Catalyst — Phase 14 Roadmap: Workers Compatibility

> **Companion doc:** `catalyst-workers-plan.md` (architecture, bindings design, decisions)  
> **CC Kickoffs:** `phase14-cc-kickoffs.md` (session prompts)  
> **Starting point:** Phase 13 complete — 648 tests passing, unenv integrated, Hono in SW, Worker isolation.

---

## PHASE MAP

```
Phase 14a-1: CatalystKV + CatalystR2                  (1 session, 4-6 hrs)
Phase 14a-2: CatalystD1 (wa-sqlite)                   (1 session, 4-6 hrs)
Phase 14b:   CatalystWorkers Runtime Shell             (1 session, 4-6 hrs)
Phase 14c:   Nitro Preset + Unstorage Driver           (1 session, 3-5 hrs)
Phase 14d:   Framework Adapters (Astro + SvelteKit)    (1 session, 4-6 hrs)
Phase 14e:   Integration Tests + Example Apps          (1 session, 4-6 hrs)
```

**Total: 6 CC sessions, ~24-34 hrs**

---

## DEPENDENCY GRAPH

```
Phase 14a-1 (KV + R2)
    |
    +-- Phase 14a-2 (D1)
            |
            v
      Phase 14b (CatalystWorkers runtime shell)
            |
            +--------> Phase 14c (Nitro preset)
            |               |
            +--------> Phase 14d (Framework adapters)
                            |
                            v
                      Phase 14e (Integration + examples)
```

- 14a-1 must come first — KV and R2 are the simplest bindings, establish patterns
- 14a-2 depends on 14a-1 — follows same patterns, adds wa-sqlite complexity
- 14b depends on all of 14a — runtime shell constructs bindings
- 14c and 14d are independent of each other, both depend on 14b
- 14e depends on everything

---

## PHASE 14a-1: CatalystKV + CatalystR2

### Scope

Pure IndexedDB/OPFS wrappers with no external WASM dependencies. Establish the bindings package structure.

### Files to Create

```
packages/catalyst-workers/
├── src/
│   ├── bindings/
│   │   ├── kv.ts              # CatalystKV class
│   │   ├── kv.browser.test.ts
│   │   ├── r2.ts              # CatalystR2 class
│   │   ├── r2.browser.test.ts
│   │   └── types.ts           # Shared types (D1Result, R2Object, etc.)
│   └── index.ts               # Package entry (re-exports)
├── package.json
└── tsconfig.json
```

### Verification Gates

- [ ] CatalystKV: get/put/delete basic cycle
- [ ] CatalystKV: get with type options (text, json, arrayBuffer, stream)
- [ ] CatalystKV: put with expiration (TTL and absolute)
- [ ] CatalystKV: get expired key returns null + auto-deletes
- [ ] CatalystKV: list with prefix filtering
- [ ] CatalystKV: list with cursor pagination
- [ ] CatalystKV: getWithMetadata returns value + metadata
- [ ] CatalystKV: large values (1MB+)
- [ ] CatalystR2: put/get text content
- [ ] CatalystR2: put/get binary content (ArrayBuffer)
- [ ] CatalystR2: put/get stream content (ReadableStream)
- [ ] CatalystR2: metadata sidecar round-trips (httpMetadata + customMetadata)
- [ ] CatalystR2: list with prefix and delimiter
- [ ] CatalystR2: list with pagination
- [ ] CatalystR2: head returns metadata without body
- [ ] CatalystR2: nested key paths (foo/bar/baz.txt)
- [ ] All tests pass in browser runner

### Test Count: ~36 new tests → ~684 total

### Commit

```
Phase 14a-1: CatalystKV + CatalystR2 — KV and R2 bindings emulation
```

---

## PHASE 14a-2: CatalystD1

### Scope

wa-sqlite integration with OPFS persistence. Separate lazy-loadable package due to 940KB WASM dependency.

### Files to Create

```
packages/catalyst-workers-d1/
├── src/
│   ├── d1.ts                          # CatalystD1 + PreparedStatement
│   ├── d1.browser.test.ts             # SQL operation tests
│   ├── d1-persistence.browser.test.ts # Write → close → reopen tests
│   └── index.ts
├── package.json
└── tsconfig.json
```

### Files to Modify

```
packages/catalyst-workers/src/bindings/types.ts  — add D1 type exports
packages/catalyst-workers/src/index.ts           — add lazy D1 import path
```

### Dependencies

- `wa-sqlite` — MIT licensed, WASM SQLite with JSPI + OPFS support

### Verification Gates

- [ ] wa-sqlite JSPI build loads (no COOP/COEP headers needed)
- [ ] CREATE TABLE / INSERT / SELECT / UPDATE / DELETE cycle
- [ ] prepare().bind().first() returns single row or null
- [ ] prepare().bind().all() returns { results: [...], success, meta }
- [ ] prepare().bind().raw() returns array of arrays
- [ ] prepare().bind().run() for mutations (returns changes count)
- [ ] batch() executes all statements atomically
- [ ] batch() rolls back ALL on error (verify no partial writes)
- [ ] exec() handles DDL statements
- [ ] SQL injection safety (bound parameters)
- [ ] Multiple tables with foreign keys
- [ ] NULL, integer, float, text, blob column types
- [ ] Empty result sets return { results: [] }
- [ ] Large result sets (1000+ rows)
- [ ] dump() exports valid ArrayBuffer
- [ ] Persistence: write → destroy → recreate → read → data intact
- [ ] Dynamic import from catalyst-workers works (lazy loading)
- [ ] Falls back to IDBBatchAtomicVFS if OPFS SAH unavailable

### Test Count: ~28 new tests → ~712 total

### Commit

```
Phase 14a-2: CatalystD1 — SQLite database via wa-sqlite + OPFS
```

---

## PHASE 14b: CatalystWorkers Runtime Shell

### Scope

The orchestrator that loads Worker bundles, constructs env with bindings, routes fetch events, and parses wrangler.toml.

### Files to Create

```
packages/catalyst-workers/src/
├── runtime.ts                  # CatalystWorkers class
├── context.ts                  # CatalystExecutionContext
├── globals.ts                  # Workers compat globals injection
├── wrangler-config.ts          # wrangler.toml/jsonc parser
├── runtime.browser.test.ts
└── wrangler-config.test.ts
```

### Test Fixtures

```
packages/catalyst-workers/test/fixtures/
├── minimal-worker.js           # Hand-written: export default { fetch(req, env) {...} }
├── kv-worker.js                # Uses env.MY_KV
├── d1-worker.js                # Uses env.MY_DB
├── multi-route-worker.js       # Multiple route patterns
└── sample-wrangler.toml        # Binding config for parsing tests
```

### Verification Gates

- [ ] Load module-format Worker, verify fetch routing returns response
- [ ] env contains KV binding, Worker reads from it
- [ ] env contains D1 binding, Worker queries it
- [ ] env contains R2 binding, Worker reads from it
- [ ] env contains secret/var bindings as plain strings
- [ ] ExecutionContext.waitUntil extends SW lifetime
- [ ] ExecutionContext.passThroughOnException sets fallthrough flag
- [ ] Route pattern: exact match (/api/health)
- [ ] Route pattern: prefix match (/api/*)
- [ ] Route pattern: wildcard match (/**)
- [ ] Non-matching requests fall through (not intercepted)
- [ ] Worker error → 500 response (not crash)
- [ ] Parse wrangler.toml → WorkerConfig (kv_namespaces, d1_databases, r2_buckets, vars)
- [ ] Parse wrangler.jsonc → WorkerConfig
- [ ] destroy() cleans up all bindings and resources

### Test Count: ~15 new tests → ~727 total

### Commit

```
Phase 14b: CatalystWorkers — runtime shell loads and executes Worker bundles
```

---

## PHASE 14c: Nitro Preset + Unstorage Driver

### Scope

Nitro integration that unlocks Nuxt, SolidStart, Analog, standalone H3.

### Files to Create

```
packages/nitro-preset-catalyst/
├── src/
│   ├── preset.ts           # NitroPreset config
│   ├── entry.ts            # Runtime entry (SW fetch handler)
│   └── storage-driver.ts   # Unstorage CatalystKV driver
├── package.json
├── tsconfig.json
└── README.md
```

### Test Fixtures

```
packages/catalyst-workers/test/fixtures/
├── nitro-basic/
│   ├── nitro.config.ts
│   ├── routes/
│   │   ├── index.ts           # GET / → HTML
│   │   └── api/hello.ts       # GET /api/hello → JSON
│   ├── .output/               # Pre-built (committed to repo)
│   └── package.json
└── build-fixtures.sh          # Script to rebuild fixtures
```

### Test Approach

Build the fixture externally (Node.js + Nitro CLI). Commit the `.output/` directory. Browser tests load the pre-built bundle into CatalystWorkers.

### Verification Gates

- [ ] Nitro build with preset: 'catalyst' produces valid ES module
- [ ] Output has `export default { fetch }` entry
- [ ] Bundle loads in CatalystWorkers
- [ ] GET / returns Nitro-rendered HTML
- [ ] GET /api/hello returns JSON { hello: 'world' }
- [ ] useStorage('data').setItem() writes via CatalystKV driver
- [ ] useStorage('data').getItem() reads via CatalystKV driver
- [ ] event.context.catalyst.env accessible in route handlers
- [ ] Static + dynamic routes coexist

### Test Count: ~8 new tests → ~735 total

### Commit

```
Phase 14c: nitro-preset-catalyst — Nuxt/SolidStart/Analog run in browser
```

---

## PHASE 14d: Framework Adapters — Astro + SvelteKit

### Scope

Individual adapters for non-Nitro frameworks. Same runtime (CatalystWorkers), different build integration.

### Files to Create

```
packages/catalyst-astro/
├── src/
│   ├── index.ts           # Astro integration
│   └── server.ts          # Server entry (fetch handler wrapping Astro App)
├── package.json
└── README.md

packages/catalyst-sveltekit/
├── src/
│   └── index.ts           # SvelteKit adapter
├── package.json
└── README.md
```

### Test Fixtures

```
packages/catalyst-workers/test/fixtures/
├── astro-basic/
│   ├── astro.config.mjs
│   ├── src/pages/index.astro
│   ├── src/pages/api/hello.ts
│   └── .output/              # Pre-built with @aspect/catalyst-astro
└── sveltekit-basic/
    ├── svelte.config.js
    ├── src/routes/+page.svelte
    ├── src/routes/api/hello/+server.ts
    └── .output/              # Pre-built with @aspect/catalyst-sveltekit
```

### Verification Gates

- [ ] Astro adapter builds without errors
- [ ] Astro SSR bundle loads in CatalystWorkers
- [ ] Astro page renders HTML correctly
- [ ] Astro API route returns JSON
- [ ] Astro `Astro.locals.catalyst.env` provides bindings
- [ ] SvelteKit adapter builds without errors
- [ ] SvelteKit bundle loads in CatalystWorkers
- [ ] SvelteKit page renders correctly
- [ ] SvelteKit API route returns JSON
- [ ] SvelteKit `platform.catalyst.env` provides bindings
- [ ] Both frameworks' bundles coexist in separate CatalystWorkers instances

### Test Count: ~10 new tests → ~745 total

### Commit

```
Phase 14d: Astro + SvelteKit adapters — framework bundles run in browser
```

---

## PHASE 14e: Integration Tests + Example Apps

### Scope

End-to-end validation. A real Nuxt app demonstrating D1 + KV + R2 running entirely in the browser. Raw Workers compat test.

### Files to Create

```
packages/catalyst-workers/test/
├── integration/
│   ├── full-stack-nuxt.browser.test.ts    # Nuxt CRUD app (D1 + KV + R2)
│   ├── full-stack-astro.browser.test.ts   # Astro SSR app (D1)
│   └── workers-compat.browser.test.ts     # Raw Workers bundle (no framework)
└── fixtures/
    ├── nuxt-fullstack/
    │   ├── nuxt.config.ts
    │   ├── server/api/
    │   │   ├── todos.get.ts       # GET /api/todos → D1 query
    │   │   ├── todos.post.ts      # POST /api/todos → D1 insert
    │   │   └── upload.post.ts     # POST /api/upload → R2 put
    │   ├── wrangler.toml          # Defines KV + D1 + R2 bindings
    │   └── .output/               # Pre-built
    └── raw-worker/
        ├── index.js               # Pure Workers code, no framework
        └── wrangler.toml
```

### Verification Gates

- [ ] Nuxt app: create todo (POST → D1 insert)
- [ ] Nuxt app: list todos (GET → D1 select)
- [ ] Nuxt app: update todo (PUT → D1 update)
- [ ] Nuxt app: delete todo (DELETE → D1 delete)
- [ ] Nuxt app: session persistence (KV set → refresh → KV get)
- [ ] Nuxt app: file upload (POST → R2 put → GET → R2 get)
- [ ] wrangler.toml auto-configures all bindings
- [ ] Raw Worker bundle (no framework) processes requests correctly
- [ ] Raw Worker uses KV + D1 from env
- [ ] All data persists across CatalystWorkers destroy/recreate (OPFS)
- [ ] Full app works offline after initial load

### Test Count: ~11 new tests → ~756 total

### Commits

```
Phase 14e: Integration tests + full-stack Nuxt example app
```

---

## SUMMARY TABLE

| Phase | Session | Scope | New Tests | Cumulative |
|---|---|---|---|---|
| 14a-1 | 1 | CatalystKV + CatalystR2 | ~36 | ~684 |
| 14a-2 | 2 | CatalystD1 (wa-sqlite) | ~28 | ~712 |
| 14b | 3 | CatalystWorkers runtime | ~15 | ~727 |
| 14c | 4 | Nitro preset + unstorage | ~8 | ~735 |
| 14d | 5 | Astro + SvelteKit adapters | ~10 | ~745 |
| 14e | 6 | Integration + examples | ~11 | ~756 |

---

## MILESTONES

**M9 "Platform bindings"** (Phase 14a): KV, D1, R2 emulation working. Can store/query/upload from browser.  
**M10 "Workers runtime"** (Phase 14b): Any Cloudflare Workers bundle runs unmodified. wrangler.toml auto-configures.  
**M11 "Framework multiplier"** (Phase 14c): Nuxt/SolidStart/Analog in the browser via one Nitro preset.  
**M12 "Full framework support"** (Phase 14d): Astro + SvelteKit adapters. Every major framework covered.  
**M13 "Proof of platform"** (Phase 14e): Full-stack Nuxt todo app with D1+KV+R2, entirely in browser.
