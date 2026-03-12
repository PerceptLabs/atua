# Sizzle (Hashbrown × Atua) — Implementation Plan

**Companion to:** `hashbrown-atua-spec.md`
**Package:** `@aspect/atua-ui`
**Purpose:** Execution guide for CC. Assumes Atua phases 0–12 complete. Fabric (MCP hub) operational. Conductor (Pi-Atua) optional.

---

## Pre-Flight Checklist

```bash
# Confirm Atua substrate
node -e "import('@aspect/atua-fs').then(() => console.log('OK'))"
node -e "import('@aspect/atua-fabric').then(() => console.log('OK'))"

# Confirm Hashbrown packages exist on npm
npm info @hashbrownai/core version     # must resolve
npm info @hashbrownai/react version    # must resolve

# Read Hashbrown source before writing any adapter code
# Clone or browse: github.com/liveloveapp/hashbrown
# Target files to read:
#   packages/core/src/index.ts          — exports, Chat.Api types
#   packages/core/src/streaming.ts      — frame format (THIS IS CRITICAL)
#   packages/react/src/use-ui-chat.ts   — useUiChat options shape
#   packages/react/src/use-tool.ts      — useTool interface
#   packages/react/src/expose-component.ts — exposeComponent interface

# Confirm SW infrastructure from Atua Phase 7
# The ServiceWorkerBridge from Atua Phase 7 must exist and be tested
ls packages/atua-net/src/service-worker-bridge.ts

# Confirm relay is deployed (needed for provider CORS)
curl -I https://relay.atua.dev   # must return 200 or 101
```

**The binary frame format is the single highest-risk item in this spec.** Do NOT begin Phase 1 (SW proxy) without first completing the Phase 0 wire format inspection step. Everything in Layer 1 depends on encoding frames Hashbrown's frontend can decode.

---

## Package Scaffold

```bash
mkdir -p packages/atua-ui/src/{llm,tools,runtime,registry,threads,schema}
```

`packages/atua-ui/package.json`:
```json
{
  "name": "@aspect/atua-ui",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@hashbrownai/core": "0.4.x",
    "@hashbrownai/react": "0.4.x"
  },
  "peerDependencies": {
    "@aspect/atua-fabric": "workspace:*",
    "@aspect/atua-fs": "workspace:*",
    "@aspect/atua-proc": "workspace:*",
    "react": ">=18"
  },
  "peerDependenciesMeta": {
    "@aspect/pi-atua": { "optional": true }
  }
}
```

---

## Phase 0 — Hashbrown Baseline + Wire Format Inspection

**Spec ref:** §17 Phase 0
**Depends on:** Nothing (runs independently, no Atua needed)
**Goal:** Understand exactly how Hashbrown works before touching Atua. The wire format must be known before writing the SW proxy encoder.

**Execution order:**

1. **Inspect `@hashbrownai/core` source for the streaming frame format:**
   ```bash
   cd node_modules/@hashbrownai/core/src
   grep -r "encode\|decode\|frame\|octet\|stream\|chunk" . --include="*.ts" -l
   # Open each file found — identify encodeFrame() or equivalent
   ```
   Record the exact wire format: field names, byte layout or JSON shape, content types used in the `application/octet-stream` response.

2. **Inspect `Chat.Api.CompletionCreateParams`:**
   ```bash
   grep -r "CompletionCreateParams" node_modules/@hashbrownai/core/src --include="*.ts" -A 20
   ```
   Record every field the frontend sends in its POST body. This is what the SW proxy must accept.

3. **Set up minimal Node.js baseline:**
   ```bash
   mkdir packages/hashbrown-baseline
   # Express server + @hashbrownai/openai backend
   # React frontend with useUiChat, one useTool, one exposeComponent
   ```

4. **Run baseline and capture network traffic:**
   - Open Chrome DevTools → Network tab → filter by `/api/chat`
   - Send a message that triggers a tool call
   - Record: exact request body shape, exact response headers, exact response frame bytes
   - Send a message that triggers `exposeComponent` render
   - Record: what the component definition looks like in the wire format

5. **Document findings** in `packages/atua-ui/src/llm/wire-format-notes.md`:
   - `CompletionCreateParams` field list with types
   - Frame type byte values or string identifiers
   - Text frame structure
   - Tool call frame structure  
   - Component render frame structure
   - Whether streaming uses chunked transfer or SSE or raw binary frames

**Phase 0 verification:**
```
POST /api/chat → streaming response arrives at useUiChat hook → text renders
Tool fires (useTool) → result returned to LLM → LLM continues
exposeComponent renders in chat UI
Wire format documented in wire-format-notes.md — no guessing allowed
```

**Hard gate:** Wire format notes must be complete before Phase 1 starts. If the frame encoder in Phase 1 is written without Phase 0 documentation, the SW proxy will produce malformed frames that fail silently.

---

## Phase 1 — ServiceWorker LLM Proxy (Layer 1)

**Spec ref:** §7
**Depends on:** Phase 0 (wire format known), Atua Phase 7 (SW infrastructure)

**Execution order:**

1. `packages/atua-ui/src/llm/frame-encoder.ts` — encodes LLM provider responses into Hashbrown's wire format. This is the most critical file in the entire package:
   ```ts
   // Converts Anthropic/OpenAI streaming response → Hashbrown binary frames
   // Wire format from Phase 0 notes
   export class HashbrownFrameEncoder {
     encodeTextDelta(text: string): Uint8Array
     encodeToolCallStart(id: string, name: string): Uint8Array
     encodeToolCallArgs(id: string, argsDelta: string): Uint8Array
     encodeToolCallEnd(id: string): Uint8Array
     encodeComponentRender(componentName: string, props: unknown): Uint8Array
     encodeDone(): Uint8Array
   }
   ```

2. `packages/atua-ui/src/llm/provider-transformer.ts` — transforms `CompletionCreateParams` to provider-specific format and back:
   - `toAnthropic(params: CompletionCreateParams): AnthropicMessagesRequest`
   - `toOpenAI(params: CompletionCreateParams): OpenAIChatRequest`
   - `toOpenRouter(params: CompletionCreateParams): OpenAIChatRequest` (OpenAI-compatible)

3. `packages/atua-ui/src/llm/provider-config.ts` — reads provider configs from AtuaFS:
   ```ts
   // Reads /.atua/providers/{provider}.json
   // Schema: { apiKey, baseUrl?, model? }
   export async function getProviderConfig(provider: string, fs: AtuaFS): Promise<ProviderConfig>
   ```

4. `packages/atua-ui/src/llm/sw-route-handler.ts` — SW route handler for `/__atua_llm__/chat`:
   ```ts
   export async function handleLLMRequest(request: Request, fs: AtuaFS): Promise<Response> {
     const params: CompletionCreateParams = await request.json()
     const config = await getProviderConfig(params.provider, fs)
     const providerRequest = providerTransformer.transform(params, config)
     const providerResponse = await fetch(providerRequest.url, providerRequest.init)
     // Stream through frame encoder
     const encoded = new TransformStream({
       transform(chunk, controller) {
         controller.enqueue(encoder.encode(parseChunk(chunk)))
       }
     })
     return new Response(providerResponse.body.pipeThrough(encoded), {
       headers: { 'Content-Type': 'application/octet-stream' }
     })
   }
   ```

5. Register route in Atua's preview SW: intercept `/__atua_llm__/chat` → `handleLLMRequest`

6. `packages/atua-ui/src/llm/atua-hashbrown-provider.tsx` — React component:
   ```tsx
   <HashbrownProvider url="/__atua_llm__/chat">
     {children}
   </HashbrownProvider>
   ```

7. `tests/phase1-sw-proxy.browser.test.ts`

**Phase 1 verification:**
```
HashbrownProvider url="/__atua_llm__/chat" — no Node backend running
useUiChat() sends message → SW intercepts → Anthropic called → response streams back → text renders
Anthropic API key from /.atua/providers/anthropic.json used correctly
OpenAI API key path works
OpenRouter (zero CORS issues) works directly without relay
Streaming: tokens appear progressively, not all at once after completion
Zero Node processes running during test
```

**Provider priority:** Implement OpenRouter first. It works from browser without CORS issues and accepts OpenAI-compatible format. Use it to validate the full pipeline before dealing with Anthropic/OpenAI CORS routing via the relay.

---

## Phase 2 — MCP Tool Bridge (Layer 2)

**Spec ref:** §8
**Depends on:** Phase 1, Fabric hub

**Execution order:**

1. **Read Hashbrown `useTool` interface:**
   ```bash
   grep -r "useTool\|ToolDefinition" node_modules/@hashbrownai/react/src --include="*.ts" -A 10
   ```
   Record exact shape: `{ name, description, schema: SkilletSchema, call: Function }`

2. `packages/atua-ui/src/tools/skillet-converter.ts` — `mcpToolSchemaToSkillet(mcpTool: MCPTool): SkilletToolDef`:
   - MCP tools use JSON Schema for parameters
   - Hashbrown uses Skillet (their schema DSL)
   - Map: `{ type: 'string' }` → `s.string()`, `{ type: 'object', properties: {...} }` → `s.object({...})`
   - Handle: `s.optional()` for non-required fields, `s.array()`, `s.union()` for anyOf

3. `packages/atua-ui/src/tools/hub-bridge.ts` — `useAtuaTools(hub: AtuaHub): HashbrownTool[]`:
   ```ts
   export function useAtuaTools(hub: AtuaHub) {
     const [tools, setTools] = useState<HashbrownTool[]>([])
     
     useEffect(() => {
       hub.listTools().then(mcpTools => setTools(mcpTools.map(toHashbrownTool)))
       
       const unsub = hub.onToolsChanged(() => {
         hub.listTools().then(mcpTools => setTools(mcpTools.map(toHashbrownTool)))
       })
       return unsub
     }, [hub])
     
     return tools
   }
   
   function toHashbrownTool(mcpTool: MCPTool): HashbrownTool {
     return useTool({
       name: mcpTool.name,
       description: mcpTool.description,
       schema: mcpToolSchemaToSkillet(mcpTool),
       call: (args) => hub.callTool(mcpTool.name, args),
     })
   }
   ```

4. `tests/phase2-tool-bridge.browser.test.ts`

**Phase 2 verification:**
```
useAtuaTools() returns tools for all registered hub providers (atuafs.*, catalyst.*)
LLM calls atuafs.read tool → hub.callTool routes to AtuaFS → file content returned
LLM calls atuafs.write tool → file appears in OPFS
Skillet conversion: { type: 'string', description: 'path' } → s.string().describe('path')
Skillet conversion: nested object with optional fields → correct s.object() shape
Install new MCP server → hub.onToolsChanged fires → tools update → next request includes new tools
```

**Skillet conversion edge cases to handle:** `anyOf` (→ `s.union()`), array items (→ `s.array(s.string())` etc.), `description` field (→ `.describe()`), `enum` values (→ `s.literal()` or `s.union()` of literals).

---

## Phase 3 — Runtime Replacement (Layer 3)

**Spec ref:** §9
**Depends on:** Phase 1, Atua Phase 5 (CatalystProc), Atua Phase 5 (QuickJS sandbox)

**Execution order:**

1. **Find Hashbrown's runtime interface:**
   ```bash
   grep -r "HashbrownRuntime\|createRuntime\|useRuntime" node_modules/@hashbrownai --include="*.ts" -l
   # Read found files — identify the runtime interface methods
   ```

2. `packages/atua-ui/src/runtime/quickjs-gate.ts` — QuickJS validation tier:
   ```ts
   // Validates generated code before real execution
   // Checks: syntax errors, infinite loops (via timeout), memory limits
   // Does NOT execute with side effects — dry run only
   export async function validateCode(code: string, timeoutMs = 500): Promise<ValidationResult> {
     const result = await runInSandbox(code, { timeout: timeoutMs, memoryLimit: 10 * 1024 * 1024 })
     if (result.timeoutExceeded) return { valid: false, reason: 'timeout' }
     if (result.error) return { valid: false, reason: result.error }
     return { valid: true }
   }
   ```

3. `packages/atua-ui/src/runtime/atua-runtime.ts` — `AtuaRuntime implements HashbrownRuntime`:
   ```ts
   export class AtuaRuntime {
     async execute(code: string): Promise<unknown> {
       // 1. QuickJS validation gate (syntax + timeout check)
       const validation = await validateCode(code, 500)
       if (!validation.valid) throw new RuntimeError(validation.reason)
       
       // 2. Execute in real CatalystProc Worker
       return this.proc.eval(wrapWithRuntimeFunctions(code))
     }
   }
   ```

4. `packages/atua-ui/src/runtime/runtime-functions.ts` — default functions injected into executed code:
   ```ts
   // These are available inside LLM-generated code
   export const runtimeFunctions = {
     readFile: (path: string) => hub.callTool('atuafs.read', { path }),
     writeFile: (path: string, content: string) => hub.callTool('atuafs.write', { path, content }),
     query: (sql: string, params?: unknown[]) => hub.callTool('catalyst.d1.query', { sql, params }),
     fetch: globalThis.fetch,  // real browser fetch
     buildBundle: (entry: string) => hub.callTool('catalyst.build.run', { entry }),
   }
   ```

5. `tests/phase3-runtime.browser.test.ts`

**Phase 3 verification:**
```
runtime.execute('1 + 1') === 2
runtime.execute('while(true){}') → RuntimeError with reason 'timeout' within 500ms
runtime.execute('readFile("/.atua/test.txt")') reads real OPFS file
runtime.execute('writeFile("/.atua/out.txt", "hello")') writes to OPFS
runtime.execute('query("SELECT 1")') hits wa-sqlite
useRuntime(atuaRuntime) hook wires correctly to useUiChat
@hashbrownai/runtime WASM bundle NOT present in Network waterfall
```

**Tree-shaking Hashbrown's QuickJS:** Hashbrown may not expose a way to opt out of loading its own QuickJS. If the WASM loads regardless, check if `AtuaRuntime` can be passed to `useUiChat({ runtime: atuaRuntime })` such that Hashbrown's internal runtime is never invoked. If Hashbrown's QuickJS is loaded unconditionally, file an issue upstream and document the ~1MB overhead.

---

## Phase 4 — Dynamic Component Registry (Layer 4)

**Spec ref:** §10
**Depends on:** Phase 1, Atua Phase 4 (Rolldown/bundler)

**Execution order:**

1. **Inspect `exposeComponent` interface:**
   ```bash
   grep -r "exposeComponent\|ComponentDefinition\|ComponentRegistry" node_modules/@hashbrownai --include="*.ts" -A 15
   ```
   Record: how does Hashbrown expect components to be registered? At hook call time? At provider level? What schema does `exposeComponent` take?

2. `packages/atua-ui/src/registry/atua-component-registry.ts` — `AtuaComponentRegistry`:
   ```ts
   export class AtuaComponentRegistry {
     private components = new Map<string, ComponentDef>()
     private listeners = new Set<() => void>()
     
     register(name: string, component: React.ComponentType, schema: SkilletSchema): void {
       this.components.set(name, { name, component, schema })
       this.listeners.forEach(fn => fn())
     }
     
     async registerFromSource(name: string, tsxSource: string, schema: SkilletSchema): Promise<void> {
       // 1. Bundle tsx via Rolldown
       const bundle = await bundler.bundle({ source: tsxSource, format: 'esm' })
       // 2. Create object URL and dynamic import
       const url = URL.createObjectURL(new Blob([bundle], { type: 'text/javascript' }))
       const mod = await import(/* @vite-ignore */ url)
       URL.revokeObjectURL(url)
       // 3. Register the default export
       this.register(name, mod.default, schema)
     }
     
     subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
     getAll(): ComponentDef[] { return Array.from(this.components.values()) }
   }
   ```

3. `packages/atua-ui/src/registry/use-atua-components.ts` — `useAtuaComponents(registry)` hook:
   ```ts
   export function useAtuaComponents(registry: AtuaComponentRegistry) {
     const [defs, setDefs] = useState(() => registry.getAll())
     useEffect(() => registry.subscribe(() => setDefs(registry.getAll())), [registry])
     return defs.map(def => exposeComponent(def.component, { name: def.name, schema: def.schema }))
   }
   ```

4. `tests/phase4-registry.browser.test.ts`

**Phase 4 verification:**
```
registry.register(MyComp, { name: 'MyComp', schema: s.object({...}) }) → component in useAtuaComponents()
LLM renders registered component in chat response
registry.registerFromSource('DynamicChart', tsxSource, schema):
  - Rolldown bundles source
  - Component appears in useAtuaComponents()
  - LLM renders it in next message
Two sequential registerFromSource calls → both components available
Component rendered with props matching schema → props received correctly
```

---

## Phase 5 — Thread Persistence (Layer 5)

**Spec ref:** §11
**Depends on:** Phase 1, Atua Phase 2 (AtuaFS)

**Execution order:**

1. **Find Hashbrown threads interface:**
   ```bash
   grep -r "ThreadStore\|threads\|useChat.*thread" node_modules/@hashbrownai --include="*.ts" -A 15
   ```
   Record: `threads` option shape in `useUiChat`, what methods `ThreadStore` must implement.

2. `packages/atua-ui/src/threads/atua-thread-store.ts` — `AtuaThreadStore`:
   ```ts
   // Persists to /.atua/threads/{threadId}.json via AtuaFS
   export class AtuaThreadStore implements HashbrownThreadStore {
     async save(threadId: string, messages: Message[]): Promise<void>
     async load(threadId: string): Promise<Message[] | null>
     async list(): Promise<ThreadMeta[]>
     async delete(threadId: string): Promise<void>
   }
   ```

3. `packages/atua-ui/src/threads/pi-session-thread-store.ts` — `PiSessionThreadStore` (optional, requires Pi):
   ```ts
   // Delegates to pi.session.* via hub
   // Adds: FTS5 search, importance weighting, cross-session memory
   export class PiSessionThreadStore implements HashbrownThreadStore {
     constructor(private hub: AtuaHub) {}
     async save(threadId: string, messages: Message[]): Promise<void> {
       await this.hub.callTool('pi.session.save', { id: threadId, messages })
     }
     async load(threadId: string): Promise<Message[] | null> {
       return this.hub.callTool('pi.session.get', { id: threadId })
     }
     // ...
   }
   ```

4. `packages/atua-ui/src/threads/index.ts` — factory: if Pi provider registered on hub, return `PiSessionThreadStore`, else return `AtuaThreadStore`

5. `tests/phase5-threads.browser.test.ts`

**Phase 5 verification:**
```
useUiChat({ threads: { store: new AtuaThreadStore(fs), maxTokens: 4096 } })
Send 5 messages → simulate page refresh (create new AtuaInstance) → messages restored
Thread list API: list() returns correct thread IDs and message counts
Multiple threads: each thread ID loads correct messages
With Pi: messages searchable via hub.callTool('pi.memory.search')
Without Pi: falls back to AtuaThreadStore gracefully (no import errors)
```

---

## Phase 6 — Schema Bridge + Polish (Layer 6)

**Spec ref:** §12, §13
**Depends on:** All prior phases

**Execution order:**

1. `packages/atua-ui/src/schema/type-box-to-skillet.ts` — `typeBoxToSkillet(schema: TSchema): SkilletSchema`:
   - `t.String()` → `s.string()`
   - `t.Number()` → `s.number()`
   - `t.Boolean()` → `s.boolean()`
   - `t.Object({...})` → `s.object({...})` recursively
   - `t.Array(t.String())` → `s.array(s.string())`
   - `t.Optional(t.String())` → `s.optional(s.string())`
   - `t.Union([t.Literal('a'), t.Literal('b')])` → `s.union([s.literal('a'), s.literal('b')])`
   - Preserve `.description` via `.describe()` on output

2. `packages/atua-ui/src/schema/skillet-to-json-schema.ts` — `skilletToJsonSchema(schema: SkilletSchema): JSONSchema7` — reverse of above

3. `packages/atua-ui/src/index.ts` — `createAtuaUI()` unified entry point:
   ```ts
   export function createAtuaUI({ atua, model, piSession }: CreateAtuaUIOptions) {
     const sw = atua.serviceWorker
     registerLLMRoute(sw, atua.fs)   // Layer 1
     
     const runtime = new AtuaRuntime(atua.proc, atua.hub)  // Layer 3
     const registry = new AtuaComponentRegistry(atua.bundler)  // Layer 4
     const threads = piSession
       ? new PiSessionThreadStore(atua.hub)
       : new AtuaThreadStore(atua.fs)  // Layer 5
     
     return {
       Provider: ({ children }) => (
         <HashbrownProvider url="/__atua_llm__/chat">{children}</HashbrownProvider>
       ),
       useTools: () => useAtuaTools(atua.hub),  // Layer 2
       registry,
       useComponents: () => useAtuaComponents(registry),
       runtime,
       threads,
       schema: { toSkillet: typeBoxToSkillet, toJsonSchema: skilletToJsonSchema, mcpToSkillet: mcpToolSchemaToSkillet },
     }
   }
   ```

4. `packages/atua-ui/src/examples/full-example.tsx` — demo app showing all layers

5. `tests/phase6-schema.browser.test.ts` + `tests/phase6-e2e.browser.test.ts`

**Phase 6 verification:**
```
t.Object({ x: t.String(), y: t.Optional(t.Number()) }) → Skillet → JSON Schema → no data loss
Round-trip: TypeBox → Skillet → back to TypeBox equivalent
createAtuaUI() initializes layers in correct dependency order
Full example app: text → tool call → generative component → dynamic component → refresh restore
No @aspect/atua-ui imports in @aspect/atua-fabric, @aspect/atua-fs (modularity)
Atua + Pi boots without @aspect/atua-ui installed — no import errors
```

---

## Isolation Verification

After Phase 6, confirm modularity is clean:

```bash
# No atua-ui imports in core packages
grep -r "atua-ui" packages/atua-fabric/src/ packages/atua-fs/src/ packages/pi-atua/src/
# Must return zero results

# Atua works without atua-ui
pnpm --filter @aspect/atua test  # must pass without atua-ui installed

# Pi works without atua-ui  
pnpm --filter @aspect/pi-atua test  # must pass without atua-ui installed
```

---

## Wire Format Risk — Escalation Protocol

If during Phase 1, Hashbrown's wire format is found to be:
- **Undocumented and complex** (custom binary encoding): Allocate extra time for frame-by-frame inspection. Use `ReadableStream` reader to log raw bytes from a Phase 0 baseline response.
- **Version-locked** (internals changed in 0.4 vs 0.3): Check Hashbrown CHANGELOG. Pin to the exact minor.patch version inspected in Phase 0.
- **Changing at HEAD** (pre-release instability): Pin to a specific git SHA, not `0.4.x`.

In any of these cases, file a GitHub issue on `liveloveapp/hashbrown` asking for the wire format to be documented as a stable public API. This benefits all third-party integrations, not just Atua.
