# Hashbrown × Atua Integration Spec

**Codename:** Sizzle
**Status:** Draft
**Date:** 2026-03-03
**Depends on:** Atua unified spec (hyperkernel complete), Pi-Atua spec (Conductor, optional), Fabric (MCP hub)
**Package:** `@aspect/atua-ui`

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [What Hashbrown Actually Is](#2-what-hashbrown-actually-is)
3. [The Core Problem Hashbrown Solves Inside Atua](#3-the-core-problem-hashbrown-solves-inside-atua)
4. [Architecture Overview](#4-architecture-overview)
5. [The Backend Problem — and How Atua Solves It](#5-the-backend-problem--and-how-atua-solves-it)
6. [Package Structure](#6-package-structure)
7. [Layer 1 — LLM Backend: ServiceWorker Proxy](#7-layer-1--llm-backend-serviceworker-proxy)
8. [Layer 2 — Tool Provider: MCP Hub Bridge](#8-layer-2--tool-provider-mcp-hub-bridge)
9. [Layer 3 — Runtime Replacement](#9-layer-3--runtime-replacement)
10. [Layer 4 — Dynamic Component Registry](#10-layer-4--dynamic-component-registry)
11. [Layer 5 — Thread → Session Bridge](#11-layer-5--thread--session-bridge)
12. [Layer 6 — Schema Bridge: Skillet ↔ TypeBox](#12-layer-6--schema-bridge-skillet--typebox)
13. [The Entry Point: createAtuaUI()](#13-the-entry-point-createatuaui)
14. [Modularity & Opt-In Surface](#14-modularity--opt-in-surface)
15. [What Gets Unlocked](#15-what-gets-unlocked)
16. [Dependency Manifest](#16-dependency-manifest)
17. [Implementation Phases](#17-implementation-phases)
18. [CC Kickoff Prompts](#18-cc-kickoff-prompts)
19. [Risk Assessment](#19-risk-assessment)
20. [Cleanroom Protocol](#20-cleanroom-protocol)
21. [Success Criteria](#21-success-criteria)

---

## 1. What This Is

Hashbrown is an MIT-licensed TypeScript framework for generative UI — LLMs compose real React or Angular components, call client-side tools, produce structured output, and execute generated code. It is built by LiveLoveApp (led by Mike Ryan, co-creator of NgRx).

This spec describes making Hashbrown a first-class citizen of Atua's platform by:

1. Replacing Hashbrown's required Node.js backend with Atua's ServiceWorker transparent LLM proxy — so the full stack runs in the browser with no server
2. Replacing Hashbrown's static tool registry with the Atua MCP hub — so every Atua subsystem and installed MCP server is automatically a Hashbrown tool
3. Replacing Hashbrown's QuickJS WASM runtime with Atua's real Worker-backed execution environment — so LLM-generated code runs with real Node.js compatibility, real filesystem, real npm packages
4. Making Hashbrown's component registry dynamic — Pi writes a component, Rolldown bundles it, it joins the registry live
5. Persisting Hashbrown's threads to wa-sqlite via Pi's session layer — threads survive page refresh

The result is `@aspect/atua-ui`: a thin adapter package. Hashbrown does not know it is inside Atua. Atua does not know it is running Hashbrown. The adapter knows both.

### What This Is NOT

- Not a fork of Hashbrown — used as an npm dependency (MIT)
- Not a rewrite of Hashbrown's UI primitives — we extend, not replace
- Not required — Atua works without it, Pi works without it, this is an opt-in layer
- Not Angular-specific — though Hashbrown supports both React and Angular, this spec focuses on React (Atua's IDE is React-based); Angular support follows the same patterns

### Relationship to Other Specs

**Atua unified spec:** Provides the hyperkernel, AtuaFS, CatalystProc, Rolldown-WASM, ServiceWorker, MCP hub (Fabric). This spec depends on those being available.

**Pi-Atua spec (Conductor):** Pi provides session persistence, memory, and agent loop. The thread→session bridge in Layer 5 is optional — it works with or without Pi. If Pi is present, threads get FTS5 search and cross-session memory. If not, threads use OPFS directly.

**Fabric (MCP hub spec):** Layer 2 (tool provider) routes through the hub. Fabric must be initialized before `createAtuaUI()` is called.

---

## 2. What Hashbrown Actually Is

Understanding Hashbrown's internals is required before writing the adapter.

### Package Structure

```
@hashbrownai/core        Framework-agnostic primitives, Skillet schema, streaming
@hashbrownai/react       React hooks: useChat, useUiChat, useStructuredChat,
                         useStructuredCompletion, useTool, exposeComponent
@hashbrownai/angular     Angular equivalents (signals, resources, directives)
@hashbrownai/openai      Node.js backend wrapper — OpenAI SDK → Hashbrown wire format
@hashbrownai/google      Node.js backend wrapper — Google Gemini
@hashbrownai/azure       Node.js backend wrapper — Azure OpenAI
@hashbrownai/writer      Node.js backend wrapper — Writer
@hashbrownai/ollama      Node.js backend wrapper — Ollama (local models)
```

### How LLM Communication Works

Hashbrown splits across a frontend/backend boundary:

**Frontend:** React hooks post to a configurable `url` (default `/api/chat`). The request body is `Chat.Api.CompletionCreateParams` — Hashbrown's normalized completion shape including messages, schema, tools, and component definitions.

**Backend:** A Node.js server hosts one of the `@hashbrownai/*` provider wrappers. These wrap the provider SDK, stream the response back as `application/octet-stream` chunked frames.

```
Browser (hooks) → POST /api/chat → Node server → LLM provider → stream back
```

**This backend requirement is the key problem for Atua.** Atua is browser-only. There is no Node server. The solution is in §7.

### Skillet Schema Language

Skillet is Hashbrown's LLM-optimized schema language. It is a strict subset of JSON Schema, reduced to constructs that LLMs reliably handle. Future versions plan JSON Schema and Zod bridge support.

```ts
import { s } from '@hashbrownai/core'

s.string('description')
s.number('description')
s.boolean('description')
s.enumeration('description', ['a', 'b', 'c'])
s.literal('value')
s.object('description', { field: s.string('...') })
s.array('description', s.string('item'))
s.anyOf('description', [schemaA, schemaB])
s.streaming.string('description')   // enables eager JSON parsing for streaming
```

Skillet schemas are used for: tool argument definitions, component prop definitions, structured output shapes.

### React Hooks

```ts
useChat()                 // Basic text chat
useUiChat()               // Chat + generative UI component rendering
useStructuredChat()       // Chat with typed structured output
useStructuredCompletion() // One-shot completion (no chat history)
useTool()                 // Define a client-side tool the LLM can call
exposeComponent()         // Expose a React component to the LLM
```

### Tool Calling

Tools are defined with `useTool()` and passed to a chat hook. The LLM decides when to call them. Arguments are validated against the Skillet schema. The handler runs synchronously in the browser — it can access React state, call services, mutate state.

```ts
const getLights = useTool({
  name: 'getLights',
  description: 'Get all lights',
  handler: () => lightsStore.getAll(),
  deps: [lightsStore],
})

const setLight = useTool({
  name: 'setLight',
  description: 'Set brightness',
  schema: s.object('input', {
    id: s.string('light id'),
    brightness: s.number('0-100'),
  }),
  handler: ({ id, brightness }) => lightsStore.set(id, brightness),
  deps: [lightsStore],
})
```

### Generative UI

`exposeComponent()` tells Hashbrown which React components the LLM can compose. Hashbrown uses structured output to get JSON from the LLM, then renders the described components:

```ts
const exposed = exposeComponent(LightCard, {
  name: 'LightCard',
  description: 'Show a light control card',
  props: {
    lightId: s.string('The light ID'),
    label: s.streaming.string('Label text, streamed in'),
  },
})
```

The LLM's response is JSON like:
```json
{"ui":[{"LightCard":{"$props":{"lightId":"light-1","label":"Kitchen"}}}]}
```

Hashbrown parses this and renders the component tree. The LLM can only render components you explicitly expose — nothing else.

### JavaScript Runtime

Hashbrown's runtime is QuickJS compiled to WASM via `quickjs-emscripten`. ~1MB, lazy-loaded. LLM-generated JavaScript runs inside the QuickJS sandbox. Functions you expose via `createRuntimeFunction()` are callable from LLM-generated code — they run asynchronously on the host but appear synchronous inside QuickJS.

**In Atua this entire runtime is replaced** — see §9.

### Threads

Conversation history management with token budget awareness. Messages are cached and replayed. v0.4 feature.

### Magic Text

Streaming markdown parser with citation support. `hb-magic-text-renderer` / `MagicTextRenderer` components. Headless — you provide templates for links, text, citations.

### MCP Client

v0.4 added remote MCP client support. Hashbrown can call tools on an MCP server. In Atua, this becomes bidirectional — Atua's hub IS the MCP layer, so Hashbrown's tools and the hub's tools are unified.

---

## 3. The Core Problem Hashbrown Solves Inside Atua

Without Hashbrown (or equivalent), Atua + Pi has a gap at the UI layer:

- Pi produces text responses and tool call results
- Pi-web-ui (Lit components) renders basic chat UI
- There is no mechanism for the LLM to compose actual application UI from components
- There is no structured output → typed React state pipeline
- There is no predictive action suggestion system

Hashbrown fills this gap. It is the missing UI intelligence layer that turns Atua from a "runtime that has an AI agent" into a "runtime where the AI agent can build and render actual UI."

Specifically what Hashbrown adds that Atua does not have:

| Gap | Hashbrown Solution |
|-----|-------------------|
| LLM renders real components | `exposeComponent()` + `useUiChat()` |
| Natural language → typed data | `useStructuredCompletion()` + Skillet |
| Predictive next actions | `useStructuredCompletion()` on app state events |
| Streaming UI construction | `s.streaming.*` + eager JSON parser |
| LLM-generated glue code | JavaScript runtime (replaced by Atua in our integration) |
| Structured forms via NL | `useStructuredChat()` |
| Streaming markdown + citations | Magic Text |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Host Application                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              @aspect/atua-ui (Sizzle)                │   │
│  │                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │  Hashbrown  │  │  MCP Bridge  │  │  Runtime   │  │   │
│  │  │  Provider   │  │  (Tools)     │  │  Adapter   │  │   │
│  │  │  (SW proxy) │  │              │  │            │  │   │
│  │  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │   │
│  │         │                │                │          │   │
│  └─────────┼────────────────┼────────────────┼──────────┘   │
│            │                │                │              │
│  ┌─────────▼────────────────▼────────────────▼──────────┐   │
│  │                   Atua Runtime                        │   │
│  │                                                       │   │
│  │  ServiceWorker   MCP Hub (Fabric)   CatalystProc      │   │
│  │  ├ /api/chat     ├ listTools()      ├ Worker exec     │   │
│  │  └ LLM proxy     └ callTool()       └ Rolldown build  │   │
│  │                                                       │   │
│  │  AtuaFS (OPFS)   CatalystD1         Pi Sessions       │   │
│  │  ├ files         ├ wa-sqlite        ├ thread store    │   │
│  │  └ bundles       └ FTS5 memory      └ cross-session   │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Dependency direction:**
- `@aspect/atua-ui` imports from `@hashbrownai/core` and `@hashbrownai/react`
- `@aspect/atua-ui` imports from Atua subsystems via `atua` instance
- Atua has zero imports from Hashbrown
- Hashbrown has zero imports from Atua

---

## 5. The Backend Problem — and How Atua Solves It

This is the most important integration point. Understanding it is required before anything else.

### The Problem

Hashbrown is designed for a frontend/backend split. The `HashbrownProvider` posts to a URL that must be served by a Node.js process running one of the `@hashbrownai/*` provider wrappers. The provider wrapper holds the API key and calls the LLM.

```ts
// Standard Hashbrown setup — requires Node backend
<HashbrownProvider url="/api/chat">
```

**Atua has no Node backend.** Everything runs in the browser.

### The Solution: ServiceWorker as the Backend

Atua's ServiceWorker already intercepts all `fetch()` calls. It handles HTTP virtualization for running app servers. The same mechanism can intercept Hashbrown's POST to `/api/chat`.

The SW recognizes the `/__atua_llm__/chat` route (or any configurable path) and:

1. Receives the `Chat.Api.CompletionCreateParams` body from Hashbrown
2. Extracts the model identifier and maps it to a provider + API key
3. Transforms the request to the provider's wire format
4. Calls the LLM via the SW's existing WebSocket relay to `relay.atua.dev` (bypassing CORS)
5. Streams the response back in Hashbrown's `application/octet-stream` chunked frame format

From Hashbrown's perspective, it posted to `/api/chat` and got a streaming response back. It has no idea the "backend" is a ServiceWorker calling a relay calling an LLM.

```ts
// @aspect/atua-ui setup — no backend needed
<AtuaHashbrownProvider atua={atua} model="anthropic/claude-sonnet-4-6">
  {children}
</AtuaHashbrownProvider>

// Which internally renders:
<HashbrownProvider url="/__atua_llm__/chat">
  {children}
</HashbrownProvider>
```

### Why This Is Better Than Hashbrown's Approach

| Dimension | Standard Hashbrown | Hashbrown in Atua |
|-----------|-------------------|-------------------|
| Backend required | Yes — Node.js process | No — ServiceWorker |
| API key location | Server env var | User's browser (OPFS or memory) |
| CORS issues | Handled by server | Handled by SW + relay |
| Deployment | Frontend + backend | Browser only |
| Offline capable | No | Yes (except LLM calls) |
| Multi-provider | One per server | Dynamic, switchable |

### SW Proxy Implementation Detail

The Hashbrown wire format is `application/octet-stream` chunked binary frames. The SW proxy must:

1. Parse incoming `Chat.Api.CompletionCreateParams` from Hashbrown
2. Detect the model string format (`provider/model-name` convention)
3. Look up provider configuration from AtuaFS (user's stored API key/proxy config)
4. Transform to provider API format (OpenAI-compatible for most; Anthropic native for Anthropic)
5. Open WebSocket to relay for the actual HTTP call
6. Re-encode the streaming response as Hashbrown binary frames
7. Respond with `ReadableStream` of those frames

The encoder/decoder for Hashbrown's binary frame format must be reverse-engineered from `@hashbrownai/core`. This is adapter code — original work.

---

## 6. Package Structure

```
packages/atua-ui/
├── src/
│   ├── index.ts                    Public API
│   ├── provider/
│   │   ├── AtuaHashbrownProvider.tsx   React provider wrapping HashbrownProvider
│   │   └── sw-proxy.ts                 SW route handler for /api/chat
│   ├── tools/
│   │   ├── AtuaToolProvider.ts         MCP hub → Hashbrown tools
│   │   └── skillet-bridge.ts           Skillet ↔ TypeBox / JSON Schema
│   ├── runtime/
│   │   ├── AtuaRuntime.ts              Replaces Hashbrown's QuickJS runtime
│   │   └── runtime-functions.ts        Host function bridge
│   ├── registry/
│   │   ├── AtuaComponentRegistry.ts    Dynamic component registration
│   │   └── live-bundle.ts              Rolldown → module → register pipeline
│   ├── threads/
│   │   ├── AtuaThreadStore.ts          Hashbrown threads → wa-sqlite / OPFS
│   │   └── pi-session-adapter.ts       Optional Pi session bridge
│   └── create-atua-ui.ts               Entry point
├── package.json
└── README.md
```

---

## 7. Layer 1 — LLM Backend: ServiceWorker Proxy

**Goal:** Hashbrown posts to `/__atua_llm__/chat`. The SW answers. No Node backend.

### SW Route Registration

During Atua initialization, the SW registers a handler for the LLM proxy route:

```ts
// In PreviewSW.ts (extends existing SW)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/__atua_llm__/chat') {
    event.respondWith(handleLLMProxy(event.request))
  }
})
```

### handleLLMProxy

```ts
async function handleLLMProxy(request: Request): Promise<Response> {
  const body: Chat.Api.CompletionCreateParams = await request.json()

  // 1. Resolve provider from model string
  const { provider, model } = resolveModel(body.model)
  // e.g. "anthropic/claude-sonnet-4-6" → { provider: 'anthropic', model: 'claude-sonnet-4-6' }

  // 2. Load credentials from AtuaFS
  const config = await loadProviderConfig(provider)
  // { apiKey?, proxyUrl?, streamFn? }

  // 3. Build upstream request in provider format
  const upstreamRequest = transformToProvider(provider, model, body, config)

  // 4. Route through relay WebSocket (CORS bypass)
  const responseStream = await relayRequest(upstreamRequest, provider)

  // 5. Encode as Hashbrown binary frames
  const hashbrownStream = encodeAsHashbrownFrames(responseStream)

  return new Response(hashbrownStream, {
    headers: { 'Content-Type': 'application/octet-stream' }
  })
}
```

### Provider Config Storage

User credentials stored in AtuaFS at `.atua/providers/`:

```
.atua/providers/anthropic.json  → { apiKey: "sk-ant-..." }
.atua/providers/openai.json     → { apiKey: "sk-..." }
.atua/providers/proxy.json      → { url: "https://my-proxy.example.com" }
```

Config loaded synchronously via `createSyncAccessHandle()` — no async stall in the SW handler.

### Provider Support

| Provider | Format | Notes |
|----------|--------|-------|
| Anthropic | Native Messages API | Atua uses Anthropic natively; priority provider |
| OpenAI | OpenAI Chat Completions | Standard |
| Google Gemini | Gemini API | Transform required |
| OpenRouter | OpenAI-compatible | Zero CORS issues, unified endpoint |
| Ollama | OpenAI-compatible | Local models, no relay needed |
| Any OpenAI-compatible | Pass-through | Works without transform |

---

## 8. Layer 2 — Tool Provider: MCP Hub Bridge

**Goal:** Every tool on the Atua MCP hub (Fabric) is automatically a Hashbrown tool.

### The Bridge

```ts
// src/tools/AtuaToolProvider.ts

import { useTool } from '@hashbrownai/react'
import type { AtuaHub } from '@aspect/atua-fabric'

export function useAtuaTools(hub: AtuaHub) {
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])

  // On mount, list all hub tools. Re-list when hub changes.
  useEffect(() => {
    hub.listTools().then(setMcpTools)
    return hub.onToolsChanged(() => hub.listTools().then(setMcpTools))
  }, [hub])

  // Map each MCP tool to a Hashbrown useTool() definition
  return mcpTools.map(mcpTool =>
    useTool({
      name: mcpTool.name,
      description: mcpTool.description,
      schema: mcpToolSchemaToSkillet(mcpTool.inputSchema),
      handler: async (args) => hub.callTool(mcpTool.name, args),
      deps: [hub],
    })
  )
}
```

### Schema Conversion: MCP → Skillet

MCP tool schemas are JSON Schema objects. Skillet is a strict subset of JSON Schema. The conversion is lossy in one direction (JSON Schema has constructs Skillet doesn't support) but Atua's hub tools are already designed with simple schemas.

```ts
// src/tools/skillet-bridge.ts

function mcpToolSchemaToSkillet(jsonSchema: JSONSchema): SkilletSchema {
  switch (jsonSchema.type) {
    case 'string':  return s.string(jsonSchema.description ?? '')
    case 'number':  return s.number(jsonSchema.description ?? '')
    case 'boolean': return s.boolean(jsonSchema.description ?? '')
    case 'object':  return s.object(
      jsonSchema.description ?? '',
      Object.fromEntries(
        Object.entries(jsonSchema.properties ?? {})
          .map(([k, v]) => [k, mcpToolSchemaToSkillet(v)])
      )
    )
    case 'array':   return s.array(
      jsonSchema.description ?? '',
      mcpToolSchemaToSkillet(jsonSchema.items ?? {})
    )
    default: return s.string('unknown')
  }
}
```

### Dynamic Tool Updates

When a new MCP server is installed into Atua (or an existing one changes), `hub.onToolsChanged()` fires. The `useAtuaTools()` hook re-queries the hub and returns a new tool list. On the next chat request, Hashbrown's LLM sees the updated tool definitions. No restart, no reconfiguration.

**This means:** Install a new MCP server → Pi can use it → Hashbrown can use it → the LLM rendering your UI can use it. Zero configuration.

### Atua Subsystems as Tools

Out of the box, the hub exposes these as tools (via Fabric's built-in providers):

| Tool | What it does |
|------|-------------|
| `atuafs.read` | Read file from OPFS |
| `atuafs.write` | Write file to OPFS |
| `atuafs.list` | List directory |
| `atuafs.delete` | Delete file |
| `atuafs.exists` | Check file exists |
| `catalyst.build` | Bundle a TypeScript project with Rolldown |
| `catalyst.install` | Install npm package |
| `catalyst.exec` | Run code in a Worker |
| `catalyst.preview` | Get preview URL for running app |
| `catalyst.sqlite` | Execute SQL against wa-sqlite |
| `pi.prompt` | Send a message to Pi agent |
| `pi.session.list` | List Pi sessions |
| `pi.memory.search` | Search Pi's long-term memory |

All of these are available as Hashbrown tools with zero extra configuration.

---

## 9. Layer 3 — Runtime Replacement

**Goal:** Replace Hashbrown's QuickJS WASM runtime with Atua's real execution environment.

### What Hashbrown's Runtime Does

Hashbrown exposes a `createRuntimeFunction()` API. LLM-generated JavaScript calls these functions. They run inside QuickJS with CPU timeout and memory limits. Functions appear synchronous inside QuickJS but can be async on the host.

Use cases: generate glue code to slice/filter data, configure charts dynamically, perform mathematical operations, stitch services together.

### What AtuaRuntime Does

`AtuaRuntime` implements the same `HashbrownRuntime` interface but routes execution to CatalystProc — a real Worker backed by the hyperkernel. Generated code:

- Has access to AtuaFS (read/write real files)
- Can import npm packages already installed in the project
- Can use unenv's full Node.js compatibility layer
- Has real async/await support
- Has real error reporting with stack traces

The QuickJS validation tier still runs FIRST as a safety gate (syntax check, infinite loop detection, memory limits). If QuickJS rejects the code, it never reaches the real Worker. If QuickJS accepts it, the real Worker executes it.

```ts
// src/runtime/AtuaRuntime.ts

export class AtuaRuntime implements HashbrownRuntime {
  constructor(
    private proc: CatalystProc,
    private sandbox: QuickJSSandbox,  // Atua's existing QuickJS tier
    private functions: Map<string, (...args: unknown[]) => Promise<unknown>>
  ) {}

  async execute(code: string): Promise<unknown> {
    // Step 1: QuickJS validation — syntax, timeout, memory
    const validation = await this.sandbox.validate(code)
    if (!validation.ok) {
      throw new RuntimeError(validation.error)
    }

    // Step 2: Real Worker execution
    return this.proc.eval(code, {
      functions: Object.fromEntries(this.functions),
      timeout: 10_000,
    })
  }

  exposeFunction(name: string, fn: (...args: unknown[]) => Promise<unknown>) {
    this.functions.set(name, fn)
  }
}
```

### Runtime Function Bridge

Host functions exposed to LLM-generated code:

```ts
// src/runtime/runtime-functions.ts

export function createDefaultRuntimeFunctions(atua: AtuaInstance) {
  return {
    // Filesystem
    readFile: (path: string) => atua.fs.readFile(path, 'utf8'),
    writeFile: (path: string, content: string) => atua.fs.writeFile(path, content),
    listFiles: (dir: string) => atua.fs.readdir(dir),

    // Database
    query: (sql: string, params?: unknown[]) => atua.db.exec(sql, params),

    // Build
    buildBundle: (entry: string) => atua.build.bundle(entry),

    // Preview
    getPreviewUrl: (port: number) => atua.net.getPreviewUrl(port),

    // Fetch (via SW proxy — CORS handled)
    fetch: (url: string, init?: RequestInit) => fetch(url, init).then(r => r.json()),
  }
}
```

These functions are available in every LLM-generated script without any imports. The LLM can call `readFile('/src/data.json')` and get real data from OPFS.

---

## 10. Layer 4 — Dynamic Component Registry

**Goal:** Components built by Pi at runtime can be registered and used by Hashbrown in the same session.

### The Static Problem

Standard Hashbrown: you call `exposeComponent(MyComponent, {...})` at app startup. The set of components the LLM can render is fixed at build time.

### AtuaComponentRegistry

```ts
// src/registry/AtuaComponentRegistry.ts

export class AtuaComponentRegistry {
  private components = new Map<string, ExposedComponent>()
  private listeners = new Set<() => void>()

  // Static registration — existing design system components
  register(component: React.ComponentType, options: ExposeComponentOptions) {
    const exposed = exposeComponent(component, options)
    this.components.set(options.name, exposed)
    this.notify()
    return exposed
  }

  // Dynamic registration — Pi writes source, we bundle and register
  async registerFromSource(name: string, source: string, options: ExposeComponentOptions) {
    // 1. Write source to AtuaFS
    await atua.fs.writeFile(`/.atua/components/${name}.tsx`, source)

    // 2. Bundle with Rolldown
    const bundle = await atua.build.bundle(`/.atua/components/${name}.tsx`, {
      format: 'esm',
      external: ['react'],  // host React, don't bundle it
    })

    // 3. Import the bundled module
    const moduleUrl = URL.createObjectURL(
      new Blob([bundle.code], { type: 'text/javascript' })
    )
    const mod = await import(/* @vite-ignore */ moduleUrl)
    URL.revokeObjectURL(moduleUrl)

    // 4. Register with Hashbrown
    const exposed = exposeComponent(mod.default, { name, ...options })
    this.components.set(name, exposed)
    this.notify()
    return exposed
  }

  getAll(): ExposedComponent[] {
    return [...this.components.values()]
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach(l => l())
  }
}
```

### Dynamic Component Hook

```ts
// src/registry/useAtuaComponents.ts

export function useAtuaComponents(registry: AtuaComponentRegistry) {
  const [components, setComponents] = useState(registry.getAll())

  useEffect(() => {
    return registry.onChange(() => setComponents(registry.getAll()))
  }, [registry])

  return components
}
```

### The Live Extension Loop

1. User asks Pi: "Add a DataTable component that shows my users"
2. Pi writes `DataTable.tsx` to AtuaFS
3. Pi calls `catalyst.build` to validate the component builds
4. Pi calls `registry.registerFromSource('DataTable', source, { description: '...' })`
5. `AtuaComponentRegistry` bundles with Rolldown and registers
6. `useAtuaComponents()` fires, Hashbrown's component list updates
7. Next LLM response can include `<DataTable />` in the generated UI
8. The component renders immediately with real data from AtuaFS

**This loop is the key unlock.** The application's UI vocabulary grows during the session without reloading or redeploying.

---

## 11. Layer 5 — Thread → Session Bridge

**Goal:** Hashbrown conversation threads persist across page refresh and search across sessions.

### Without Pi

Threads stored directly in OPFS via AtuaFS:

```ts
// src/threads/AtuaThreadStore.ts

export class AtuaThreadStore {
  private basePath = '/.atua/threads'

  async save(threadId: string, messages: Chat.Message[]) {
    const path = `${this.basePath}/${threadId}.json`
    await atua.fs.writeFile(path, JSON.stringify(messages))
  }

  async load(threadId: string): Promise<Chat.Message[]> {
    try {
      const raw = await atua.fs.readFile(`${this.basePath}/${threadId}.json`, 'utf8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  async list(): Promise<string[]> {
    const files = await atua.fs.readdir(this.basePath)
    return files.map(f => f.replace('.json', ''))
  }
}
```

### With Pi

When Pi is present, threads are stored in wa-sqlite with FTS5 full-text search, importance weighting, and cross-session memory:

```ts
// src/threads/pi-session-adapter.ts

export class PiSessionThreadStore extends AtuaThreadStore {
  constructor(private piSession: PiSessionManager) { super() }

  async save(threadId: string, messages: Chat.Message[]) {
    // Store in OPFS (fast access)
    await super.save(threadId, messages)
    // Also persist to Pi's wa-sqlite session (searchable, memory-weighted)
    await this.piSession.save(threadId, messages)
  }

  async load(threadId: string): Promise<Chat.Message[]> {
    return this.piSession.load(threadId)
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.piSession.search(query)  // FTS5 full-text search
  }
}
```

### Thread Injection

Hashbrown's `useUiChat()` accepts a `threads` option (v0.4). The adapter injects the store:

```ts
const chat = useUiChat({
  model: 'anthropic/claude-sonnet-4-6',
  threads: {
    store: atuaUI.threads,
    maxTokens: 4096,
  },
  tools: atuaUI.tools,
  components: atuaUI.registry.getAll(),
})
```

---

## 12. Layer 6 — Schema Bridge: Skillet ↔ TypeBox

**Goal:** Pi tool definitions (TypeBox) and Hashbrown component props (Skillet) share schema definitions at the source. One schema, two consumers.

This layer is primarily for developers building on top of Atua who want to define a tool once and expose it to both Pi and Hashbrown.

```ts
// src/tools/skillet-bridge.ts

// TypeBox → Skillet (for exposing Pi tools as Hashbrown tools)
export function typeBoxToSkillet(schema: TSchema): SkilletSchema {
  if (schema.type === 'string')  return s.string(schema.description ?? '')
  if (schema.type === 'number')  return s.number(schema.description ?? '')
  if (schema.type === 'boolean') return s.boolean(schema.description ?? '')
  if (schema.type === 'object')  return s.object(
    schema.description ?? '',
    Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .map(([k, v]) => [k, typeBoxToSkillet(v as TSchema)])
    )
  )
  if (schema.type === 'array')   return s.array(
    schema.description ?? '',
    typeBoxToSkillet(schema.items as TSchema)
  )
  // fallback
  return s.string(schema.description ?? 'unknown')
}

// Skillet → JSON Schema (for sending to MCP hub)
export function skilletToJsonSchema(skillet: SkilletSchema): JSONSchema {
  // Inverse transformation — used when Hashbrown tool is registered on hub
  return skillet[SKILLET_JSON_SCHEMA_SYMBOL]  // Skillet stores the JSON Schema internally
}
```

---

## 13. The Entry Point: createAtuaUI()

Everything above surfaces through one initializer:

```ts
// src/create-atua-ui.ts

export interface AtuaUIOptions {
  atua: AtuaInstance
  model?: string              // Default model string, e.g. "anthropic/claude-sonnet-4-6"
  piSession?: PiSessionManager  // Optional — enables Pi thread bridge
  components?: ExposedComponent[]  // Initial static components
}

export function createAtuaUI(options: AtuaUIOptions): AtuaUI {
  const { atua, model, piSession, components = [] } = options

  // Initialize layers
  const threads = piSession
    ? new PiSessionThreadStore(piSession)
    : new AtuaThreadStore()

  const registry = new AtuaComponentRegistry(atua)
  components.forEach(c => registry.registerRaw(c))

  const runtime = new AtuaRuntime(
    atua.proc,
    atua.sandbox,
    createDefaultRuntimeFunctions(atua)
  )

  return {
    // React provider component
    Provider: ({ children }) => (
      <AtuaHashbrownProvider atua={atua} model={model}>
        {children}
      </AtuaHashbrownProvider>
    ),

    // Dynamic tools from MCP hub
    useTools: () => useAtuaTools(atua.hub),

    // Dynamic component registry
    registry,
    useComponents: () => useAtuaComponents(registry),

    // Runtime (replaces Hashbrown's QuickJS)
    runtime,

    // Thread storage
    threads,

    // Schema bridges
    schema: {
      toSkillet: typeBoxToSkillet,
      toJsonSchema: skilletToJsonSchema,
      mcpToSkillet: mcpToolSchemaToSkillet,
    },
  }
}
```

### Usage in a Host Application

```tsx
// app.tsx

const atua = await Atua.create()
const atuaUI = createAtuaUI({ atua, model: 'anthropic/claude-sonnet-4-6' })

function App() {
  const tools = atuaUI.useTools()
  const components = atuaUI.useComponents()

  const chat = useUiChat({
    model: 'anthropic/claude-sonnet-4-6',
    system: 'You are an AI assistant...',
    tools,
    components,
    runtime: atuaUI.runtime,
    threads: { store: atuaUI.threads, maxTokens: 4096 },
  })

  return (
    <atuaUI.Provider>
      <ChatPanel chat={chat} />
    </atuaUI.Provider>
  )
}
```

---

## 14. Modularity & Opt-In Surface

`@aspect/atua-ui` is completely optional. The dependency graph:

```
Atua         → no knowledge of Hashbrown or atua-ui
Pi           → no knowledge of Hashbrown or atua-ui
@aspect/atua-ui → imports from Atua + Pi (optional) + Hashbrown
```

Valid configurations:

| Config | Use case |
|--------|----------|
| Atua only | Runtime sandbox, build environment, no UI layer |
| Atua + Pi | Autonomous agent, terminal/code-first UI |
| Atua + atua-ui | Generative UI, no autonomous agent |
| Atua + Pi + atua-ui | Full stack |

Each layer within `@aspect/atua-ui` is also opt-in:

| Layer | Required | Without it |
|-------|----------|-----------|
| SW Proxy (Layer 1) | Yes — enables Hashbrown at all | Can't use Hashbrown without LLM access |
| MCP Bridge (Layer 2) | No | Use static `useTool()` definitions instead |
| Runtime Replacement (Layer 3) | No | Hashbrown uses its QuickJS (~1MB) |
| Dynamic Registry (Layer 4) | No | Static component list at startup |
| Thread Bridge (Layer 5) | No | In-memory threads only |
| Schema Bridge (Layer 6) | No | Manual schema duplication |

### Framework Agnosticism

The core layers (1, 2, 3, 5, 6) are framework-agnostic — they work with or without React. Only Layer 4 (dynamic component registry) and the `createAtuaUI()` entry point are React-specific today. Angular support follows the same patterns using Hashbrown's Angular package.

---

## 15. What Gets Unlocked

### For IDE (Atua + Pi + atua-ui)

**Self-building UI.** Pi writes a component → it's registered live → Hashbrown renders it in the current session. The IDE's panel layout, component palette, and preview widgets can be extended by Pi without reloading.

**Natural language project commands.** "Show me all files modified today" → Hashbrown routes to `atuafs.list` tool → renders a `<FileList>` component with the results → Pi can act on selected files.

**Predictive actions.** Every edit Pi makes fires a `useStructuredCompletion()` on current project state → suggests next actions → renders as `<ActionSuggestion>` components in the sidebar.

**Streaming build feedback.** Build output streams into a `<BuildLog>` component rendered by Hashbrown while Rolldown runs. Token-by-token, not buffered.

### For Host Applications Embedding Atua

**AI-native dashboards.** "Show Q3 revenue by region" → LLM calls `catalyst.sqlite` tool → queries wa-sqlite → renders `<BarChart>` with results. No server, no API, no deployment.

**Self-configuring forms.** User says "I need to log an expense for $42 at the airport" → `useStructuredCompletion()` produces typed `Expense` object → submits to in-browser sqlite.

**App-level theming via natural language.** "Make the interface feel more professional" → LLM generates CSS variables → writes to AtuaFS → triggers HMR → Hashbrown renders updated UI.

**Background AI processes visible in UI.** Pi runs in the background building a feature → Hashbrown renders progress components into the active chat panel as Pi's tool calls complete.

---

## 16. Dependency Manifest

### NPM Packages Added by @aspect/atua-ui

| Package | Version | What | License | Notes |
|---------|---------|------|---------|-------|
| `@hashbrownai/core` | 0.4.x | Skillet, types, streaming primitives | MIT | Pin to minor |
| `@hashbrownai/react` | 0.4.x | React hooks | MIT | Pin to minor |

**No other npm additions.** Hashbrown's QuickJS WASM is replaced — its ~1MB is not loaded.

### Atua Subsystems Used

| Subsystem | Used by |
|-----------|---------|
| `ServiceWorker` | Layer 1 — LLM proxy route |
| `AtuaFS (OPFS)` | Layer 1 (provider config), Layer 4 (component source), Layer 5 (threads) |
| `Fabric (MCP Hub)` | Layer 2 — tool bridge |
| `CatalystProc` | Layer 3 — runtime execution |
| `QuickJS sandbox` | Layer 3 — validation tier |
| `Rolldown-WASM` | Layer 4 — dynamic component bundling |
| `CatalystD1 / wa-sqlite` | Layer 5 — thread persistence (with Pi) |

---

## 17. Implementation Phases

### Phase 0: Hashbrown Baseline
**Depends on:** Nothing (can start in parallel with Atua core)
**Goal:** Hashbrown works with standard Node.js backend in isolation

**What gets built:**
- Minimal Express server using `@hashbrownai/openai`
- Basic `useUiChat()` with static tool and component
- Confirms Hashbrown wire format and streaming behavior

**Verification:**
- [ ] `POST /api/chat` returns streaming Hashbrown frames
- [ ] `useUiChat()` renders a text response
- [ ] `useTool()` fires and returns result to LLM
- [ ] `exposeComponent()` renders a component from LLM response

---

### Phase 1: ServiceWorker LLM Proxy
**Depends on:** Atua ServiceWorker (Atua Phase 7), Phase 0
**Goal:** Hashbrown works with zero backend — SW is the backend

**What gets built:**
- SW route handler for `/__atua_llm__/chat`
- Hashbrown request → provider transform (Anthropic + OpenAI + OpenRouter)
- WebSocket relay integration for CORS bypass
- Provider config storage in AtuaFS
- `AtuaHashbrownProvider` React component

**Verification:**
- [ ] `HashbrownProvider url="/__atua_llm__/chat"` works without Node backend
- [ ] Anthropic API key stored in `.atua/providers/anthropic.json` used correctly
- [ ] OpenAI API key path works
- [ ] OpenRouter (zero CORS) works without relay
- [ ] Streaming response reaches `useUiChat()` correctly
- [ ] No Node backend running — browser tab only

---

### Phase 2: MCP Tool Bridge
**Depends on:** Fabric (MCP hub), Phase 1
**Goal:** Every hub tool is a Hashbrown tool

**What gets built:**
- `useAtuaTools()` hook — hub.listTools() → useTool() array
- `mcpToolSchemaToSkillet()` converter
- `hub.onToolsChanged()` subscription → hook re-render
- Test: AtuaFS read/write tools visible in Hashbrown

**Verification:**
- [ ] `useAtuaTools()` returns tools for all registered hub providers
- [ ] LLM calls `atuafs.read` tool, receives file content
- [ ] LLM calls `atuafs.write` tool, file appears in OPFS
- [ ] Install new MCP server → tools appear in next request without restart
- [ ] Tool schema with nested object converts correctly to Skillet

---

### Phase 3: Runtime Replacement
**Depends on:** CatalystProc (Atua Phase 5), Atua QuickJS sandbox (Atua Phase 1 partial)
**Goal:** LLM-generated code runs in real Atua Worker, not QuickJS only

**What gets built:**
- `AtuaRuntime` class implementing HashbrownRuntime interface
- QuickJS validation gate
- CatalystProc execution path
- Default runtime functions (readFile, writeFile, query, fetch)
- `createRuntimeFunction()` compatibility shim

**Verification:**
- [ ] `runtime.execute('1 + 1')` returns `2` via CatalystProc
- [ ] `runtime.execute('while(true){}')` returns timeout error from QuickJS gate
- [ ] `readFile('/.atua/test.txt')` in generated code reads real OPFS file
- [ ] `query('SELECT * FROM users')` in generated code hits wa-sqlite
- [ ] Hashbrown's `useRuntime()` hook works with AtuaRuntime
- [ ] ~1MB QuickJS WASM from Hashbrown is NOT loaded (tree-shaken)

---

### Phase 4: Dynamic Component Registry
**Depends on:** Rolldown-WASM (Atua Phase 4/6), Phase 1
**Goal:** Components written at runtime are registerable and renderable

**What gets built:**
- `AtuaComponentRegistry` with `registerFromSource()`
- Rolldown bundle → object URL → dynamic import pipeline
- `useAtuaComponents()` hook with change subscription
- Integration with `useUiChat()` components option

**Verification:**
- [ ] `registry.register(StaticComp, {...})` — component renders from LLM response
- [ ] `registry.registerFromSource('Dynamic', source, {...})` — component bundles and registers
- [ ] Registered dynamic component appears in `useAtuaComponents()` output
- [ ] LLM renders dynamically registered component in chat
- [ ] Two sequential `registerFromSource()` calls — both components available

---

### Phase 5: Thread Persistence
**Depends on:** AtuaFS (Atua Phase 2), Phase 1
**Goal:** Threads survive page refresh

**What gets built:**
- `AtuaThreadStore` — OPFS-backed thread storage
- `PiSessionThreadStore` — Pi session bridge (optional)
- Integration with Hashbrown's `threads` option

**Verification:**
- [ ] Chat 5 messages → page refresh → messages restored via AtuaThreadStore
- [ ] With Pi: messages indexed in wa-sqlite FTS5, searchable
- [ ] Thread list API returns correct thread IDs
- [ ] Multiple threads — correct thread loaded by ID

---

### Phase 6: Schema Bridge + Polish
**Depends on:** All prior phases
**Goal:** Schema interop, full createAtuaUI() API, documentation

**What gets built:**
- `typeBoxToSkillet()` and `skilletToJsonSchema()` converters
- `createAtuaUI()` unified entry point
- `AtuaHashbrownProvider` with full model routing
- React example app demonstrating all layers

**Verification:**
- [ ] TypeBox schema round-trips through Skillet with type preservation
- [ ] `createAtuaUI()` initializes all layers in correct order
- [ ] Example app: text chat, tool call, generative UI, dynamic component, thread restore
- [ ] Angular: Phase 1 (SW proxy) verified with `@hashbrownai/angular`
- [ ] No console errors in browser during full example run

---

## 18. CC Kickoff Prompts

### Phase 0 kickoff

```
Read docs/plans/hashbrown-atua-spec.md. This is the spec for integrating
Hashbrown (generative UI framework) with Atua.

Implement Phase 0 only. Goal: confirm Hashbrown works with a standard Node
backend before we replace it with the SW proxy.

Set up a minimal Express backend using @hashbrownai/openai. Wire up a React
frontend with useUiChat(), one useTool(), and one exposeComponent(). 
Verify the Phase 0 checklist before moving on.

Read:
- docs/plans/hashbrown-atua-spec.md (this spec)
- https://hashbrown.dev/docs/react/start/intro (Hashbrown docs)
```

### Phase 1–6 kickoffs

```
Continue with Hashbrown × Atua Phase {N} per docs/plans/hashbrown-atua-spec.md.
Run verification checklist before committing.
git add -A && git commit -m "Sizzle Phase {N}: {description}"
```

---

## 19. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Hashbrown binary frame format not documented | High | Medium | Reverse-engineer from @hashbrownai/core source (MIT). Inspect wire format in Phase 0 before building SW encoder. |
| Hashbrown breaks on major version bump | Medium | Medium | Pin to 0.4.x. Hashbrown pre-1.0 — changes expected. Review CHANGELOG before bumping. |
| QuickJS validation false positives blocking valid code | Medium | Low | QuickJS gate is syntax + timeout only. Don't add semantic validation. Tune timeout generously (500ms). |
| Rolldown bundle fails for complex component source | Medium | Medium | Components Pi generates are React + Tailwind — well-understood bundle path. Test with realistic component shapes in Phase 4. |
| Skillet schema conversion loses fidelity for complex types | Low | Medium | Hub tools use simple schemas by design. Document unsupported patterns. `s.anyOf` is the escape hatch. |
| SW proxy latency adds perceptible delay | Low | Low | SW is in-process. WebSocket relay adds ~20-50ms. Not perceptible for LLM streaming. |
| Hashbrown's internal reactivity conflicts with React 18 concurrent features | Medium | Low | Hashbrown uses its own state management. Test with concurrent mode. Use `useDeferredValue` if needed. |
| Multiple Hashbrown providers in same app (multi-agent) | Low | Low | Each `AtuaHashbrownProvider` gets its own SW route suffix. Hub handles concurrent callers already. |
| Anthropic not yet supported in Hashbrown packages | Low | Confirmed | Hashbrown README lists "Anthropic — coming soon". Irrelevant — we're bypassing their provider packages entirely with the SW proxy. |

---

## 20. Cleanroom Protocol

### Allowed Sources
- `@hashbrownai/core`, `@hashbrownai/react`, `@hashbrownai/angular` (MIT, public npm)
- Hashbrown GitHub repo (`liveloveapp/hashbrown`, MIT) — read for interface understanding
- Atua unified spec and source (own project)
- Pi-Atua spec (own project)
- MCP TypeScript SDK (MIT)
- MDN Web Docs for browser APIs
- React documentation

### Not Accessed
- Nodepod source code
- WebContainers source or proprietary APIs
- StackBlitz proprietary technology
- Any decompiled competing runtime

### Implementation Rules
- `@aspect/atua-ui` adapter code is original work
- Hashbrown packages used as npm dependencies (MIT), not forked
- SW proxy LLM frame encoder/decoder is original implementation
- Tool bridge, runtime replacement, component registry are original
- No copy-paste from Hashbrown internals — only use public APIs

---

## 21. Success Criteria

All must pass in a real browser (Playwright chromium):

| # | Test | Proves |
|---|------|--------|
| 1 | `useUiChat()` returns text response with zero Node backends running | §7: SW proxy works |
| 2 | LLM calls `atuafs.read` tool, receives correct file content | §8: MCP bridge works |
| 3 | Install new MCP server → its tools appear in next Hashbrown request | §8: Dynamic tools work |
| 4 | `runtime.execute('readFile("/.atua/x")')` returns file from OPFS | §9: Runtime replacement works |
| 5 | `runtime.execute('while(true){}')` returns timeout within 500ms | §9: QuickJS gate works |
| 6 | `registry.registerFromSource(name, tsx, opts)` → LLM renders it | §10: Dynamic registry works |
| 7 | 5-message thread → page refresh → messages restored | §11: Thread persistence works |
| 8 | TypeBox `t.Object({x: t.String()})` → Skillet → back to JSON Schema without loss | §12: Schema bridge works |
| 9 | Full example: text chat + tool call + generative UI + dynamic component + refresh restore | §13: End-to-end works |
| 10 | `@hashbrownai/runtime` WASM is NOT in the network waterfall | §9: QuickJS replaced, not added |
| 11 | No `@aspect/atua-ui` imports in Atua core or Pi packages | §14: Modularity clean |
| 12 | Atua + Pi works without `@aspect/atua-ui` installed | §14: Optional confirmed |
