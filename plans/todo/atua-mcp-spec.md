# Atua MCP Specification

**Codename:** Fabric  
**Status:** Draft  
**Date:** 2026-03-03  
**Depends on:** Atua Phase 13 complete (648 tests, 96.2% Node.js compat)

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Why MCP as Kernel Protocol](#2-why-mcp-as-kernel-protocol)
3. [Architecture Overview](#3-architecture-overview)
4. [Three Transports](#4-three-transports)
5. [The Kernel — MCP Hub](#5-the-kernel--mcp-hub)
6. [Internal Providers](#6-internal-providers)
7. [V8 Instrumentation Provider](#7-v8-instrumentation-provider)
8. [Local MCP Server Hosting](#8-local-mcp-server-hosting)
9. [External MCP Surface](#9-external-mcp-surface)
10. [Pi.dev Integration](#10-pidev-integration)
11. [Tool Composition Engine](#11-tool-composition-engine)
12. [Security Model](#12-security-model)
13. [Offline & Caching](#13-offline--caching)
14. [MCP Server Templates](#14-mcp-server-templates)
15. [Testing Strategy](#15-testing-strategy)
16. [Implementation Phases](#16-implementation-phases)
17. [CC Kickoff Prompts](#17-cc-kickoff-prompts)
18. [Risk Assessment](#18-risk-assessment)
19. [Cleanroom Protocol](#19-cleanroom-protocol)

---

## 1. What This Is

MCP is Atua's kernel protocol. Every subsystem — filesystem, database, build pipeline, process manager, networking, preview, telemetry — registers as an MCP tool provider with a central hub. Every consumer — internal agents, locally hosted MCP servers, external clients connecting from outside the browser — interacts with those subsystems through the same MCP interface.

This is not an MCP client bolted onto a runtime. The runtime itself IS an MCP system. Internal wiring between subsystems, local server execution, and external access are three scopes of the same protocol — not three different systems.

### What You Get

- Every subsystem interaction is an explicit, logged MCP tool call
- The entire stdio MCP server ecosystem runs unmodified inside browser Workers
- External tools (Claude Desktop, other agents, test harnesses) connect to Atua and drive it via MCP
- Pi.dev's agent framework plugs in as an internal consumer and provider with zero custom adapter code
- Real V8 browser instrumentation (Web Vitals, DOM inspection, Performance API) exposed as MCP tools
- Any subsystem is independently swappable, testable, mockable, and remoteable

### What This Is NOT

- Not a client-only MCP integration (connecting to external servers and calling their tools)
- Not a wrapper around existing MCP SDKs with browser polyfills
- Not dependent on any specific agent framework
- Not a simulation layer — tools return real data from real browser APIs

---

## 2. Why MCP as Kernel Protocol

Traditional runtime architectures wire subsystems together with direct imports. CatalystBuild imports CatalystFS to read source files. Preview imports CatalystBuild to get bundles. Each subsystem knows about the others. Testing requires mocking imports. Swapping implementations means touching every consumer. The dependency graph is implicit — hidden in import statements across dozens of files.

MCP as the kernel protocol inverts this. No subsystem imports any other. Each registers tools with the hub. Each calls tools through the hub. The dependency graph is the MCP call log — explicit, inspectable, replayable.

**Uniform interface.** Internal tools and external tools look identical to any consumer. `catalyst.fs.read` and `github.search_repos` are the same shape — a name, a description, a JSON schema for parameters, a callable function. An agent doesn't branch on "is this built-in or remote."

**Inspectability.** Every tool call through the hub is a logged transaction with timestamp, caller, provider, parameters, result, and duration. Replay any session by replaying its call log. Debug anything by reading the transaction history. This is structural — not instrumentation you add but a consequence of the architecture.

**Swappability.** Replace CatalystFS with a different filesystem implementation. As long as it registers the same `catalyst.fs.*` tools with the same schemas, nothing else changes. Replace esbuild-wasm with Rolldown. Register the same `catalyst.build.*` tools. Everything works.

**Testability.** Mock any subsystem by registering a fake provider with canned responses. Test the build system without a real filesystem. Test the preview without a real build. Test an agent without any real subsystems. The MCP boundary is the natural mock boundary.

**Composability.** Subsystems call each other through the hub. CatalystBuild calls `catalyst.fs.read` to get source files. Preview calls `catalyst.build.run` to get bundles. Every cross-subsystem interaction is an explicit tool call, not a hidden import.

**Remote-ability.** Since it's all MCP, any subsystem could run on a different machine. CatalystBuild running Rolldown on a beefy server. The tool call goes over StreamableHTTP instead of MessageChannel. Same interface, different transport. Hybrid local/remote execution without architectural changes.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  External MCP Clients                                    │
│  (Claude Desktop, Claude Code, other Atua instances,     │
│   test harnesses, any MCP-compatible tool)                │
│                                                           │
│  Connect via StreamableHTTP (Hono in Service Worker)      │
└────────────────────┬──────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Atua Kernel — MCP Hub                    │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   Registry                           │ │
│  │  Maps tool names → providers                         │ │
│  │  Routes calls to correct provider + transport        │ │
│  │  Logs every transaction                              │ │
│  └──────────┬──────────────┬──────────────┬─────────────┘ │
│             │              │              │               │
│  ┌──────────┴──┐ ┌────────┴────┐ ┌───────┴───────┐      │
│  │  Internal   │ │   Local     │ │   External    │      │
│  │  Providers  │ │   Servers   │ │   Servers     │      │
│  │             │ │             │ │               │      │
│  │ MessageCh.  │ │ stdio via   │ │ StreamableHTTP│      │
│  │ transport   │ │ CatalystProc│ │ or SSE        │      │
│  └─────────────┘ └─────────────┘ └───────────────┘      │
│                                                           │
│  Internal Providers:                                      │
│    CatalystFS · CatalystD1 · CatalystBuild                │
│    CatalystProc · CatalystPkg · CatalystNet               │
│    Preview · Telemetry · Pi.dev Agent                     │
│                                                           │
│  Local Servers (in Workers):                              │
│    Any stdio MCP server from npm, running unmodified      │
│                                                           │
│  External Servers (over network):                         │
│    GitHub · Supabase · Notion · any remote MCP server     │
│                                                           │
│  Internal Consumers:                                      │
│    Pi.dev agent loop · Quality gates · Visual review      │
│    Any code running inside Atua                           │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

**Internal tool call (subsystem → subsystem):**
1. CatalystBuild needs source files
2. Calls `catalyst.fs.read("src/App.tsx")` through hub
3. Hub routes to CatalystFS provider via MessageChannel
4. CatalystFS reads from OPFS, returns content
5. Hub logs the transaction, returns result to CatalystBuild

**Local MCP server tool call:**
1. Agent calls `github.search_repos({ query: "react" })`
2. Hub identifies `github` as a local MCP server running in a Worker
3. Routes call via stdio (MessageChannel pipes) to the Worker
4. MCP server processes the call, returns result via stdout pipe
5. Hub logs the transaction, returns result to agent

**External client tool call:**
1. Claude Desktop connects to Atua's StreamableHTTP endpoint
2. Calls `catalyst.build.run()`
3. Hono in Service Worker receives the HTTP request
4. Routes to hub, hub routes to CatalystBuild provider
5. CatalystBuild runs esbuild-wasm, returns build result + telemetry
6. Hub logs the transaction, Hono returns HTTP response

All three flows go through the same hub. Same logging. Same routing. Same schemas. Different transports.

---

## 4. Three Transports

### MessageChannel — Internal Fabric

For subsystems within the same Atua instance talking to each other. Zero serialization overhead for transferable objects. Direct Worker-to-Worker communication. Lowest possible latency.

Used by: internal providers, internal consumers (Pi agent, quality gates), subsystem-to-subsystem calls.

```typescript
interface MessageChannelTransport {
  // Provider side: listen for calls
  onToolCall(handler: (call: ToolCall) => Promise<ToolResult>): void;
  
  // Consumer side: make calls
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  listTools(): Promise<ToolDefinition[]>;
  
  // Underlying: MessagePort pair
  readonly port: MessagePort;
}
```

The hub creates a MessagePort pair for each provider registration. The provider holds one port, the hub holds the other. Tool calls are `postMessage` in both directions. Transferable objects (ArrayBuffer, ReadableStream) move zero-copy.

### stdio — Local MCP Servers

For MCP servers running inside CatalystProc Workers. The server reads JSON-RPC from `process.stdin` and writes JSON-RPC to `process.stdout`. CatalystProc provides these as MessageChannel-backed ReadableStream and WritableStream. The server doesn't know it's in a browser.

Used by: the entire existing ecosystem of stdio MCP servers (filesystem, GitHub, database, etc.) running unmodified inside Atua Workers.

```typescript
interface StdioTransport {
  // CatalystProc provides these to the Worker
  stdin: ReadableStream<Uint8Array>;   // MessagePort readable
  stdout: WritableStream<Uint8Array>;  // MessagePort writable
  stderr: WritableStream<Uint8Array>;  // MessagePort writable (for logging)
  
  // Hub reads/writes JSON-RPC over these streams
  // MCP SDK's stdio client works unmodified
}
```

CatalystProc already implements this. Worker MessagePorts produce exactly the stream interfaces the MCP SDK expects. The transport is the process isolation layer — each server runs in its own Worker with its own capability-gated access to Atua primitives.

### StreamableHTTP — External Surface

For external clients connecting to Atua from outside the browser. Hono in the Service Worker handles the HTTP endpoint. The MCP SDK's StreamableHTTPServerTransport handles the protocol layer. External clients use standard MCP SDK clients to connect.

Used by: Claude Desktop, Claude Code, other Atua instances, test harnesses, any MCP-compatible tool connecting from outside.

```typescript
// Hono route in Service Worker
import { Hono } from 'hono';
import { handle } from 'hono/service-worker';

const app = new Hono();

// MCP endpoint
app.post('/mcp', async (c) => {
  // StreamableHTTPServerTransport handles JSON-RPC
  // Routes to hub, hub routes to provider
  return hub.handleHTTP(c.req.raw);
});

// SSE fallback for clients that need it
app.get('/mcp/sse', async (c) => {
  return hub.handleSSE(c.req.raw);
});

self.addEventListener('fetch', handle(app));
```

The Service Worker intercepts requests to the MCP endpoint. Hono routes them. The hub handles them. External clients see a standard MCP server. They don't know the "server" is a browser tab.

---

## 5. The Kernel — MCP Hub

The hub is the center of Atua's MCP architecture. It maintains the registry of providers, routes tool calls, manages transports, and logs every transaction.

### Registry

```typescript
interface MCPHub {
  // Provider management
  registerProvider(provider: ProviderRegistration): void;
  unregisterProvider(namespace: string): void;
  
  // Tool discovery (used by consumers and external clients)
  listTools(filter?: ToolFilter): ToolDefinition[];
  
  // Tool dispatch (the core routing function)
  callTool(name: string, args: Record<string, unknown>, context: CallContext): Promise<ToolResult>;
  
  // Transaction log
  getLog(filter?: LogFilter): Transaction[];
  
  // Transport handlers
  handleHTTP(request: Request): Promise<Response>;  // StreamableHTTP
  handleSSE(request: Request): Response;             // SSE fallback
  
  // Health
  getProviderHealth(): Map<string, ProviderHealth>;
}

interface ProviderRegistration {
  namespace: string;              // e.g. "catalyst.fs", "catalyst.build", "pi"
  tools: ToolDefinition[];        // tools this provider exposes
  transport: Transport;           // how to reach this provider
  capabilities?: Capabilities;    // what this provider can access
}

interface Transaction {
  id: string;
  timestamp: number;
  caller: string;                 // who made the call
  provider: string;               // who handled it
  tool: string;                   // full namespaced tool name
  args: Record<string, unknown>;  // input
  result: ToolResult;             // output
  duration_ms: number;            // how long it took
  transport: 'message_channel' | 'stdio' | 'streamable_http' | 'sse';
}
```

### Routing Logic

When `callTool("catalyst.fs.read", { path: "src/App.tsx" })` arrives:

1. Split on first `.` separator to find namespace: `catalyst.fs`
2. Look up provider registration for `catalyst.fs`
3. Determine transport from registration (MessageChannel for internal providers)
4. Dispatch call over the transport
5. Wait for result
6. Log the transaction
7. Return result to caller

For external tool calls like `github.search_repos`, the namespace `github` maps to a local MCP server running in a Worker. The transport is stdio. The dispatch goes over the Worker's MessageChannel pipes.

### Namespacing

Tool names are hierarchical: `{provider_namespace}.{tool_name}`

Internal providers use the `catalyst.*` prefix:
- `catalyst.fs.read`, `catalyst.fs.write`, `catalyst.fs.watch`
- `catalyst.build.run`, `catalyst.build.status`
- `catalyst.preview.start`, `catalyst.preview.dom.query`
- `catalyst.d1.query`, `catalyst.d1.execute`

Pi uses the `pi.*` prefix:
- `pi.prompt`, `pi.session.list`, `pi.memory.search`

Local and external MCP servers use their configured name:
- `github.search_repos`, `github.create_issue`
- `supabase.query`, `supabase.insert`

No collisions. Every tool has a globally unique name within the hub.

### Self-Description

```typescript
// Any consumer or external client can discover the full surface
const tools = hub.listTools();
// Returns every tool from every provider:
// catalyst.fs.read, catalyst.fs.write, catalyst.build.run,
// pi.prompt, github.search_repos, ...

// Filter by namespace
const fsTools = hub.listTools({ namespace: "catalyst.fs" });

// Capabilities endpoint for external clients
hub.registerProvider({
  namespace: "catalyst.meta",
  tools: [{
    name: "catalyst.meta.capabilities",
    description: "Returns what this Atua instance supports",
    inputSchema: {},
    // Returns: list of loaded providers, tool counts, transport info,
    // Atua version, supported features
  }]
});
```

---

## 6. Internal Providers

Each Atua subsystem registers as an MCP provider. These are the tools that make the runtime programmable.

### CatalystFS Provider

Namespace: `catalyst.fs`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.fs.read` | `{ path: string }` | File contents (string or base64 for binary) |
| `catalyst.fs.write` | `{ path: string, content: string }` | Success confirmation |
| `catalyst.fs.mkdir` | `{ path: string, recursive?: boolean }` | Success confirmation |
| `catalyst.fs.readdir` | `{ path: string }` | Array of entry names with types |
| `catalyst.fs.stat` | `{ path: string }` | Size, modified time, type |
| `catalyst.fs.unlink` | `{ path: string }` | Success confirmation |
| `catalyst.fs.rename` | `{ from: string, to: string }` | Success confirmation |
| `catalyst.fs.watch` | `{ path: string, recursive?: boolean }` | Stream handle for change events |
| `catalyst.fs.search` | `{ pattern: string, path?: string }` | Matching file paths with context |
| `catalyst.fs.glob` | `{ pattern: string, cwd?: string }` | Matching file paths |

Backend: OPFS with IndexedDB fallback. FileSystemObserver for native watching, polling fallback.

### CatalystD1 Provider

Namespace: `catalyst.d1`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.d1.query` | `{ sql: string, params?: any[] }` | Rows as JSON array |
| `catalyst.d1.execute` | `{ sql: string, params?: any[] }` | Rows affected count |
| `catalyst.d1.batch` | `{ statements: { sql: string, params?: any[] }[] }` | Array of results |
| `catalyst.d1.tables` | `{}` | List of table names and schemas |
| `catalyst.d1.describe` | `{ table: string }` | Column names, types, constraints |

Backend: wa-sqlite compiled to WASM, storage in OPFS. FTS5 extension enabled for full-text search.

### CatalystBuild Provider

Namespace: `catalyst.build`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.build.run` | `{ entryPoints?: string[], config?: object }` | Build result: success/fail, errors, warnings, output files, timing |
| `catalyst.build.status` | `{}` | Last build result, current state (idle/building/error) |
| `catalyst.build.telemetry` | `{}` | Full build telemetry: file count, bundle size, dependency graph, timing breakdown |
| `catalyst.build.resolve` | `{ specifier: string }` | Where a module resolves to |
| `catalyst.build.analyze` | `{ entryPoint?: string }` | Bundle analysis: size by module, tree-shake stats, duplicate deps |

Backend: esbuild-wasm. esm.sh for CDN resolution. ContentHashCache for incremental builds.

### CatalystProc Provider

Namespace: `catalyst.proc`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.proc.spawn` | `{ command: string, args?: string[], cwd?: string, env?: object }` | Process handle with pid |
| `catalyst.proc.kill` | `{ pid: number, signal?: string }` | Success confirmation |
| `catalyst.proc.list` | `{}` | Running processes with pid, command, uptime, memory |
| `catalyst.proc.stdin` | `{ pid: number, data: string }` | Success confirmation |
| `catalyst.proc.stdout` | `{ pid: number }` | Buffered stdout output |
| `catalyst.proc.wait` | `{ pid: number, timeout_ms?: number }` | Exit code and final output |

Backend: Workers with Blob URL creation, MessageChannel stdio pipes. Capability-gated access per process.

### CatalystPkg Provider

Namespace: `catalyst.pkg`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.pkg.install` | `{ specifier: string }` | Resolution result: version, size, dependencies |
| `catalyst.pkg.resolve` | `{ specifier: string }` | Where it resolved to (esm.sh URL, OPFS cache path) |
| `catalyst.pkg.list` | `{}` | Installed packages with versions and sizes |
| `catalyst.pkg.search` | `{ query: string }` | npm registry search results |
| `catalyst.pkg.outdated` | `{}` | Packages with newer versions available |

Backend: NpmResolver for registry metadata, esm.sh for CDN fetching, OPFS PackageCache with LRU eviction.

### CatalystNet Provider

Namespace: `catalyst.net`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.net.fetch` | `{ url: string, method?: string, headers?: object, body?: string }` | Response: status, headers, body |
| `catalyst.net.routes` | `{}` | Active Hono routes in the Service Worker |
| `catalyst.net.serve` | `{ path: string, handler: string }` | Registers a new route |

Backend: Hono in Service Worker. Real `fetch()` for external requests. Route registration for internal HTTP serving.

### Preview Provider

Namespace: `catalyst.preview`

| Tool | Parameters | Returns |
|------|-----------|---------|
| `catalyst.preview.start` | `{ entryPoint?: string }` | Preview URL (served by Service Worker) |
| `catalyst.preview.stop` | `{}` | Success confirmation |
| `catalyst.preview.screenshot` | `{ selector?: string, fullPage?: boolean }` | Base64 PNG |
| `catalyst.preview.dom.query` | `{ selector: string }` | Element tree: tag, attributes, computed styles, bounding rects |
| `catalyst.preview.dom.queryAll` | `{ selector: string }` | Array of element trees |
| `catalyst.preview.dom.measure` | `{ selector: string }` | Bounding rects, computed styles, layout info |
| `catalyst.preview.dom.accessibility` | `{ selector?: string }` | Accessibility tree via TreeWalker |
| `catalyst.preview.dom.mutations` | `{ selector?: string }` | Stream handle for MutationObserver events |
| `catalyst.preview.metrics` | `{}` | Web Vitals (LCP, FID, CLS), resource timing, memory |
| `catalyst.preview.console` | `{ since?: number }` | Console log entries since timestamp |
| `catalyst.preview.errors` | `{ since?: number }` | Runtime errors since timestamp |

Backend: Real DOM in a real iframe. Real V8 rendering. These tools return actual browser data, not approximations. See Section 7.

---

## 7. V8 Instrumentation Provider

Namespace: `catalyst.telemetry`

This is what makes Atua's MCP surface fundamentally different from any other tool platform. Atua runs user code in real V8 Workers and renders previews in a real DOM in a real iframe. The instrumentation tools expose the actual browser measurement stack.

### Performance API — Not a Shim

```typescript
// These tools call real browser APIs, not wrappers
tools: [
  {
    name: "catalyst.telemetry.webvitals",
    description: "Real LCP, FID, CLS from PerformanceObserver watching the preview iframe",
    // Returns actual Web Vitals measured by the browser's rendering engine
  },
  {
    name: "catalyst.telemetry.resources",
    description: "Every network request with full timing breakdown",
    // Returns performance.getEntriesByType('resource') — DNS, TCP, TLS, TTFB, download
  },
  {
    name: "catalyst.telemetry.memory",
    description: "Actual heap usage",
    // Returns performance.measureUserAgentSpecificMemory() — real V8 heap data
  },
  {
    name: "catalyst.telemetry.marks",
    description: "Custom performance marks and measures",
    // Returns performance.getEntriesByType('mark') and 'measure'
    // Agent can instrument its own code with performance.mark()
  },
  {
    name: "catalyst.telemetry.layout",
    description: "Layout metrics for elements",
    // ResizeObserver data, reflow counts, layout shift attribution
  }
]
```

### DOM Inspection — Not Vision Model Interpretation

Every other AI coding tool screenshots the preview and sends it to a vision model for interpretation. "Does this button look right?" requires a multimodal model to guess from pixels. Atua doesn't guess.

```typescript
// Direct DOM access
catalyst.preview.dom.query("button.submit")
// Returns:
{
  tag: "button",
  classes: ["submit"],
  computedStyles: {
    width: "120px",        // getComputedStyle() — what the browser actually rendered
    height: "40px",
    backgroundColor: "rgb(59, 130, 246)",
    fontSize: "14px",
    fontFamily: "Inter, sans-serif",
    padding: "8px 16px",
    borderRadius: "6px"
  },
  boundingRect: {          // getBoundingClientRect() — actual position
    x: 320, y: 480, width: 120, height: 40
  },
  accessible: {            // Accessibility tree
    role: "button",
    name: "Submit",
    focusable: true
  },
  children: [...]
}

// Check overflow without guessing
catalyst.preview.dom.measure(".container")
// Returns scrollWidth > clientWidth = true → overflow detected

// Check accessibility without a separate audit tool
catalyst.preview.dom.accessibility()
// Returns full accessibility tree via TreeWalker with NodeFilter.SHOW_ELEMENT

// Watch for layout changes in real time
catalyst.preview.dom.mutations({ selector: "#app" })
// Returns stream handle for MutationObserver events
```

The agent doesn't need a vision model to validate UI. It reads the DOM directly as structured data. "Is this button the right size?" — measure it. "Does this layout overflow?" — check scrollWidth. "Is this accessible?" — read the accessibility tree. The rendered output is queryable, not just viewable.

### Build Telemetry

```typescript
catalyst.telemetry.build()
// Returns:
{
  duration_ms: 340,
  files_processed: 47,
  bundle_size_bytes: 182400,
  dependencies_resolved: 12,
  cache_hits: 38,
  cache_misses: 9,
  errors: [],
  warnings: ["Unused import: lodash/merge"],
  timing: {
    resolve_ms: 45,
    transform_ms: 120,
    bundle_ms: 150,
    write_ms: 25
  }
}
```

### Runtime Behavior

```typescript
catalyst.telemetry.runtime()
// Returns:
{
  console_entries: 14,
  errors: 0,
  warnings: 2,
  network_requests: 8,
  dom_mutations: 23,
  event_listeners: 47,
  memory_mb: 12.4,
  fps: 60,
  long_tasks: 0    // tasks > 50ms
}
```

---

## 8. Local MCP Server Hosting

Atua can run MCP servers inside browser Workers. This is the feature that opens the entire existing MCP ecosystem to the browser.

### How It Works

1. User provides a server specifier — npm package name, GitHub URL, or local path in CatalystFS
2. Atua resolves and installs the package via CatalystPkg (esm.sh CDN, OPFS cache)
3. Atua spawns a Worker via CatalystProc with capability-gated access
4. The Worker's `process.stdin` and `process.stdout` are MessageChannel-backed streams
5. The MCP server reads/writes JSON-RPC over these streams — standard stdio transport
6. The hub registers the server's tools under its configured namespace
7. Tools are discoverable by any consumer — agents, external clients, other servers

### Server Configuration

```json
{
  "servers": {
    "github": {
      "source": "npm:@modelcontextprotocol/server-github",
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "capabilities": {
        "network": ["api.github.com"],
        "fs": "none",
        "db": "none"
      }
    },
    "filesystem": {
      "source": "npm:@modelcontextprotocol/server-filesystem",
      "capabilities": {
        "fs": { "scope": "/project", "write": false },
        "network": "none",
        "db": "none"
      }
    },
    "custom": {
      "source": "git:github.com/user/my-mcp-server",
      "capabilities": {
        "fs": { "scope": "/project/.data", "write": true },
        "network": ["api.example.com"],
        "db": "catalyst.d1"
      }
    }
  }
}
```

### Lifecycle

**Lazy initialization.** Servers don't start until a tool is first called. The hub knows what tools each server provides (cached from last discovery). When a call arrives for a server that isn't running, the hub starts it, waits for initialization, then dispatches.

**Hot reload.** If the server source is a local file in CatalystFS, FileSystemObserver watches for changes. On change: stop the Worker, rebuild if needed, restart, re-discover tools, update the registry.

**Graceful shutdown.** Before terminating a Worker, send a shutdown notification over stdin. Wait up to 5 seconds for acknowledgment. Then `Worker.terminate()` (instant, no negotiation). This matches the MCP specification's lifecycle protocol.

**Health monitoring.** The hub tracks each server's status: `idle | starting | ready | error | stopped`. Exposes this via `catalyst.meta.server_health`.

### Install from URL

```typescript
// Agent or user calls:
catalyst.meta.install_server({
  name: "my-server",
  source: "npm:@example/mcp-tools",
  capabilities: { network: ["api.example.com"] }
})

// Atua:
// 1. Resolves @example/mcp-tools via CatalystPkg
// 2. Downloads via esm.sh, caches in OPFS
// 3. Creates Worker with capability bindings
// 4. Starts server, discovers tools
// 5. Registers tools under "my-server.*" namespace
// 6. Returns: { tools: ["my-server.do_thing", "my-server.query_data"] }
```

---

## 9. External MCP Surface

Atua exposes its full tool surface as an MCP server via StreamableHTTP through Hono in the Service Worker. Any MCP client connects and gets access to everything.

### Endpoint

```
POST /mcp          — StreamableHTTP (primary)
GET  /mcp/sse      — SSE fallback
GET  /mcp/tools    — Tool discovery (convenience, not MCP standard)
GET  /mcp/health   — Server health check
```

Hono handles routing, CORS, authentication (optional), and rate limiting. The MCP SDK's `StreamableHTTPServerTransport` handles the JSON-RPC protocol layer.

### What External Clients See

A standard MCP server exposing every tool from every provider:

```
catalyst.fs.*         — Full filesystem access
catalyst.d1.*         — Database queries
catalyst.build.*      — Build pipeline
catalyst.proc.*       — Process management
catalyst.pkg.*        — Package management
catalyst.net.*        — Network operations
catalyst.preview.*    — Preview and DOM inspection
catalyst.telemetry.*  — Real V8 instrumentation
catalyst.meta.*       — Self-description and management
pi.*                  — Pi agent capabilities (if Pi is loaded)
{server}.*            — Any locally hosted MCP server's tools
```

### Use Cases

**Claude Desktop → Atua:** A developer has their project open in Atua. They ask Claude Desktop to help refactor. Claude Desktop connects to Atua's MCP endpoint, reads the project files via `catalyst.fs.read`, suggests changes, writes them via `catalyst.fs.write`, triggers a build via `catalyst.build.run`, checks the preview via `catalyst.preview.dom.query`. The browser tab is the shared development environment.

**Test harness → Atua:** A QA tool connects to Atua and systematically exercises every tool. Write code, trigger builds, measure Web Vitals, inspect the DOM, check accessibility. The test harness IS the production interface — you're testing exactly what agents use in production, through exactly the protocol they use.

**Atua → Atua:** One Atua instance connects to another as an MCP client. Shared development. One person's browser tab is another person's remote dev environment. No deployment, no Docker, no cloud.

**CI/CD → Atua:** A CI pipeline connects to Atua, writes test files, runs builds, checks for errors, validates output. Browser-based CI.

### Authentication

Optional. By default the MCP endpoint is open (same as a local dev server). For shared access:

```json
{
  "mcp_server": {
    "auth": {
      "type": "bearer",
      "tokens": ["token-1", "token-2"]
    },
    "rate_limit": {
      "calls_per_minute": 60
    },
    "allowed_origins": ["*"]
  }
}
```

Bearer tokens stored encrypted in IndexedDB via chacha20poly1305. Hono middleware validates on each request.

---

## 10. Pi.dev Integration

Pi.dev is a TypeScript agent toolkit — a monorepo of packages that layer: `pi-ai` (multi-provider LLM), `pi-agent-core` (agent loop with tool calling), `pi-coding-agent` (coding tools, sessions, extensions), `pi-web-ui` (browser chat components).

Pi runs inside Atua as an internal consumer and provider on the MCP hub. No custom adapter code. No special integration layer. Pi speaks MCP. Atua speaks MCP.

### Pi as Consumer

Pi's agent-core discovers tools by calling `listTools()`. Inside Atua, it calls this on the hub via MessageChannel. It gets back every tool from every provider — filesystem, database, build, preview, telemetry, locally hosted servers, external servers. Pi calls tools via `callTool()`. The hub routes them.

Pi doesn't know it's in a browser. It sees tools. It calls tools. The tools happen to be backed by OPFS, wa-sqlite, esbuild-wasm, and real V8 DOM inspection. Pi doesn't care.

```typescript
// Pi agent initialization inside Atua
import { Agent } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful coding assistant.",
    model: getModel('anthropic', 'claude-sonnet-4-5-20250929'),
    // Tools come from Atua's MCP hub
    tools: await hub.listTools()
  },
  // Tool execution goes through the hub
  toolExecutor: async (name, args) => {
    return await hub.callTool(name, args, { caller: 'pi.agent' });
  }
});
```

### Pi as Provider

Pi registers its own capabilities as MCP tools on the hub:

```typescript
hub.registerProvider({
  namespace: "pi",
  transport: messageChannelTransport,
  tools: [
    {
      name: "pi.prompt",
      description: "Send a message to the Pi agent and get a response",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send" },
          session_id: { type: "string", description: "Optional session ID for continuity" }
        },
        required: ["message"]
      }
    },
    {
      name: "pi.session.list",
      description: "List all Pi agent sessions",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "pi.session.history",
      description: "Get conversation history for a session",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string" }
        },
        required: ["session_id"]
      }
    },
    {
      name: "pi.memory.search",
      description: "Search Pi's memory for relevant context",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    },
    {
      name: "pi.memory.store",
      description: "Store a memory entry",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          metadata: { type: "object" }
        },
        required: ["content"]
      }
    },
    {
      name: "pi.extensions.list",
      description: "List loaded Pi extensions",
      inputSchema: { type: "object", properties: {} }
    },
    {
      name: "pi.status",
      description: "Current agent status: idle, thinking, using tools",
      inputSchema: { type: "object", properties: {} }
    }
  ]
});
```

External clients connecting to Atua's MCP endpoint see Pi's tools alongside everything else. Claude Desktop can call `pi.prompt` to talk to the Pi agent running in the browser. A test harness can call `pi.memory.search` to inspect what the agent remembers. Another Atua instance can call `pi.session.history` to review what happened.

### Pi's MCP Server Support

Pi has its own MCP adapter for connecting to external servers. Inside Atua, Pi's servers run through CatalystProc — same as any other locally hosted MCP server. Pi configures servers in its `mcp.json`, Atua spawns them in Workers with stdio over MessageChannel. Pi's adapter doesn't change. The transport is already what Pi expects.

```json
// Pi's mcp.json — runs inside Atua exactly as-is
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Atua resolves `npx chrome-devtools-mcp@latest` through CatalystPkg, installs via esm.sh, spawns a Worker, provides stdio pipes. Pi's adapter connects over stdio. The server runs. No changes to Pi.

### Pi's Web UI

Pi ships `pi-web-ui` — Lit web components for browser chat interfaces. Inside Atua, these components render directly. Chat panel, model selector, artifact rendering, streaming display. Either use Pi's components as-is or integrate with whatever UI layer the host application provides.

### Memory System

Pi doesn't have a built-in persistent memory system. Atua provides one via CatalystD1. Pi's memory provider wraps CatalystD1:

```typescript
// Pi memory backed by Atua's wa-sqlite
hub.registerProvider({
  namespace: "pi.memory",
  tools: [
    {
      name: "pi.memory.store",
      // Internally: INSERT INTO memories (id, content, embedding, timestamp)
      // CatalystD1 handles the storage in OPFS
    },
    {
      name: "pi.memory.search",
      // Internally: FTS5 keyword search + vector cosine similarity
      // Same SQL logic ZeroClaw uses, different execution backend
    }
  ]
});
```

---

## 11. Tool Composition Engine

The hub can compose tools from multiple providers into higher-level operations.

### Chains

Sequential tool execution where each step's output feeds the next step's input:

```typescript
hub.registerComposite({
  name: "catalyst.compose.build_and_check",
  description: "Build the project and return both build result and preview metrics",
  steps: [
    { tool: "catalyst.build.run", args: {} },
    { tool: "catalyst.preview.start", args: {} },
    { tool: "catalyst.preview.metrics", args: {} },
    { tool: "catalyst.telemetry.build", args: {} }
  ],
  // Returns combined result from all steps
});
```

An agent calls one tool. The hub executes four. The agent gets a single result with build output, preview status, Web Vitals, and build telemetry.

### Fan-out

Parallel tool execution for independent operations:

```typescript
hub.registerComposite({
  name: "catalyst.compose.project_status",
  description: "Full project status: files, packages, build, errors",
  parallel: [
    { tool: "catalyst.fs.readdir", args: { path: "/", recursive: true } },
    { tool: "catalyst.pkg.list", args: {} },
    { tool: "catalyst.build.status", args: {} },
    { tool: "catalyst.preview.errors", args: {} }
  ]
});
```

### Dynamic Composition

Agents can create composite tools at runtime:

```typescript
// Agent defines a new composite tool
catalyst.meta.register_composite({
  name: "my_workflow.deploy_check",
  steps: [
    { tool: "catalyst.build.run" },
    { tool: "catalyst.preview.metrics" },
    { 
      tool: "catalyst.d1.query", 
      args: { sql: "SELECT COUNT(*) FROM errors WHERE timestamp > ?" }
    }
  ],
  condition: "all_succeed"  // only proceed if all steps succeed
})
```

---

## 12. Security Model

### Capability-Gated Providers

Each provider registration declares what the provider can access. The hub enforces these boundaries.

```typescript
interface Capabilities {
  fs?: 'none' | { scope: string, write: boolean };
  network?: 'none' | string[];  // allowed domains
  db?: 'none' | 'catalyst.d1';
  proc?: 'none' | 'spawn' | 'full';
  preview?: boolean;
}
```

A locally hosted MCP server declared with `fs: { scope: "/project", write: false }` cannot write to the filesystem and can only read within `/project`. The hub checks capabilities before routing calls to the server's Worker. Violations return an error, not a silent failure.

### Internal Provider Trust

Internal providers (CatalystFS, CatalystBuild, etc.) run in the main Atua context and have full access to their respective subsystems. They don't go through capability checks — they ARE the capabilities.

### External Client Authentication

External clients connecting via StreamableHTTP are authenticated via bearer tokens or are unauthenticated (local-only mode). The hub can restrict which tools are available to external clients:

```typescript
// External clients get a subset of tools
hub.setExternalPolicy({
  allow: ["catalyst.fs.*", "catalyst.build.*", "catalyst.preview.*"],
  deny: ["catalyst.proc.spawn", "catalyst.meta.install_server"],
  // External clients can read/build/preview but can't spawn processes
  // or install new servers
});
```

### Audit Trail

Every tool call is logged regardless of source. The transaction log includes caller identity, so you can trace what an external client did vs what the internal agent did vs what a locally hosted server did.

### API Key Storage

LLM provider API keys and MCP server tokens are stored encrypted in IndexedDB via chacha20poly1305 with PBKDF2 key derivation from a user passphrase. Keys never leave the browser. The hub never logs parameter values that match known secret patterns.

---

## 13. Offline & Caching

### Tool Schema Cache

The hub caches tool schemas for all providers in CatalystD1. When a remote MCP server is unreachable, the hub still knows what tools it had and their schemas. Discovery results persist across sessions.

### Local-First

Internal providers and locally hosted MCP servers work fully offline. They run in Workers backed by OPFS. No network needed.

### Remote Server Degradation

When an external MCP server is unreachable:
1. Hub marks it as `degraded` in health
2. Tool calls return an error with the server's last-known status
3. Schema cache means discovery still works — consumers see the tools, they just can't call them
4. When connectivity returns, the hub re-discovers and updates

### Deterministic Tool Caching

For tools that are deterministic (same input → same output), the hub can cache results in CatalystD1. Configurable per-tool:

```typescript
{
  name: "catalyst.pkg.resolve",
  cache: { ttl_ms: 3600000 }  // cache resolution for 1 hour
}
```

---

## 14. MCP Server Templates

Agents can generate MCP servers at runtime from templates. The server code is written to CatalystFS, compiled by esbuild-wasm, and spawned in a Worker.

### Database Server Template

```typescript
catalyst.meta.create_server_from_template({
  template: "database",
  name: "project-db",
  config: {
    tables: ["users", "posts", "comments"],
    capabilities: { db: "catalyst.d1" }
  }
})
// Generates: MCP server wrapping CatalystD1 with typed query/insert/update/delete tools
// Registers: project-db.query_users, project-db.insert_post, etc.
```

### File Watcher Template

```typescript
catalyst.meta.create_server_from_template({
  template: "file-watcher",
  name: "src-watcher",
  config: {
    paths: ["src/"],
    events: ["create", "modify", "delete"],
    capabilities: { fs: { scope: "/project/src", write: false } }
  }
})
// Generates: MCP server that watches CatalystFS paths and exposes change-feed tools
// Registers: src-watcher.changes, src-watcher.subscribe
```

### Custom — Agent Writes Its Own Server

```typescript
// 1. Agent writes server code to CatalystFS
catalyst.fs.write("/servers/my-tools/index.ts", serverCode);

// 2. Agent tells Atua to install and run it
catalyst.meta.install_server({
  name: "my-tools",
  source: "local:/servers/my-tools",
  capabilities: { network: ["api.example.com"] }
});

// 3. Server starts in a Worker, tools are discoverable
```

The agent creates its own tools at runtime. No restart. No configuration file editing. Write code, install, use.

---

## 15. Testing Strategy

### Unit Tests — Per Provider

Each internal provider has isolated tests that don't depend on other providers.

```
catalyst.fs.*        — Test OPFS operations: read, write, mkdir, stat, watch
catalyst.d1.*        — Test wa-sqlite operations: query, execute, FTS5
catalyst.build.*     — Test esbuild-wasm: build, resolve, analyze
catalyst.proc.*      — Test Worker lifecycle: spawn, kill, stdio pipes
catalyst.pkg.*       — Test package resolution: install, resolve, cache
catalyst.preview.*   — Test preview lifecycle: start, stop, DOM access
catalyst.telemetry.* — Test Performance API, Web Vitals collection
```

### Integration Tests — Cross-Provider

Test that the hub correctly routes between providers:

```
Build reads from FS: build.run → fs.read (via hub)
Preview reads from build: preview.start → build.status (via hub)
Agent drives full workflow: fs.write → build.run → preview.metrics
```

### Transport Tests

```
MessageChannel: internal provider calls round-trip correctly
stdio: locally hosted MCP server receives and responds correctly
StreamableHTTP: external client connects, discovers, calls, disconnects
SSE fallback: external client uses SSE when StreamableHTTP fails
```

### Transaction Log Tests

```
Every call is logged with correct caller, provider, args, result, duration
Log survives provider restarts
Log can be replayed to reproduce a session
```

### Security Tests

```
Capability violations return errors, not silent failures
External policy restricts tool access correctly
Secret parameters are not logged
Worker capability bindings enforce scope correctly
```

### Pi Integration Tests

```
Pi discovers all hub tools via listTools()
Pi calls hub tools via callTool()
Pi's own tools are discoverable by external clients
Pi's MCP servers run in Workers with stdio
Pi's memory stores and retrieves via CatalystD1
```

### Mock Provider Tests

```
Register fake provider, call its tools, verify responses
Replace real provider with mock, verify consumers don't break
Full agent test with all providers mocked
```

---

## 16. Implementation Phases

### Phase 0: Hub Core — Registry + MessageChannel Transport

**Goal:** The kernel hub exists. Internal providers can register and consumers can call tools.

**What gets built:**
- `MCPHub` class with registry, routing, and transaction logging
- `MessageChannelTransport` for internal provider communication
- `ProviderRegistration` interface and validation
- Transaction log with structured entries
- Two test providers: a simple echo provider and a counter provider

**Verification:**
- [ ] Register a provider, discover its tools via `listTools()`
- [ ] Call a tool, receive correct result
- [ ] Transaction log contains the call with correct fields
- [ ] Unregister a provider, tools disappear from discovery
- [ ] Call a non-existent tool, receive clear error

---

### Phase 1: Internal Providers — CatalystFS + CatalystD1 + CatalystBuild

**Goal:** Core subsystems register as MCP providers. The hub routes calls between them.

**What gets built:**
- CatalystFS wrapped as MCP provider with all `catalyst.fs.*` tools
- CatalystD1 wrapped as MCP provider with all `catalyst.d1.*` tools
- CatalystBuild wrapped as MCP provider with all `catalyst.build.*` tools
- Cross-provider routing: build reads from FS through the hub

**Verification:**
- [ ] Write a file via `catalyst.fs.write`, read it back via `catalyst.fs.read`
- [ ] Execute SQL via `catalyst.d1.execute`, query via `catalyst.d1.query`
- [ ] Build via `catalyst.build.run`, verify it reads sources via `catalyst.fs.read` through hub
- [ ] Transaction log shows cross-provider call chain

---

### Phase 2: Remaining Internal Providers — Proc, Pkg, Net, Preview, Telemetry

**Goal:** All subsystems are MCP providers. Full internal surface.

**What gets built:**
- CatalystProc, CatalystPkg, CatalystNet wrapped as providers
- Preview provider with DOM inspection tools
- Telemetry provider with V8 instrumentation tools
- `catalyst.meta` provider for self-description

**Verification:**
- [ ] Spawn a process via `catalyst.proc.spawn`, send stdin, read stdout
- [ ] Install a package via `catalyst.pkg.install`
- [ ] Start preview, query DOM via `catalyst.preview.dom.query`
- [ ] Read Web Vitals via `catalyst.telemetry.webvitals`
- [ ] Call `catalyst.meta.capabilities`, verify all providers listed

---

### Phase 3: stdio Transport — Local MCP Server Hosting

**Goal:** Run existing MCP servers inside browser Workers with stdio transport.

**What gets built:**
- `StdioTransport` wrapping CatalystProc's MessageChannel pipes
- Server lifecycle management: install, start, discover, shutdown
- Server configuration schema and storage
- Capability-gated Worker creation
- Hub integration: local servers' tools appear in discovery

**Verification:**
- [ ] Install an npm MCP server package via CatalystPkg
- [ ] Spawn it in a Worker with stdio pipes
- [ ] Discover its tools via the hub
- [ ] Call a tool, receive correct result
- [ ] Verify capability gating: server can't access resources outside its scope
- [ ] Shutdown and restart server, tools re-register

---

### Phase 4: StreamableHTTP Transport — External MCP Surface

**Goal:** External clients connect to Atua as an MCP server.

**What gets built:**
- Hono route for `/mcp` endpoint in Service Worker
- `StreamableHTTPServerTransport` integration
- SSE fallback at `/mcp/sse`
- External client authentication (bearer token)
- External policy (allow/deny tool lists)
- Health endpoint at `/mcp/health`

**Verification:**
- [ ] External MCP client connects via StreamableHTTP
- [ ] Client discovers all tools from all providers
- [ ] Client calls `catalyst.fs.read`, receives file contents
- [ ] Client calls `catalyst.build.run`, receives build result
- [ ] Client calls `catalyst.preview.dom.query`, receives DOM data
- [ ] Authentication: unauthenticated client rejected when auth enabled
- [ ] External policy: restricted tools return permission error
- [ ] SSE fallback works when StreamableHTTP fails

---

### Phase 5: Pi.dev Integration

**Goal:** Pi runs inside Atua as an MCP consumer and provider.

**What gets built:**
- Pi agent-core initialization with hub as tool source
- Pi provider registration (pi.prompt, pi.session.*, pi.memory.*)
- Pi memory system backed by CatalystD1
- Pi MCP server support via CatalystProc stdio
- Pi web-ui integration (optional, for visual interface)

**Verification:**
- [ ] Pi agent discovers all hub tools
- [ ] Pi agent calls `catalyst.fs.read`, receives file contents
- [ ] Pi agent calls `catalyst.build.run`, build succeeds
- [ ] External client calls `pi.prompt`, receives agent response
- [ ] Pi memory: store entry, search for it, find it
- [ ] Pi's MCP servers run in Workers with stdio

---

### Phase 6: Composition Engine + Server Templates

**Goal:** Composite tools and runtime server generation.

**What gets built:**
- Chain composition (sequential tool execution)
- Fan-out composition (parallel tool execution)
- Dynamic composite registration by agents
- Server template system (database, file-watcher, custom)
- `catalyst.meta.install_server` for runtime server creation
- `catalyst.meta.create_server_from_template` for template-based generation

**Verification:**
- [ ] Call a composite tool, all steps execute in order
- [ ] Fan-out: parallel tools complete, combined result returned
- [ ] Agent registers a dynamic composite, calls it
- [ ] Create server from database template, query through it
- [ ] Agent writes custom server code, installs it, calls its tools

---

## 17. CC Kickoff Prompts

### Initial Kickoff

```
Read atua-mcp-spec.md in the repo root. This is the spec for Atua's MCP
kernel architecture — where every subsystem is an MCP provider and the
hub routes all tool calls. Implement Phase 0 first. Each phase has a
verification checklist — run it before moving to the next phase.
Commit after each phase:
git add -A && git commit -m "MCP Phase {N}: {description}"

Do not reference, examine, or search for WebContainers source code or
any proprietary competing runtime code. Implement from this spec,
the MCP SDK (MIT/Apache-2.0), and open-source dependency documentation only.
```

### Between Phases

```
Continue with MCP Phase {N} per atua-mcp-spec.md. Run verification
checklist before committing.
```

---

## 18. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| MessageChannel transport performance for high-frequency calls | Medium | Low | Batch calls, use Transferable objects, benchmark early |
| stdio MCP servers with Node.js-only dependencies | High | Medium | CatalystProc + unenv covers 96.2%. Servers with native deps won't work — document clearly |
| StreamableHTTP Service Worker interception conflicts | Medium | Medium | Dedicated `/mcp` path, careful route ordering in Hono |
| Transaction log storage growth | Low | High | LRU eviction in CatalystD1, configurable retention |
| Pi.dev version compatibility | Medium | Low | Pin to specific Pi package versions, test against updates |
| External client abuse (DoS via unlimited tool calls) | Medium | Medium | Rate limiting in Hono middleware, configurable per-client |
| Capability bypass via tool composition | High | Low | Composite tools inherit the most restrictive capability set of their steps |
| wa-sqlite FTS5 performance for Pi memory at scale (>10k entries) | Medium | Medium | Pagination, index tuning, optional memory compaction |
| CORS blocking external MCP client connections | Medium | High | Document CORS requirements, Hono cors() middleware |

---

## 19. Cleanroom Protocol

### Allowed Sources
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`, MIT/Apache-2.0)
- Atua/Catalyst spec and source code (own project)
- This spec document
- Pi.dev monorepo (`pi-mono`, MIT license)
- Hono framework (MIT license)
- wa-sqlite (MIT license)
- MDN Web Docs for browser APIs
- MCP specification (https://modelcontextprotocol.io)

### Not Accessed
- WebContainers source code or proprietary API
- Bolt.new source code
- Any decompiled or reverse-engineered competing runtime
- Any source code not under an open-source license

### Implementation Rules
- All hub, registry, routing, transport code written fresh from this spec
- Provider wrappers are original adapter code around existing Atua subsystems
- MCP SDK used directly (MIT/Apache-2.0 licensed)
- Pi.dev packages used as dependencies (MIT licensed), not forked
- No copy-paste from any competing MCP implementation
