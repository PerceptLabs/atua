# Catalyst Tiered Engine Spec — Addendum

**Extends:** catalyst-tiered-engine-spec.md
**Covers:** TCP/DNS/TLS via modern APIs, cluster module, npm at scale, native addon strategy, package splitting, integration testing, benchmarking, Deno API surface

---

## 1. TCP, DNS, and TLS — The "Impossible" List Revisited

The base spec listed raw TCP, DNS, and TLS as permanent browser limitations. That was premature. Modern 2026 browser APIs and architectural patterns make all three feasible without touching WebContainers' patented mechanisms.

### 1.1 TCP — Three Layers of Coverage

The Node.js `net` module serves three distinct use cases, each with a different browser solution.

**Layer A: HTTP-over-TCP (90% of real usage)**

Most packages that `require('net')` are ultimately making HTTP connections. Express, Fastify, Axios, got, node-fetch — they use `net` internally but their actual need is HTTP request/response. This is already solved by the base spec's MessagePort routing and the browser's native `fetch`. No additional work needed.

**Layer B: WebSocket Bridge (database protocols, SMTP, custom TCP)**

For packages that need actual TCP-like bidirectional streams (database wire protocols, SMTP, IRC, custom protocols), WebSocket provides the transport:

```
User code: net.createConnection({ host: 'db.example.com', port: 5432 })
                    │
                    ▼
CatalystNet intercepts → Creates WebSocket to relay endpoint
                    │
                    ▼
Relay service (lightweight): WSS ←→ raw TCP to target host
                    │
                    ▼
PostgreSQL server receives standard wire protocol
```

The relay service is a tiny, stateless TCP proxy. It receives WebSocket connections from the browser, opens the corresponding TCP connection to the target, and pipes bytes bidirectionally. This is architecturally identical to what Cloudflare Workers uses for TCP (their `connect()` API uses the same pattern). The relay can run as:

- A Cloudflare Worker (using `connect()` for outbound TCP)
- A Deno Deploy edge function
- A small Node.js/Deno process (for self-hosted)
- A shared public service for common protocols (PostgreSQL, MySQL, Redis)

Many database providers already offer WebSocket-native connections that skip the relay entirely:
- **Neon** (PostgreSQL): Native WebSocket endpoint, no relay needed
- **PlanetScale** (MySQL): HTTP-based protocol
- **Turso** (SQLite): libSQL over HTTP
- **Upstash** (Redis): REST + WebSocket APIs
- **Supabase** (PostgreSQL): REST + Realtime (WebSocket)

For these providers, Catalyst's `net.createConnection()` can detect the target and use the native WebSocket endpoint directly.

**Layer C: Direct Sockets (Isolated Web Apps — future path)**

Chrome's Direct Sockets API provides raw TCP and UDP from Isolated Web Apps (IWAs). As of 2025, this requires IWA packaging (signed web bundle, Chrome-only). The API surface is exactly what `net` needs:

```javascript
// Direct Sockets API (IWA only)
const socket = new TCPSocket('example.com', 5432);
const { readable, writable } = await socket.opened;
// Full duplex TCP — ReadableStream + WritableStream
```

If Catalyst ships as a Chrome IWA (which is viable for a desktop IDE), this gives raw TCP with no relay. The IWA security model (strict CSP, cross-origin isolation, signed bundles) is stricter than a regular web app, which is a feature for a development environment.

For the immediate roadmap: Layer A (already done) + Layer B (WebSocket relay) covers 99% of use cases. Layer C is a future enhancement if/when IWA distribution makes sense.

**Patent Non-Infringement:**

The WebContainers patent covers a specific cross-origin relay mechanism using iFrames, invisible windows, and Service Workers bridging two local domains via SharedArrayBuffer. Catalyst's approach is fundamentally different:

- WebSocket relay is standard client-server communication, not cross-origin bridging
- No iFrames, no invisible windows, no Service Worker on invisible window
- No SharedArrayBuffer requirement
- No cross-origin isolation requirement
- MessagePort routing is same-origin, not cross-origin
- Direct Sockets API is a browser-standard API with no relay mechanism at all

### 1.2 DNS — DNS-over-HTTPS

Node's `dns` module resolves domain names. Browsers don't expose the OS DNS resolver. But DNS-over-HTTPS (DoH) is a standard protocol supported by all major DNS providers:

```
User code: dns.resolve('example.com', 'A', callback)
                    │
                    ▼
CatalystDNS → fetch('https://1.1.1.1/dns-query', {
                headers: { 'Accept': 'application/dns-json' }
              })
                    │
                    ▼
Cloudflare DNS returns JSON: { Answer: [{ type: 1, data: '93.184.216.34' }] }
                    │
                    ▼
Callback receives: ['93.184.216.34']
```

**Supported providers (all free, all support JSON wire format):**
- Cloudflare: `https://1.1.1.1/dns-query` (fastest)
- Google: `https://8.8.8.8/resolve`
- Quad9: `https://dns.quad9.net:5053/dns-query`

**Full `dns` module coverage:**

| Method | Implementation |
|--------|---------------|
| `dns.resolve(hostname, rrtype)` | DoH query with specified record type (A, AAAA, MX, TXT, etc.) |
| `dns.resolve4(hostname)` | DoH query for A records |
| `dns.resolve6(hostname)` | DoH query for AAAA records |
| `dns.resolveMx(hostname)` | DoH query for MX records |
| `dns.resolveTxt(hostname)` | DoH query for TXT records |
| `dns.resolveCname(hostname)` | DoH query for CNAME records |
| `dns.resolveNs(hostname)` | DoH query for NS records |
| `dns.resolveSoa(hostname)` | DoH query for SOA records |
| `dns.resolveSrv(hostname)` | DoH query for SRV records |
| `dns.reverse(ip)` | DoH PTR query |
| `dns.lookup(hostname)` | DoH A/AAAA query (uses `getaddrinfo` behavior: returns first result, respects family option) |
| `dns.lookupService(address, port)` | PTR query + port-to-service mapping (static table) |
| `dns.getServers()` | Returns configured DoH provider URLs |
| `dns.setServers(servers)` | Configures DoH providers |
| `dns.Resolver` class | Instance with own DoH config, timeout, tries |

**Caching:** DoH responses include TTL. CatalystDNS maintains an in-memory cache keyed by (hostname, rrtype) with TTL-based expiration. This matches how OS resolvers work and avoids redundant network requests.

**Offline:** When offline, cached entries still resolve. New lookups fail with `ENOTFOUND` — same behavior as Node when the network is unavailable.

### 1.3 TLS — Browser-Native + WebCrypto

TLS in the browser is split into two scenarios:

**Scenario A: HTTPS/WSS connections (automatic)**

The browser handles TLS for all `https://` and `wss://` connections. When user code does `https.request(url)` or `net.createConnection()` to a WebSocket relay, TLS happens transparently. Certificate validation, cipher negotiation, SNI — all handled by the browser's native TLS stack (BoringSSL in Chrome). This covers 99% of TLS usage.

**Scenario B: STARTTLS / custom TLS (via WebSocket relay)**

Some protocols (SMTP, IMAP, POP3, LDAP) start as plaintext TCP and upgrade to TLS mid-connection via STARTTLS. In the WebSocket relay model:

1. Browser opens WSS connection to relay (already TLS-encrypted browser-to-relay)
2. Relay opens plaintext TCP to target
3. User code sends STARTTLS command through the pipe
4. Relay detects STARTTLS and upgrades its TCP connection to TLS
5. From this point: browser ←WSS→ relay ←TLS→ target

The entire path is encrypted. The relay handles the STARTTLS upgrade on the TCP side. User code sees a stream that transitions from plaintext to encrypted, matching Node's `tls.connect()` behavior.

**Node `tls` module coverage:**

| Method | Implementation |
|--------|---------------|
| `tls.connect(options)` | Opens WSS to relay, relay opens TLS to target. Returns TLSSocket-like wrapper. |
| `tls.createServer(options)` | Uses the same HttpServer (MessagePort) with TLS handled by browser's native HTTPS. |
| `tls.createSecureContext()` | Wraps WebCrypto key/cert operations. |
| `tls.getCiphers()` | Returns browser-supported cipher list (static, queried from WebCrypto). |
| `TLSSocket` class | Wrapper around WebSocket connection with cert/cipher info from relay metadata. |
| Certificate verification | Browser validates relay cert. Relay validates target cert and reports status to browser. |

**What doesn't work:** Loading custom CA bundles, client certificate authentication from within the browser (the browser's own cert store is used). For development environments, this is rarely needed. For production, the Cloudflare Workers target handles TLS natively.

---

## 2. Cluster Module

Node's `cluster` module forks the process to utilize multiple CPU cores for HTTP serving. In the browser, Web Workers provide multi-core parallelism.

### Architecture

```
Primary Worker (cluster.isPrimary = true)
  │
  ├─ Spawns N Worker threads (navigator.hardwareConcurrency)
  │
  ├─ Receives HTTP requests via Service Worker / MessagePort
  │
  └─ Round-robin distributes requests to Worker pool
      │
      ├─ Worker 1 (cluster.isWorker = true) — handles request
      ├─ Worker 2 — handles request
      ├─ Worker 3 — handles request
      └─ Worker N — handles request
```

### Implementation

```typescript
// CatalystCluster maps Node's cluster to Web Workers

interface CatalystCluster {
  isPrimary: boolean;
  isWorker: boolean;
  workers: Map<number, ClusterWorker>;
  
  fork(env?: Record<string, string>): ClusterWorker;
  disconnect(callback?: () => void): void;
  
  // Events
  on(event: 'fork', handler: (worker: ClusterWorker) => void): void;
  on(event: 'online', handler: (worker: ClusterWorker) => void): void;
  on(event: 'listening', handler: (worker: ClusterWorker, address: AddressInfo) => void): void;
  on(event: 'disconnect', handler: (worker: ClusterWorker) => void): void;
  on(event: 'exit', handler: (worker: ClusterWorker, code: number, signal: string) => void): void;
  on(event: 'message', handler: (worker: ClusterWorker, message: any) => void): void;
  
  schedulingPolicy: 'rr' | 'none';  // round-robin or OS-decided
  settings: ClusterSettings;
  setupPrimary(settings: ClusterSettings): void;
}
```

**Request distribution:** The Primary Worker owns the port binding (registered with the PortRouter from Phase C). When a request arrives, the Primary sends it to the next Worker in the round-robin pool via MessagePort. The Worker processes the request and sends the response back through the same MessagePort.

**IPC:** `worker.send(message)` and `process.on('message')` map directly to `MessagePort.postMessage()` and `MessagePort.onmessage`. The semantics are identical — structured clone algorithm for serialization, same as Node's IPC.

**Graceful shutdown:** `worker.disconnect()` closes the MessagePort and lets in-flight requests complete. `worker.kill()` calls `Worker.terminate()` (immediate, no grace period — same as SIGKILL).

**Shared state:** Node's cluster uses shared file descriptors for the listening socket. In Catalyst, the Primary Worker owns the port binding and distributes requests. Workers don't share a socket — they receive pre-parsed requests via MessagePort. This is actually simpler and avoids the thundering herd problem that Node's cluster can exhibit.

### What Works

- `cluster.fork()` — spawns Web Workers with full Node.js bootstrap
- `cluster.isPrimary` / `cluster.isWorker` — correct based on Worker context
- `worker.send()` / `process.on('message')` — MessagePort IPC
- `cluster.on('exit')` — Worker.terminate() or crash detection
- Round-robin scheduling — Primary distributes requests
- `os.cpus().length` for default worker count — `navigator.hardwareConcurrency`

### What Differs

- No shared file descriptors (Primary distributes, Workers don't bind ports directly)
- No SIGTERM/SIGINT signal handling (Workers get 'disconnect' event, then terminate)
- `cluster.setupPrimary({ exec: 'worker.js' })` — the exec file runs in Worker with full bootstrap, same as a child_process spawn
- No `cluster.schedulingPolicy = cluster.SCHED_NONE` (OS-level scheduling doesn't apply; always round-robin via Primary)

---

## 3. npm At Scale

The base spec acknowledged that esm.sh handles single-package resolution but doesn't handle `npm install` with 500+ dependency lockfiles. This section specifies the full npm registry client.

### Two-Mode Architecture

**Mode 1: esm.sh (Development Speed — Default)**

What exists today. Fast for iterative development:
- User writes `import express from 'express'` or `require('express')`
- CatalystPkg resolves via esm.sh CDN (pre-bundled, ESM-converted)
- Cached in OPFS with integrity hashes
- No `node_modules` directory needed
- No dependency tree resolution needed (esm.sh handles it server-side)

Best for: Wiggum/Ralph-generated code, rapid prototyping, educational environments, single-file scripts.

**Mode 2: Full Registry Client (Production Fidelity)**

New. For when a real `package.json` + `node_modules` + lockfile workflow is needed:

```
User runs: npm install
                │
                ▼
1. Parse package.json → extract dependencies + devDependencies
                │
                ▼
2. Check lockfile (catalyst-lock.json)
   ├─ Lockfile exists → use exact resolved versions
   └─ No lockfile → resolve from registry
                │
                ▼
3. Resolve dependency tree
   ├─ Fetch package metadata: GET https://registry.npmjs.org/{package}
   ├─ Apply semver constraints
   ├─ Deduplicate (flat tree, npm v7+ algorithm)
   └─ Detect peer dependency conflicts
                │
                ▼
4. Check OPFS package cache
   ├─ Cache hit (integrity matches) → skip download
   └─ Cache miss → download tarball
                │
                ▼
5. Download tarballs
   ├─ GET tarball URL from package metadata
   ├─ Verify integrity hash (sha512)
   └─ Store in OPFS cache (keyed by name@version)
                │
                ▼
6. Extract to CatalystFS /node_modules
   ├─ Untar/ungzip in browser (pako + tar-stream, both pure JS)
   ├─ Write files to CatalystFS virtual filesystem
   └─ Flat directory structure (npm v7+ deduplication)
                │
                ▼
7. Execute lifecycle scripts (optional, gated)
   ├─ preinstall → Tier 0 validate → Tier 1 execute in Worker
   ├─ install → same
   └─ postinstall → same
                │
                ▼
8. Write lockfile
   └─ catalyst-lock.json with exact versions + integrity hashes
```

### Registry Client Implementation

**CatalystRegistry** — speaks the npm registry HTTP API:

```typescript
interface CatalystRegistry {
  // Fetch package metadata (all versions)
  getPackageMetadata(name: string): Promise<PackageMetadata>;
  
  // Fetch specific version metadata
  getVersionMetadata(name: string, version: string): Promise<VersionMetadata>;
  
  // Download tarball
  downloadTarball(url: string): Promise<ArrayBuffer>;
  
  // Configurable registry URL (default: registry.npmjs.org)
  registryUrl: string;
  
  // Authentication token (for private registries)
  authToken?: string;
}
```

The npm registry API is simple HTTP:
- `GET https://registry.npmjs.org/{package}` → all versions, tarball URLs, dependency maps
- `GET https://registry.npmjs.org/{package}/{version}` → specific version metadata
- `GET {tarball_url}` → download .tgz file

**CatalystResolver** — dependency tree resolution:

```typescript
interface CatalystResolver {
  // Resolve full dependency tree from package.json
  resolve(packageJson: PackageJson): Promise<DependencyTree>;
  
  // Resolve from lockfile (exact versions, no registry calls except verification)
  resolveFromLockfile(lockfile: CatalystLockfile): Promise<DependencyTree>;
  
  // Deduplicate tree (npm v7+ flat algorithm)
  deduplicate(tree: DependencyTree): DependencyTree;
  
  // Detect conflicts
  detectConflicts(tree: DependencyTree): ConflictReport;
}
```

Resolution algorithm follows npm v7+:
1. Start with direct dependencies from package.json
2. For each dependency, fetch metadata, find best matching version per semver
3. For each resolved version, recursively resolve its dependencies
4. Deduplicate: if package@version already exists higher in the tree, don't duplicate
5. Detect peer dependency conflicts and report

**CatalystExtractor** — tarball extraction in browser:

Uses `pako` (gzip decompression, pure JS, 45KB) and `tar-stream` or `untar.js` (tar parsing, pure JS). Both work in browser with zero native dependencies.

```typescript
interface CatalystExtractor {
  // Extract tarball to CatalystFS path
  extract(tarball: ArrayBuffer, targetPath: string): Promise<string[]>;
  
  // Verify integrity before extraction
  verifyIntegrity(tarball: ArrayBuffer, expected: string): Promise<boolean>;
}
```

### Performance Optimizations

**Parallel downloads:** The dependency tree reveals all needed tarballs upfront. Download them in parallel (browsers support 6+ concurrent connections per origin). Use HTTP/2 multiplexing to the registry.

**OPFS tarball cache:** Store downloaded .tgz files in OPFS, keyed by `{name}-{version}.tgz` with sha512 integrity hash. On subsequent installs, only verify integrity and extract — no network needed.

**Incremental installs:** When package.json changes, diff against lockfile. Only resolve/download new or updated packages. Extraction is incremental — don't re-extract unchanged packages.

**Metadata caching:** Package metadata responses include ETags. Cache metadata in OPFS with conditional GET (If-None-Match). Most metadata requests return 304 Not Modified.

**Pre-resolved CDN (future):** For common dependency trees (create-react-app, next.js, express starter), pre-compute the resolved tree and host it as a single downloadable manifest. One request instead of 500 metadata fetches.

### Lifecycle Scripts

Lifecycle scripts (preinstall, install, postinstall) are the most dangerous part of npm install — they run arbitrary code. Catalyst's tiered execution makes this safer than any other runtime:

1. Script enters Tier 0 (QuickJS validation) — checked for malicious patterns
2. If clean, promoted to Tier 1 (native execution) in an isolated Worker
3. Worker has filesystem access restricted to the package's directory
4. Network access restricted to the registry and known CDNs
5. CPU and memory limits enforced
6. If script exceeds limits or fails validation, installation continues without it (warn, don't fail)

**Default behavior:** Lifecycle scripts are OFF by default. Most packages don't need them. Users opt in per-package or globally with a `--scripts` flag. This matches the security stance of Deno and Bun.

---

## 4. Native Addon Strategy

Native addons (.node files compiled from C/C++) cannot run in the browser. But the most popular native addons have WASM or pure-JS alternatives. Catalyst maintains a compatibility registry that transparently redirects `require('native-addon')` to its browser-compatible equivalent.

### The Addon Compatibility Registry

```typescript
interface AddonRegistry {
  // Check if a native addon has a browser alternative
  hasAlternative(packageName: string): boolean;
  
  // Get the alternative package specifier
  getAlternative(packageName: string): AddonAlternative;
  
  // Register a custom alternative
  register(packageName: string, alternative: AddonAlternative): void;
}

interface AddonAlternative {
  // The replacement package to load instead
  package: string;
  // How to load it
  type: 'wasm' | 'pure-js' | 'web-api';
  // Any API shape differences to shim
  shimModule?: string;
  // Notes on behavioral differences
  caveats?: string[];
}
```

### Tier 1 — WASM Alternatives (Direct Replacements)

These are the same C/C++ library compiled to WASM instead of native. API-compatible or near-compatible.

| Native Addon | WASM Alternative | Size | Compatibility | Notes |
|-------------|-----------------|------|---------------|-------|
| **sharp** | wasm-vips | ~8MB | High | StackBlitz proved this works in WebContainers. Image resize, convert, transform. |
| **sqlite3** / **better-sqlite3** | sql.js / wa-sqlite | ~1MB | High | SQLite compiled to WASM. sql.js is in-memory, wa-sqlite supports OPFS persistence. |
| **canvas** | canvas-wasm / skia-wasm | ~4MB | Medium | Skia compiled to WASM. 2D drawing API. Some font rendering differences. |
| **argon2** | argon2-browser | ~200KB | High | Argon2 password hashing compiled to WASM. Same algorithm, same output. |
| **libsodium** | libsodium.js | ~180KB | High | Official WASM build from libsodium project. Full crypto coverage. |
| **esbuild** | esbuild-wasm | ~9MB | High | Already in Catalyst's build pipeline. Official WASM build. |
| **sass** | sass (Dart compiled to JS) | ~5MB | High | The `sass` npm package is already pure Dart-to-JS, no native addon needed. |

### Tier 2 — Pure JS Alternatives (Different Implementation, Same API)

These reimplement the functionality in JavaScript. Usually slower but fully compatible.

| Native Addon | Pure JS Alternative | Notes |
|-------------|-------------------|-------|
| **bcrypt** | bcryptjs | Same API, ~3x slower. Acceptable for dev environments. |
| **leveldown** | browser-level (IndexedDB) | Level-compatible API backed by IndexedDB instead of LevelDB. |
| **node-fetch** | Native `fetch` (via unenv) | Browser-native, no addon needed. |
| **utf-8-validate** | Pure JS validator | ws package falls back to JS implementation automatically. |
| **bufferutil** | Pure JS buffer utils | ws package falls back to JS implementation automatically. |
| **cpu-features** | Static stub | Returns reasonable defaults for browser environment. |

### Tier 3 — Web API Bridges (Browser Provides the Capability)

Some native addons wrap OS capabilities that the browser provides natively through different APIs.

| Native Addon | Web API | Notes |
|-------------|---------|-------|
| **node-cron** / **cron** | setTimeout + setInterval | Pure JS, no native addon. Already works. |
| **node:crypto** (native parts) | WebCrypto API | SHA-256, HMAC, AES, RSA — all available via crypto.subtle. Already wired via unenv. |
| **zlib** (native) | CompressionStream / DecompressionStream | Browser-native gzip/deflate. Available in all modern browsers. |
| **http_parser** (native) | llhttp (WASM) or pure JS parser | Node internalized this. For user code, the http module shim handles parsing. |

### How Transparent Redirection Works

When user code does `require('sharp')`, the module loader checks the addon registry before trying npm:

```
require('sharp')
  │
  ├─ 1. Built-in module? → No
  ├─ 2. Addon registry has alternative? → Yes: wasm-vips
  │     │
  │     ├─ Load wasm-vips from OPFS cache or esm.sh
  │     ├─ Apply API shim (sharp → wasm-vips adapter)
  │     └─ Return shimmed module
  │
  └─ 3. If no alternative → attempt normal resolution
        └─ If package has .node binary → throw helpful error:
           "sharp requires native compilation. In Catalyst,
            use the WASM alternative: require('sharp') is
            automatically redirected to wasm-vips."
```

### Addon Registry Maintenance

The registry ships as a JSON file (`addon-alternatives.json`) bundled with Catalyst. It maps package names to their alternatives:

```json
{
  "sharp": {
    "package": "wasm-vips",
    "type": "wasm",
    "shimModule": "@aspect/sharp-shim",
    "caveats": ["Some format conversions may differ slightly", "EXIF handling varies"]
  },
  "better-sqlite3": {
    "package": "sql.js",
    "type": "wasm",
    "shimModule": "@aspect/sqlite-shim",
    "caveats": ["In-memory by default, OPFS persistence opt-in"]
  }
}
```

Users can extend the registry for their own native addons. The registry is also updatable independently of Catalyst releases.

### What We Don't Cover

Some native addons have no browser equivalent and never will:
- **fsevents** (macOS file system events) — OS-specific, CatalystFS has its own watcher
- **node-gyp** itself — no C++ compilation in browser
- **electron** / **nw.js** — desktop frameworks, wrong target
- **grpc** (native) — use @grpc/grpc-js (pure JS gRPC) instead
- **pg-native** — use pg (pure JS PostgreSQL client) with WebSocket transport

For these, Catalyst reports a clear error explaining why and suggests the alternative.

---

## 5. Package Splitting — Resolving Empty Re-exports

The base spec notes that `packages/dev` and `packages/pkg` are empty re-exports from core. The monorepo plan covers the full restructuring, but this section specifies how the split integrates with the tiered engine architecture.

### Current State

Everything lives in `packages/core`. The separate directories exist but just re-export:

```typescript
// packages/dev/src/index.ts — today
export * from '@aspect/catalyst-core/dev';

// packages/pkg/src/index.ts — today
export * from '@aspect/catalyst-core/pkg';
```

### Target State

The split follows the engine architecture's dependency graph:

```
packages/
  shared/
    engine-interface/     → IEngine, IModuleLoader, EngineConfig types
    fs/                   → CatalystFS (OPFS + IndexedDB)
    net/                  → CatalystNet (MessageChannel proxy + HTTP server + TCP bridge)
    dns/                  → CatalystDNS (DoH resolver)
    proc/                 → CatalystProc (Worker pool, stdio pipes, cluster)
    pkg/                  → CatalystPkg (esm.sh + registry client + OPFS cache)
    dev/                  → CatalystDev (esbuild-wasm + HMR)
    wasi/                 → CatalystWASI (WASI P1 bindings)
    sync/                 → CatalystSync (journal + CRDTs)
    workers/              → CatalystWorkers (KV/R2/D1 stubs)
    security/             → Security tests, validation utilities
    addon-registry/       → Native addon → WASM alternative mapping
    compliance/           → Workers compliance gate tests
  engines/
    quickjs/              → QuickJSEngine + QuickJS-WASM binary
    native/               → NativeEngine + WorkerBootstrap
  loaders/
    node-compat/          → NodeCompatLoader (require + unenv)
    workers-strict/       → StrictWorkersLoader (Workers API only)
  distributions/
    catalyst/             → @aspect/catalyst (Workers target: QuickJS + StrictWorkersLoader)
    reaction/             → @aspect/reaction (Deno/Node target: Native + NodeCompatLoader)
```

### Split Rules

1. **No cross-engine imports in shared packages.** Shared packages import from `engine-interface` only. They never reference QuickJS or NativeEngine directly.

2. **Distribution packages are wiring only.** `@aspect/catalyst` imports QuickJSEngine + StrictWorkersLoader + shared packages and wires them together. `@aspect/reaction` imports NativeEngine + NodeCompatLoader + shared packages. No business logic in distribution packages.

3. **Shared packages have independent version numbers and size budgets:**
   - `engine-interface`: <5KB (types only)
   - `fs`: <30KB
   - `net`: <20KB (excluding TCP relay which is optional)
   - `dns`: <10KB
   - `proc`: <25KB
   - `pkg`: <50KB (excluding registry client which lazy-loads)
   - `dev`: <15KB (esbuild-wasm loaded lazily, not bundled)
   - `wasi`: <20KB
   - `sync`: <30KB
   - `workers`: <15KB
   - `addon-registry`: <5KB (JSON + lookup function)

4. **The split happens AFTER the engine abstraction is stable.** Don't restructure and refactor simultaneously. Phase order: extract interfaces → implement engines → split packages.

### Migration Steps

The monorepo plan specifies 6 phases for restructuring. This addendum adds one constraint: **the npm registry client (Section 3) ships inside `packages/shared/pkg/` as a lazy-loaded module.** It's not bundled into the main CatalystPkg entry point — it loads on demand when the user runs `npm install` in full mode. This keeps the default package size small while allowing full npm capabilities when needed.

---

## 6. Integration Testing — No More Mocked Networks

The base spec's Phase 7 integration tests use mock fetch with fake lodash instead of hitting real services. This must be fixed.

### Testing Tiers

**Unit tests (mocked):** Each module in isolation. Mock dependencies. Fast, deterministic, run on every change. These stay as-is.

**Integration tests (real network):** End-to-end flows that hit real services. Run in CI and on-demand locally.

**Conformance tests (Node.js test suite):** Subsets of Node.js's own test suite run against Catalyst's implementations. The gold standard for compatibility claims.

### Required Integration Tests

**Package installation (real network):**

```typescript
test('install lodash from esm.sh', async () => {
  const runtime = await Catalyst.create({ net: { allowDomains: ['esm.sh'] } });
  const result = await runtime.eval(`
    const _ = require('lodash');
    _.chunk([1, 2, 3, 4], 2);
  `);
  expect(result).toEqual([[1, 2], [3, 4]]);
});

test('install express from npm registry', async () => {
  const runtime = await Reaction.create({ net: { allowDomains: ['registry.npmjs.org'] } });
  await runtime.exec('npm install express');
  const files = await runtime.fs.readdir('/node_modules/express');
  expect(files).toContain('package.json');
  expect(files).toContain('index.js');
});
```

**DNS resolution (real DoH):**

```typescript
test('dns.resolve4 returns real IP', async () => {
  const result = await runtime.eval(`
    const dns = require('dns').promises;
    await dns.resolve4('example.com');
  `);
  expect(result).toEqual(expect.arrayContaining([expect.stringMatching(/^\d+\.\d+\.\d+\.\d+$/)]));
});
```

**HTTP server (MessagePort routing):**

```typescript
test('http.createServer serves requests', async () => {
  await runtime.eval(`
    const http = require('http');
    const server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('Hello from Catalyst');
    });
    server.listen(3000);
  `);
  
  const response = await runtime.fetch('http://localhost:3000');
  expect(await response.text()).toBe('Hello from Catalyst');
});
```

**Process pipelines:**

```typescript
test('spawn with stdout piping', async () => {
  const output = await runtime.eval(`
    const { spawn } = require('child_process');
    const child = spawn('node', ['-e', 'console.log("piped")']);
    let data = '';
    child.stdout.on('data', (chunk) => { data += chunk; });
    await new Promise(resolve => child.on('close', resolve));
    data.trim();
  `);
  expect(output).toBe('piped');
});
```

### CI Configuration

Integration tests run in a separate CI job with real network access. They're tagged `@integration` and excluded from the fast unit test suite. Flaky tests (network timeouts) use retry with exponential backoff. Test results include timing data for the benchmarking system (Section 7).

---

## 7. Performance Benchmarking

The base spec claims native V8 speed but doesn't prove it. This section specifies the benchmark suite.

### Benchmark Categories

**Engine boot time:**
- QuickJS-WASM instantiation + initialization
- Native engine Worker creation + bootstrap
- Time from `Catalyst.create()` to first `eval()`

**JavaScript execution:**
- Fibonacci(35) — CPU-bound recursive computation
- JSON.parse(10MB) — data processing
- RegExp matching over large strings — engine optimization quality
- async/await chain (1000 iterations) — promise scheduling
- `crypto.createHash('sha256')` on 1MB data — crypto path

**Filesystem operations:**
- Write 1KB file, read it back
- Write 1MB file, read it back
- Create 100 files in a directory, readdir
- Stat 100 files
- Watch file, detect change

**Package resolution:**
- `require('lodash')` cold (no cache)
- `require('lodash')` warm (OPFS cache hit)
- `npm install express` (full dependency tree, ~55 packages)

**HTTP server throughput:**
- Requests per second through MessagePort routing
- Latency: request → response round-trip

### Benchmark Format

Each benchmark produces a JSON result:

```json
{
  "name": "fibonacci_35",
  "engine": "native",
  "median_ms": 42,
  "p95_ms": 48,
  "p99_ms": 55,
  "iterations": 100,
  "timestamp": "2026-03-02T12:00:00Z",
  "browser": "Chrome/126",
  "platform": "Windows 11"
}
```

### Regression Detection

Benchmarks run in CI on every PR. Results are compared against the baseline (main branch median). Regression thresholds:

- **Boot time:** >20% regression → warning, >50% → fail
- **JS execution:** >10% regression → warning, >30% → fail
- **FS operations:** >20% regression → warning, >50% → fail
- **Package resolution:** >30% regression → warning (network variance expected)

Baseline is updated when a PR is merged to main. Historical results are stored for trend analysis.

---

## 8. Deno API Surface

The base spec's "Deno target" is really "Node target that supports URL imports." For genuine Deno compatibility — code that runs on `deno run` also runs in Catalyst — we need Deno-specific API coverage.

### What Deno Code Looks Like

```typescript
// Deno-style imports (URL-based)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";

// Deno namespace APIs
const text = await Deno.readTextFile("./config.json");
const env = Deno.env.get("API_KEY");
await Deno.writeTextFile("./output.txt", "hello");

// Deno-native patterns
Deno.serve({ port: 3000 }, (req) => new Response("Hello"));

// npm: specifier (Deno's Node compat)
import express from "npm:express@4";
```

### Deno API Coverage Plan

**Already covered by existing infrastructure:**

| Deno API | Catalyst equivalent | Notes |
|----------|-------------------|-------|
| `Deno.readTextFile()` | CatalystFS | Map to fs.readFile |
| `Deno.writeTextFile()` | CatalystFS | Map to fs.writeFile |
| `Deno.readDir()` | CatalystFS | Map to fs.readdir |
| `Deno.stat()` / `Deno.lstat()` | CatalystFS | Map to fs.stat |
| `Deno.mkdir()` | CatalystFS | Map to fs.mkdir |
| `Deno.remove()` | CatalystFS | Map to fs.unlink/rmdir |
| `Deno.rename()` | CatalystFS | Map to fs.rename |
| `Deno.cwd()` | process.cwd() | Already shimmed |
| `Deno.env` | process.env | Already shimmed |
| `Deno.exit()` | process.exit() | Already shimmed |
| `fetch()` | Native + CatalystNet proxy | Browser-native, same as Deno |
| `crypto.subtle` | WebCrypto | Browser-native, same as Deno |
| `TextEncoder` / `TextDecoder` | Browser-native | Same as Deno |
| `URL` / `URLSearchParams` | Browser-native | Same as Deno |
| `Response` / `Request` / `Headers` | Browser-native | Same as Deno |
| `ReadableStream` / `WritableStream` | Browser-native | Same as Deno |
| `AbortController` / `AbortSignal` | Browser-native | Same as Deno |
| `structuredClone()` | Browser-native | Same as Deno |

**Needs implementation:**

| Deno API | Implementation |
|----------|---------------|
| `Deno.serve()` | Wraps the HttpServer from Phase C. `Deno.serve(handler)` registers handler with PortRouter. |
| `Deno.Command` / `Deno.run()` | Maps to CatalystProc. `new Deno.Command('node', { args: ['script.js'] }).spawn()` creates Worker. |
| `Deno.permissions` | Maps to Catalyst's security model. `Deno.permissions.query({ name: 'read', path: '/tmp' })` checks CatalystFS mount permissions. |
| `Deno.connect()` / `Deno.listen()` | Maps to CatalystNet TCP bridge (Section 1.1). Same WebSocket relay pattern. |
| `Deno.resolveDns()` | Maps to CatalystDNS (Section 1.2). DoH-backed resolution. |
| `Deno.test()` | Test runner that collects test results. Maps to CatalystProc for parallel test execution. |
| `npm:` specifier | CatalystPkg resolves npm: imports via esm.sh or registry client. |
| `https://deno.land/` imports | Fetched via CatalystNet, cached in OPFS. Deno's CDN serves TypeScript directly. |
| `jsr:` specifier | JSR registry (npm-compatible). CatalystPkg resolves via https://npm.jsr.io. |

### URL Import Resolution

Deno uses URL imports instead of npm package names. CatalystPkg's module loader needs a URL import path:

```
import "https://deno.land/std@0.224.0/http/server.ts"
  │
  ├─ 1. Is it a URL import? → Yes
  ├─ 2. Check OPFS cache for URL → hit or miss
  ├─ 3. If miss, fetch URL via CatalystNet
  ├─ 4. If TypeScript (.ts), compile via esbuild-wasm
  ├─ 5. Cache compiled output in OPFS
  └─ 6. Return module
```

This is simpler than npm resolution — no dependency tree, no semver, no lockfile needed. The URL IS the version. OPFS cache key is the full URL.

### The `Deno` Global Object

In Reaction (Deno/Node target), the `Deno` global is available alongside Node globals. This matches how Deno itself works — both `Deno` and `process` are available when running in Node compat mode.

```typescript
// packages/shared/deno-compat/src/DenoGlobal.ts

const Deno = {
  // Version info
  version: { deno: '2.0.0-catalyst', v8: navigator.userAgent.match(/Chrome\/(\S+)/)?.[1] ?? 'unknown', typescript: '5.6.0' },
  
  // File system — delegates to CatalystFS
  readTextFile: (path) => catalystFS.readFile(path, 'utf-8'),
  writeTextFile: (path, data) => catalystFS.writeFile(path, data),
  readFile: (path) => catalystFS.readFile(path),  // returns Uint8Array
  writeFile: (path, data) => catalystFS.writeFile(path, data),
  readDir: (path) => catalystFS.readdir(path),
  stat: (path) => catalystFS.stat(path),
  lstat: (path) => catalystFS.lstat(path),
  mkdir: (path, options) => catalystFS.mkdir(path, options),
  remove: (path, options) => catalystFS.rm(path, options),
  rename: (oldPath, newPath) => catalystFS.rename(oldPath, newPath),
  
  // Environment — delegates to process shim
  env: { get: (key) => processShim.env[key], set: (key, val) => processShim.env[key] = val, delete: (key) => delete processShim.env[key], toObject: () => ({...processShim.env}) },
  
  // Process
  cwd: () => processShim.cwd(),
  exit: (code) => processShim.exit(code),
  pid: processShim.pid,
  
  // Network — delegates to CatalystNet
  serve: (optionsOrHandler, handler) => { /* wire to HttpServer */ },
  connect: (options) => { /* wire to TCP bridge */ },
  listen: (options) => { /* wire to HttpServer */ },
  resolveDns: (query, recordType) => { /* wire to CatalystDNS */ },
  
  // Subprocess — delegates to CatalystProc
  Command: class { /* wire to CatalystProc.spawn() */ },
  
  // Permissions — delegates to security layer
  permissions: { query: (desc) => { /* check Catalyst permissions */ }, request: (desc) => { /* prompt user */ }, revoke: (desc) => { /* revoke */ } },
  
  // Diagnostics
  memoryUsage: () => performance.measureUserAgentSpecificMemory?.() ?? { rss: 0, heapTotal: 0, heapUsed: 0 },
  
  // Build info
  build: { target: 'wasm32-unknown-unknown', arch: 'wasm32', os: 'browser', vendor: 'aspect', env: undefined },
};
```

### What Doesn't Map

- `Deno.openKv()` — Deno's built-in KV store. Could map to CatalystWorkers KV stub or OPFS-backed KV.
- `Deno.dlopen()` — FFI for native libraries. Cannot work in browser. Same limitation as Node native addons.
- `Deno.watchFs()` — Map to CatalystFS file watching (already implemented with FileSystemObserver + polling fallback).
- Deno's built-in formatter (`deno fmt`) and linter (`deno lint`) — these are Rust tools compiled into Deno CLI. In Catalyst, equivalent functionality comes from external tools (prettier, eslint) run as processes.

---

## 9. Implementation Priority

Given the base spec's Phases A–F plus this addendum's additions, here is the recommended implementation order:

1. **Phase A: Native Engine** (base spec) — the foundation everything else builds on
2. **Phase B: Tier 0 Validation** (base spec) — security before features
3. **Phase C: HTTP Server** (base spec) — unlocks Express, Fastify, Hono, dev servers
4. **Phase D: Process Pipelines** (base spec) — unlocks npm-as-process, test runners
5. **Phase G: DNS Module** (addendum §1.2) — small, self-contained, high impact
6. **Phase H: npm Registry Client** (addendum §3) — full npm install capability
7. **Phase I: Addon Registry** (addendum §4) — transparent native → WASM redirection
8. **Phase J: TCP Bridge** (addendum §1.1 Layer B) — WebSocket relay for database connections
9. **Phase K: TLS Module** (addendum §1.3) — depends on TCP bridge
10. **Phase L: Cluster Module** (addendum §2) — Worker pool + round-robin distribution
11. **Phase E: Workers Compliance Gate** (base spec) — validation for Cloudflare target
12. **Phase M: Deno API Surface** (addendum §8) — `Deno` global + URL imports
13. **Phase N: Package Split** (addendum §5) — monorepo restructuring
14. **Phase F: npm Process Runner** (base spec) — lifecycle scripts, full npm CLI emulation

Integration tests (§6) and benchmarks (§7) are not phases — they're continuous. Every phase adds its own integration tests and benchmark cases. The benchmark baseline is established during Phase A and updated with each subsequent phase.
