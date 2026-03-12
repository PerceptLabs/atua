# Atua — Transport Implementation Plan

**Companion to:** `atua-transport-spec.md`  
**Purpose:** Execution guide for CC. The spec defines *what* to build. This defines *how* — file order, exact blockers, pre-flight checks, and the boundary conditions that will stop a phase dead if missed.

---

## Pre-Flight Checklist

Run before CC writes a single line:

```bash
# Confirm test infrastructure is live (transport depends on it)
pnpm test --reporter=verbose tests/sanity.browser.test.ts
# Must pass: crossOriginIsolated === true, SharedArrayBuffer available, OPFS accessible

# Confirm AtuaFS is available (transport uses it for auth storage, session events)
pnpm test tests/fs.browser.test.ts

# Confirm ServiceWorker phase complete (inbound endpoints live in SW)
pnpm test tests/http.browser.test.ts

# Count any existing transport stubs to avoid duplicating
grep -r "AtuaTransportRouter\|WebSocketAdapter\|SSEAdapter\|AtuaProviderTransport" src/ --include="*.ts" | wc -l
```

---

## Phase T0 — Auth Storage

**Spec ref:** §10  
**Depends on:** AtuaFS (Atua Phase 2)  
**CC constraint:** Everything else in transport reads credentials from here. Build first, build correctly. No credentials ever go in query params, URLs, logs, or localStorage.

**Execution order:**
1. `transport/auth/atua-auth-storage.ts` — `AtuaAuthStorage`:
   ```ts
   const AUTH_PATH = '/.atua/auth.json'

   export class AtuaAuthStorage {
     constructor(private fs: AtuaFS) {}

     async set(provider: string, credentials: ProviderCredentials): Promise<void>
     async get(provider: string): Promise<ProviderCredentials | null>
     async delete(provider: string): Promise<void>
     async list(): Promise<string[]>
   }

   export interface ProviderCredentials {
     apiKey?: string
     proxyUrl?: string    // for custom/self-hosted endpoints
     ephemeralToken?: string  // Gemini: short-lived, rotated
     ephemeralExpiry?: number // unix ms — discard if Date.now() > expiry
   }
   ```
   - Storage in `/.atua/auth.json` as a flat `Record<string, ProviderCredentials>` JSON object
   - Read/write via `AtuaFS.readFile` / `AtuaFS.writeFile` with `'utf8'` encoding
   - File is created on first `set()` if missing; missing file on `get()` returns null
2. `transport/auth/atua-auth-storage.test.ts` — unit tests with real AtuaFS:
   ```
   set('openai', { apiKey: 'sk-test' }) → get('openai') === { apiKey: 'sk-test' }
   get('nonexistent') === null
   delete('openai') → get('openai') === null
   list() returns all stored provider names
   second set() overwrites first (no duplicates)
   ```

**Hard gate:** All auth tests pass. No test touches localStorage, sessionStorage, or any browser storage other than OPFS.

---

## Phase T1 — Provider Formats

**Spec ref:** §9  
**Depends on:** Phase T0  
**CC constraint:** All provider-specific knowledge lives here and only here. No other file may branch on `provider === 'anthropic'` or similar. Build formats in the order specified — OpenRouter first because it validates the full pipeline without proxy infrastructure.

**The interface (implement verbatim — do not deviate):**
```ts
export interface ProviderFormat {
  supportsWebSocket: boolean
  wsEndpoint?: string
  httpEndpoint: string
  wsAuthMethod?: 'header' | 'first_message' | 'query_param'

  serializeTurn(request: ProviderTurnRequest): unknown
  normalizeEvent(raw: unknown): NormalizedEvent
  extraHeaders(): Record<string, string>
  cancelEvent?(): unknown
}

export type NormalizedEvent =
  | { type: 'token';    delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'turn_end'; reason: FinishReason; usage: Usage }
  | { type: 'session_end' }
  | { type: 'ignore' }  // provider heartbeats, metadata, non-content events
```

**Execution order (one file per format):**

1. `transport/formats/openrouter-format.ts` — `OpenRouterFormat`:
   - `supportsWebSocket: false`
   - `httpEndpoint: 'https://openrouter.ai/api/v1/chat/completions'`
   - `serializeTurn` → OpenAI-compatible chat completion body with `stream: true`
   - `normalizeEvent` → parses `data: {...}` SSE lines, extracts `choices[0].delta.content`
   - `extraHeaders()` → `{ 'HTTP-Referer': 'https://atua.com', 'X-Title': 'Atua' }` (OpenRouter recommends these)
   - **No proxy needed** — OpenRouter sends CORS headers. This format validates the full Pi → transport pipeline before any infrastructure exists.

2. `transport/formats/anthropic-format.ts` — `AnthropicFormat`:
   - `supportsWebSocket: false`
   - `httpEndpoint: '/proxy/llm/anthropic'` (relative — resolved by SSEAdapter based on deployment config)
   - `serializeTurn` → Anthropic Messages API body: `{ model, messages, system, tools, stream: true, max_tokens }`
   - `normalizeEvent` → handles `content_block_delta` (text), `content_block_start` (tool_use start), `content_block_stop`, `message_delta` (stop_reason, usage), `message_stop`
   - `extraHeaders()` → `{ 'anthropic-version': '2023-06-01', 'x-api-key': '...' }` — BUT: api key is injected by the proxy, not this format. `extraHeaders()` returns only the version header for client use; key is added server-side.

3. `transport/formats/openai-responses-format.ts` — `OpenAIResponsesFormat`:
   - `supportsWebSocket: true`
   - `wsEndpoint: 'wss://api.openai.com/v1/realtime?model={model}'`
   - `wsAuthMethod: 'header'` (Authorization on upgrade)
   - `serializeTurn` → `{ type: 'response.create', response: { instructions, tools, input: [...newMessages], previous_response_id? } }`
   - `normalizeEvent` → handles `response.audio_transcript.delta` (text), `response.function_call_arguments.delta` (tool streaming), `response.done` (turn_end), `error`
   - Track `previous_response_id` in format instance — updated on each `response.done` event
   - Warmup message: `{ type: 'response.create', generate: false }` on connect — send before any real turn

4. `transport/formats/gemini-live-format.ts` — `GeminiLiveFormat`:
   - `supportsWebSocket: true`
   - `wsEndpoint: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'`
   - `wsAuthMethod: 'query_param'` (ephemeral token as `?key=...`)
   - First message MUST be `BidiGenerateContentSetup` with model + tools. Block subsequent sends until `BidiGenerateContentSetupComplete` received.
   - `normalizeEvent` → `serverContent.modelTurn.parts` → text deltas; `toolCall` events → tool_call; `serverContent.turnComplete` → turn_end
   - **Ephemeral token handling:** On connect, `AtuaAuthStorage.get('gemini')` returns `{ ephemeralToken, ephemeralExpiry }`. If `Date.now() > expiry`, fetch new ephemeral token from atua.com `/auth/gemini/token` before connecting. If self-hosted and no ephemeral service: fall back to direct API key (security warning logged).

5. `transport/formats/openai-sse-format.ts` — `OpenAISSEFormat`:
   - `supportsWebSocket: false`
   - `httpEndpoint: 'https://api.openai.com/v1/chat/completions'`
   - Same normalization as OpenRouterFormat (both are OpenAI-compatible SSE)
   - Used for single-shot calls where session persistence is not needed

6. `transport/formats/ollama-format.ts` — `OllamaFormat`:
   - `supportsWebSocket: false`
   - `httpEndpoint: 'http://localhost:11434/api/chat'`
   - `serializeTurn` → Ollama chat body with `stream: true`
   - `normalizeEvent` → `{ message: { content }, done }` per line

**Tests for each format (unit tests, no network — mock the raw events):**
```
serializeTurn produces correct shape for provider
normalizeEvent('token') returns { type: 'token', delta }
normalizeEvent('tool_call') returns { type: 'tool_call', call }
normalizeEvent('turn_end') returns { type: 'turn_end', reason, usage }
normalizeEvent(heartbeat/metadata) returns { type: 'ignore' }
```

**Hard gate:** All six format files exist. All format unit tests pass. No format file exceeds 200 lines — if it does, normalizeEvent is doing too much.

---

## Phase T2 — Transport Adapters

**Spec ref:** §5.3, §5.4  
**Depends on:** Phase T1  
**CC constraint:** Adapters own connection lifecycle only. They do not parse provider events — that is ProviderFormat's job. Do not inline any provider-specific logic.

**Execution order:**

1. `transport/adapters/websocket-adapter.ts` — `WebSocketAdapter implements AtuaProviderTransport`:
   - Constructor: `(wsEndpoint: string, credentials: ProviderCredentials, format: ProviderFormat)`
   - `connect()`: opens `WebSocket`, sets `Authorization` header on upgrade (WSS), waits for `open` event
   - `send(request)`: calls `format.serializeTurn(request)`, sends JSON via `ws.send()`
   - `cancel()`: sends `format.cancelEvent()` if defined; else `ws.close(4000, 'cancelled')`
   - Incoming messages: `ws.onmessage` → `format.normalizeEvent(JSON.parse(data))` → emit typed event
   - Reconnect: exponential backoff (100ms, 200ms, 400ms… max 30s). On reconnect: re-send warmup message if `format` requires it (OpenAI). Emit `reconnecting(attempt)` before each attempt, `reconnected()` on success.
   - 60-minute OpenAI limit: set a timer at connect; 55 minutes → proactive reconnect so the session doesn't die mid-response
   - `close()`: `ws.close(1000)`, clear reconnect timer

2. `transport/adapters/sse-adapter.ts` — `SSEAdapter implements AtuaProviderTransport`:
   - Constructor: `(resolvedEndpoint: string, credentials: ProviderCredentials, format: ProviderFormat)`
   - `send(request)`: `fetch(resolvedEndpoint, { method: 'POST', headers: format.extraHeaders(), body: JSON.stringify(format.serializeTurn(request)) })`
   - Parse SSE response body: `ReadableStream` → split on `\n\n` → parse `data:` lines → `format.normalizeEvent()` → emit
   - SSE is stateless per-request — `reconnect()` is a no-op (Pi injects full context on next `send()`)
   - `cancel()`: `AbortController.abort()` on the current fetch

3. `transport/adapters/transport.types.ts` — shared types:
   ```ts
   export interface AtuaProviderTransport { ... }  // from spec §5.2 verbatim
   export interface ProviderTurnRequest { ... }
   export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'cancelled'
   export interface Usage { inputTokens: number; outputTokens: number }
   export interface ToolCall { id: string; name: string; args: unknown }
   export interface TransportError { code: string; message: string; retryable: boolean }
   ```

**Tests (browser tests — real WebSocket + SSE behavior, mock server):**

Use Playwright's `page.route()` to intercept WebSocket and fetch calls:
```
WebSocketAdapter: connect → send → receive token events → receive turn_end
WebSocketAdapter: WS drops → reconnect fires → reconnected event emits
WebSocketAdapter: cancel → cancelEvent sent (or close 4000)
SSEAdapter: send → fetch POST → SSE stream → token events → turn_end
SSEAdapter: cancel → AbortController aborts in-flight fetch
SSEAdapter: reconnect() is a no-op (no error thrown)
```

**Hard gate:** Adapter tests pass. Adapters have zero `if provider === 'anthropic'` type branches — all provider knowledge is in formats.

---

## Phase T3 — Transport Router

**Spec ref:** §5.5  
**Depends on:** Phase T2, Phase T0  
**CC constraint:** `resolvedEndpoint` for SSE providers is set at router construction time from deployment config — not hardcoded in the provider format. The format never knows which deployment it's in. The router does.

**Execution order:**

1. `transport/deployment-config.ts` — `AtuaDeploymentConfig`:
   ```ts
   export interface AtuaDeploymentConfig {
     mode: 'hosted' | 'self-hosted' | 'embed' | 'desktop'
     // hosted: 'https://atua.com'
     // self-hosted: undefined (relay used for non-CORS providers)
     // embed: undefined (streamFn/fetchFn injected by host)
     // desktop: undefined (host process handles outbound)
     hostedOrigin?: string

     relayUrl: string      // 'wss://relay.atua.dev' — used only in self-hosted bare
     streamFn?: (request: unknown) => Promise<Response>   // embed injection point
     fetchFn?:  (url: string, init?: RequestInit) => Promise<Response>
   }

   export function detectDeploymentMode(): AtuaDeploymentConfig {
     // hosted: window.location.origin === 'https://atua.com' (or agent.atua.com, ide.atua.com)
     // desktop: globalThis.window === undefined OR Electron/Tauri detection
     // else: self-hosted
   }

   export function resolveEndpoint(
     provider: string,
     format: ProviderFormat,
     config: AtuaDeploymentConfig
   ): string {
     if (format.supportsWebSocket) return format.wsEndpoint!
     if (provider === 'openrouter' || provider === 'ollama') return format.httpEndpoint  // CORS-friendly
     if (config.mode === 'hosted') return `${config.hostedOrigin}/proxy/llm/${provider}`
     if (config.mode === 'embed' || config.mode === 'desktop') return format.httpEndpoint  // host handles proxy
     return `${config.relayUrl}/llm/${provider}`  // self-hosted bare: relay
   }
   ```

2. `transport/atua-transport-router.ts` — `AtuaTransportRouter` (verbatim from spec §5.5 with `resolvedEndpoint` resolved by `resolveEndpoint()`):
   - `getTransport(provider, sessionId)` — cache by `${provider.id}:${sessionId}`
   - On cache miss: `resolveEndpoint()` → `new WebSocketAdapter` or `new SSEAdapter`
   - For WebSocket: `await transport.connect()` before returning
   - `releaseSession(sessionId)` — close and remove all transports for that session
   - `closeAll()` — close everything (used on page unload)

3. `transport/provider-config.ts` — `ProviderConfig` factory:
   ```ts
   export function buildProviderConfig(
     providerId: string,
     auth: AtuaAuthStorage,
     deploymentConfig: AtuaDeploymentConfig
   ): ProviderConfig
   ```
   Maps provider ID string → `{ id, format, apiKey, resolvedEndpoint, supportsWebSocket }`

4. `tests/transport-router.browser.test.ts`:
   ```
   hosted mode → Anthropic resolvedEndpoint === '/proxy/llm/anthropic' (relative same-origin)
   self-hosted mode → Anthropic resolvedEndpoint === 'wss://relay.atua.dev/llm/anthropic'
   OpenRouter → always direct (CORS-friendly, never relay)
   OpenAI → WebSocketAdapter returned
   Anthropic → SSEAdapter returned
   getTransport same session twice → same instance returned (cached)
   releaseSession → transport.close() called, cache cleared
   ```

**Hard gate:** All deployment mode routing tests pass. No hardcoded relay URL anywhere in `src/transport/` except `deployment-config.ts`.

---

## Phase T4 — Outbound MCP Client

**Spec ref:** §6  
**Depends on:** Phase T3 (uses same deployment-aware fetch path)  
**CC constraint:** Do NOT implement WebSocket MCP transport — MCP SEP-1288 is not ratified. Streamable HTTP only. SSE legacy transport is the fallback for servers that reject POST.

**Execution order:**

1. `transport/mcp/mcp-streamable-client.ts` — `McpStreamableClient`:
   ```ts
   export class McpStreamableClient {
     constructor(private serverUrl: string, private sessionId?: string) {}

     async call(method: string, params: unknown): Promise<unknown>
     async stream(method: string, params: unknown): AsyncGenerator<unknown>
     close(): void
   }
   ```
   - `call()`: `POST {serverUrl}` with `Content-Type: application/json`, body `{ jsonrpc: '2.0', method, params, id }`, `Mcp-Session-Id` header if `sessionId` set
   - `stream()`: `POST {serverUrl}` with `Accept: text/event-stream`, parse SSE response
   - On 405 from POST or GET: fall back to legacy SSE transport (see step 2)
   - On `Mcp-Session-Id` in response headers: store and send on subsequent requests

2. `transport/mcp/mcp-legacy-sse-client.ts` — `McpLegacySseClient`:
   - GET to `{serverUrl}/sse` → persistent SSE stream for server → client notifications
   - POST to `{serverUrl}/messages` for client → server calls
   - Used only when server returns 405 on Streamable HTTP POST

3. `transport/mcp/mcp-client-factory.ts` — `createMcpClient(serverUrl)`:
   - Probe with a `POST` to the server URL
   - `200` → return `McpStreamableClient`
   - `405` → return `McpLegacySseClient`

4. `transport/mcp/stdio-mcp-bridge.ts` — `StdioMcpBridge`:
   - Wraps a Worker running an MCP server. Bridges Worker's `stdin`/`stdout` (via MessageChannel) to `McpStreamableClient` interface.
   - Already specified in pi-atua spec §14 — verify it's not duplicated.

5. `tests/mcp-client.browser.test.ts` — use Playwright intercept to mock an MCP server:
   ```
   call() returns correct JSON-RPC response
   stream() yields events from SSE response
   405 response triggers fallback to legacy SSE client
   Mcp-Session-Id from response stored and sent on next call
   ```

**Hard gate:** MCP client tests pass. `McpStreamableClient` has zero WebSocket code.

---

## Phase T5 — Inbound: SW MCP Endpoint

**Spec ref:** §7.2  
**Depends on:** Phase T3, Atua Phase 7 (ServiceWorker), Fabric hub  
**CC constraint:** Origin validation is mandatory. An `/__atua_mcp__` endpoint without origin checking is a DNS rebinding vulnerability. Validate on every request, not just once.

**Execution order:**

1. `transport/inbound/sw-mcp-endpoint.ts` — `SwMcpEndpoint`:
   ```ts
   export class SwMcpEndpoint {
     constructor(private hub: FabricHub, private allowedOrigins: string[]) {}
     register(sw: ServiceWorkerGlobalScope): void
     private handleRequest(request: Request): Promise<Response>
   }
   ```
   - `register()`: adds fetch handler for `/__atua_mcp__` prefix to SW
   - `handleRequest()`:
     - Validate `Origin` header against `allowedOrigins`. Return 403 if not in list.
     - Parse JSON-RPC body: `{ method, params, id }`
     - Route to `hub.callTool(method, params)` (MCP tool calls) or `hub.listTools()` (MCP `tools/list`)
     - Return streaming response for `tools/call` (server-sent events), plain JSON for `tools/list`
   - `allowedOrigins`: defaults to `[self.location.origin]`. Configurable for embed scenarios.

2. `transport/inbound/tab-registry.ts` — `TabRegistry`:
   - On Atua init: register tab with relay via `POST https://relay.atua.dev/register` with `{ tabId, origin, token }`
   - Tab ID is a UUID generated per session, stored in `/.atua/session.json`
   - Auth token from `AtuaAuthStorage`
   - On page `unload` / `pagehide`: `POST https://relay.atua.dev/unregister`
   - Relay uses this registry to route `wss://relay.atua.dev/mcp/{tabId}` to the correct browser tab

3. `tests/sw-mcp-endpoint.browser.test.ts`:
   ```
   POST /__atua_mcp__ with valid Origin → routes to hub → returns tool result
   POST /__atua_mcp__ with invalid Origin → 403
   POST /__atua_mcp__ tools/list → returns hub tool list
   ```

**Hard gate:** Origin validation test passes. A request with a fake origin returns 403, not a tool result.

---

## Phase T6 — Inbound: Session Bus

**Spec ref:** §7.3  
**Depends on:** Phase T5, AtuaFS (for event log)  
**CC constraint:** Session lifecycle is independent of WebSocket connection lifecycle. A session running when a WebSocket drops must keep running. Reconnecting clients must be able to catch up via event log — never require a session restart.

**Execution order:**

1. `transport/inbound/atua-session-bus.ts` — `AtuaSessionBus`:
   ```ts
   export class AtuaSessionBus {
     constructor(private fs: AtuaFS) {}

     async createSession(sessionId: string, meta: SessionMeta): Promise<void>
     async emit(sessionId: string, event: SessionEvent): Promise<void>
     async subscribe(sessionId: string, handler: (event: SessionEvent) => void): Unsubscribe
     async history(sessionId: string, since?: number): Promise<SessionEvent[]>
     async endSession(sessionId: string): Promise<void>
   }
   ```
   - `emit()`: appends event as JSON line to `/.atua/sessions/{sessionId}/events.jsonl` AND fans out to all active subscribers
   - `subscribe()`: adds in-memory handler; returns unsubscribe function
   - `history()`: reads `events.jsonl`, parses lines, filters by `event.ts > since`
   - `endSession()`: emits `session.ended`, clears subscribers, leaves log on disk

2. `transport/inbound/session-event-types.ts` — `SessionEvent`, `SessionCommand` types (verbatim from spec §7.3)

3. `transport/inbound/sw-session-endpoint.ts` — `SwSessionEndpoint`:
   - SW WebSocket upgrade handler at `/__atua_session__/{sessionId}`
   - Origin validation (same as MCP endpoint)
   - On connect: `bus.subscribe(sessionId, ws.send)` + send missed events via `bus.history(sessionId, sinceTimestamp)`
   - On message: parse `SessionCommand`, route to Pi session (send/cancel require auth token validation)
   - On WS close: `bus.unsubscribe()` — session continues running

4. `tests/session-bus.browser.test.ts`:
   ```
   emit() → subscriber receives event
   emit() → event appended to JSONL file
   two subscribers → both receive same event
   WS closes → session keeps emitting to remaining subscribers
   reconnect with since=T → receives only events after T
   session.send command with valid token → forwarded to Pi session
   session.send command without token → 401
   ```

**Hard gate:** "WS closes → session keeps emitting" test passes. This is the critical invariant.

---

## Phase T7 — Relay: Extended Routes

**Spec ref:** §7.2, §7.3, §8  
**Depends on:** Atua Phase 11 (relay exists with TCP bridge)  
**CC constraint:** Atua Phase 11 already deploys a relay with TCP bridge + LLM proxy. This phase extends that relay with two more routes: the MCP tab bridge and the session WebSocket bridge. Do NOT rewrite Phase 11's relay — extend it. If Phase 11 hasn't deployed yet, implement all routes together.

**Execution order:**

Check Phase 11 relay status first:
```bash
wscat -c 'wss://relay.atua.dev/tcp/echo.example.com/80'
# If this works, Phase 11 is deployed. Add routes to the existing Worker.
# If not, implement all relay routes from scratch.
```

1. Extend `packages/relay/src/index.ts` with two new route handlers:

   **MCP tab bridge** — `wss://relay.atua.dev/mcp/{tabId}`:
   - Incoming WebSocket from external client (Claude Desktop, CI, etc.)
   - Look up `tabId` in tab registry (KV store or Durable Object, populated by `TabRegistry.register()`)
   - If tab not found: close WS with `4404 Tab not found`
   - If found: bidirectional proxy between the external client WS and the tab's `/__atua_mcp__` endpoint
   - Tab lookup must be fast — use Cloudflare KV or Durable Objects, not an external DB

   **Session bridge** — `wss://relay.atua.dev/session/{sessionId}`:
   - Incoming WebSocket from external observer
   - Forward to the tab that owns the session (same tab registry lookup)
   - Proxy `SessionEvent` stream from tab to observer
   - Proxy `SessionCommand` from observer to tab

2. `packages/relay/src/tab-registry.ts` — KV-backed tab registry:
   - `register(tabId, origin, wsEndpoint)` — sets KV key `tab:{tabId}` with TTL 24h
   - `lookup(tabId)` — returns tab WS endpoint or null
   - `unregister(tabId)` — deletes KV key

3. Deploy:
   ```bash
   wrangler deploy
   ```

4. Smoke tests (run against deployed relay, not local):
   ```
   wss://relay.atua.dev/tcp/echo.example.com/80 → data round-trips (Phase 11 criterion)
   wss://relay.atua.dev/mcp/{unknownTabId} → closes with 4404
   wss://relay.atua.dev/session/{unknownSessionId} → closes with 4404
   ```

**Hard gate:** Relay deploys successfully. All three route types (TCP, MCP, session) accept connections without error.

---

## Phase T8 — Conductor Integration

**Spec ref:** Transport spec §11 (what changes in Conductor Phase 4)  
**Depends on:** Phase T3, Conductor Phase 3  
**CC constraint:** This phase modifies the existing Conductor implementation. Conductor Phase 4 currently routes Pi's LLM calls via a hardcoded relay URL. Replace that with `AtuaTransportRouter`. The Pi call site must not change — only the transport layer beneath it.

**Execution order:**

1. Read `conductor-implementation-plan.md` Phase 4. Identify where Pi constructs its LLM adapter.
2. Replace hardcoded relay URL with `AtuaTransportRouter.getTransport(providerConfig, sessionId)`
3. Ensure Pi calls `router.releaseSession(sessionId)` when a session ends
4. Smoke test with OpenRouter first (CORS-friendly, no infrastructure needed):
   ```ts
   // In Conductor test — real OpenRouter call, no mocks
   const session = await conductor.createSession({
     provider: 'openrouter',
     model: 'openai/gpt-4o-mini',
   })
   const response = await session.send('What is 2 + 2?')
   expect(response).toContain('4')
   ```
5. Then test Anthropic (requires atua.com proxy or relay — confirm which environment CI runs in)

**Hard gate:** OpenRouter real-call test passes. No hardcoded `relay.atua.dev` URL remains in Conductor source.

---

## Final Verification Gate

Run after all transport phases complete:

```bash
# No hardcoded relay URLs outside deployment-config.ts
grep -r "relay.atua.dev" src/ --include="*.ts" | grep -v "deployment-config.ts"
# Must return zero results

# No credentials in URLs or query params
grep -r "apiKey\|api_key" src/transport/ --include="*.ts" | grep -v "auth.json\|AtuaAuthStorage\|ProviderCredentials"
# Must return zero results

# Full transport test suite
pnpm test tests/transport-router.browser.test.ts \
           tests/sw-mcp-endpoint.browser.test.ts \
           tests/session-bus.browser.test.ts \
           tests/mcp-client.browser.test.ts \
           tests/transport-router.browser.test.ts

# Relay smoke test (requires deployed relay)
wscat -c 'wss://relay.atua.dev/tcp/echo.example.com/80'
```

**The critical end-to-end test (real browser, no mocks):**
```ts
// Validates the entire outbound path: router → format → adapter → provider
const atua = await AtuaInstance.create()
const router = new AtuaTransportRouter(detectDeploymentConfig(), atua.auth)

const transport = await router.getTransport(
  buildProviderConfig('openrouter', atua.auth, router.config),
  'test-session'
)

const tokens: string[] = []
transport.on('token', delta => tokens.push(delta))
transport.on('turn_end', () => {
  expect(tokens.join('')).toContain('4')
  router.releaseSession('test-session')
})

transport.send({
  sessionId: 'test-session',
  messages: [{ role: 'user', content: 'What is 2 + 2? Answer with just the number.' }],
  model: 'openai/gpt-4o-mini',
})
```

Zero grep matches + all tests green + real LLM call returns tokens = transport complete.
