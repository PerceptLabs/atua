# Atua Embedded Agent Specification

**Status:** Draft
**Date:** 2026-03-07
**Companion to:** `atua-unified-spec.md`, `conductor-implementation-plan.md`, `hive-implementation-plan.md`, `pi-hive-dual-mode-addendum.md`
**Scope:** Defines how Atua generates, deploys, and manages applications with embedded agentic capabilities — apps that continue to reason, learn, and act after deployment.

---

## §1 — Thesis

Every AI-first development tool today produces inert artifacts. Bolt, Lovable, v0, Replit — they generate React apps, deploy them, and walk away. The app is frozen at the moment of deployment. It cannot observe, decide, or adapt.

Atua produces apps that think.

When a user describes an application that requires ongoing intelligence — monitoring, summarization, auto-categorization, draft generation, anomaly detection, scheduled reasoning — Atua generates the application code *and* an embedded agent module that ships alongside it. The agent is not a separate service. It lives inside the deployed application as a lightweight, auditable runtime that operates within scoped capabilities, reports back to Atua when connected, and functions autonomously when disconnected.

The key architectural insight: the embedded agent is written in the same JavaScript/TypeScript that Atua already generates for the application itself. No foreign runtime, no second language, no opaque binary. The agent code is app code. Users can read it, modify it, and reason about it.

---

## §2 — Design Principles

### 2.1 — Same language everywhere

Atua generates TypeScript. The application backend (Hono), the frontend (React), and the embedded agent are all TypeScript. A single codebase runs on every deployment target without transpilation to a different language or runtime. This is the decisive advantage over a Lua-based or Python-based embedded agent — there is no impedance mismatch between the app and its intelligence layer.

### 2.2 — Auditable minimalism

The embedded agent runtime targets ~500 lines of TypeScript — enough to implement a message queue, model adapter, tool dispatch, memory interface, skill loader, and scheduler. Inspired by NanoClaw's radical minimalism: every line is there for the user, not for framework overhead. A developer can read the entire agent runtime in a single sitting.

### 2.3 — Standard output, not proprietary lock-in

The generated agent module uses standard APIs: `fetch()` for model calls, SQL for persistence, HTTP for webhooks. It runs on any JavaScript runtime — Cloudflare Workers, Node.js, Deno, Bun, or txiki.js. There is no Atua-specific runtime dependency in the deployed artifact. Users can eject and maintain the agent independently.

### 2.4 — Scoped authority

The embedded agent never holds ambient authority. It receives explicit capability grants at configuration time: which database tables it can access, which API routes it can call, which external services it can reach, what its token budget is. This mirrors Atua's own security model where the agent lives inside the kernel and reaches out with user approval at each step.

### 2.5 — Generator, not framework

Atua does not ship an "agent framework" that users install. Atua *generates* the agent code fresh for each application, tailored to that application's domain, data model, and integration surface. The output is self-contained. No `npm install @atua/agent-runtime`. The code is right there in the project, no different from the route handlers or React components Atua also generated.

---

## §3 — Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Atua (Browser IDE)                           │
│                                                                 │
│  User describes app + agentic behavior                          │
│       │                                                         │
│       ▼                                                         │
│  Pi / Hive agents generate:                                     │
│       ├── /src/app/        → Hono backend + React frontend      │
│       ├── /src/agent/      → Embedded agent module (~500 LOC)   │
│       ├── /agent.config.ts → Declarative run spec               │
│       └── /src/skills/     → Agent skill files (extensible)     │
│       │                                                         │
│       ▼                                                         │
│  atua deploy (target selection)                                 │
│       ├── Cloudflare Workers  → V8 isolate                      │
│       ├── Docker / VPS        → Node.js or txiki.js binary      │
│       ├── Edge / IoT          → txiki.js cross-compiled         │
│       └── Bridge (local)      → txiki.js embedded in bridge     │
│                                                                 │
│  Post-deployment:                                               │
│       ├── Agent operates within capability grants               │
│       ├── Reports telemetry to Atua via MCP (when connected)    │
│       ├── Atua can push config/skill updates (no redeploy)      │
│       └── Agent operates independently (when disconnected)      │
└────────────────────────────────────────────────────────────────┘
```

---

## §4 — The Embedded Agent Module

### 4.1 — Structure

The generated agent module lives at `/src/agent/` within the application project. It is not a dependency — it is generated source code, owned by the user.

```
/src/agent/
  index.ts          — Agent entrypoint: boot, scheduler, shutdown
  loop.ts           — Core agent loop: observe → decide → act
  model.ts          — Model adapter: fetch-based, provider-agnostic
  tools.ts          — Tool registry + dispatch
  memory.ts         — SQLite-backed memory: store, search, forget, compact
  skills.ts         — Skill loader: reads /src/skills/*.md at boot
  config.ts         — Reads agent.config.ts, validates grants
  types.ts          — Shared types: RunSpec, ToolDef, MemoryEntry, etc.
```

Total: ~500 lines across all files. Each file is single-purpose, readable independently.

### 4.2 — Core Loop

The agent operates on a simple observe-decide-act cycle:

```typescript
// loop.ts — the entire agent brain
export async function agentLoop(ctx: AgentContext): Promise<void> {
  // 1. Observe: gather current state from granted sources
  const observations = await ctx.tools.call('observe', {
    sources: ctx.config.observeSources,
  })

  // 2. Decide: send observations + memory to model, get structured action
  const action = await ctx.model.complete({
    system: ctx.systemPrompt,
    messages: [
      ...ctx.memory.relevant(observations.summary, 10),
      { role: 'user', content: observations.summary },
    ],
    tools: ctx.tools.schemas(),
    budget: ctx.config.budget,
  })

  // 3. Act: execute the decided action within capability grants
  if (action.toolCalls.length > 0) {
    for (const call of action.toolCalls) {
      ctx.tools.assertGranted(call.name)
      const result = await ctx.tools.call(call.name, call.input)
      await ctx.memory.store({
        role: 'tool',
        content: JSON.stringify(result),
        importance: result.importance ?? 0.5,
      })
    }
  }

  // 4. Remember: store this cycle's outcome
  await ctx.memory.store({
    role: 'agent',
    content: action.reasoning,
    importance: action.confidence,
  })
}
```

### 4.3 — Scheduling

The agent loop is triggered by one or more scheduling mechanisms, depending on deployment target:

| Trigger | Implementation | Use case |
|---|---|---|
| Cron | Cloudflare Scheduled Events, `setInterval`, or OS cron | Periodic monitoring, daily summaries |
| Webhook | HTTP route on the app's server | React to external events |
| Event | Database trigger, queue message, filesystem watch | React to internal state changes |
| Manual | API call from user or Atua | On-demand agent invocation |

The scheduler is part of `index.ts` and is configured via `agent.config.ts`:

```typescript
// agent.config.ts
export default {
  schedule: [
    { trigger: 'cron', pattern: '0 * * * *', task: 'monitor' },
    { trigger: 'webhook', path: '/agent/notify', task: 'triage' },
    { trigger: 'event', source: 'db:tickets:insert', task: 'categorize' },
  ],
  // ...
}
```

---

## §5 — The Declarative Run Spec

Every embedded agent is configured by a single `agent.config.ts` file that declares what the agent can do, what it can access, and how it should behave. This is the contract between the application and its embedded intelligence.

```typescript
// agent.config.ts — full example
import type { AgentRunSpec } from './agent/types'

export default {
  // Identity
  name: 'support-agent',
  description: 'Monitors support tickets, auto-categorizes, drafts responses',

  // Model access
  model: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'openrouter/auto',
    maxTokensPerCycle: 4096,
  },

  // Capability grants — exhaustive list of what agent can touch
  grants: {
    database: {
      tables: ['tickets', 'responses', 'categories'],
      operations: ['select', 'insert', 'update'],
      // Agent cannot DROP, DELETE, or touch other tables
    },
    api: {
      routes: ['/api/tickets/*', '/api/notify'],
      methods: ['GET', 'POST'],
    },
    external: [
      { url: 'https://api.anthropic.com/v1/messages', methods: ['POST'] },
      { url: 'https://hooks.slack.com/services/*', methods: ['POST'] },
    ],
    filesystem: {
      read: ['/src/skills/', '/data/templates/'],
      write: ['/data/agent-output/'],
    },
  },

  // Scheduling
  schedule: [
    { trigger: 'cron', pattern: '*/15 * * * *', task: 'check-new-tickets' },
    { trigger: 'event', source: 'db:tickets:insert', task: 'categorize' },
    { trigger: 'webhook', path: '/agent/escalation', task: 'handle-escalation' },
  ],

  // Budget and safety
  budget: {
    maxCyclesPerHour: 60,
    maxTokensPerDay: 500_000,
    maxActionsPerCycle: 5,
  },

  // Memory
  memory: {
    backend: 'sqlite',
    table: 'agent_memory',
    maxEntries: 5000,
    compactStrategy: 'importance-recency',
  },

  // Skills — agent reads these at boot and on reload
  skills: {
    directory: '/src/skills/',
    autoReload: true,
  },

  // Security mode
  security: 'scoped',
  // 'scoped'  — agent operates only within declared grants (default)
  // 'supervised' — every action requires approval via callback
  // 'readonly'   — agent can observe and reason but cannot act
} satisfies AgentRunSpec
```

### 5.1 — Run Spec as Compilation Target

The run spec is the stable interface between Atua (the generator) and the embedded agent (the execution engine). Atua's Pi/Hive agents author this spec based on the user's description. The embedded agent runtime reads and enforces it. This separation means:

- The run spec format is the same regardless of deployment target
- The same spec deploys to Workers, Docker, txiki, or the bridge
- Atua can update the spec without regenerating application code
- Third-party tools can read/write run specs to integrate with Atua-generated agents

---

## §6 — Model Adapter

The model adapter is a thin `fetch()`-based layer that handles provider routing, streaming, and token accounting. No SDK dependencies.

```typescript
// model.ts — provider-agnostic model adapter
export class ModelAdapter {
  constructor(private config: ModelConfig) {}

  async complete(request: CompleteRequest): Promise<CompleteResponse> {
    const { provider, model, fallback } = this.config

    try {
      return await this.call(provider, model, request)
    } catch (err) {
      if (fallback) {
        return await this.call(...parseFallback(fallback), request)
      }
      throw err
    }
  }

  private async call(
    provider: string,
    model: string,
    request: CompleteRequest,
  ): Promise<CompleteResponse> {
    const endpoint = PROVIDER_ENDPOINTS[provider]
    const body = formatRequest(provider, model, request)

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await this.getKey(provider)}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) throw new ModelError(provider, res.status, await res.text())

    const data = await res.json()
    this.accountTokens(data.usage)
    return parseResponse(provider, data)
  }

  private accountTokens(usage: TokenUsage): void {
    this.cycleTokens += usage.input_tokens + usage.output_tokens
    this.dailyTokens += usage.input_tokens + usage.output_tokens
    // Budget enforcement happens in the agent loop, not here
  }
}
```

### 6.1 — Provider Endpoints

```typescript
const PROVIDER_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  // 'proxy' — user-provided URL for self-hosted or corp proxies
  // 'relay' — relay.atua.dev for edge cases
}
```

### 6.2 — Key Management

API keys are never embedded in generated code. They are read from environment variables at runtime (`process.env`, Cloudflare secrets, or txiki's `tjs.env`). The run spec declares which providers are needed; the deployment process ensures keys are configured.

---

## §7 — Memory System

SQLite-backed persistent memory with full-text search. Same pattern as Conductor's memory system (FTS5), adapted for standalone operation.

```typescript
// memory.ts
export class AgentMemory {
  constructor(private db: Database, private config: MemoryConfig) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${config.table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS ${config.table}_fts
        USING fts5(content, role, content='${config.table}', content_rowid='id');
    `)
  }

  async store(entry: MemoryEntry): Promise<void> {
    this.db.run(
      `INSERT INTO ${this.config.table} (session_id, role, content, importance, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [entry.sessionId, entry.role, entry.content, entry.importance, Date.now()],
    )
  }

  async relevant(query: string, limit: number): Promise<MemoryEntry[]> {
    // FTS5 match weighted by importance and recency
    return this.db.query(`
      SELECT m.*, rank
      FROM ${this.config.table}_fts fts
      JOIN ${this.config.table} m ON fts.rowid = m.id
      WHERE fts MATCH ?
      ORDER BY (rank * -1) * m.importance * (1.0 / (1.0 + (? - m.last_accessed) / 86400000.0))
      LIMIT ?
    `, [query, Date.now(), limit])
  }

  async compact(): Promise<void> {
    const keep = this.config.maxEntries
    this.db.run(`
      DELETE FROM ${this.config.table}
      WHERE id NOT IN (
        SELECT id FROM ${this.config.table}
        ORDER BY importance * (1.0 / (1.0 + (? - COALESCE(last_accessed, created_at)) / 86400000.0)) DESC
        LIMIT ?
      )
    `, [Date.now(), keep])
  }
}
```

### 7.1 — Memory Across Runtimes

| Runtime | SQLite provider |
|---|---|
| Cloudflare Workers | D1 (native) |
| Node.js / Bun | better-sqlite3 or bun:sqlite |
| Deno | deno-sqlite |
| txiki.js | tjs:sqlite (built-in) |
| Atua (browser) | wa-sqlite (WASM) |

The memory module imports a `Database` interface. The correct driver is selected at build time based on the deployment target. The SQL is identical across all.

---

## §8 — Tool System

Tools are the agent's hands. Each tool is a function with a JSON Schema, a capability tag, and a handler. The agent can only invoke tools that match its capability grants.

```typescript
// tools.ts
export class ToolRegistry {
  private tools = new Map<string, ToolDef>()
  private grants: Set<string>

  constructor(grants: GrantConfig) {
    this.grants = resolveGrants(grants)
  }

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool)
  }

  assertGranted(name: string): void {
    const tool = this.tools.get(name)
    if (!tool) throw new ToolError(`Unknown tool: ${name}`)
    if (!this.grants.has(tool.capability)) {
      throw new ToolError(`Tool "${name}" requires capability "${tool.capability}" which is not granted`)
    }
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()]
      .filter(t => this.grants.has(t.capability))
      .map(t => ({ name: t.name, description: t.description, input_schema: t.schema }))
  }

  async call(name: string, input: unknown): Promise<ToolResult> {
    this.assertGranted(name)
    const tool = this.tools.get(name)!
    return tool.handler(input)
  }
}
```

### 8.1 — Generated Tools

Atua generates tools specific to the application's domain. For a support dashboard, the generated tools might include:

```typescript
// Generated by Atua — /src/agent/tools/tickets.ts
export const ticketTools: ToolDef[] = [
  {
    name: 'get-open-tickets',
    description: 'Retrieve all open support tickets',
    capability: 'database.tickets.select',
    schema: { type: 'object', properties: { limit: { type: 'number' } } },
    handler: async ({ limit }) => db.query('SELECT * FROM tickets WHERE status = ? LIMIT ?', ['open', limit ?? 50]),
  },
  {
    name: 'categorize-ticket',
    description: 'Set category on a ticket',
    capability: 'database.tickets.update',
    schema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        category: { type: 'string', enum: ['billing', 'technical', 'account', 'feature-request'] },
        confidence: { type: 'number' },
      },
      required: ['ticketId', 'category'],
    },
    handler: async ({ ticketId, category, confidence }) => {
      await db.run('UPDATE tickets SET category = ?, agent_confidence = ? WHERE id = ?', [category, confidence, ticketId])
      return { success: true, ticketId, category }
    },
  },
  {
    name: 'draft-response',
    description: 'Save a draft response for human review',
    capability: 'database.responses.insert',
    schema: {
      type: 'object',
      properties: { ticketId: { type: 'string' }, draft: { type: 'string' } },
      required: ['ticketId', 'draft'],
    },
    handler: async ({ ticketId, draft }) => {
      await db.run('INSERT INTO responses (ticket_id, body, status) VALUES (?, ?, ?)', [ticketId, draft, 'draft'])
      return { success: true, ticketId, status: 'draft' }
    },
  },
  {
    name: 'notify-slack',
    description: 'Send a notification to the configured Slack channel',
    capability: 'external.slack',
    schema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    handler: async ({ message }) => {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      })
      return { success: true }
    },
  },
]
```

### 8.2 — Self-Extending Tools via Skills

The agent can extend its own capabilities post-deployment by writing skill files to `/src/skills/`. Skills are markdown files with structured instructions that modify the agent's system prompt, similar to NanoClaw's skill model and Pi's `/.atua/skills/` convention.

```
/src/skills/
  categorization-rules.md    — "When a ticket mentions 'invoice'..."
  response-templates.md      — "For billing issues, start with..."
  escalation-policy.md       — "Escalate if confidence < 0.6 or..."
```

Skills are loaded at boot and on a configurable reload interval. The agent can write new skill files (if granted filesystem write access) to accumulate learned behaviors over time.

---

## §9 — Execution Hosts

The embedded agent module is pure TypeScript with a `Database` interface and `fetch()`. It runs anywhere JavaScript runs. The deployment target determines which host provides the runtime substrate.

### 9.1 — Cloudflare Workers (Primary)

Atua's primary deployment target. The agent module runs inside the same Worker as the Hono application.

**Agent scheduling:** Cloudflare Scheduled Events (cron triggers) invoke the agent loop. Webhooks arrive as normal HTTP requests routed to the agent endpoint.

**Persistence:** D1 for SQLite (memory, sessions). KV for configuration cache. R2 for skill files and artifacts.

**Isolation:** V8 isolate per Worker invocation. No ambient access to other Workers or services.

**Durable agents:** For agents that need to maintain state across invocations beyond what D1 provides — long-running observation loops, real-time WebSocket monitoring — Durable Objects provide a stateful execution context with WebSocket support and transactional storage.

**Multi-step resilience:** Cloudflare Workflows for complex agent behaviors that span multiple steps with durable checkpointing. A monitoring agent that needs to: detect anomaly → run diagnostic → attempt fix → wait for result → escalate if unresolved — each step survives restarts, has automatic retry, and can sleep for hours between actions.

```typescript
// Example: Cloudflare Worker with embedded agent
import { Hono } from 'hono'
import { createAgent } from './agent'
import config from './agent.config'

const app = new Hono()

// Application routes
app.get('/api/tickets', async (c) => { /* ... */ })
app.post('/api/tickets', async (c) => { /* ... */ })

// Agent webhook route
app.post('/agent/notify', async (c) => {
  const agent = createAgent(c.env, config)
  await agent.run('triage', await c.req.json())
  return c.json({ ok: true })
})

// Scheduled handler — agent cron
export default {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    const agent = createAgent(env, config)
    ctx.waitUntil(agent.runScheduled(event.cron))
  },
}
```

### 9.2 — txiki.js (Portable Standalone)

This is the unlock for environments where Node.js is unavailable or too heavy: IoT devices, game engines, CI runners, edge hardware, the Atua bridge binary, air-gapped deployments.

**What txiki.js provides natively:**

| Capability | txiki API | Agent uses for |
|---|---|---|
| HTTP client | `fetch()` (Web API) | Model API calls |
| HTTP server | `export default { fetch }` (Hono-compatible) | Webhooks, health endpoint |
| SQLite | `tjs:sqlite` (built-in) | Agent memory, app database |
| File I/O | `tjs.readFile`, `tjs.writeFile` | Skills, config, artifacts |
| WebSocket | `WebSocket` (Web API) | Real-time telemetry to Atua |
| Child process | `tjs.spawn()` | Local tool execution |
| Timers | `setTimeout`, `setInterval` | Cron-style scheduling |
| Standalone binary | `tjs compile` | Single-file deployment |
| WASI | Built-in WASI support | Guest process hosting |

**Why txiki over Node.js:** txiki compiles to a standalone binary of a few megabytes. Node.js is 50+ MB with a sprawling dependency surface. The NanoClaw philosophy of radical minimalism — ~500 lines, auditable, minimal dependencies — is philosophically contradicted by running on Node.js. txiki is the consistent choice: a tiny agent on a tiny runtime.

**Why txiki over Lua:** The Lua runtime approach (see §12) requires Atua to generate a second language alongside TypeScript. With txiki, Atua generates TypeScript for everything. The application backend, the frontend, and the embedded agent are all the same language, sharing types and modules. No impedance mismatch.

**Hono compatibility:** txiki's HTTP server API is already compatible with Hono via a simple adapter. The exact same Hono application code runs on Workers and txiki without modification:

```typescript
// This same code runs on Workers AND txiki
import { Hono } from 'hono'
const app = new Hono()
app.get('/health', (c) => c.json({ status: 'ok', agent: 'running' }))
export default app
```

**Standalone compilation:**

```bash
# Bundle the app + agent into a single file
npx esbuild src/index.ts --bundle --outfile=bundle.js \
  --external:tjs:* --format=esm --platform=neutral

# Compile to standalone executable
tjs compile bundle.js my-app

# Result: single binary, runs anywhere, no Node.js needed
./my-app
```

**Cross-compilation targets:** txiki supports Linux (x86_64, ARM64), macOS (x86_64, ARM64), and Windows. A Raspberry Pi deployment is a cross-compiled binary + the agent.config.ts baked in.

### 9.3 — Node.js / Deno / Bun (Standard)

For users who already have a server environment and want to deploy with their existing toolchain. The agent module works with any standard JavaScript runtime — no special adapters needed beyond swapping the SQLite driver.

### 9.4 — Atua Bridge (Local Agent)

The `@aspect/atua-bridge` is currently a dumb pipe — filesystem, shell, git over WebSocket. With an embedded txiki.js agent, the bridge becomes a local collaborator:

- Pre-filters large codebases before sending context to Atua
- Runs lint/test cycles locally without browser round-trips
- Monitors file changes and proactively suggests improvements
- Operates as a local MCP server with tool capabilities

The bridge ships as a single `npx` command today. With txiki, it could ship as a standalone binary that includes both the bridge tunnel and a local agent runtime.

### 9.5 — Deployment Matrix

| Target | JS Runtime | SQLite | Scheduling | Binary Size | Use Case |
|---|---|---|---|---|---|
| Cloudflare Workers | V8 isolate | D1 | Scheduled Events | N/A (serverless) | Primary production |
| Docker / VPS | Node.js or txiki | better-sqlite3 or tjs:sqlite | node-cron or setInterval | ~5MB (txiki) | Self-hosted |
| Raspberry Pi / edge | txiki (cross-compiled) | tjs:sqlite | setInterval + tjs.spawn for cron | ~5MB | IoT, edge monitoring |
| Atua bridge | txiki (embedded) | tjs:sqlite | Event-driven | ~5MB | Local dev agent |
| CI runner | txiki (standalone) | tjs:sqlite | Single-shot | ~5MB | Test agent, deploy gate |
| Browser (Atua itself) | V8 (native) | wa-sqlite | requestIdleCallback | N/A | In-editor preview |

**Same TypeScript source runs across all targets.** Build-time selection swaps only the SQLite driver and scheduling mechanism.

---

## §10 — Atua as Agent Generator

### 10.1 — Generation Flow

When a user describes an application with agentic behavior, Atua's Pi/Hive agents generate three things:

1. **The application code** — Hono backend, React frontend, database schema, API routes. This already exists in Atua's capabilities.

2. **The agent module** — The `/src/agent/` directory containing the core runtime (~500 LOC) plus domain-specific tools generated for this application's data model and integrations.

3. **The run spec** — `agent.config.ts` declaring the agent's grants, schedule, model access, and behavioral constraints. This is the control surface the user can modify without touching agent code.

### 10.2 — Intent Detection

Atua's agent (Pi/Hive) determines whether an application needs embedded intelligence based on the user's description. Signal phrases include:

- "monitor", "watch", "check periodically"
- "auto-categorize", "auto-label", "auto-tag"
- "draft responses", "suggest", "recommend"
- "notify me when", "alert if", "escalate"
- "learn from", "improve over time", "adapt"
- "summarize daily", "weekly report", "digest"
- "triage", "route", "prioritize"

When agentic intent is detected, Atua generates the agent module alongside the application. When it is not detected, no agent code is generated — the application is purely inert, as it would be from any other tool.

### 10.3 — Iterative Refinement

After initial generation, the user can refine the agent's behavior conversationally:

- "It's miscategorizing billing tickets" → Atua updates the categorization skill file
- "Check more often during business hours" → Atua updates the schedule in the run spec
- "Don't auto-respond to enterprise customers" → Atua adds a grant constraint or skill rule
- "Add Slack notifications for escalations" → Atua generates a new tool and adds the external grant

For config and skill changes, Atua pushes updates to the deployed agent without redeploying the application. For tool changes, a redeploy is required (new code).

---

## §11 — Telemetry and Management

### 11.1 — Agent-to-Atua Communication

When the deployed agent is connected to Atua (via MCP over WebSocket or StreamableHTTP), it reports:

```typescript
// Telemetry events the agent sends to Atua
type AgentEvent =
  | { type: 'cycle-complete'; task: string; actions: number; tokens: number; duration: number }
  | { type: 'error'; task: string; error: string; stack?: string }
  | { type: 'budget-warning'; resource: 'tokens' | 'cycles' | 'actions'; used: number; limit: number }
  | { type: 'skill-written'; path: string; description: string }
  | { type: 'memory-compacted'; entriesBefore: number; entriesAfter: number }
  | { type: 'escalation'; reason: string; context: unknown }
```

### 11.2 — Atua-to-Agent Commands

Atua can push commands to the deployed agent:

```typescript
type AtuaCommand =
  | { type: 'update-config'; patch: Partial<AgentRunSpec> }
  | { type: 'update-skill'; path: string; content: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'run-now'; task: string; input?: unknown }
  | { type: 'compact-memory' }
  | { type: 'report-status' }
```

### 11.3 — Disconnected Operation

If the connection to Atua is lost, the agent continues operating within its last-known configuration. Telemetry events are queued locally (SQLite) and flushed when the connection is restored. No Atua dependency is required for ongoing operation.

### 11.4 — Dashboard View

In `ide.atua.dev`, a deployed application with an embedded agent shows an agent panel:

- Live telemetry stream (cycles, actions, token usage)
- Memory browser (search and inspect agent memories)
- Skill editor (view and modify skill files, push changes)
- Config editor (modify run spec, push changes)
- Agent log (chronological record of agent decisions and actions)
- Health indicator (last cycle time, error rate, budget utilization)

---

## §12 — Future: Lua WASM Portable Runtime

The near-term strategy (§9) uses JavaScript runtimes for all deployment targets. A future tier adds a Lua-based agent runtime compiled to WASM for environments where even txiki is too heavy or where the host application is not JavaScript:

- Game engines (Unity, Unreal, Godot) embedding agents via C ABI
- Bare-metal embedded systems with minimal WASM runtimes
- Existing Lua-based applications (Neovim plugins, game mods, Redis scripts)

The Lua runtime would implement the same agent architecture (run spec, capability grants, memory, tool dispatch) and speak MCP for interoperability with Atua. The run spec format is identical — Atua compiles to either the TypeScript target or the Lua target based on the deployment environment.

This tier is deferred. The TypeScript/txiki path covers 95%+ of use cases with zero language impedance. Lua becomes relevant only when specific host constraints demand it.

---

## §13 — Competitive Position

| Capability | Bolt / Lovable / v0 | Replit | Atua |
|---|---|---|---|
| Generates frontend | Yes | Yes | Yes |
| Generates backend | Limited | Yes | Yes (Hono) |
| Generates database | No | Partial | Yes (SQLite/D1) |
| Deploys to production | Limited | Yes | Yes (Workers) |
| **Embedded agent in output** | **No** | **No** | **Yes** |
| **App learns post-deploy** | **No** | **No** | **Yes** |
| **Agent telemetry** | **N/A** | **N/A** | **Yes** |
| **Remote config updates** | **N/A** | **N/A** | **Yes** |
| **Portable standalone binary** | **No** | **No** | **Yes (txiki)** |

The positioning: **"Other tools build apps. Atua builds apps that think."**

No existing AI-first development tool produces applications with embedded intelligence. This is greenfield. The closest analog is manually wiring LangChain or CrewAI into a web application — a multi-day engineering effort that Atua reduces to a conversation.

---

## §14 — Implementation Phases

### Phase 0 — Agent Module Generator

**Depends on:** Atua Phases 0–12 (unified spec), Conductor Phase 0 (Pi boots in Atua)

**Goal:** Pi can generate a `/src/agent/` directory alongside application code when agentic intent is detected. The generated agent runs locally in Atua's preview.

**Deliverables:**
- Agent module template (~500 LOC TypeScript)
- Run spec type definitions and validator
- Model adapter with Anthropic + OpenRouter support
- Memory module using wa-sqlite (in Atua's browser context)
- Tool registry with grant enforcement
- Skill loader reading from AtuaFS
- Pi system prompt additions for agentic intent detection

**Verification:**
```
User: "Build a ticket dashboard that auto-categorizes new tickets"
→ Pi generates Hono + React app WITH /src/agent/ directory
→ Agent boots in Atua preview
→ Agent categorizes a test ticket inserted into wa-sqlite
→ Agent stores categorization reasoning in memory
→ Agent respects capability grants (cannot access non-granted tables)
```

### Phase 1 — Cloudflare Workers Deployment

**Depends on:** Phase 0, Atua deployment pipeline (§19 of unified spec)

**Goal:** Generated app + agent deploys to Cloudflare Workers with D1, Scheduled Events, and agent webhook routes.

**Deliverables:**
- Build-time SQLite driver swap (wa-sqlite → D1 binding)
- Scheduled Event handler generation
- Agent webhook route generation
- Secret management for API keys (Cloudflare secrets)
- Wrangler config generation including D1 bindings and cron triggers

**Verification:**
```
Deploy ticket dashboard to Workers
→ Cron fires every 15 minutes
→ Agent checks for uncategorized tickets via D1
→ Agent categorizes and stores memory
→ Agent sends Slack notification on escalation
→ All within declared capability grants
```

### Phase 2 — Telemetry + Remote Management

**Depends on:** Phase 1

**Goal:** Deployed agent reports to Atua. Atua can push config and skill updates.

**Deliverables:**
- WebSocket telemetry channel (agent → Atua)
- Command channel (Atua → agent)
- Offline event queue with flush-on-reconnect
- Agent dashboard panel in ide.atua.dev
- Skill push (Atua edits skill → agent reloads)
- Config push (Atua edits run spec → agent reloads)

### Phase 3 — txiki.js Standalone Target

**Depends on:** Phase 1

**Goal:** Generated app + agent compiles to a standalone txiki.js binary.

**Deliverables:**
- Build-time SQLite driver swap for tjs:sqlite
- esbuild bundle step with `--external:tjs:*`
- `tjs compile` integration in deployment pipeline
- Cross-compilation targets (Linux x86_64, ARM64, macOS)
- Standalone smoke test: binary boots, agent runs, SQLite persists

**Verification:**
```
tjs compile bundle.js my-ticket-app
./my-ticket-app
→ Hono server starts on port 3000
→ Agent cron fires
→ SQLite database created and populated
→ curl localhost:3000/api/tickets returns data
→ Agent categorizes new ticket within 15 seconds
```

### Phase 4 — Bridge Agent

**Depends on:** Phase 3

**Goal:** `@aspect/atua-bridge` includes a local txiki agent that operates as a development collaborator.

**Deliverables:**
- Bridge binary embeds txiki runtime
- Local agent with filesystem tools (read, grep, lint, test)
- MCP server registration with Atua's Fabric hub
- Pre-filtering: agent summarizes large directories before sending to browser
- Local tool execution: agent runs lint/test without browser round-trip

### Phase 5 — Durable Object + Workflow Agents

**Depends on:** Phase 2

**Goal:** Complex agentic behaviors using Cloudflare Durable Objects (stateful) and Workflows (multi-step durable).

**Deliverables:**
- Durable Object agent pattern for real-time WebSocket monitoring
- Workflow agent pattern for multi-step remediation pipelines
- Atua generates the appropriate pattern based on complexity of described behavior
- Run spec extensions for DO and Workflow configuration

---

## §15 — What This Spec Does NOT Cover

- **Pi/Hive internal agent architecture** — covered by `conductor-implementation-plan.md` and `hive-implementation-plan.md`. This spec covers the *output* agents Atua generates, not Atua's own internal agents.
- **Hashbrown UI intelligence** — covered by `hashbrown-atua-spec.md`. The embedded agent is backend-only. UI intelligence in deployed apps is a separate concern.
- **Atua's own deployment pipeline** — the `atua deploy` command and Wrangler integration are out of scope here; this spec assumes that pipeline exists.
- **Multi-agent coordination in deployed apps** — V1 embeds a single agent per application. Multi-agent swarms in deployed apps (NanoClaw-style) are future work.
- **Marketplace or agent registry** — sharing and reusing agent templates across projects is future work.
- **Billing and metering** — token cost attribution and usage-based billing for embedded agents are product decisions, not architecture.

---

## §16 — References

| Resource | URL | Relevance |
|---|---|---|
| NanoClaw | github.com/qwibitai/nanoclaw | ~500 LOC agent runtime, container isolation, skills model, Claude Agent SDK |
| txiki.js | github.com/saghul/txiki.js | QuickJS-ng + libuv, built-in SQLite/fetch/HTTP server, standalone binaries |
| txiki.js 26.3.0 | code.saghul.net | Hono-compatible HTTP server, Web Streams, WAMR for WASM |
| Cloudflare D1 | developers.cloudflare.com/d1 | Serverless SQLite at the edge |
| Cloudflare Workflows | developers.cloudflare.com/workflows | Durable multi-step execution |
| Cloudflare Durable Objects | developers.cloudflare.com/durable-objects | Stateful serverless with WebSocket |
| Hono | hono.dev | Lightweight web framework, multi-runtime |
| Claude Agent SDK | docs.anthropic.com | Anthropic's agent harness (used by NanoClaw) |
| OpenClaw / Pi Agent Framework | github.com/psteinroe/openclaw | Multi-provider agent runtime, prior art |
| FTS5 | sqlite.org/fts5 | Full-text search for agent memory |
