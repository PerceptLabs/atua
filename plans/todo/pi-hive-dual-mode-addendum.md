# Pi Hive — Dual-Mode Orchestration Addendum

**Updates:** `pi-hive-spec.md` + `hive-implementation-plan.md`
**Status:** Draft
**Date:** 2026-03-04

This addendum introduces a first-class dual-mode orchestration system. Read alongside the base Hive spec and implementation plan. Where this document contradicts the base spec, this document wins.

---

## What Changes and Why

The base Hive spec describes one orchestration model: an internal Pi instance acts as Orchestrator, receives tasks from external clients via `pi.prompt`, and delegates to sub-agents.

This works but wastes a context window. The external LLM — Claude Desktop, bolt.dev's AI, Cursor, whatever — already has project context, task history, and planning capability. Routing through a Pi Orchestrator adds latency and an unnecessary translation layer between the external LLM's intent and the workers that execute it.

The better model for capable external clients: they *are* the orchestrator. They write the plan directly to AtuaFS, create handoffs, spawn agents, read results, decide next steps. Pi agents are pure execution workers. No middleman.

Both models are valid for different clients. A simple client that only knows `pi.prompt` should still work. Claude Desktop should be able to drive Pi agents directly without going through a Pi middleman.

**The solution:** two modes, switchable at init time and at runtime, exposed on the same Fabric hub.

---

## Orchestration Modes

### Mode A — Internal (Pi Orchestrator)

Original model. One Pi instance acts as Orchestrator. External clients call `pi.prompt`. Orchestrator handles everything internally.

**Best for:** Simple clients, zero-config integrations, clients that treat Atua as a black box.

**Entry point:** `pi.prompt`

**MCP tools registered:**
```
pi.prompt         → Orchestrator Pi (runs full agent loop, delegates internally)
pi.status         → Orchestrator's aggregate view
pi.session.*      → Orchestrator's session management
pi.memory.*       → Orchestrator's memory
```

### Mode B — External (Headless Hive)

New model. External LLM is the orchestrator. It calls Fabric tools directly to plan, spawn, delegate, and observe. No Pi Orchestrator.

**Best for:** Claude Desktop, bolt.dev AI, Cursor, any LLM with strong planning capability and existing project context.

**Entry point:** `hive.plan.write` + `hive.spawn` + `hive.agent.run`

**MCP tools registered:**
```
hive.plan.write       → writes /.atua/plan.md (external LLM authors this)
hive.handoff.create   → creates /.atua/handoffs/{taskId}.json
hive.handoff.read     → reads a handoff file
hive.spawn            → spawns a named role (no task yet)
hive.agent.run        → runs a spawned agent synchronously (blocks until done)
hive.agent.runAsync   → runs a spawned agent, returns taskId immediately
hive.agent.status     → { role } → current agent state + lastUpdate
hive.status           → raw /.atua/status.json (all agents)
hive.feedback.read    → reads /.atua/feedback.md
hive.specs.read       → reads /.atua/specs/ directory listing + content
hive.specs.write      → writes to /.atua/specs/{filename}
hive.terminate        → terminates one agent or all
hive.checkpoint.save  → saves current hive state to OPFS
hive.checkpoint.load  → restores hive state from OPFS
hive.roles.list       → lists available role names + descriptions
hive.log              → queryable agent activity log
```

### Mode C — Both (Default)

All tools from both modes registered simultaneously. External clients self-select based on `hub.listTools()` discovery:

- Clients that find `hive.plan.write` and understand it → use Mode B directly
- Clients that only know `pi.prompt` → use Mode A automatically
- Advanced clients → can mix both (e.g., use `pi.prompt` for simple tasks, drop into `hive.spawn` for parallel workloads)

**This is the recommended default.** No client is excluded. Capable clients get full control.

---

## Mode Configuration

### At init time

```ts
const hive = await createHive({
  hub,
  fs,
  orchestrationMode: 'internal' | 'external' | 'both',  // default: 'both'
  defaultModel: 'anthropic/claude-sonnet-4-6',
  internalOrchestratorModel: 'anthropic/claude-opus-4-6',  // smarter model for Pi Orchestrator
  workerModel: 'anthropic/claude-sonnet-4-6',               // cost-efficient for worker agents
})
```

### At runtime

```ts
// Switch modes without restarting
await hive.setMode('external')
// Deregisters pi.prompt (internal entry point)
// Registers hive.plan.write, hive.spawn, etc.

await hive.setMode('internal')
// Reverse

await hive.setMode('both')
// All tools registered

// Query current mode
hive.mode  // 'internal' | 'external' | 'both'
```

Mode switching is atomic — hub deregisters old tools and registers new ones in a single operation. In-flight agent tasks are not interrupted. The mode change only affects what entry points are available to new requests.

### Settings surface

In the IDE settings panel:

```
Orchestration Mode
  ◉ Both (recommended)
  ○ Internal — Pi manages everything
  ○ External — Let your AI client drive directly

[Save]
```

Settings written to `/.atua/config.json` → `hive.orchestrationMode`. Persists across page loads.

---

## Mode B Protocol — External Orchestrator Workflow

This is the protocol a capable external LLM follows when using Mode B. The Hive spec's §9 described what Claude Desktop *could* do; this section defines what it *should* do when operating in external mode.

### Step 1 — Discover capabilities

```
hub.listTools()
→ finds hive.* tools → enters Mode B protocol
→ finds hive.roles.list → learns available roles
→ does NOT find hive.plan.write → falls back to pi.prompt (Mode A)
```

### Step 2 — Write the plan

```ts
hive.plan.write({
  taskId: 'build-saas-dashboard',
  task: 'Build a SaaS dashboard with auth, dark mode, and revenue analytics',
  roles: ['Architect', 'Builder', 'Designer', 'Reviewer'],
  constraints: [
    'TypeScript strict mode',
    'shadcn/ui components only',
    'OKLCH color system',
    'No hardcoded colors',
  ],
  successCriteria: [
    'pnpm build passes with zero errors',
    'Auth flow works end-to-end',
    'Revenue chart renders with mock data',
  ],
})
// Writes /.atua/plan.md — all Pi agents will read this
```

### Step 3 — Delegate architecture

```ts
// Spawn Architect first — it produces specs Builder will consume
hive.agent.run({
  role: 'Architect',
  task: 'Design component structure, data model, and API surface for the plan in /.atua/plan.md',
  taskId: 'arch-001',
})
// Blocks until Architect writes /.atua/specs/

// External LLM reads the output
hive.specs.read({ taskId: 'arch-001' })
→ { components: '...', dataModel: '...', apiSurface: '...' }
// External LLM can review and amend before delegating implementation
```

### Step 4 — Parallel execution

```ts
// Spawn multiple Builders in parallel for independent modules
const [authTask, dashboardTask] = await Promise.all([
  hive.agent.runAsync({
    role: 'Builder',
    task: 'Implement authentication per /.atua/specs/auth.md',
    taskId: 'build-auth',
    retryBudget: 3,
  }),
  hive.agent.runAsync({
    role: 'Builder',
    task: 'Implement dashboard layout per /.atua/specs/dashboard.md',
    taskId: 'build-dashboard',
    retryBudget: 3,
  }),
])

// Poll until both complete
await hive.waitForAll([authTask, dashboardTask])
```

### Step 5 — Observe, decide, iterate

```ts
// Read what was built
const feedback = await hive.feedback.read()
const buildStatus = await hive.status()

if (buildStatus.buildState === 'failed') {
  // External LLM decides: escalate, retry, or amend plan
  const errorLog = await hive.log({ role: 'Builder', limit: 20 })
  // External LLM analyzes, may rewrite part of the plan
  await hive.plan.write({ ...updatedPlan })
  // Re-delegate
}
```

### Step 6 — Design pass

```ts
hive.agent.run({
  role: 'Designer',
  task: 'Generate a cohesive theme using OKLCH. Professional SaaS aesthetic. Dark mode first.',
  taskId: 'design-001',
})
```

### Step 7 — Review

```ts
hive.agent.run({
  role: 'Reviewer',
  task: 'Review all files in src/ against the plan in /.atua/plan.md',
  taskId: 'review-001',
})

const reviewFeedback = await hive.feedback.read()
// External LLM decides if blockers require another Builder iteration
```

---

## Bolt.dev Integration Pattern

bolt.dev's AI has full codebase context, task history, and user intent. It's the natural orchestrator. The integration:

**bolt.dev AI connects to Atua MCP endpoint:**
```json
{
  "atua": {
    "transport": "streamableHttp",
    "url": "https://relay.atua.dev/mcp"
  }
}
```

**bolt.dev AI discovers `hive.*` tools → enters external mode:**

```
bolt AI: "Build the authentication system for this project"
→ hive.plan.write (bolt has the full project context, writes a precise plan)
→ hive.agent.run('Architect', ...) → specs generated
→ hive.agent.runAsync('Builder', ...) → implementation running in background
→ bolt AI continues handling other user requests while Builder works
→ hive.status() poll → Builder completes
→ atuafs.read('src/auth/') → bolt AI reviews output
→ hive.agent.run('Reviewer', ...) → quality gate
→ bolt AI surfaces result to user
```

bolt.dev's AI writes the plan from its codebase understanding. Pi agents do the filesystem work. The division is clean: bolt AI = what and why, Pi = how.

**The key advantage over bolt's current model:** Pi agents run in the user's browser, not bolt's infrastructure. Parallel Builder instances cost bolt nothing — they run on the user's machine. bolt.dev offloads the execution loop entirely.

---

## Multi-Client Coordination

Multiple external LLMs can connect to the same Fabric hub simultaneously and coordinate through shared AtuaFS state:

```
Claude Desktop     → writes /.atua/plan.md, spawns Architect
bolt.dev AI        → reads /.atua/specs/, spawns parallel Builders
Cursor AI          → reads src/ for context, calls hive.feedback.read, spawns Reviewer
```

They don't call each other. They don't need to. The filesystem is the coordination layer, same as how internal Pi agents coordinate. Any external LLM that reads `/.atua/status.json` knows what every other client has done.

Conflict prevention: Web Locks on plan.md and status.json (already in base spec) prevent concurrent writes from corrupting state. Last-write-wins on specs — external LLMs should read before writing to avoid clobbering Architect output.

---

## `hive.waitForAll()` — New Tool

Not in the base spec. Required for the parallel execution pattern in Mode B:

```ts
// Fabric tool: waits for multiple async agent tasks to complete
hive.waitForAll({
  taskIds: ['build-auth', 'build-dashboard'],
  timeoutMs: 300_000,  // 5 minutes
  pollIntervalMs: 2_000,
})
→ { completed: ['build-auth', 'build-dashboard'], failed: [], timedOut: [] }
```

Internally: polls `/.atua/status.json` every `pollIntervalMs`, resolves when all taskIds reach `idle` or `terminated` state.

---

## Updated Package Structure

Add to `packages/pi-hive/src/`:

```
src/
├── modes/
│   ├── mode-manager.ts        Mode switching logic, atomic tool (de)registration
│   ├── internal-mode.ts       Registers pi.prompt → Orchestrator Pi
│   ├── external-mode.ts       Registers all hive.* planning tools
│   └── mode-config.ts         Read/write /.atua/config.json orchestration mode setting
├── external/
│   ├── mcp-provider.ts        (already exists) — split into internal/external
│   ├── plan-tools.ts          hive.plan.write, hive.handoff.*, hive.specs.*
│   ├── spawn-tools.ts         hive.spawn, hive.agent.run, hive.agent.runAsync
│   ├── observe-tools.ts       hive.status, hive.feedback.read, hive.log, hive.roles.list
│   ├── control-tools.ts       hive.terminate, hive.checkpoint.*, hive.setMode
│   └── wait-for-all.ts        hive.waitForAll polling logic
```

---

## Updated `createHive()` Signature

```ts
export interface HiveOptions {
  hub: AtuaHub
  fs: AtuaFS
  db: CatalystD1

  orchestrationMode?: 'internal' | 'external' | 'both'  // default: 'both'

  // Model routing — different roles can use different models
  defaultModel?: string
  modelOverrides?: {
    orchestrator?: string   // internal mode Pi Orchestrator
    architect?: string
    builder?: string
    reviewer?: string
    designer?: string
    inspector?: string
    [role: string]: string | undefined
  }

  // Worker limits
  maxConcurrentLLMCalls?: number  // default: 3
  agentTimeoutMs?: number         // watchdog timeout, default: 5 * 60 * 1000

  // Persistence
  piSession?: PiAtua  // optional Pi session integration
}

export async function createHive(options: HiveOptions): Promise<Hive>

export class Hive {
  mode: 'internal' | 'external' | 'both'
  async setMode(mode: 'internal' | 'external' | 'both'): Promise<void>
  async spawn(role: string, options: SpawnOptions): Promise<HiveAgent>
  async terminate(role: string, taskId: string): Promise<void>
  async terminateAll(): Promise<void>
  async getStatus(): Promise<HiveStatus>
  async saveCheckpoint(): Promise<void>
  async loadCheckpoint(): Promise<boolean>
}
```

---

## Implementation Plan Updates

### New Phase: Phase 0b — Mode Manager

Insert between existing Phase 0 (scoped agent foundation) and Phase 1 (Orchestrator + single sub-agent).

**Goal:** Mode switching infrastructure exists before either mode is built. Both subsequent phases plug into it.

**Execution order:**

1. `packages/pi-hive/src/modes/mode-config.ts` — read/write `/.atua/config.json`:
   ```ts
   export async function getOrchestratorMode(fs: AtuaFS): Promise<OrchestratorMode>
   export async function setOrchestratorMode(fs: AtuaFS, mode: OrchestratorMode): Promise<void>
   ```

2. `packages/pi-hive/src/modes/mode-manager.ts` — `ModeManager` class:
   ```ts
   export class ModeManager {
     private currentMode: OrchestratorMode
     
     async switchTo(mode: OrchestratorMode): Promise<void> {
       // Atomic: deregister old tools, register new tools
       // Does not interrupt in-flight agent tasks
       await navigator.locks.request('atua-hive-mode', async () => {
         await this.deregisterCurrentMode()
         this.currentMode = mode
         await this.registerMode(mode)
         await setOrchestratorMode(this.fs, mode)
       })
     }
     
     private async registerMode(mode: OrchestratorMode) {
       if (mode === 'internal' || mode === 'both') await this.registerInternalTools()
       if (mode === 'external' || mode === 'both') await this.registerExternalTools()
     }
   }
   ```

3. Update `createHive()` to instantiate `ModeManager`, read mode from config, register accordingly

4. `tests/phase0b-mode-manager.browser.test.ts`:
   ```
   createHive({ mode: 'internal' }) → hub.listTools() includes pi.prompt, excludes hive.plan.write
   createHive({ mode: 'external' }) → hub.listTools() includes hive.plan.write, excludes pi.prompt
   createHive({ mode: 'both' }) → hub.listTools() includes both
   hive.setMode('external') → pi.prompt deregistered, hive.plan.write registered
   setMode is atomic — no window where neither set of tools is registered
   Mode persists to /.atua/config.json, survives hive restart
   ```

### Updated Phase 1 — Internal Mode

Existing Phase 1 (Orchestrator + Builder) is now specifically **Internal Mode** implementation.

After building it, add to Phase 1 verification:
```
createHive({ mode: 'internal' }) → pi.prompt routes to Pi Orchestrator
createHive({ mode: 'both' }) → same behavior via pi.prompt
```

### New Phase: Phase 1b — External Mode Tools

**Depends on:** Phase 0b (mode manager)
**Goal:** All `hive.*` planning tools work. External LLM can drive agents directly.

**Execution order:**

1. `packages/pi-hive/src/external/plan-tools.ts`:
   - `hive.plan.write({ taskId, task, roles, constraints, successCriteria })` → writes `/.atua/plan.md` as structured markdown
   - `hive.handoff.create({ from, to, task, taskId, context })` → writes `/.atua/handoffs/{taskId}.json`
   - `hive.handoff.read({ taskId })` → reads handoff JSON
   - `hive.specs.read({ taskId? })` → lists `/.atua/specs/` and returns file contents
   - `hive.specs.write({ filename, content })` → writes to `/.atua/specs/{filename}`
   - `hive.feedback.read()` → reads `/.atua/feedback.md`

2. `packages/pi-hive/src/external/spawn-tools.ts`:
   - `hive.spawn({ role, taskId })` → spawns agent, returns immediately (no task yet)
   - `hive.agent.run({ role, task, taskId, retryBudget? })` → spawns + runs synchronously, blocks until done, returns result
   - `hive.agent.runAsync({ role, task, taskId, retryBudget? })` → spawns + runs async, returns `taskId`
   - `hive.agent.status({ role })` → single agent status

3. `packages/pi-hive/src/external/wait-for-all.ts`:
   - `hive.waitForAll({ taskIds, timeoutMs?, pollIntervalMs? })` → polls `status.json`, resolves when all tasks settle

4. `packages/pi-hive/src/external/observe-tools.ts`:
   - `hive.status()` → full `HiveStatus`
   - `hive.log({ role?, taskId?, limit? })` → D1 query on `agent_log`
   - `hive.roles.list()` → available role names + descriptions + tool scopes

5. `packages/pi-hive/src/external/control-tools.ts`:
   - `hive.terminate({ role, taskId } | { all: true })` → terminate one or all
   - `hive.checkpoint.save()` → calls `saveCheckpoint()`
   - `hive.checkpoint.load()` → calls `loadCheckpoint()`
   - `hive.setMode({ mode })` → delegates to `ModeManager.switchTo()`

6. `tests/phase1b-external-mode.browser.test.ts`

**Phase 1b verification:**
```
hive.plan.write → /.atua/plan.md written with correct structure
hive.handoff.create → /.atua/handoffs/{taskId}.json written
hive.spawn('Builder') → agent created, no task yet, status 'idle'
hive.agent.run('Builder', task) → Builder executes task, returns result, writes file to src/
hive.agent.runAsync returns taskId immediately, agent runs in background
hive.waitForAll([taskId1, taskId2]) → resolves when both reach idle/terminated
hive.specs.read() → returns /.atua/specs/ contents
hive.feedback.read() → returns /.atua/feedback.md contents
hive.roles.list() → correct role names and descriptions
Full Mode B workflow: plan.write → spawn Architect → agent.run → specs.read → spawn Builder → agent.runAsync → waitForAll → feedback.read
```

### Updated Phase 3 — External MCP Surface

Phase 3 in the base plan now covers the relay connection and streaming for both modes.

Add to Phase 3 verification:
```
Mode B: external client writes plan, spawns two parallel Builders via runAsync, waitForAll resolves correctly
Mode switch mid-session: hive.setMode('external') while Builder is running → Builder completes normally, pi.prompt deregistered after in-flight tasks
Two external clients connected simultaneously → shared status.json updates visible to both
Claude Desktop: discovers hive.* tools → uses Mode B → streams progress → receives final result
bolt.dev pattern: hive.plan.write + hive.agent.runAsync × 2 + hive.waitForAll → both agents complete → correct status
```

---

## Updated Success Criteria

Add to §18 of the base spec:

| # | Test | Proves |
|---|------|--------|
| 13 | `createHive({ mode: 'both' })` → `hub.listTools()` includes both `pi.prompt` and `hive.plan.write` | Both modes registered |
| 14 | `hive.setMode('external')` → `pi.prompt` deregistered, `hive.plan.write` registered, in-flight tasks uninterrupted | Mode switching atomic |
| 15 | External client: `hive.plan.write` + `hive.agent.run('Architect')` + `hive.specs.read()` → specs available | Mode B planning works |
| 16 | External client: `hive.agent.runAsync × 2` + `hive.waitForAll` → both agents complete, correct status | Parallel Mode B works |
| 17 | Two external clients connected, both call `hive.status()` → both see same shared state | Multi-client coordination works |
| 18 | `createHive({ mode: 'internal' })` → `hive.plan.write` NOT in `hub.listTools()` | Mode isolation enforced |
| 19 | Mode persists across page reload → `/.atua/config.json` → correct mode re-registered | Mode persistence works |

---

## Updated Risk Table

Add to §17 of the base spec:

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| External LLM writes malformed plan.md | Medium | Medium | `hive.plan.write` validates schema before writing. Returns error with validation message, does not write partial file. |
| Two external clients write plan.md simultaneously | Medium | Low | Web Lock on `/.atua/plan.md` writes. Second writer waits, then writes — last-write-wins is documented behavior. |
| External LLM spawns too many agents, overwhelms semaphore | Low | Low | Semaphore queues all requests. External clients see latency, not errors. Document max concurrency in `hive.roles.list()` response. |
| Mode switch during active orchestration confuses in-flight Pi Orchestrator (internal mode) | Medium | Low | ModeManager checks for active Orchestrator Pi session before deregistering internal tools. If active, queues mode switch until Orchestrator reaches idle. |
| External client uses both `pi.prompt` and `hive.*` in same session (mode: 'both') | Low | Low | Both are valid. Pi Orchestrator and external LLM may write to status.json concurrently — Web Lock prevents corruption. Document that mixing modes is supported but the caller must manage task ID namespacing. |

---

## CC Kickoff Prompts

### Phase 0b kickoff

```
Read docs/plans/pi-hive-spec.md and docs/plans/pi-hive-dual-mode-addendum.md.

Implement Phase 0b only: Mode Manager.

Goal: ModeManager class that atomically switches which tools are registered
on the Fabric hub. Both modes must coexist in 'both' mode with no conflicts.

Read:
- docs/plans/pi-hive-dual-mode-addendum.md (modes/mode-manager.ts section)
- packages/atua-fabric/src/hub.ts (registerTool/deregisterTool API)

Do not implement any actual mode tools yet — just the switching infrastructure.
Commit: git add -A && git commit -m "Hive Phase 0b: mode manager"
```

### Phase 1b kickoff

```
Continue with Hive Phase 1b per docs/plans/pi-hive-dual-mode-addendum.md.

Goal: All hive.* external mode tools registered and working.
External LLM can plan, spawn, delegate, and observe without going through pi.prompt.

Read:
- docs/plans/pi-hive-dual-mode-addendum.md (Phase 1b execution order)
- docs/plans/pi-hive-spec.md (shared state model §10 — tools must write to same paths)
- packages/pi-hive/src/modes/mode-manager.ts (registerExternalTools hook)

Run Phase 1b verification checklist before committing.
Commit: git add -A && git commit -m "Hive Phase 1b: external orchestration mode"
```
