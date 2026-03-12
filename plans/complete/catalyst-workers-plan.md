# Catalyst — Phase 14: Cloudflare Workers in the Browser

> **Companion docs:** `catalyst-spec.md` (architecture), `catalyst-roadmap.md` (phases 0-12), `catalyst-upgrade-spec.md` (phase 13)  
> **Depends on:** Phase 13a (unenv), Phase 13b (Hono/SW), Phase 13c (Worker isolation)  
> **Scope:** Make Catalyst a drop-in Cloudflare Workers runtime. Any Worker-targeted bundle runs unmodified. Nitro preset unlocks Nuxt/SolidStart/Analog. Individual adapters for Astro/SvelteKit/Remix.

---

## CLEANROOM NOTICE — STILL APPLIES

```
Same rules as catalyst-roadmap.md. Do NOT reference WebContainers, StackBlitz,
bolt.new, or any competing product internals. Implement from:
- Cloudflare Workers PUBLIC API documentation (developers.cloudflare.com)
- Nitro PUBLIC documentation and nitro-preset-starter template (nitro.build)
- Framework adapter PUBLIC source code (MIT/Apache licensed adapters only)
- wa-sqlite PUBLIC repository and documentation (MIT licensed)
- UnJS PUBLIC packages: unenv, unstorage, h3, ofetch (MIT licensed)
- MDN Web Platform documentation
```

---

## 1. THE INSIGHT

Cloudflare Workers is NOT Node.js. It's `workerd` — a custom V8-based runtime with:
- A `fetch(request, env, ctx)` entry point
- Web APIs (Request, Response, fetch, crypto, streams)
- Node.js polyfills via unenv (the same unenv Catalyst integrated in Phase 13a)
- Platform bindings (KV, D1, R2, Queues, Durable Objects)
- No filesystem, no TCP sockets, no child processes

Catalyst's Service Worker is structurally identical:
- A `self.addEventListener('fetch', handler)` entry point
- Native Web APIs (it's a browser)
- Node.js polyfills via unenv (Phase 13a)
- Platform bindings → **this is the gap**

The delta is platform bindings. Everything else already matches.

Cloudflare actively contributes to unenv. Their `nodejs_compat` flag uses the same polyfill layer. Nitro (UnJS) uses unenv, H3, unstorage. The triangle is: Nitro → unenv → Cloudflare Workers. Catalyst slots in as an alternative runtime target alongside Workers, using the same polyfill layer.

---

## 2. ARCHITECTURE OVERVIEW

```
+----------------------------------------------------------------------+
|  Consumer Application (Wiggum IDE, tutorial platform, playground)     |
+----------------------------------------------------------------------+
        |
        v
+----------------------------------------------------------------------+
|  CatalystWorkers Runtime Shell                                        |
|  Loads Worker bundles, wires bindings, routes fetch events            |
|                                                                       |
|  +-------------------------------+  +------------------------------+ |
|  | Bindings Emulation            |  | Entry Point Adapter          | |
|  |                               |  |                              | |
|  | CatalystKV     → IndexedDB    |  | Workers module format:       | |
|  | CatalystD1     → wa-sqlite    |  |   export default { fetch }   | |
|  | CatalystR2     → OPFS dirs    |  |                              | |
|  | CatalystQueue  → BroadcastCh  |  | Service Worker format:       | |
|  | CatalystDO     → Web Workers  |  |   self.addEventListener      | |
|  +-------------------------------+  +------------------------------+ |
|                                                                       |
|  +-------------------------------+  +------------------------------+ |
|  | Unstorage Driver              |  | Workers Compat Globals       | |
|  | catalyst-kv driver for Nitro  |  | caches, crypto.subtle,       | |
|  | useStorage() just works       |  | navigator.userAgent stub,    | |
|  +-------------------------------+  | performance.now, etc.        | |
|                                     +------------------------------+ |
+----------------------------------------------------------------------+
        |                                    |
        v                                    v
+-------------------+         +----------------------------------+
| Nitro Preset      |         | Framework Adapters               |
| (catalyst)        |         | @aspect/catalyst-astro           |
|                   |         | @aspect/catalyst-sveltekit       |
| → Nuxt            |         | @aspect/catalyst-remix           |
| → SolidStart      |         |                                  |
| → Analog          |         | Each outputs a fetch-handler     |
| → Standalone H3   |         | bundle CatalystWorkers can load  |
+-------------------+         +----------------------------------+
```

### Two Integration Paths, One Runtime

**Path A — Nitro Preset:** One preset (`catalyst`) generates a Service Worker entry point. Frameworks built on Nitro (Nuxt, SolidStart, Analog) use it via `preset: 'catalyst'`. Build externally, output bundle loads into CatalystWorkers.

**Path B — Framework Adapters:** Frameworks with their own adapter systems (Astro, SvelteKit, Remix) get individual `@aspect/catalyst-*` adapters. Each outputs the same contract: a JS bundle with `export default { fetch(request, env, ctx) }`. CatalystWorkers loads it identically.

---

## 3. WORKERS RUNTIME CONTRACT

### What Already Exists vs What's New

| Workers runtime provides | Catalyst equivalent | Status |
|---|---|---|
| V8 isolate | QuickJS-WASM in Service Worker | ✅ Phase 4 + 13c |
| `export default { fetch(req, env, ctx) }` | SW `fetch` event handler | ✅ Phase 13b |
| Web APIs: Request, Response, URL, Headers | Browser native | ✅ Free |
| Web APIs: fetch, crypto.subtle, streams | Browser native | ✅ Free |
| Web APIs: caches (Cache API) | Browser native | ✅ Free |
| `waitUntil(promise)` | `event.waitUntil(promise)` in SW | ✅ Native SW |
| Node.js compat via unenv | Phase 13a unenv integration | ✅ 96.2% |
| `env.*` bindings object | CatalystWorkers config → env | 🔨 Phase 14b |
| KV namespace | CatalystKV → IndexedDB | 🔨 Phase 14a |
| D1 database | CatalystD1 → wa-sqlite/OPFS | 🔨 Phase 14a |
| R2 bucket | CatalystR2 → OPFS directory | 🔨 Phase 14a |
| Queues | CatalystQueue → BroadcastChannel | 🔨 Stretch |
| Durable Objects | CatalystDO → Web Workers + IDB | 🔨 Stretch |
| Secrets | Config injection (plain strings) | ✅ Trivial |

### The env Object Contract

Every Cloudflare Worker receives `env` as second argument to `fetch`. CatalystWorkers constructs it from configuration:

```typescript
// User's Worker code sees this — identical to Cloudflare:
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const value = await env.MY_KV.get('key');
    const row = await env.MY_DB.prepare('SELECT * FROM users WHERE id = ?')
                                .bind(1).first();
    const file = await env.MY_BUCKET.get('photo.jpg');
    return new Response(JSON.stringify({ value, row }));
  }
};
```

### ExecutionContext Contract

```typescript
interface CatalystExecutionContext {
  waitUntil(promise: Promise<any>): void;      // maps to event.waitUntil
  passThroughOnException(): void;               // fallthrough to static on error
}
```

---

## 4. BINDINGS EMULATION

### 4.1 CatalystKV — Key-Value Store → IndexedDB

**Cloudflare KV:** Global, eventually-consistent key-value store. Simple API, heavily used for caching, configuration, session data.

**Implementation:** IndexedDB wrapper with exact Cloudflare KV API shape.

```typescript
export class CatalystKV {
  constructor(namespace: string)

  get(key: string, options?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<any>
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: {
    expiration?: number;       // Unix timestamp (seconds)
    expirationTtl?: number;    // Seconds from now
    metadata?: Record<string, any>;
  }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: {
    prefix?: string;
    limit?: number;            // default 1000
    cursor?: string;
  }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: any }>; list_complete: boolean; cursor?: string }>
  getWithMetadata(key: string, type?: string): Promise<{ value: any; metadata: Record<string, any> | null }>
}
```

**IDB Schema:**

```
Database: catalyst-kv-{namespace}
  ObjectStore: kv-entries
    key: string (KV key)
    value: { value: string, metadata?: object, expiration?: number }
    index: prefix (for list operations)
```

**TTL:** Lazy expiration on `get` (check timestamp, delete if expired, return null). Background sweep every 60s. Matches Cloudflare KV's eventual consistency.

**Size:** ~200 lines. No external dependencies. Pure IndexedDB.

### 4.2 CatalystD1 — SQLite Database → wa-sqlite + OPFS

**Cloudflare D1:** SQLite at the edge. The binding that makes real apps possible.

**Implementation:** wa-sqlite with OPFS persistence via `opfs-sahpool` VFS.

**Why wa-sqlite over sql.js:**
- JSPI support (same async bridge Catalyst uses — no SharedArrayBuffer)
- OPFS SyncAccessHandle Pool VFS — persistent SQLite without COOP/COEP
- MIT licensed, actively maintained

**Size cost:** ~940KB WASM. Lazy-loaded — only fetched when project declares D1 binding. Separate package `@aspect/catalyst-workers-d1`.

```typescript
export class CatalystD1 {
  constructor(databaseName: string)

  prepare(sql: string): CatalystD1PreparedStatement
  exec(sql: string): Promise<D1ExecResult>
  batch<T>(statements: CatalystD1PreparedStatement[]): Promise<D1Result<T>[]>
  dump(): Promise<ArrayBuffer>
  destroy(): Promise<void>
}

class CatalystD1PreparedStatement {
  bind(...values: any[]): CatalystD1PreparedStatement
  first<T>(column?: string): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  raw<T>(): Promise<T[]>
  run(): Promise<D1Result>
}
```

**OPFS persistence:** Each database at `/catalyst-d1/{name}/` in OPFS. Survives refresh/close/restart. Exportable via `dump()`.

**What works:** Full SQL — CRUD, joins, indexes, transactions via `batch()`, prepared statements, aggregations, subqueries.

**What doesn't:** Concurrent multi-tab connections (OPFS exclusive lock). FTS5 needs explicit WASM build flag. No D1 Time Travel.

### 4.3 CatalystR2 — Object Storage → OPFS Directory

**Cloudflare R2:** S3-compatible object storage.

**Implementation:** OPFS directory per bucket. Thin adapter over CatalystFS.

```typescript
export class CatalystR2 {
  constructor(bucketName: string)

  get(key: string): Promise<CatalystR2Object | null>
  put(key: string, value: string | ArrayBuffer | ReadableStream | Blob, options?: {
    httpMetadata?: { contentType?: string; contentEncoding?: string };
    customMetadata?: Record<string, string>;
  }): Promise<CatalystR2Object>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string; delimiter?: string }): Promise<CatalystR2Objects>
  head(key: string): Promise<CatalystR2Object | null>
}
```

**Metadata:** Sidecar at `.meta/{key}.json` — httpMetadata, customMetadata, size, etag, timestamp.

**Size:** ~150 lines. Depends on CatalystFS (exists).

### 4.4 CatalystQueue + CatalystDO — Stretch Goals

**Queues:** BroadcastChannel + IndexedDB. Development/preview quality.

**Durable Objects:** Dedicated Web Worker per instance + IndexedDB storage. Complex, deferred.

KV + D1 + R2 cover 90%+ of real Workers apps. Ship common case first.

---

## 5. CATALYSTWORKERS RUNTIME SHELL

The orchestrator. Loads Worker bundles, constructs `env`, routes fetch events.

```typescript
export interface WorkerConfig {
  script: string;                              // URL or inline script
  bindings?: Record<string, BindingConfig>;    // env.* bindings
  routes?: string[];                           // URL patterns to intercept
}

export interface BindingConfig {
  type: 'kv' | 'd1' | 'r2' | 'queue' | 'secret' | 'var';
  namespace?: string;    // KV
  database?: string;     // D1
  bucket?: string;       // R2
  value?: string;        // secret / var
}

export class CatalystWorkers {
  static async create(config: {
    workers: Record<string, WorkerConfig>;
  }): Promise<CatalystWorkers>

  handleFetch(event: FetchEvent): void
  async destroy(): Promise<void>
}
```

**Under the hood:**
1. Load Worker bundle via dynamic `import()`
2. Create binding instances per config
3. Construct `env` object
4. Register fetch routing
5. Non-matching requests fall through to static serving

### wrangler.toml Parsing

```typescript
export function parseWranglerConfig(config: string): WorkerConfig
// Extracts: kv_namespaces, d1_databases, r2_buckets, vars, secrets
// Maps to CatalystWorkers BindingConfig format
```

---

## 6. NITRO PRESET

### Why Nitro Is the Multiplier

Nitro abstracts deployment targets via presets. One preset = entry point + build config. Everything funnels through `nitroApp.localFetch()`. The preset controls the wrapper.

### Package Structure

```
nitro-preset-catalyst/
├── src/
│   ├── preset.ts          # Build-time preset config (node: false, ES output)
│   ├── entry.ts           # Runtime entry (wraps localFetch in fetch handler)
│   └── storage-driver.ts  # Unstorage driver backed by CatalystKV
├── package.json
└── README.md
```

**preset.ts:** `node: false`, `format: 'es'`, `inlineDynamicImports: true`. Compiled hook generates `catalyst-workers.json` mapping Nitro storage to CatalystWorkers bindings.

**entry.ts:** Wraps `nitroApp.localFetch()` in `export default { fetch }`. Bindings accessible via `event.context.catalyst`.

**storage-driver.ts:** Unstorage driver so `useStorage('data')` reads/writes via CatalystKV.

### What One Preset Unlocks

```typescript
// Nuxt
export default defineNuxtConfig({ nitro: { preset: 'catalyst' } })

// SolidStart  
export default defineConfig({ server: { preset: 'catalyst' } })

// Analog (Angular)
export default defineConfig({ plugins: [analog({ nitro: { preset: 'catalyst' } })] })

// Standalone Nitro/H3
export default defineNitroConfig({ preset: 'catalyst' })
```

One preset → four framework ecosystems.

---

## 7. FRAMEWORK ADAPTERS

For frameworks that don't use Nitro. Each is 50-200 lines because the hard work lives in CatalystWorkers.

### @aspect/catalyst-astro
Mirrors `@astrojs/cloudflare`. Integration hook targets `webworker`, bundles everything, wraps Astro's SSR `App` in `default.fetch`.

### @aspect/catalyst-sveltekit
Mirrors `@sveltejs/adapter-cloudflare`. Uses `builder.writeServer()`, wraps in `{ fetch }` export.

### @aspect/catalyst-remix
Mirrors `@remix-run/cloudflare`. Wraps Remix request handler. Lower priority — Phase 15.

### Priority
1. **Astro** — largest independent SSG/SSR
2. **SvelteKit** — significant mindshare, clean adapter API
3. **Remix** — defer

---

## 8. DECISION LOG

| Decision | Chosen | Why |
|---|---|---|
| KV backing | IndexedDB | Async API matches KV, available in SW, no size limit |
| D1 implementation | wa-sqlite | JSPI support, OPFS persistence without COOP/COEP, MIT |
| D1 VFS | OPFSSAHPoolVFS | No SharedArrayBuffer, persistent. Falls back to IDBBatchAtomicVFS |
| R2 backing | OPFS directory | File semantics, streaming, CatalystFS exists |
| Nitro vs per-framework | Both | Nitro multiplies (1→4). Adapters cover the rest. Not exclusive |
| wrangler.toml parsing | TOML lib + manual mapping | Don't depend on CF internal config package |
| D1 package split | Separate lazy package | 940KB WASM shouldn't penalize non-D1 projects |
| Queue/DO | Defer (stretch) | KV+D1+R2 cover 90%+ of apps |
| In-browser build | Defer to Phase 15+ | Pre-built bundles ship now. Don't block. |

---

## 9. RISK ASSESSMENT

| Risk | Level | Mitigation |
|---|---|---|
| KV/R2 API mismatch | Low | Tiny APIs. CF types published. Test against them. |
| wa-sqlite OPFS VFS stability | Medium | Production-used. IDBBatchAtomicVFS fallback. |
| wa-sqlite JSPI build | Medium | Explicitly supports JSPI. Asyncify fallback. |
| D1 edge cases | Medium | Focus on documented API. File issues for gaps. |
| Nitro version compat | Medium | Pin Nitro 2.x. Stable preset API. |
| wa-sqlite WASM size | High | Lazy-load separate package. Workbox caches. |
| QuickJS SSR perf | High | Benchmark in 14e. May target "API + static" if SSR too slow. |
| Workers API drift | High | Focus on stable core. New bindings are additive. |
