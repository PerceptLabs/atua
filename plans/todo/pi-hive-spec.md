# Pi Hive: Multi-Agent Coordination Spec

**Codename:** Hive
**Status:** Draft
**Date:** 2026-03-03
**Depends on:** Atua unified spec (complete), Pi-Atua spec (Conductor, complete), Fabric (MCP hub, complete)
**Package:** `@aspect/pi-hive`

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Why Multi-Agent](#2-why-multi-agent)
3. [Architecture Overview](#3-architecture-overview)
4. [The Hive Mental Model](#4-the-hive-mental-model)
5. [Agent Roles](#5-agent-roles)
6. [Inter-Agent Communication](#6-inter-agent-communication)
7. [Tool Scoping](#7-tool-scoping)
8. [Spawning & Lifecycle](#8-spawning--lifecycle)
9. [External Orchestration: Claude Desktop](#9-external-orchestration-claude-desktop)
10. [Shared State Model](#10-shared-state-model)
11. [Quality Gate Agents](#11-quality-gate-agents)
12. [Failure & Recovery](#12-failure--recovery)
13. [Observability](#13-observability)
14. [Package Structure](#14-package-structure)
15. [Implementation Phases](#15-implementation-phases)
16. [CC Kickoff Prompts](#16-cc-kickoff-prompts)
17. [Risk Assessment](#17-risk-assessment)
18. [Success Criteria](#18-success-criteria)

---

## 1. What This Is

Pi Hive is a multi-agent coordination layer that runs entirely inside a single Atua browser tab. Multiple Pi agent instances operate concurrently, each with a defined role, scoped tools, and isolated session — coordinating through shared AtuaFS files and the Fabric MCP hub.

External orchestrators (Claude Desktop, any MCP client) connect to the Hive through a single MCP endpoint. They issue tasks to the Orchestrator. The Orchestrator delegates. Sub-agents execute. The external client observes progress and results without knowing how many agents are involved or what each one does.

### What This Is NOT

- Not a server-side multi-agent framework — everything runs in the browser tab
- Not a separate product — Hive is a coordination layer on top of Pi-Atua
- Not required — Pi-Atua works fine with a single agent
- Not a general-purpose agent framework — scoped specifically to Atua's runtime surface

### Relationship to Other Specs

**Pi-Atua (Conductor):** Defines a single Pi agent wired to Atua. Hive takes N of those and coordinates them. All Conductor patterns apply to each agent in the Hive.

**Fabric (MCP hub):** The hub is the coordination backbone. Agents communicate by registering tools on the hub and calling each other's tools. The hub also exposes the Hive to the outside world.

**Atua unified spec:** Provides the shared substrate — AtuaFS, wa-sqlite, CatalystProc — that all agents read and write.

**Hashbrown (Sizzle):** Optional UI layer. The Hive's status, progress, and output can be rendered through Hashbrown's generative UI if present.

---

## 2. Why Multi-Agent

A single Pi agent has a fundamental constraint: it operates sequentially. One LLM call at a time, one tool call at a time, one context window. For complex tasks this creates two problems:

**Context bloat.** A single agent building a full-stack application accumulates thousands of tokens of context — file contents, build outputs, error traces, prior decisions. Eventually the context window fills, compaction degrades quality, and the agent loses coherence.

**Role confusion.** The same agent that writes code also reviews it, designs it, tests it. These roles have conflicting incentives — a builder wants to ship, a reviewer wants to block, a designer wants to refactor. A single agent optimizing for all of them simultaneously does none of them well.

Multi-agent solves both. Each agent has a narrow role, a small context window (only what that role needs), and can run in parallel with peers. The Orchestrator holds the high-level plan; sub-agents hold only the context for their current task.

**The browser-native advantage:** In other multi-agent frameworks, parallelism means network calls, infrastructure, billing per agent. In Atua, each agent is a Worker + Pi instance in the same tab. Spawning a sub-agent is creating a new Pi instance — cheap, instant, no network. Coordination through shared OPFS is microsecond latency. The "distributed system" is a local one.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Tab                                  │
│                                                                      │
│  External MCP Client (Claude Desktop, any MCP client)               │
│       │                                                              │
│       │  wss://atua.dev/mcp  (StreamableHTTP via relay)             │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Fabric (MCP Hub)                           │    │
│  │                                                              │    │
│  │  hive.spawn     hive.status    hive.broadcast               │    │
│  │  hive.delegate  hive.recall    hive.terminate                │    │
│  │                                                              │    │
│  │  pi.prompt (→ Orchestrator)    pi.session.*                  │    │
│  │  pi.memory.*   pi.status       catalyst.*                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       │              │              │              │                 │
│       ▼              ▼              ▼              ▼                 │
│  ┌─────────┐   ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Orch-  │   │Architect │  │ Builder  │  │ Reviewer │           │
│  │estrator │   │  Pi      │  │   Pi     │  │   Pi     │           │
│  │  Pi     │   │          │  │          │  │          │           │
│  │         │   │ scope:   │  │ scope:   │  │ scope:   │           │
│  │ all     │   │ read+plan│  │ write+   │  │ read+    │           │
│  │ tools   │   │          │  │ build    │  │ quality  │           │
│  └────┬────┘   └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │             │              │              │                 │
│       └─────────────┴──────────────┴──────────────┘                 │
│                              │                                       │
│                    ┌─────────▼──────────┐                           │
│                    │   Shared State     │                           │
│                    │                   │                           │
│                    │  AtuaFS (OPFS)    │                           │
│                    │  .atua/plan.md    │                           │
│                    │  .atua/specs/     │                           │
│                    │  .atua/feedback.md│                           │
│                    │  .atua/status.json│                           │
│                    │                   │                           │
│                    │  CatalystD1       │                           │
│                    │  agent_log        │                           │
│                    │  agent_memory     │                           │
│                    │  agent_handoffs   │                           │
│                    └───────────────────┘                           │
│                                                                      │
│  Preview Window (full viewport — running application output)         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. The Hive Mental Model

The Hive is not a pipeline. It is not a DAG. It is a **colony** — agents with roles that activate, do their work, and yield, coordinated through shared state rather than direct messaging.

### Shared State is the Protocol

Agents don't call each other directly. They read and write shared files:

```
.atua/
├── plan.md          Orchestrator writes. All agents read.
├── specs/           Architect writes. Builder reads.
│   ├── components.md
│   ├── data-model.md
│   └── api-routes.md
├── feedback.md      Reviewer writes. Builder reads before next iteration.
├── status.json      All agents write their status. Orchestrator reads.
├── handoffs/        Explicit task handoffs with context packages
│   └── {task-id}.json
└── memory/          Long-term knowledge from CatalystD1 FTS5
```

This pattern is not accidental. It mirrors how Wiggum's Ralph operates — filesystem as the persistent state that survives context resets. Each agent in the Hive gets a fresh context per task, but the shared filesystem carries continuity between them.

### Roles Activate on Demand

The Orchestrator doesn't keep all sub-agents running constantly. It spawns them for specific tasks and terminates them when done. A Reviewer Pi lives for the duration of a review pass. A Designer Pi lives for the duration of a theme generation task.

This keeps Worker count low and memory usage bounded. Active agents: typically 1-3 at any moment.

### The Orchestrator is the Only External Surface

External clients (Claude Desktop) talk to exactly one endpoint: `pi.prompt` on the Orchestrator. The Orchestrator decides whether to handle something itself or spawn a sub-agent. The external client never addresses sub-agents directly.

---

## 5. Agent Roles

Roles are not hardcoded. They are system prompt templates stored in `.atua/roles/` and loaded at spawn time. The default roles shipped with Hive:

### Orchestrator
**Responsibility:** Task decomposition, delegation, synthesis, external communication.
**Tools:** All tools (full hub access).
**Spawns:** Any other role.
**Session:** Persistent across the full task lifecycle.
**Key behaviors:**
- Writes `.atua/plan.md` before spawning any agents
- Routes external `pi.prompt` calls — handles simple tasks itself, delegates complex ones
- Aggregates sub-agent results into coherent responses
- Monitors `.atua/status.json` for sub-agent progress

### Architect
**Responsibility:** Technical design, component specs, data model, API surface.
**Tools:** Read-only AtuaFS, `catalyst.sqlite` (read), `pi.memory.search`.
**Cannot:** Write to `src/`, trigger builds, install packages.
**Session:** Per-design-task.
**Writes to:** `.atua/specs/`
**Key behaviors:**
- Reads existing codebase before designing
- Produces machine-readable specs that Builder can execute directly
- Checks memory for prior decisions on similar problems

### Builder
**Responsibility:** Implementation — writing code, installing packages, running builds.
**Tools:** Full AtuaFS read/write, `catalyst.build`, `catalyst.install`, `catalyst.exec`.
**Cannot:** Trigger deployments, modify `.atua/plan.md`, spawn agents.
**Session:** Per-feature.
**Reads from:** `.atua/specs/`, `.atua/feedback.md`
**Key behaviors:**
- Reads spec before writing any code
- Commits after each logical unit of work
- Writes build output to `.atua/status.json`
- Reads Reviewer feedback and iterates within budget

### Reviewer
**Responsibility:** Quality gate — correctness, style, accessibility, performance.
**Tools:** Read-only AtuaFS, `catalyst.build` (read-only mode), ESLint runner, `catalyst.sqlite` (read).
**Cannot:** Write to `src/`, install packages.
**Session:** Per-review-pass.
**Writes to:** `.atua/feedback.md`
**Key behaviors:**
- Never edits code — only writes feedback
- Structured feedback format: severity (block/warn/suggest), file, line, description
- Terminates itself after writing feedback

### Designer
**Responsibility:** Visual design — CSS variables, theme generation, component styling.
**Tools:** AtuaFS read/write scoped to `src/index.css` and design tokens only.
**Cannot:** Write to TypeScript files, trigger builds.
**Session:** Per-design-task.
**Key behaviors:**
- OKLCH color science for theme generation
- Reads Hashbrown component registry for what's available
- Validates output in preview via ServiceWorker

### Inspector
**Responsibility:** Runtime observation — error detection, performance profiling, accessibility audit.
**Tools:** `catalyst.preview`, `catalyst.telemetry`, read-only AtuaFS.
**Cannot:** Write anything.
**Session:** Per-inspection.
**Writes to:** `.atua/feedback.md` (appends)
**Key behaviors:**
- Runs after Builder completes each iteration
- Collects runtime errors from errorCollector
- Produces structured report Reviewer can act on

### Custom Roles

Any role can be defined by dropping a markdown file in `.atua/roles/`:

```markdown
---
name: DataEngineer
tools: [catalyst.sqlite, atuafs.read, atuafs.write scoped to src/data/]
sessionMode: per-task
spawnable-by: [Orchestrator]
---
You are a data engineer specializing in SQLite schema design...
```

Hive loads these at startup and makes them available to the Orchestrator as spawneable roles.

---

## 6. Inter-Agent Communication

### Primary Channel: Shared Files

The primary coordination mechanism. Every agent can read any file in AtuaFS. Write access is scoped by role (see §7). Agents poll for changes or use AtuaFS watch events.

```ts
// Orchestrator watches for sub-agent status updates
atua.fs.watch('.atua/status.json', async () => {
  const status = JSON.parse(await atua.fs.readFile('.atua/status.json', 'utf8'))
  if (status.builder.state === 'awaiting-review') {
    hive.spawn('Reviewer', { task: status.builder.lastTask })
  }
})
```

### Secondary Channel: Hub Tool Calls

For synchronous delegation where the Orchestrator needs a result before continuing, it calls a sub-agent's registered MCP tool directly:

```ts
// Orchestrator delegates synchronously to Architect
const specs = await hub.callTool('hive.architect.design', {
  task: 'Design the user authentication flow',
  context: await atua.fs.readFile('.atua/plan.md', 'utf8'),
})
```

Each spawned agent registers a tool on the hub under its role namespace. The tool accepts a task and returns when complete.

### Handoff Files

For complex context transfer between agents, the Orchestrator creates a handoff file:

```ts
// .atua/handoffs/{task-id}.json
{
  "taskId": "feat-auth-001",
  "from": "orchestrator",
  "to": "builder",
  "task": "Implement JWT authentication per .atua/specs/auth.md",
  "context": {
    "specsPath": ".atua/specs/auth.md",
    "targetFiles": ["src/auth/", "src/middleware/auth.ts"],
    "constraints": ["Use jose library", "OPFS session storage"],
    "retryBudget": 3
  },
  "createdAt": 1741000000
}
```

The Builder reads its handoff file at startup. This gives it focused context without inheriting the Orchestrator's full conversation history.

---

## 7. Tool Scoping

Each role gets a tool scope defined in its role file. The Hive enforces this at the hub level — a Builder trying to call `hive.spawn` gets a permission error.

### Scope Implementation

Tool scopes are enforced by a thin proxy wrapper around hub.callTool():

```ts
// @aspect/pi-hive/src/scoped-hub.ts

export function createScopedHub(hub: AtuaHub, allowedTools: string[]): AtuaHub {
  return {
    ...hub,
    callTool: async (name: string, args: unknown) => {
      if (!isAllowed(name, allowedTools)) {
        throw new PermissionError(
          `Role does not have access to tool: ${name}`
        )
      }
      return hub.callTool(name, args)
    },
    listTools: async () => {
      const all = await hub.listTools()
      return all.filter(t => isAllowed(t.name, allowedTools))
    },
  }
}

function isAllowed(toolName: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p.endsWith('.*')) return toolName.startsWith(p.slice(0, -2))
    return toolName === p
  })
}
```

Each Pi instance gets a scoped hub. It can only see and call its allowed tools.

### Default Scope Table

| Role | Allowed Tool Patterns |
|------|----------------------|
| Orchestrator | `*` (all tools) |
| Architect | `atuafs.read`, `atuafs.list`, `catalyst.sqlite.query`, `pi.memory.*` |
| Builder | `atuafs.*`, `catalyst.build`, `catalyst.install`, `catalyst.exec`, `pi.memory.*` |
| Reviewer | `atuafs.read`, `atuafs.list`, `catalyst.build.check`, `catalyst.lint` |
| Designer | `atuafs.read`, `atuafs.write` (path-scoped), `catalyst.preview` |
| Inspector | `catalyst.preview`, `catalyst.telemetry`, `atuafs.read` |

### Filesystem Path Scoping

Some roles get filesystem access scoped to specific paths. AtuaFS enforces this as a separate layer:

```ts
// Designer can only write to CSS/design token files
const designerFs = createPathScopedFs(atua.fs, {
  write: ['src/index.css', 'src/tokens/', '.atua/design/'],
  read: ['*'],  // read anything
})
```

---

## 8. Spawning & Lifecycle

### Spawn

```ts
// @aspect/pi-hive/src/hive.ts

export class Hive {
  private agents = new Map<string, HiveAgent>()

  async spawn(role: string, options: SpawnOptions): Promise<HiveAgent> {
    const roleConfig = await this.loadRole(role)

    // Create scoped hub for this role
    const scopedHub = createScopedHub(this.hub, roleConfig.tools)

    // Create Pi instance with role system prompt
    const pi = await createPiAgent({
      hub: scopedHub,
      model: options.model ?? this.defaultModel,
      systemPrompt: roleConfig.systemPrompt,
      sessionId: `hive:${role}:${options.taskId}`,
    })

    // Register role tool on hub (for synchronous delegation)
    this.hub.registerTool(`hive.${role.toLowerCase()}.run`, {
      description: roleConfig.description,
      schema: { task: s.string('Task description'), context: s.string('Context') },
      handler: async ({ task, context }) => pi.run(task, context),
    })

    // Write to status
    await this.updateStatus(role, 'active', options.taskId)

    const agent: HiveAgent = { role, pi, scopedHub, taskId: options.taskId }
    this.agents.set(`${role}:${options.taskId}`, agent)
    return agent
  }

  async terminate(role: string, taskId: string) {
    const key = `${role}:${taskId}`
    const agent = this.agents.get(key)
    if (!agent) return

    // Deregister hub tool
    this.hub.deregisterTool(`hive.${role.toLowerCase()}.run`)

    // Update status
    await this.updateStatus(role, 'terminated', taskId)

    this.agents.delete(key)
  }

  async terminateAll() {
    for (const [key] of this.agents) {
      const [role, taskId] = key.split(':')
      await this.terminate(role, taskId)
    }
  }
}
```

### Worker Budget

Each Pi agent runs in the browser tab's JS thread (Pi is TypeScript, not a Worker). LLM calls are async and non-blocking. The constraint is concurrent LLM requests — browser tabs have connection limits.

Recommendation: Max 3 concurrent Pi agents making LLM calls simultaneously. Hive enforces a concurrency semaphore:

```ts
const llmSemaphore = new Semaphore(3)

// In Pi agent wrapper
async function callLLM(request: CompletionRequest) {
  await llmSemaphore.acquire()
  try {
    return await pi.ai.call(request)
  } finally {
    llmSemaphore.release()
  }
}
```

Queued agents wait for a slot. This prevents request stacking and rate limit hits.

### Lifecycle States

```
created → active → awaiting-handoff → idle → terminated
                ↘ error → terminated
```

Agents write their state to `.atua/status.json` at each transition. The Orchestrator watches this file and reacts.

---

## 9. External Orchestration: Claude Desktop

This is the primary external use case. Claude Desktop connects to Atua as an MCP server and orchestrates the Hive from outside the browser.

### Connection

```
Claude Desktop MCP config:
{
  "atua": {
    "transport": "streamableHttp",
    "url": "https://atua.dev/mcp"  // or localhost relay
  }
}
```

The relay at `relay.atua.dev` handles the WebSocket → browser-tab MCP bridge (same relay used for TCP and LLM proxy).

### What Claude Desktop Can Do

```
# Kick off a full build task
pi.prompt({ message: "Build a SaaS dashboard with auth, dark mode, and a revenue chart" })

# Check progress
pi.status()
→ { orchestrator: "delegating", builder: "writing src/Dashboard.tsx", reviewer: "idle" }

# Inspect what's been built
atuafs.list({ path: "src/" })
atuafs.read({ path: "src/Dashboard.tsx" })

# See what Pi has learned
pi.memory.search({ query: "authentication decisions" })

# Trigger a specific sub-task directly
hive.architect.run({ task: "Redesign the data model for multi-tenancy" })

# Get preview URL
catalyst.preview()
→ { url: "http://localhost:3000", status: "running" }

# Terminate everything and start fresh
hive.terminate({ all: true })
```

### The Delegation Pattern

Claude Desktop doesn't need to manage sub-agents. It kicks off the Orchestrator and observes:

```
Claude Desktop: pi.prompt("Build me a full-stack todo app")

Orchestrator Pi:
  1. Writes .atua/plan.md
  2. spawns Architect → waits for .atua/specs/
  3. spawns Builder with handoff
  4. spawns Inspector after each build
  5. spawns Reviewer when Inspector finds issues
  6. spawns Builder again with feedback
  7. reports completion

Claude Desktop: pi.status()
→ "Complete. Preview at http://localhost:3000. 14 files written. 0 build errors."

Claude Desktop: catalyst.preview()
→ opens preview in browser
```

Claude Desktop issued one instruction. Pi Hive ran 5 agent instances across 12 iterations. Claude Desktop never knew.

### Streaming Progress

The `pi.prompt` tool supports streaming via MCP's streaming tool response pattern. The Orchestrator streams status updates as sub-agents complete tasks:

```
[streaming from pi.prompt]
→ "Planning task..."
→ "Architect: Designing component structure"
→ "Architect: Complete. Specs written to .atua/specs/"
→ "Builder: Installing dependencies (react-query, zod)"
→ "Builder: Writing src/components/ (3/8 components)"
→ "Builder: Build failed — TypeScript error in UserList.tsx"
→ "Builder: Fixing TypeScript error (attempt 2/3)"
→ "Builder: Build passing. Preview available."
→ "Inspector: Running accessibility audit"
→ "Review complete. 2 warnings, 0 blockers."
→ "Task complete. Preview: http://localhost:3000"
```

---

## 10. Shared State Model

### AtuaFS Conventions

All Hive coordination files live under `.atua/`. Never in `src/`. The running application never sees these files.

```
.atua/
├── plan.md              Master plan — Orchestrator writes once per task
├── roles/               Role definitions — static or user-defined
│   ├── orchestrator.md
│   ├── architect.md
│   ├── builder.md
│   ├── reviewer.md
│   ├── designer.md
│   └── inspector.md
├── specs/               Architecture specs — Architect writes, Builder reads
├── feedback.md          Reviewer output — appended per review pass
├── status.json          Live agent status — all agents write
├── handoffs/            Task context packages
└── memory/              Ephemeral task memory (distinct from Pi's long-term memory)
```

### status.json Schema

```ts
interface HiveStatus {
  taskId: string
  startedAt: number
  agents: {
    [role: string]: {
      state: 'active' | 'idle' | 'awaiting-handoff' | 'error' | 'terminated'
      currentTask?: string
      lastUpdate: number
      iterationCount: number
      errorCount: number
    }
  }
  buildState: 'clean' | 'building' | 'failed' | 'passing'
  previewUrl?: string
}
```

### CatalystD1 Tables

Beyond files, agents write structured data to wa-sqlite:

```sql
-- All agent activity, queryable by role, task, or time
CREATE TABLE agent_log (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL,        -- 'llm_call', 'tool_call', 'file_write', etc.
  detail TEXT,                 -- JSON
  created_at INTEGER NOT NULL
);

-- Handoff records — audit trail of task delegation
CREATE TABLE agent_handoffs (
  id INTEGER PRIMARY KEY,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_description TEXT NOT NULL,
  handoff_file TEXT,           -- path to handoff JSON
  status TEXT NOT NULL,        -- 'pending', 'accepted', 'complete', 'failed'
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Cross-agent memory — searchable by FTS5
CREATE VIRTUAL TABLE agent_memory USING fts5(
  task_id,
  role,
  content,
  importance REAL,
  created_at INTEGER
);
```

---

## 11. Quality Gate Agents

The Reviewer and Inspector roles deserve special treatment — they are invoked automatically, not on demand.

### Auto-Gate Pattern

The Builder Pi has a post-write extension hook. After every file write that produces a buildable artifact, it triggers the quality pipeline:

```ts
// Builder's post-write extension
onToolCall('atuafs.write', async ({ path, content }) => {
  if (isBuildableFile(path)) {
    // Write status
    await updateStatus('awaiting-inspection')

    // Spawn Inspector (synchronous — wait for result)
    const inspectorResult = await hive.spawn('Inspector', {
      task: `Inspect ${path} and running application state`,
      taskId: currentTaskId,
    })

    // If Inspector found issues, spawn Reviewer
    if (inspectorResult.hasIssues) {
      const reviewerResult = await hive.spawn('Reviewer', {
        task: 'Review issues from Inspector',
        taskId: currentTaskId,
      })

      // Update feedback file
      await atua.fs.appendFile('.atua/feedback.md', reviewerResult.feedback)
    }

    // Builder reads feedback on next iteration
    await updateStatus('active')
  }
})
```

### Retry Budget

Each Builder task has a `retryBudget` in its handoff file. Every Reviewer block decrements it:

```ts
handoff.retryBudget -= blockerCount
if (handoff.retryBudget <= 0) {
  // Escalate to Orchestrator — Builder can't resolve this
  await hub.callTool('hive.orchestrator.escalate', {
    taskId: handoff.taskId,
    reason: 'Retry budget exhausted',
    lastFeedback: await atua.fs.readFile('.atua/feedback.md', 'utf8'),
  })
}
```

The Orchestrator decides whether to retry with a different approach, spawn an Architect to redesign, or report failure to the external client.

---

## 12. Failure & Recovery

### Agent Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| LLM returns malformed response | Pi's agent loop catches JSON parse error | Retry up to 2 times with corrected prompt |
| Build fails repeatedly | Retry budget exhausted | Escalate to Orchestrator |
| Agent exceeds time limit | Hive watchdog timer | Terminate and report |
| Hub tool call fails | Tool returns error | Agent decides: retry, skip, or escalate |
| Browser tab backgrounded | Web Lock keeps kernel alive | Agents resume when tab returns to foreground |

### Watchdog

The Hive runs a watchdog timer that monitors `.atua/status.json`:

```ts
const AGENT_TIMEOUT_MS = 5 * 60 * 1000  // 5 minutes per agent task

hive.watchdog = setInterval(async () => {
  const status = await loadStatus()
  const now = Date.now()

  for (const [role, agentStatus] of Object.entries(status.agents)) {
    if (
      agentStatus.state === 'active' &&
      now - agentStatus.lastUpdate > AGENT_TIMEOUT_MS
    ) {
      console.warn(`Agent ${role} timed out — terminating`)
      await hive.terminate(role, status.taskId)
      await hub.callTool('hive.orchestrator.notify', {
        event: 'agent_timeout',
        role,
        taskId: status.taskId,
      })
    }
  }
}, 30_000)
```

### Checkpoint Recovery

Before each major delegation, the Orchestrator writes a checkpoint to `.atua/checkpoints/`:

```json
{
  "checkpointId": "cp-001",
  "planState": "architect-complete",
  "completedTasks": ["design-components", "design-data-model"],
  "pendingTasks": ["implement-auth", "implement-dashboard"],
  "filesWritten": ["src/types/", ".atua/specs/"],
  "createdAt": 1741000000
}
```

If the Orchestrator loses context (tab reload, context window compaction), it reads the latest checkpoint and resumes from there rather than starting over.

---

## 13. Observability

### MCP Tools for Inspection

External clients can inspect the Hive at any granularity:

```ts
// High-level status
hive.status()
→ { activAgents: 2, buildState: 'passing', iterationCount: 7 }

// Per-agent status
hive.agent.status({ role: 'Builder' })
→ { state: 'active', currentTask: 'Writing src/auth/middleware.ts', ... }

// Full log
hive.log({ role: 'Builder', limit: 50 })
→ [{ action: 'llm_call', ... }, { action: 'file_write', path: 'src/...' }, ...]

// Memory
pi.memory.search({ query: 'authentication', role: 'Architect' })
→ [{ content: 'Decided to use JWT with 1-hour expiry', importance: 0.9 }]

// Handoff history
hive.handoffs({ taskId: 'current' })
→ [{ from: 'orchestrator', to: 'builder', status: 'complete', ... }]
```

### Hashbrown Integration (Optional)

When `@aspect/atua-ui` is present, Hive status renders as live UI in the host application:

```tsx
// Orchestrator streams progress → Hashbrown renders it
const chat = useUiChat({
  tools: [
    useTool({ name: 'hiveStatus', handler: () => hive.getStatus() }),
    useTool({ name: 'agentLog', handler: ({ role }) => hive.getLog(role) }),
  ],
  components: [
    exposeComponent(AgentStatusCard, { ... }),
    exposeComponent(BuildProgressBar, { ... }),
    exposeComponent(FeedbackList, { ... }),
  ]
})
```

The running application can surface Hive activity as a first-class UI element — not a debug panel, a live feature.

---

## 14. Package Structure

```
packages/pi-hive/
├── src/
│   ├── index.ts                    Public API: createHive(), Hive class
│   ├── hive.ts                     Core Hive class — spawn, terminate, status
│   ├── agent/
│   │   ├── hive-agent.ts           HiveAgent wrapper around Pi instance
│   │   ├── scoped-hub.ts           Tool scope enforcement
│   │   ├── path-scoped-fs.ts       Filesystem path scoping
│   │   └── watchdog.ts             Timeout monitoring
│   ├── roles/
│   │   ├── role-loader.ts          Load role configs from .atua/roles/
│   │   ├── role-registry.ts        In-memory role registry
│   │   └── defaults/               Default role markdown files
│   │       ├── orchestrator.md
│   │       ├── architect.md
│   │       ├── builder.md
│   │       ├── reviewer.md
│   │       ├── designer.md
│   │       └── inspector.md
│   ├── coordination/
│   │   ├── shared-state.ts         Read/write .atua/ coordination files
│   │   ├── handoff.ts              Handoff file creation and consumption
│   │   ├── status.ts               status.json management
│   │   └── checkpoint.ts           Checkpoint write/restore
│   ├── quality/
│   │   ├── gate-extension.ts       Builder post-write extension
│   │   ├── retry-budget.ts         Retry budget tracking
│   │   └── escalation.ts           Escalation to Orchestrator
│   ├── external/
│   │   ├── mcp-provider.ts         hive.* tools on the hub
│   │   └── streaming-progress.ts  Streaming status updates
│   └── db/
│       ├── schema.sql               CatalystD1 table definitions
│       └── queries.ts               Typed query helpers
├── package.json
└── README.md
```

---

## 15. Implementation Phases

### Phase 0: Single-Agent Foundation
**Depends on:** Pi-Atua (Conductor) complete
**Goal:** Verify Pi works correctly as the basis for multi-agent before adding coordination

**What gets built:**
- `HiveAgent` wrapper around a single Pi instance
- `ScopedHub` with tool filtering
- Path-scoped filesystem wrapper
- Basic `.atua/status.json` write on agent state changes

**Verification:**
- [ ] `hive.spawn('Builder', {...})` creates Pi with scoped tools
- [ ] Builder Pi cannot call `hive.spawn` (permission error)
- [ ] Builder Pi cannot write to `.atua/plan.md` (path scope error)
- [ ] `status.json` updated when agent starts and terminates

---

### Phase 1: Orchestrator + One Sub-Agent
**Depends on:** Phase 0
**Goal:** Orchestrator delegates to Builder via handoff file

**What gets built:**
- Orchestrator role with full hub access
- Handoff file creation and consumption
- Builder reads handoff at startup
- Orchestrator waits for Builder completion via status watch

**Verification:**
- [ ] Orchestrator spawns Builder with handoff file
- [ ] Builder reads handoff, executes task, writes result
- [ ] Orchestrator detects Builder completion via status watch
- [ ] End-to-end: Orchestrator + Builder write a React component to `src/`

---

### Phase 2: Full Role Set
**Depends on:** Phase 1
**Goal:** All 6 default roles work correctly

**What gets built:**
- Architect, Reviewer, Designer, Inspector role files
- Quality gate extension in Builder
- Retry budget tracking
- Escalation to Orchestrator

**Verification:**
- [ ] Full pipeline: Orchestrator → Architect → Builder → Inspector → Reviewer → Builder (iteration)
- [ ] Reviewer blocks cause retry budget decrement
- [ ] Budget exhaustion triggers Orchestrator escalation
- [ ] Designer generates valid CSS variables in `src/index.css`
- [ ] Inspector detects runtime errors and writes to feedback.md

---

### Phase 3: External MCP Surface
**Depends on:** Phase 2, relay.atua.dev deployed
**Goal:** Claude Desktop can orchestrate the Hive via MCP

**What gets built:**
- `hive.*` tools registered on hub
- Streaming progress from `pi.prompt` → external client
- Checkpoint write/restore
- Full `hive.status`, `hive.log`, `hive.handoffs` tools

**Verification:**
- [ ] Claude Desktop connects to relay, lists hive.* tools
- [ ] `pi.prompt` streams progress updates back to Claude Desktop
- [ ] Claude Desktop can read `atuafs.read` on files Builder wrote
- [ ] Tab reload → Orchestrator reads checkpoint → resumes correctly
- [ ] Watchdog terminates stuck agent after timeout

---

### Phase 4: Custom Roles + Hashbrown Integration
**Depends on:** Phase 3, Sizzle (Hashbrown integration) optional
**Goal:** User-defined roles, observable UI

**What gets built:**
- Role loader from `.atua/roles/` custom files
- Role registry with runtime registration
- Hive status → Hashbrown components (if Sizzle present)
- `AgentStatusCard`, `BuildProgressBar`, `FeedbackList` components

**Verification:**
- [ ] Drop custom role file in `.atua/roles/` → `hive.spawn('CustomRole')` works
- [ ] Custom role tool scopes enforced correctly
- [ ] Hashbrown renders live AgentStatusCard with real hive.status data
- [ ] FeedbackList updates in real time as Reviewer writes feedback.md

---

## 16. CC Kickoff Prompts

### Phase 0 kickoff

```
Read docs/plans/pi-hive-spec.md. This is the spec for Pi Hive —
multi-agent coordination inside Atua.

Implement Phase 0 only. Goal: single HiveAgent wrapper around Pi with
scoped hub and path-scoped filesystem.

Read first:
- docs/plans/pi-hive-spec.md (this spec)
- docs/plans/pi-atua-spec.md (Pi-Atua/Conductor — foundation)
- packages/pi-atua/src/index.ts (Pi agent creation API)
- packages/atua-fabric/src/hub.ts (MCP hub interface)

Do not implement coordination, spawning, or roles yet. Phase 0 only.
Commit: git add -A && git commit -m "Hive Phase 0: scoped agent foundation"
```

### Phase 1–4 kickoffs

```
Continue with Pi Hive Phase {N} per docs/plans/pi-hive-spec.md.
Run verification checklist before committing.
git add -A && git commit -m "Hive Phase {N}: {description}"
```

---

## 17. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Concurrent LLM calls hit rate limits | High | High | Semaphore (max 3 concurrent). Orchestrator staggers spawning. OpenRouter has higher limits than direct providers. |
| Shared file race conditions (two agents writing simultaneously) | Medium | Medium | Web Locks API — same mechanism as kernel. Each agent acquires lock before writing coordination files. |
| Orchestrator loses plan context due to compaction | Medium | Medium | Checkpoint files. Orchestrator re-reads `.atua/plan.md` at start of each delegation cycle. |
| Sub-agent goes off-script (writes outside its scope) | Medium | Low | ScopedHub + path-scoped FS enforced at adapter layer — not prompt-based. Hard block. |
| Relay latency makes external orchestration feel slow | Low | Medium | Streaming progress mitigates perceived latency. External client sees updates token-by-token. |
| Builder iteration loops indefinitely | Medium | Low | Retry budget (default 3). Watchdog timer (5 min). Both independently terminate infinite loops. |
| Tab close terminates mid-task Hive | Medium | High | Checkpoint recovery on reload. Web Lock extends kernel lifetime but doesn't survive tab close. Document clearly — Hive tasks require tab to stay open. |
| Custom role with dangerous tool scope | Medium | Low | Role files loaded from `.atua/roles/` which Pi itself controls. External clients cannot inject role files directly. |

---

## 18. Success Criteria

All must pass in a real browser (Playwright chromium):

| # | Test | Proves |
|---|------|--------|
| 1 | `hive.spawn('Builder')` creates Pi with scoped tools, cannot call `hive.spawn` | §7: Tool scoping works |
| 2 | Orchestrator spawns Architect, receives spec files in `.atua/specs/` | §8: Spawn + handoff works |
| 3 | Full pipeline: Orchestrator → Architect → Builder → Inspector → Reviewer → Builder | §5: All roles work |
| 4 | Retry budget exhaustion triggers Orchestrator escalation | §11: Quality gates work |
| 5 | Watchdog terminates agent silent for 5 minutes | §12: Failure recovery works |
| 6 | Tab reload → Orchestrator reads checkpoint → task continues | §12: Checkpoint recovery works |
| 7 | Claude Desktop `pi.prompt` streams 10+ progress updates during task | §9: External orchestration works |
| 8 | Claude Desktop reads files Builder wrote via `atuafs.read` | §9: External filesystem access works |
| 9 | Custom role file in `.atua/roles/` spawnable without code change | §5: Custom roles work |
| 10 | 3 concurrent agents making LLM calls — 4th queues, unblocks when slot frees | §8: Concurrency semaphore works |
| 11 | Two agents attempting simultaneous write to feedback.md — no corruption | §10: Web Lock coordination works |
| 12 | `pi.memory.search` returns Architect's design decisions after Builder runs | §10: Cross-agent memory works |
