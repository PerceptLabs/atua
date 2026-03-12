# Fabric (Atua MCP) — Implementation Plan

**Companion to:** `atua-mcp-spec.md`
**Package:** `@aspect/atua-fabric`
**Purpose:** Execution guide for CC. The spec defines *what* to build. This defines *how* — file order, exact blockers, pre-flight checks, and the boundary conditions that will stop a phase dead if missed.

---

## Pre-Flight Checklist

Before CC begins:

```bash
# Confirm Atua substrate exists — Fabric wraps these as providers
ls packages/shared/core/src/fs/          # CatalystFS (OPFS)
ls packages/shared/core/src/wasi/        # CatalystWASI (wa-sqlite)
ls packages/shared/core/src/dev/         # BuildPipeline (esbuild)
ls packages/shared/core/src/proc/        # ProcessManager (Workers)
ls packages/shared/core/src/pkg/         # PackageManager (npm/esm.sh)
ls packages/shared/core/src/net/         # FetchProxy / HttpServer

# Confirm MCP SDK is installable
pnpm add @modelcontextprotocol/sdk@latest --dry-run

# Confirm Comlink is available (used alongside MessageChannel)
pnpm add comlink@latest --dry-run

# Confirm ArkType is available (MCP tool schema validation)
pnpm add arktype@latest --dry-run

# Confirm Service Worker infrastructure exists
grep -r "ServiceWorker\|service-worker\|sw.ts" packages/ --include="*.ts" -l

# Confirm browser test infrastructure
cat vitest.config.ts | grep "browser"
# Must have vitest-browser configured for Playwright chromium
```

**CatalystFS, CatalystD1, CatalystBuild, CatalystProc are hard blockers.** Fabric wraps them as MCP providers. If they don't exist, Fabric has nothing to register. No workaround.

**Service Worker with Hono is a blocker for Phase 4** (external surface). Phases 0–3 work without it.

---

## Package Scaffold

Before Phase 0, create the package shell:

```bash
mkdir -p packages/atua-fabric/src/{hub,transports,providers,security,composition,meta,testing}
```

`packages/atua-fabric/package.json`:
```json
{
  "name": "@aspect/atua-fabric",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "comlink": "^4",
    "arktype": "latest"
  },
  "peerDependencies": {
    "@aspect/catalyst-core": "workspace:*"
  }
}
```

`packages/atua-fabric/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

## Phase 0 — Hub Core: Registry + MessageChannel Transport

**Spec ref:** §5 (The Kernel — MCP Hub), §4 (MessageChannel transport)
**Goal:** The hub exists. Providers register. Consumers call tools. Every call is logged.
**Risk:** Low — pure TypeScript, no browser APIs beyond MessageChannel.
**Estimated session:** 1 CC session, 3-5 hrs.

### Execution order

1. **Read MCP SDK source first.** Before writing hub code, understand:
   - `@modelcontextprotocol/sdk/src/server/index.ts` — Server interface shape
   - `@modelcontextprotocol/sdk/src/types.ts` — ToolDefinition, CallToolRequest, CallToolResult
   - The SDK's tool registration pattern

2. **`src/hub/types.ts`** — Core interfaces:
   ```typescript
   interface ProviderRegistration {
     namespace: string;
     tools: ToolDefinition[];
     transport: Transport;
     capabilities?: Capabilities;
   }
   
   interface Transaction {
     id: string;
     timestamp: number;
     caller: string;
     provider: string;
     tool: string;
     args: Record<string, unknown>;
     result: ToolResult;
     duration_ms: number;
     transport: 'message_channel' | 'stdio' | 'streamable_http' | 'sse';
   }
   
   interface CallContext {
     caller: string;
     transport?: string;
   }
   
   interface ToolFilter {
     namespace?: string;
   }
   
   interface LogFilter {
     caller?: string;
     provider?: string;
     tool?: string;
     since?: number;
     limit?: number;
   }
   ```

3. **`src/transports/message-channel.ts`** — MessageChannel transport:
   - Creates a `MessagePort` pair per provider registration
   - Provider holds one port, hub holds the other
   - `postMessage` for tool calls in both directions
   - Support for Transferable objects (ArrayBuffer, ReadableStream) — zero-copy
   - Typed message protocol: `{ type: 'call', id, tool, args }` / `{ type: 'result', id, result }`

4. **`src/hub/registry.ts`** — Provider registry:
   - `Map<string, ProviderRegistration>` keyed by namespace
   - `registerProvider(reg)` — validates namespace uniqueness, stores registration
   - `unregisterProvider(namespace)` — removes, cleans up transport
   - `listTools(filter?)` — returns all tools, optionally filtered by namespace
   - `resolveProvider(toolName)` — split on first `.` to find namespace, look up provider

5. **`src/hub/transaction-log.ts`** — Transaction logging:
   - Circular buffer in memory (configurable size, default 10,000 entries)
   - Each entry: id (nanoid), timestamp, caller, provider, tool, args, result, duration_ms, transport
   - `getLog(filter?)` — query by caller, provider, tool, time range, with limit
   - Later phases persist to CatalystD1

6. **`src/hub/hub.ts`** — The hub itself:
   ```typescript
   export class MCPHub {
     private registry: ProviderRegistry;
     private log: TransactionLog;
     
     registerProvider(reg: ProviderRegistration): void;
     unregisterProvider(namespace: string): void;
     listTools(filter?: ToolFilter): ToolDefinition[];
     
     async callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult>;
     
     getLog(filter?: LogFilter): Transaction[];
     getProviderHealth(): Map<string, ProviderHealth>;
   }
   ```
   - `callTool` routing: resolve provider → dispatch via transport → log transaction → return
   - Error handling: unknown tool → clear error, provider timeout → error with context, transport failure → error with provider health

7. **`src/hub/hub.test.ts`** — Tests with two test providers:
   - `EchoProvider` — returns its input as output
   - `CounterProvider` — maintains state, increments/reads counter

### Verification gates

- [ ] Register EchoProvider, `listTools()` returns its tools
- [ ] `callTool("echo.say", { message: "hello" })` returns `{ message: "hello" }`
- [ ] Transaction log contains the call with correct timestamp, caller, duration
- [ ] Register CounterProvider, call `counter.increment` three times, `counter.read` returns 3
- [ ] Unregister EchoProvider, `listTools()` no longer includes echo tools
- [ ] `callTool("echo.say", ...)` after unregister returns clear "unknown tool" error
- [ ] Register two providers with same namespace → error (no silent override)
- [ ] `callTool` with malformed args → error propagated from provider, logged

### Commit
```
git add -A && git commit -m "Fabric Phase 0: Hub core — registry, MessageChannel transport, transaction log"
```

---

## Phase 1 — Internal Providers: CatalystFS + CatalystD1 + CatalystBuild

**Spec ref:** §6 (Internal Providers — first three)
**Goal:** Core subsystems register as MCP providers. Cross-provider routing works.
**Depends on:** Phase 0 (hub exists), Atua core packages (CatalystFS, CatalystD1, BuildPipeline)
**Risk:** Medium — wrapping real subsystems, error surface grows.
**Estimated session:** 1 CC session, 4-6 hrs.

### Execution order

1. **Read each subsystem's public API first.** Before wrapping:
   ```bash
   cat packages/shared/core/src/fs/CatalystFS.ts | grep "export\|async\|public"
   cat packages/shared/core/src/wasi/d1.ts | grep "export\|async\|public"
   cat packages/shared/core/src/dev/BuildPipeline.ts | grep "export\|async\|public"
   ```
   Map each public method to an MCP tool. Do not invent tools that the subsystem can't back.

2. **`src/providers/base-provider.ts`** — Base class for internal providers:
   ```typescript
   abstract class InternalProvider {
     abstract readonly namespace: string;
     abstract readonly tools: ToolDefinition[];
     abstract handleCall(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
     
     toRegistration(port: MessagePort): ProviderRegistration;
   }
   ```
   All internal providers extend this. The base handles transport wiring and error formatting.

3. **`src/providers/catalyst-fs.ts`** — CatalystFS provider:
   - Wraps CatalystFS instance
   - Tools: `catalyst.fs.read`, `catalyst.fs.write`, `catalyst.fs.mkdir`, `catalyst.fs.readdir`, `catalyst.fs.stat`, `catalyst.fs.unlink`, `catalyst.fs.rename`, `catalyst.fs.watch`, `catalyst.fs.search`, `catalyst.fs.glob`
   - Each tool validates args via ArkType schema, calls CatalystFS method, returns structured result
   - Error handling: file not found → clear MCP error, OPFS quota → clear MCP error

4. **`src/providers/catalyst-d1.ts`** — CatalystD1 provider:
   - Wraps CatalystD1 instance (wa-sqlite)
   - Tools: `catalyst.d1.query`, `catalyst.d1.execute`, `catalyst.d1.batch`, `catalyst.d1.tables`, `catalyst.d1.describe`
   - `catalyst.d1.query` returns rows as JSON array
   - `catalyst.d1.execute` returns affected row count
   - `catalyst.d1.batch` wraps in transaction, rollback on any failure
   - SQL injection safety: always use parameterized queries, never interpolate args into SQL

5. **`src/providers/catalyst-build.ts`** — CatalystBuild provider:
   - Wraps BuildPipeline instance
   - Tools: `catalyst.build.run`, `catalyst.build.status`, `catalyst.build.telemetry`, `catalyst.build.resolve`, `catalyst.build.analyze`
   - **Critical:** `catalyst.build.run` must read source files via the hub (`this.hub.callTool("catalyst.fs.read", ...)`) NOT via direct CatalystFS import. This proves cross-provider routing works.
   - Build telemetry includes timing breakdown, file count, bundle size, cache hit rate

6. **`src/providers/catalyst-fs.test.ts`**, **`catalyst-d1.test.ts`**, **`catalyst-build.test.ts`** — Browser tests for each.

### Verification gates

- [ ] `catalyst.fs.write({ path: "/test.txt", content: "hello" })` succeeds
- [ ] `catalyst.fs.read({ path: "/test.txt" })` returns "hello"
- [ ] `catalyst.fs.readdir({ path: "/" })` includes "test.txt"
- [ ] `catalyst.fs.stat({ path: "/test.txt" })` returns size and modified time
- [ ] `catalyst.d1.execute({ sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)" })` succeeds
- [ ] `catalyst.d1.execute({ sql: "INSERT INTO t (name) VALUES (?)", params: ["test"] })` returns 1 affected
- [ ] `catalyst.d1.query({ sql: "SELECT * FROM t" })` returns `[{ id: 1, name: "test" }]`
- [ ] `catalyst.d1.tables()` includes "t" with its schema
- [ ] `catalyst.build.run()` triggers build that reads source via `catalyst.fs.read` through the hub
- [ ] Transaction log shows the cross-provider call chain: build.run → fs.read → fs.read → ...
- [ ] Error case: `catalyst.fs.read({ path: "/nonexistent" })` returns structured MCP error
- [ ] Error case: `catalyst.d1.query({ sql: "INVALID SQL" })` returns structured MCP error

### Commit
```
git add -A && git commit -m "Fabric Phase 1: CatalystFS, CatalystD1, CatalystBuild as MCP providers"
```

---

## Phase 2 — Remaining Internal Providers: Proc, Pkg, Net, Preview, Telemetry, Meta

**Spec ref:** §6 (remaining providers), §7 (V8 instrumentation)
**Goal:** Full internal surface. Every subsystem is an MCP provider.
**Depends on:** Phase 1 (pattern established)
**Risk:** Medium — Preview and Telemetry need real iframe/DOM access.
**Estimated session:** 1-2 CC sessions, 6-10 hrs.

### Execution order

1. **`src/providers/catalyst-proc.ts`** — Process provider:
   - Tools: `catalyst.proc.spawn`, `catalyst.proc.kill`, `catalyst.proc.list`, `catalyst.proc.stdin`, `catalyst.proc.stdout`, `catalyst.proc.wait`
   - Wraps ProcessManager's Worker-based isolation
   - `spawn` returns pid, `wait` blocks until exit with timeout
   - `stdin`/`stdout` handle string data (binary via base64)

2. **`src/providers/catalyst-pkg.ts`** — Package provider:
   - Tools: `catalyst.pkg.install`, `catalyst.pkg.resolve`, `catalyst.pkg.list`, `catalyst.pkg.search`, `catalyst.pkg.outdated`
   - Wraps PackageManager's npm resolver + esm.sh CDN fetching
   - `install` triggers resolution + download + OPFS cache
   - `resolve` returns where a specifier points (esm.sh URL or OPFS path)

3. **`src/providers/catalyst-net.ts`** — Network provider:
   - Tools: `catalyst.net.fetch`, `catalyst.net.routes`, `catalyst.net.serve`
   - Wraps FetchProxy + Hono route registration
   - `fetch` delegates to browser `fetch()` with FetchProxy's allowlist/blocklist

4. **`src/providers/catalyst-preview.ts`** — Preview provider:
   - Tools: `catalyst.preview.start`, `catalyst.preview.stop`, `catalyst.preview.screenshot`, `catalyst.preview.dom.query`, `catalyst.preview.dom.queryAll`, `catalyst.preview.dom.measure`, `catalyst.preview.dom.accessibility`, `catalyst.preview.dom.mutations`, `catalyst.preview.metrics`, `catalyst.preview.console`, `catalyst.preview.errors`
   - **This is the differentiator.** Real DOM inspection, not vision model interpretation.
   - `dom.query` uses `querySelector` + `getComputedStyle` + `getBoundingClientRect` + accessibility tree walker
   - `metrics` uses `PerformanceObserver` for real Web Vitals (LCP, FID, CLS)
   - `console` and `errors` capture from iframe's console and error handlers
   - **Requires real iframe in browser test.** Node-only tests cannot verify these.

5. **`src/providers/catalyst-telemetry.ts`** — V8 instrumentation provider:
   - Tools: `catalyst.telemetry.webvitals`, `catalyst.telemetry.resources`, `catalyst.telemetry.memory`, `catalyst.telemetry.marks`, `catalyst.telemetry.layout`, `catalyst.telemetry.build`, `catalyst.telemetry.runtime`
   - Wraps real browser Performance API, PerformanceObserver, ResizeObserver
   - `memory` uses `performance.measureUserAgentSpecificMemory()` (Chrome 89+)
   - `resources` uses `performance.getEntriesByType('resource')`
   - `runtime` aggregates: console count, error count, network requests, DOM mutations, FPS, long tasks

6. **`src/providers/catalyst-meta.ts`** — Self-description provider:
   - Tools: `catalyst.meta.capabilities`, `catalyst.meta.server_health`, `catalyst.meta.install_server`, `catalyst.meta.register_composite`, `catalyst.meta.create_server_from_template`
   - `capabilities` returns: all loaded providers, tool counts per provider, transport types, Atua version
   - `server_health` returns status of all providers: `idle | starting | ready | error | stopped`
   - `install_server` and `create_server_from_template` defer to Phase 3 and Phase 6 respectively (stub with clear error until then)

### Verification gates

- [ ] `catalyst.proc.spawn({ command: "node", args: ["-e", "console.log('hi')"] })` returns pid
- [ ] `catalyst.proc.wait({ pid })` returns exit code 0 and stdout "hi"
- [ ] `catalyst.pkg.install({ specifier: "lodash" })` resolves and reports version
- [ ] `catalyst.pkg.list()` includes installed package
- [ ] `catalyst.net.fetch({ url: "https://httpbin.org/get" })` returns response
- [ ] `catalyst.preview.start()` returns preview URL
- [ ] `catalyst.preview.dom.query({ selector: "body" })` returns tag, computedStyles, boundingRect
- [ ] `catalyst.preview.metrics()` returns LCP and CLS values
- [ ] `catalyst.preview.console()` returns console entries from preview iframe
- [ ] `catalyst.telemetry.webvitals()` returns real Web Vitals data
- [ ] `catalyst.telemetry.memory()` returns heap usage (Chrome only — skip in non-Chrome)
- [ ] `catalyst.telemetry.runtime()` returns aggregated runtime data
- [ ] `catalyst.meta.capabilities()` lists all providers with correct tool counts

### Commit
```
git add -A && git commit -m "Fabric Phase 2: Full internal provider surface — proc, pkg, net, preview, telemetry, meta"
```

---

## Phase 3 — stdio Transport: Local MCP Server Hosting

**Spec ref:** §4 (stdio transport), §8 (Local MCP Server Hosting)
**Goal:** Run existing npm MCP servers inside browser Workers. The entire stdio ecosystem works.
**Depends on:** Phase 2 (CatalystProc provider), CatalystPkg (package resolution)
**Risk:** High — MCP server compat depends on unenv coverage. Servers with native deps will fail.
**Estimated session:** 1-2 CC sessions, 5-8 hrs.

### Execution order

1. **`src/transports/stdio.ts`** — stdio transport adapter:
   - Wraps CatalystProc's MessageChannel-backed stdin/stdout streams
   - Implements MCP JSON-RPC over streams (line-delimited JSON)
   - Request → write to stdin → read from stdout → parse response
   - Handles: initialization handshake, tool discovery, tool calls, shutdown notification
   - Timeout: 30s per call (configurable), Worker.terminate() on timeout

2. **`src/hub/server-manager.ts`** — Server lifecycle:
   ```typescript
   interface ServerConfig {
     name: string;
     source: string;                    // npm:pkg, git:url, local:path
     env?: Record<string, string>;
     capabilities: Capabilities;
   }
   
   class ServerManager {
     async install(config: ServerConfig): Promise<void>;
     async start(name: string): Promise<void>;
     async stop(name: string): Promise<void>;
     async restart(name: string): Promise<void>;
     getStatus(name: string): ServerStatus;
     getAllStatus(): Map<string, ServerStatus>;
   }
   ```
   - **Lazy initialization:** Server starts on first tool call, not at registration
   - Install: CatalystPkg resolves source → downloads → OPFS cache
   - Start: CatalystProc spawns Worker → stdio transport connects → discover tools → register on hub
   - Capability gating: Worker created with only the permissions declared in config
   - Hot reload for `local:` sources: CatalystFS watch → stop → rebuild → restart → re-register

3. **`src/security/capability-gate.ts`** — Capability enforcement:
   ```typescript
   function createCapabilityGate(caps: Capabilities): CapabilityGate {
     return {
       checkFs(path: string, write: boolean): boolean;
       checkNetwork(domain: string): boolean;
       checkDb(db: string): boolean;
       checkProc(op: string): boolean;
     };
   }
   ```
   - Gate sits between the hub and the server's Worker
   - Every call from the server to an internal tool is intercepted
   - If the call violates declared capabilities → reject with `PermissionError`
   - Checked at dispatch time, not registration time

4. **`src/hub/server-config-schema.ts`** — Server configuration validation:
   - ArkType schema for server config JSON
   - Validates: source format, capability declarations, env var patterns
   - Used by `catalyst.meta.install_server`

5. **Test with a real MCP server.** Write a minimal test MCP server (~30 lines) that registers one tool, responds to calls:
   ```typescript
   // test/fixtures/test-mcp-server.ts
   // Reads from stdin, writes to stdout, implements MCP JSON-RPC
   // Registers tool "test.greet" that returns "Hello, {name}!"
   ```

### Verification gates

- [ ] Install test MCP server from local CatalystFS source
- [ ] Server spawns in Worker, stdio transport connects
- [ ] Hub discovers server's tools via stdio handshake
- [ ] `test.greet({ name: "world" })` returns "Hello, world!" through the hub
- [ ] Transaction log shows the call with transport: "stdio"
- [ ] Capability gate: server with `fs: "none"` calling `catalyst.fs.read` → PermissionError
- [ ] Capability gate: server with `network: ["api.github.com"]` calling fetch to other domain → PermissionError
- [ ] Server shutdown: send shutdown notification, verify Worker terminates
- [ ] Lazy start: register server config, first call triggers start, second call is instant
- [ ] Hot reload: modify local server source → CatalystFS watch fires → server restarts → tools re-register
- [ ] Server health: `catalyst.meta.server_health()` returns status for all servers

### Commit
```
git add -A && git commit -m "Fabric Phase 3: stdio transport — local MCP server hosting in Workers"
```

---

## Phase 4 — StreamableHTTP Transport: External MCP Surface

**Spec ref:** §4 (StreamableHTTP transport), §9 (External MCP Surface)
**Goal:** External clients connect to Atua as an MCP server. Browser tab IS the server.
**Depends on:** Phase 2 (all internal providers), Service Worker with Hono
**Risk:** Medium — Service Worker routing, CORS, auth middleware.
**Estimated session:** 1 CC session, 4-6 hrs.

### Execution order

1. **`src/transports/streamable-http.ts`** — StreamableHTTP server transport:
   - Uses `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`
   - Receives HTTP requests from Hono, feeds them to the transport
   - Transport calls back into the hub for tool dispatch
   - Handles: tool discovery, tool calls, streaming responses

2. **`src/transports/sse.ts`** — SSE fallback transport:
   - For clients that can't use StreamableHTTP (older MCP SDK versions)
   - SSE endpoint at `/mcp/sse`
   - Same hub dispatch, different response format

3. **`src/hub/external-surface.ts`** — External endpoint integration:
   ```typescript
   class ExternalSurface {
     constructor(hub: MCPHub, config: ExternalConfig);
     
     // Returns Hono middleware for mounting on the Service Worker app
     middleware(): MiddlewareHandler;
     
     // Policy: which tools external clients can see
     setPolicy(policy: ExternalPolicy): void;
   }
   ```
   - Mounts at `/mcp` (StreamableHTTP), `/mcp/sse` (SSE), `/mcp/tools` (discovery), `/mcp/health`
   - Filters tool list per external policy before returning to clients
   - Logs external client identity in transaction log

4. **`src/security/auth-middleware.ts`** — Authentication:
   - Bearer token validation via Hono middleware
   - Tokens stored encrypted in IndexedDB (chacha20poly1305 + PBKDF2)
   - Optional: disabled by default for local-only development
   - Rate limiting: configurable calls-per-minute per client

5. **`src/security/external-policy.ts`** — Tool filtering for external clients:
   ```typescript
   interface ExternalPolicy {
     allow?: string[];    // glob patterns: "catalyst.fs.*"
     deny?: string[];     // glob patterns: "catalyst.proc.spawn"
   }
   ```
   - Applied on every `listTools()` and `callTool()` from external clients
   - Deny overrides allow

6. **`src/hub/external-surface.test.ts`** — Test with MCP SDK client:
   - Spin up Hono app with external surface mounted
   - Connect using `@modelcontextprotocol/sdk` StreamableHTTP client
   - Verify full round-trip: discover → call → result

### Verification gates

- [ ] External MCP client connects via StreamableHTTP to `/mcp`
- [ ] Client `listTools()` returns all non-denied tools
- [ ] Client `callTool("catalyst.fs.read", { path: "/test.txt" })` returns file contents
- [ ] Client `callTool("catalyst.build.run")` returns build result
- [ ] Client `callTool("catalyst.preview.dom.query", { selector: "body" })` returns DOM data
- [ ] Policy: denied tool returns PermissionError
- [ ] Auth: request without token rejected (when auth enabled)
- [ ] Auth: request with valid token succeeds
- [ ] Rate limit: exceeding calls-per-minute returns 429
- [ ] SSE fallback: client connects via `/mcp/sse`, receives events
- [ ] Health: GET `/mcp/health` returns provider status
- [ ] Transaction log: external calls logged with client identity

### Commit
```
git add -A && git commit -m "Fabric Phase 4: StreamableHTTP — external MCP surface via Hono"
```

---

## Phase 5 — Pi.dev Integration

**Spec ref:** §10 (Pi.dev Integration)
**Goal:** Pi runs inside Atua as both MCP consumer and provider.
**Depends on:** Phase 1-2 (all internal providers), Pi packages installable
**Risk:** Medium — Pi package browser compat, esm.sh resolution.
**Estimated session:** 1 CC session, 4-6 hrs.

### Execution order

1. **Verify Pi packages load in browser.** Before writing any integration:
   ```bash
   # In browser console or test
   await import('https://esm.sh/@mariozechner/pi-ai')
   await import('https://esm.sh/@mariozechner/pi-agent-core')
   ```
   If these fail, stop. Debug the import chain before proceeding.

2. **`src/providers/pi-consumer.ts`** — Pi agent wired to hub:
   ```typescript
   async function createPiAgent(hub: MCPHub, config: PiConfig): Promise<AgentSession> {
     const tools = await hub.listTools();
     // Convert MCP tools to Pi tool format
     const piTools = tools.map(mcpToolToPiTool);
     
     const session = await createAgentSession({
       model: config.model,
       tools: piTools,
       // Tool execution goes through the hub
       // ... session config
     });
     
     return session;
   }
   ```
   - Converts MCP tool definitions to Pi's `ToolDefinition` format
   - Tool execution: Pi calls tool → adapter calls `hub.callTool()` → result converted back
   - Model: configurable via `PiConfig` (API key, provider, model name)

3. **`src/providers/pi-provider.ts`** — Pi registered as MCP provider:
   - Namespace: `pi`
   - Tools: `pi.prompt`, `pi.session.list`, `pi.session.history`, `pi.memory.search`, `pi.memory.store`, `pi.extensions.list`, `pi.status`
   - `pi.prompt` sends message to Pi agent, streams response back
   - `pi.status` returns current agent state: idle/thinking/calling tools

4. **`src/providers/pi-memory.ts`** — Pi memory backed by CatalystD1:
   ```sql
   CREATE TABLE pi_memories (
     id TEXT PRIMARY KEY,
     content TEXT NOT NULL,
     importance REAL DEFAULT 0.5,
     access_count INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_accessed INTEGER NOT NULL
   );
   CREATE VIRTUAL TABLE pi_memories_fts USING fts5(content, content=pi_memories, content_rowid=rowid);
   ```
   - `pi.memory.store` inserts with FTS5 indexing
   - `pi.memory.search` uses FTS5 for keyword search, ranks by importance * recency
   - Importance decay: accessed memories get boosted, unused memories decay over time
   - Auto-compaction: when entries exceed threshold (configurable, default 10,000), prune lowest-importance

5. **`src/providers/pi-session.ts`** — Pi session persistence:
   - Backs Pi's `SessionManager` interface with CatalystFS (OPFS)
   - Sessions stored as JSON files in `/.pi/sessions/`
   - `pi.session.list` returns all session files with metadata
   - `pi.session.history` returns conversation history for a session

### Verification gates

- [ ] Pi agent boots inside Atua, discovers all hub tools
- [ ] Pi agent calls `catalyst.fs.read({ path: "/package.json" })` through hub, receives content
- [ ] Pi agent calls `catalyst.build.run()`, build succeeds
- [ ] Pi agent calls `catalyst.d1.query()`, receives SQL results
- [ ] External client calls `pi.prompt({ message: "Hello" })`, receives agent response
- [ ] External client calls `pi.status()`, returns current agent state
- [ ] `pi.memory.store({ content: "React uses JSX" })` persists to CatalystD1
- [ ] `pi.memory.search({ query: "React" })` finds the stored memory
- [ ] `pi.session.list()` returns available sessions
- [ ] Memory importance decay: store 5 entries, access 2, verify accessed ones rank higher in search
- [ ] Pi's tool list includes all hub tools (catalyst.*, pi.memory.*, any installed servers)

### Commit
```
git add -A && git commit -m "Fabric Phase 5: Pi.dev integration — consumer + provider + memory + sessions"
```

---

## Phase 6 — Composition Engine + Server Templates

**Spec ref:** §11 (Tool Composition), §14 (MCP Server Templates)
**Goal:** Composite tools and runtime server generation.
**Depends on:** Phase 3 (server hosting works), Phase 2 (all providers)
**Risk:** Medium — composition error handling, template code generation.
**Estimated session:** 1 CC session, 4-6 hrs.

### Execution order

1. **`src/composition/chain.ts`** — Sequential composition:
   - Takes array of steps: `{ tool, args?, mapResult? }`
   - Executes in order, each step's result available to next via `mapResult` function
   - If any step fails: abort chain, return error with step index and context
   - Registers the composite as a single tool on the hub

2. **`src/composition/fanout.ts`** — Parallel composition:
   - Takes array of steps, executes all via `Promise.all`
   - Returns combined results keyed by tool name
   - If any fails: returns partial results with error markers (don't abort all)

3. **`src/composition/dynamic.ts`** — Runtime composite registration:
   - `catalyst.meta.register_composite` tool: accepts chain or fanout definition
   - Agent defines composite at runtime, hub registers it, immediately callable
   - Stores composite definition in CatalystD1 for persistence across reloads
   - Security: composite inherits the most restrictive capability set from its steps

4. **`src/meta/server-templates.ts`** — Server template system:
   - `catalyst.meta.create_server_from_template` tool
   - Database template: generates MCP server wrapping CatalystD1 with typed CRUD tools per table
   - File-watcher template: generates MCP server watching CatalystFS paths, exposes change-feed tools
   - Custom template: agent writes server code to CatalystFS, `catalyst.meta.install_server` runs it

5. **`src/meta/install-server.ts`** — Wire `catalyst.meta.install_server`:
   - Validates server source (npm, git, local)
   - Delegates to ServerManager from Phase 3
   - Returns list of registered tools

### Verification gates

- [ ] Chain composite: `build_and_check` calls build → preview → metrics, returns combined result
- [ ] Fan-out composite: `project_status` calls fs.readdir + pkg.list + build.status in parallel
- [ ] Dynamic composite: agent registers `my_workflow.check`, calls it, works
- [ ] Dynamic composite persists: register → reload → still callable
- [ ] Database template: generate server for table "users", query through it
- [ ] File-watcher template: generate server watching `src/`, modify file, server reports change
- [ ] Agent writes custom server code to CatalystFS, installs it, calls its tools
- [ ] Composite capability inheritance: chain including `catalyst.proc.spawn` restricted when caller lacks proc capability

### Commit
```
git add -A && git commit -m "Fabric Phase 6: Composition engine + server templates"
```

---

## Phase Dependencies

```
Phase 0 (Hub Core) ──→ Phase 1 (FS, D1, Build) ──→ Phase 2 (All providers)
                                                          │
                                                          ├──→ Phase 3 (stdio servers)
                                                          │          │
                                                          ├──→ Phase 4 (external surface)
                                                          │
                                                          └──→ Phase 5 (Pi integration)
                                                                   │
Phase 3 + Phase 5 ──→ Phase 6 (composition + templates)
```

- Phase 0 blocks everything — no hub, no Fabric
- Phase 1 blocks Phase 2 — pattern established, extended
- Phases 3, 4, 5 are independent of each other (all depend on Phase 2)
- Phase 6 depends on Phase 3 (server hosting) and Phase 5 (Pi needs composites)

---

## Session Estimates

| Phase | Sessions | Hours | Scope |
|---|---|---|---|
| 0 | 1 | 3-5 | Hub + MessageChannel + logging |
| 1 | 1 | 4-6 | FS + D1 + Build providers |
| 2 | 1-2 | 6-10 | Proc + Pkg + Net + Preview + Telemetry + Meta |
| 3 | 1-2 | 5-8 | stdio transport + server hosting |
| 4 | 1 | 4-6 | StreamableHTTP + auth + policy |
| 5 | 1 | 4-6 | Pi consumer + provider + memory |
| 6 | 1 | 4-6 | Composition + templates |

**Total: 7-9 CC sessions, ~30-47 hrs**

---

## CC Kickoff Prompts

### Phase 0

```
Read atua-mcp-spec.md (§1-§5) and fabric-implementation-plan.md Phase 0.
This is the MCP hub — the kernel that routes all tool calls in Atua.

Implement Phase 0 only. The hub, MessageChannel transport, registry,
transaction log, and two test providers (echo + counter).

Read @modelcontextprotocol/sdk source first to understand ToolDefinition
and CallToolResult shapes. Match them exactly.

Do not implement providers, stdio, StreamableHTTP, or Pi integration.
Phase 0 only.

Commit: git add -A && git commit -m "Fabric Phase 0: Hub core — registry, MessageChannel transport, transaction log"
```

### Phases 1-6

```
Continue with Fabric Phase {N} per fabric-implementation-plan.md.
Read the corresponding spec sections listed in the phase header.
Run every verification gate before committing.
git add -A && git commit -m "Fabric Phase {N}: {description}"
```

---

## Conflict Resolutions

1. **Tool name format:** Spec §5 uses `{namespace}.{tool}`. Implementation uses this exactly. No shorthand, no aliases. `catalyst.fs.read` is the only way to call it.

2. **Transaction log storage:** In-memory circular buffer for Phase 0. Phase 1+ can optionally persist to CatalystD1 if available. Memory buffer is always the primary (fast), D1 is backup (durable).

3. **MCP SDK version:** Pin to latest stable. The SDK's `ToolDefinition` and `CallToolResult` types are the source of truth for tool schemas. If the spec disagrees with the SDK types, the SDK wins.

4. **Provider error format:** All provider errors return MCP-standard error objects with `code` and `message`. Internal errors (OPFS quota, wa-sqlite crash) are wrapped — never leak raw browser errors to consumers.

5. **Pi package source:** npm via pnpm workspace dependency. esm.sh as fallback for browser-only contexts where pnpm isn't available. Pin versions in package.json — do not use `latest` in production.
