# Atua — Transport Specification

**Scope:** All communication between Atua and the outside world.  
**Does not cover:** Internal Fabric hub communication (in-process MessageChannel/Comlink — already correct and settled).

---

## §1 — The CORS Problem and How Atua Solves It

CORS is a browser restriction on HTTP responses. `fetch()` from a browser page or ServiceWorker is subject to it. Not all mechanisms are.

**Techniques that are CORS-free:**

| Mechanism | Why | Atua use |
|---|---|---|
| WebSocket (`wss://`) | Browser sends `Origin` on upgrade but does not enforce CORS response headers. Server validates Origin server-side. | Direct to OpenAI, Gemini |
| Same-origin `fetch()` | Calling your own server is never blocked. | atua.com hosted deployment |
| postMessage / MessageChannel | Not HTTP. Cross-context messaging within the browser. | Internal Fabric hub |
| SharedArrayBuffer / Atomics | Shared memory, no network. | Internal kernel transport |
| Dynamic `import()` | ES module loader, not fetch(). Loads JS from external URLs without CORS restrictions. | esm.sh package loading |
| JSONP (`<script>` tag) | Not HTTP response, not CORS-checked. GET only, JS responses only. | Historical curiosity. Not used. |

**Techniques that are NOT CORS-free:**

- `fetch()` from browser page or ServiceWorker to a third-party URL — CORS applies regardless of whether Hono or any other server is running in the ServiceWorker. The SW is still a browser context. Having a server inside the SW does not help with outbound calls.
- `EventSource` (SSE) — same restriction as fetch.

The ServiceWorker intercepts inbound requests (from page to SW). It cannot make outbound calls to third-party servers without those servers sending CORS headers.

---

## §2 — Deployment Model and CORS Resolution

The CORS solution depends on how Atua is deployed. The architecture handles all cases without changing the application layer.

### 2.1 Hosted Product (atua.com, agent.atua.com, ide.atua.com)

Atua is served from atua.com. The PWA's origin is atua.com. Calling back to atua.com is same-origin — never blocked.

```
Atua PWA (browser, origin: atua.com)
    │
    │  same-origin fetch to atua.com/proxy/llm/{provider}
    │  (not CORS — calling your own server)
    ▼
atua.com Cloudflare Worker
    │
    │  server-side fetch, no CORS
    ▼
Anthropic / any provider
```

The atua.com server IS the proxy. No relay.atua.dev needed. No separate infrastructure. This is how every hosted AI product works — Lovable, v0, Bolt all call their own backend; their backend calls the provider.

**Planned domains:**
- `agent.atua.com` — headless Atua, no IDE chrome. Pure agent interface.
- `ide.atua.com` — Atua with full IDE shell (editor, file tree, preview).

Same engine, same auth, same AtuaFS, same Fabric hub underneath. The domain selects which frontend shell loads. Same-origin proxy in both cases.

### 2.2 Third-Party Embed (builder.com embeds Atua, etc.)

The embedding site can provide its own proxy endpoint via `streamFn` / `fetchFn` host transport injection. The host app's backend proxies outbound — no relay needed. Atua calls the function, doesn't know or care how the host makes the outbound call.

```typescript
// Host app injects its own transport at createPiAgent() time
createPiAgent({
  hub,
  streamFn: async (messages) => {
    // Host calls its own backend, which calls the provider
    return fetch('/api/llm/stream', { method: 'POST', body: JSON.stringify(messages) })
  }
})
```

### 2.3 Self-Hosted / Bare PWA

No atua.com backend. No host to inject transport. This is the fallback case where relay.atua.dev earns its place.

- **WebSocket-native providers (OpenAI, Gemini):** Direct browser WebSocket, CORS-free. No relay.
- **CORS-friendly providers (OpenRouter):** Sends CORS headers. Direct `fetch()` works.
- **Anthropic and other non-CORS providers:** relay.atua.dev proxies server-side.
- **Raw TCP (database connections, SMTP, etc.):** relay.atua.dev TCP bridge. No browser alternative.

### 2.4 Embedded in Non-Browser Host

Electron, VS Code extension, Tauri, headless Node/Deno. The host process has no CORS restrictions. It provides a `fetchFn` or `streamFn`. relay.atua.dev not needed.

### 2.5 Deployment Matrix

| Deployment | LLM (WebSocket providers) | LLM (Anthropic) | MCP Servers | Raw TCP |
|---|---|---|---|---|
| atua.com / agent / ide | Direct WS | Same-origin proxy | Same-origin proxy | relay.atua.dev |
| Third-party embed | Direct WS | Host proxy via streamFn | Host proxy | Host or relay |
| Self-hosted bare PWA | Direct WS | relay.atua.dev | relay.atua.dev | relay.atua.dev |
| Electron / VS Code | Direct WS | Host process | Host process | Host process |
| Headless Node/Deno | Direct WS or HTTP | HTTP (no CORS) | HTTP (no CORS) | TCP (native) |

**relay.atua.dev is the last resort.** For the primary hosted product it is not in the critical path at all.

---

## §3 — Design Principle: WebSocket-First with Normalization

All external communication is WebSocket-first where the provider supports it. For providers that don't, Atua wraps their SSE or HTTP stream in a normalized event emitter. The shape presented upward to Pi, Hive, and Hashbrown is identical regardless of wire format.

**Why WebSocket over SSE/HTTP for LLM:**

- **Persistent connection:** Session lifecycle independent of connection lifecycle. Reconnect without restarting.
- **Bidirectional:** Cancellation signals travel back without a separate HTTP request.
- **Incremental context:** OpenAI's `previous_response_id` sends only new inputs per turn, not the full conversation history. Significant savings for long agentic runs with many tool calls.
- **Durability:** Cloudflare Workers have a 100-second CPU time limit on HTTP requests. A long LLM stream or a multi-step Pi session will exceed this and die mid-response. WebSocket connections on Cloudflare Workers stay alive for up to 24 hours. For long Pi sessions and Hive runs, WebSocket is not a preference — it is the only transport that can hold a multi-hour session without dying.

---

## §4 — Provider Transport Matrix

| Provider | Transport | CORS | Notes |
|---|---|---|---|
| **OpenAI** | ✅ WebSocket | Free | `wss://api.openai.com/v1/responses`. Responses API. `previous_response_id` for incremental context. 60-min limit, reconnect with session ID. |
| **Gemini** | ✅ WebSocket | Free | `wss://generativelanguage.googleapis.com/ws/...`. Live API. Bidirectional, stateful, multimodal. Use ephemeral tokens for browser-direct. |
| **Anthropic** | ❌ SSE only | Blocked | `/v1/messages` with `stream: true`. No WebSocket, no CORS headers. Needs server-side proxy (atua.com backend or relay). |
| **OpenRouter** | ❌ SSE/HTTP | Free | Sends CORS headers. Direct `fetch()` from browser works. Wrap in SSE adapter. |
| **Ollama** | ❌ HTTP | Free | Local, same machine. No CORS. Wrap in HTTP adapter. |
| **Any OpenAI-compat** | Varies | Varies | Detect capability. Use best available. |

This matrix will change as providers add WebSocket. The adapter pattern means only the provider's `ProviderFormat` entry changes when it does.

---

## §5 — Outbound LLM Transport

### 5.1 Architecture

```
Pi / Hive / Hashbrown
        │
        │  AtuaProviderTransport (uniform interface)
        ▼
┌──────────────────────────────────┐
│        AtuaTransportRouter       │
│  capability detect → route       │
└──────────┬───────────────────────┘
           │
           ├──→ WebSocketAdapter      (OpenAI, Gemini)
           │       │ direct browser WebSocket, CORS-free
           │       ▼ provider WS endpoint
           │
           └──→ SSEAdapter            (Anthropic, OpenRouter, Ollama)
                   │ fetch() → routed per deployment:
                   │   atua.com hosted  → same-origin proxy (atua.com/proxy/llm/*)
                   │   self-hosted      → relay.atua.dev (Anthropic only)
                   │   OpenRouter/Ollama → direct fetch (CORS-friendly)
                   ▼ provider HTTP endpoint
```

### 5.2 AtuaProviderTransport Interface

All adapters implement this. Consumers never touch the wire format.

```typescript
export interface AtuaProviderTransport {
  send(request: ProviderTurnRequest): void
  cancel(): void
  reconnect(): Promise<void>
  close(): void

  on(event: 'token',        handler: (delta: string) => void): void
  on(event: 'tool_call',    handler: (call: ToolCall) => void): void
  on(event: 'turn_end',     handler: (reason: FinishReason, usage: Usage) => void): void
  on(event: 'session_end',  handler: () => void): void
  on(event: 'error',        handler: (err: TransportError) => void): void
  on(event: 'reconnecting', handler: (attempt: number) => void): void
  on(event: 'reconnected',  handler: () => void): void
}

export interface ProviderTurnRequest {
  sessionId: string
  messages: Message[]
  tools?: ToolDef[]
  systemPrompt?: string
  model: string
  previousResponseId?: string  // WebSocket transports only — OpenAI incremental context
}
```

### 5.3 WebSocketAdapter

For OpenAI Responses API and Gemini Live. Direct browser → provider WebSocket. No SW involvement, no relay, no CORS issue.

Session lifecycle is independent of connection lifecycle. If the WebSocket drops, reconnect with exponential backoff. Session ID and `previousResponseId` persist across reconnects — the session resumes, it does not restart.

**OpenAI specifics:**
- `Authorization: Bearer {key}` on the HTTP upgrade handshake (WSS — encrypted, not in URLs or query params)
- Send `response.create` with `generate: false` on connect to warm up tools/instructions before the first real turn (reduces first-token latency)
- Track `previous_response_id` from each response. Send on subsequent turns — only the new input goes over the wire, not the full conversation history
- 60-minute connection limit: reconnect, resume session chain with `previous_response_id`

**Gemini specifics:**
- First message must be `BidiGenerateContentSetup`. Wait for `BidiGenerateContentSetupComplete` before sending content
- Use ephemeral tokens minted server-side. Never embed long-lived API keys in browser-direct WebSocket connections

### 5.4 SSEAdapter

For Anthropic, OpenRouter, Ollama, and any other HTTP/SSE-only provider. Sends full context each turn — no server-side session state for these providers.

The target endpoint is configured at construction time based on deployment mode:
- atua.com hosted: `https://atua.com/proxy/llm/anthropic` (same-origin, no CORS)
- Self-hosted bare: `wss://relay.atua.dev/llm/anthropic` (relay proxies outbound server-side)
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions` (direct, CORS-friendly)
- Ollama: `http://localhost:11434/api/chat` (local, no CORS)

Reconnect for SSE is a no-op — SSE is stateless per-request. Pi handles context re-injection on the next `send()`.

### 5.5 AtuaTransportRouter

Selects adapter per provider. Caches connections per active session.

```typescript
export class AtuaTransportRouter {
  private connections = new Map<string, AtuaProviderTransport>()

  async getTransport(provider: ProviderConfig, sessionId: string): Promise<AtuaProviderTransport> {
    const key = `${provider.id}:${sessionId}`
    if (this.connections.has(key)) return this.connections.get(key)!

    const transport = provider.supportsWebSocket
      ? new WebSocketAdapter(provider.wsEndpoint, provider.apiKey, provider.format)
      : new SSEAdapter(provider.resolvedEndpoint, provider.apiKey, provider.format)
      // resolvedEndpoint is set at config time based on deployment mode

    if (transport instanceof WebSocketAdapter) await transport.connect()

    this.connections.set(key, transport)
    return transport
  }

  async releaseSession(sessionId: string): Promise<void> {
    for (const [key, transport] of this.connections) {
      if (key.includes(`:${sessionId}`)) {
        await transport.close()
        this.connections.delete(key)
      }
    }
  }
}
```

---

## §6 — Outbound MCP Servers

How Atua connects to external MCP servers that Pi or other consumers want to use.

| Server Type | Transport |
|---|---|
| Local (spawned in AtuaProc Worker) | stdio over MessageChannel. Server runs in Worker, stdio streams are MessageChannel-backed. Server doesn't know it's in a browser. Already specified in pi-atua spec §14. |
| Remote, modern | Streamable HTTP (current MCP spec, 2025-03-26 forward) |
| Remote, legacy | SSE + POST. Deprecated in MCP spec but kept for backward compat. |
| Remote, future | WebSocket when MCP SEP-1288 is ratified. Do not implement now. |

**CORS for remote MCP servers:** Most MCP servers don't send CORS headers (designed for desktop stdio/local HTTP). Resolution follows the same deployment matrix as LLM — same-origin proxy on atua.com hosted, relay for bare self-hosted, direct for CORS-friendly servers.

**Streamable HTTP:** POST to server endpoint for requests. Optional SSE stream for server-initiated notifications (GET to same endpoint). `Mcp-Session-Id` header for session continuity. Fall back to legacy SSE transport if server returns 405 on POST or GET.

---

## §7 — Inbound: External Clients → Atua

How external tools (Claude Desktop, IDE extensions, CI systems, other tabs) connect to Atua's hub and running sessions.

### 7.1 Two Surfaces

**Surface A — MCP Endpoint:** External client calls a specific tool on Atua's Fabric hub. Request/response shape. Streamable HTTP (MCP standard).

**Surface B — Session WebSocket:** External client observes or interacts with a running Pi/Hive session. Stateful, bidirectional, persistent. WebSocket only — stateful sessions require a persistent connection.

These are independent. A client can use one or both.

### 7.2 Surface A: MCP Endpoint

Atua's ServiceWorker exposes `/__atua_mcp__`. Streamable HTTP, routes inbound tool calls to Fabric hub. Origin validation required.

External clients that cannot reach the tab directly (Claude Desktop on another machine, CI systems) connect via the relay:

```
Claude Desktop → wss://relay.atua.dev/mcp/{tabId} → SW /__atua_mcp__
```

Relay maintains a tab registry. Tabs register with their tab ID on init, deregister on close.

### 7.3 Surface B: Session WebSocket

```
External client
    │  wss://relay.atua.dev/session/{sessionId}   (clients outside the browser)
    │  OR direct WebSocket to SW                  (same-origin clients)
    ▼
AtuaSessionBus (in SW / SharedWorker)
    │  fans out to all observers
    │  event log in AtuaFS for reconnect catch-up
    ▼
Running Pi/Hive Session (in Fabric hub)
```

**Session event protocol:**

```typescript
// Server → Client (Atua pushes to all observers)
type SessionEvent =
  | { type: 'session.started'; sessionId: string; model: string }
  | { type: 'turn.started';   turnId: string; input: string }
  | { type: 'token';          turnId: string; delta: string }
  | { type: 'tool.called';    turnId: string; toolName: string; args: unknown }
  | { type: 'tool.result';    turnId: string; toolName: string; result: unknown }
  | { type: 'turn.ended';     turnId: string; reason: FinishReason; usage: Usage }
  | { type: 'session.ended';  sessionId: string }

// Client → Server (observer sends commands)
type SessionCommand =
  | { type: 'session.send';      sessionId: string; message: string }
  | { type: 'session.cancel';    sessionId: string }
  | { type: 'session.subscribe'; sessionId: string }
  | { type: 'session.history';   sessionId: string; since?: number }
```

**Key properties:**
- Session lifecycle is independent of connection lifecycle. A session running for an hour keeps running if the observing WebSocket drops. Reconnecting clients send `session.history` with a timestamp to catch up on missed events.
- Multiple observers per session. A CI system and an IDE extension can both observe the same Hive run simultaneously.
- Event log persisted in AtuaFS (`/.atua/sessions/{sessionId}/events.jsonl`) for the duration of the session.
- Write commands (`session.send`, `session.cancel`) require the session auth token. Observation access is configurable per session.

---

## §8 — TCP Relay

The only case where the browser categorically cannot help itself: raw TCP sockets. Postgres, Redis, SMTP, any raw TCP target. The browser has no TCP API.

**Single route:** `wss://relay.atua.dev/tcp/{host}/{port}`

Browser opens WebSocket to relay. Relay uses Cloudflare's `connect()` API to open raw TCP to `{host}:{port}`. Frames bridge bidirectionally between the WebSocket and the TCP socket.

The relay does exactly this and nothing else for the atua.com hosted deployment. In bare self-hosted deployments the relay additionally handles Anthropic proxying via an LLM route, but TCP is its permanent, irreducible reason to exist.

Cloudflare Workers: 24-hour WebSocket connection limit vs 100-second HTTP CPU limit. WebSocket is mandatory — a long database session over HTTP would be killed mid-query.

---

## §9 — Provider Format Normalizers

Provider-specific knowledge is isolated here. The rest of the stack never branches on provider.

```typescript
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
```

**Implementation order:**

| Format | Transport | Why this order |
|---|---|---|
| `OpenRouterFormat` | SSE | CORS-friendly. Validates full Pi pipeline without needing any proxy infrastructure. Build first. |
| `AnthropicFormat` | SSE | Highest real-world usage. Needs proxy but straightforward SSE. |
| `OpenAIResponsesFormat` | WebSocket | Incremental context benefits agentic runs significantly. |
| `GeminiLiveFormat` | WebSocket | Ephemeral token flow adds complexity. Build after OpenAI WS is proven. |
| `OpenAISSEFormat` | SSE | Fallback for single-shot OpenAI calls that don't need session persistence. |
| `OllamaFormat` | HTTP | Local dev, no auth. Simple. |

---

## §10 — Security

**Outbound:**
- API keys stored in `/.atua/auth.json` via `AtuaAuthStorage`. Never in code, never in URLs, never in query params.
- WebSocket connections: key goes in the HTTP upgrade header, encrypted by WSS. Not visible in browser history or referrer headers.
- Gemini: long-lived keys stay server-side. Atua mints short-lived ephemeral tokens for browser-direct Gemini WebSocket sessions.

**Inbound:**
- Origin validation on all SW endpoints. `/__atua_mcp__` and session WebSocket both validate `Origin`. Prevents DNS rebinding.
- Relay tab registration uses a session token from AtuaFS. Prevents external clients from reaching arbitrary tabs.
- Session write commands require auth token. Observation access is configurable per session.

**Relay:**
- No request body logging, no response caching.
- Auth tokens pass through encrypted (WSS). Relay does not inspect payloads.
- Tab registration tokens are short-lived.

---

## §11 — What This Changes in Existing Plans

**Conductor Phase 4 — LLM routing**

Before: Pi routes Anthropic calls via `wss://relay.atua.dev/llm/anthropic` hardcoded.

Now: Pi calls `AtuaTransportRouter`. Router selects `WebSocketAdapter` (OpenAI/Gemini) or `SSEAdapter` (Anthropic/OpenRouter). The SSE endpoint is resolved at config time based on deployment mode — atua.com backend for hosted, relay for bare self-hosted. No hardcoded relay URL in the application layer. Implement OpenRouter first: CORS-friendly, validates the full Pi pipeline before any proxy infrastructure exists.

**Atua Implementation Plan Phase 11 — Relay**

Before: Three routes: TCP bridge, LLM proxy, MCP bridge.

Now: TCP bridge is the permanent core. LLM proxy is a deployment-config concern, not a relay route (atua.com hosted doesn't use it). MCP bridge and session bridge remain for external clients that cannot reach the tab directly.

**pi-atua spec — MCP external surface**

Before: Vague StreamableHTTP reference.

Now: SW `/__atua_mcp__` endpoint + relay MCP bridge for external access. Session WebSocket via `AtuaSessionBus` for live session observation.
