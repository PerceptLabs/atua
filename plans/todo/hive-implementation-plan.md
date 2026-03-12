# Pi Hive — Implementation Plan

**Companion to:** `pi-hive-spec.md`
**Package:** `@aspect/pi-hive`
**Purpose:** Execution guide for CC. Assumes Conductor (Pi-Atua) phases 0–5 complete. Fabric MCP hub operational. The spec defines what to build. This defines how.

---

## Pre-Flight Checklist

```bash
# Confirm Conductor is complete
node -e "import('@aspect/pi-atua').then(m => console.log(Object.keys(m)))"
# Must include: createPiAgent

# Confirm createPiAgent supports multiple independent instances
# (Two agents in same tab without shared state)
node -e "
  const { createPiAgent } = await import('@aspect/pi-atua')
  const hub = ...
  const a1 = await createPiAgent({ hub, model: '...' })
  const a2 = await createPiAgent({ hub, model: '...' })
  console.log(a1 !== a2)  // must be true — separate instances
"

# Confirm Web Locks API available
# In browser console:
# navigator.locks.query().then(state => console.log(state))

# Confirm AtuaFS watch events exist
grep -r "watch\|onChange\|onChanged" packages/atua-fs/src/ --include="*.ts"
# Must find a file watch API — needed for status.json polling

# Confirm Fabric tool registration/deregistration
grep -r "registerTool\|deregisterTool" packages/atua-fabric/src/ --include="*.ts"
# Both must exist — Hive registers role tools dynamically
```

**Multiple independent Pi instances in the same tab is the foundational assumption of Hive.** If `createPiAgent()` uses any shared global state that would cause two instances to interfere, that must be fixed in Conductor before Hive begins. Verify this explicitly in the pre-flight.

---

## Package Scaffold

```bash
mkdir -p packages/pi-hive/src/{agent,roles/defaults,coordination,quality,external,db}
```

`packages/pi-hive/package.json`:
```json
{
  "name": "@aspect/pi-hive",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {},
  "peerDependencies": {
    "@aspect/pi-atua": "workspace:*",
    "@aspect/atua-fabric": "workspace:*",
    "@aspect/atua-fs": "workspace:*",
    "@aspect/atua-d1": "workspace:*"
  }
}
```

---

## How Pi Grows In Atua

Before Phase 0, understand the model this entire plan builds toward. It frames the role loader, the scoped ResourceLoader, and what "default roles" actually means.

**Atua ships Pi as-is.** No pre-loaded extensions, no baked-in quality gate, no default skills. On first boot `/.atua/` is empty. Pi has four tools and a blank project.

**Pi extends itself.** When a user asks Pi to add a quality gate, Pi writes `/.atua/extensions/quality-gate.ts`, calls `atua.pkg.reload`, and the extension is live. Same for skills — Pi writes `/.atua/skills/react-patterns.md` and that knowledge feeds into every subsequent session. The user doesn't install anything. Pi builds what it needs from the tools it already has.

**Capabilities accumulate across sessions.** Because `AtuaResourceLoader` reads from AtuaFS on every `reload()`, everything Pi writes persists. A project that has been running for a month has a rich `/.atua/` — skills authored from experience, extensions tuned to the project's stack, an AGENTS.md that captures conventions. Fresh context per iteration, but accumulated knowledge in the filesystem.

**Roles are the same pattern, scoped.** The Architect role, over repeated runs, accumulates architecture-specific skills in `/.atua/roles/architect/skills/`. The Reviewer accumulates project-specific review criteria. These aren't shipped defaults that Atua curates — they're knowledge Pi built and stored in the role's directory. The "default role definitions" in `packages/pi-hive/src/roles/defaults/` are just starting-point system prompts for roles that haven't accumulated anything yet. The first time an Architect runs, it gets the default prompt. The tenth time, it gets the default prompt *plus* everything it has learned.

**What this means for implementation:**
- Default role `.md` files are fallbacks, not features. Keep them minimal.
- `AtuaResourceLoader` per spawned agent is not optional overhead — it's how accumulated role knowledge gets injected.
- `atua.pkg.reload` (the hub tool that triggers `loader.reload()`) is the mechanism Pi uses to make its own writes take effect. It must exist before Pi can self-extend.

---



**Spec ref:** §7 (tool scoping), §8 (spawn basics)
**Goal:** Single scoped HiveAgent. Tool scope enforced. Filesystem path scope enforced. Status writes on state changes.

**This is the most important phase to get right.** All subsequent phases depend on scoping being a hard enforcement at the adapter layer, not a soft prompt-based suggestion.

**Execution order:**

1. `packages/pi-hive/src/agent/scoped-hub.ts` — `createScopedHub(hub, allowedTools: string[])`:
   ```ts
   export function createScopedHub(hub: AtuaHub, allowedTools: string[]): AtuaHub {
     return {
       ...hub,
       callTool: async (name, args) => {
         if (!isAllowed(name, allowedTools)) {
           throw new PermissionError(`Role does not have access to tool: ${name}`)
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
     return patterns.some(p =>
       p === '*' ? true :
       p.endsWith('.*') ? toolName.startsWith(p.slice(0, -2)) :
       toolName === p
     )
   }
   ```

2. `packages/pi-hive/src/agent/path-scoped-fs.ts` — `createPathScopedFs(fs, { read: string[], write: string[] })`:
   ```ts
   // Wraps AtuaFS write operations with path validation
   // Throws PathPermissionError if write target not in allowed list
   export function createPathScopedFs(fs: AtuaFS, scope: PathScope): AtuaFS {
     return {
       ...fs,
       writeFile: async (path, content) => {
         if (!isWriteAllowed(path, scope.write)) {
           throw new PathPermissionError(`Write not permitted: ${path}`)
         }
         return fs.writeFile(path, content)
       },
       mkdir: async (path) => {
         if (!isWriteAllowed(path, scope.write)) {
           throw new PathPermissionError(`Mkdir not permitted: ${path}`)
         }
         return fs.mkdir(path)
       },
     }
   }
   ```

3. `packages/pi-hive/src/coordination/status.ts` — `updateStatus(fs, role, state, taskId)`:
   ```ts
   // Reads /.atua/status.json, updates role entry, writes back
   // Uses Web Lock to prevent concurrent write corruption
   export async function updateStatus(
     fs: AtuaFS,
     role: string,
     state: AgentState,
     taskId: string,
     currentTask?: string,
   ): Promise<void> {
     await navigator.locks.request('atua-hive-status', { mode: 'exclusive' }, async () => {
       const status = await loadStatus(fs)
       status.agents[role] = { state, taskId, currentTask, lastUpdate: Date.now(),
         iterationCount: (status.agents[role]?.iterationCount ?? 0) + (state === 'active' ? 1 : 0),
         errorCount: status.agents[role]?.errorCount ?? 0,
       }
       await fs.writeFile('/.atua/status.json', JSON.stringify(status, null, 2))
     })
   }
   ```

4. `packages/pi-hive/src/agent/hive-agent.ts` — `HiveAgent` wrapper:
   ```ts
   export class HiveAgent {
     constructor(
       public role: string,
       public taskId: string,
       private pi: PiAgentInstance,
       private scopedHub: AtuaHub,
       private fs: AtuaFS,
     ) {}
     
     async run(task: string, context?: string): Promise<string> {
       await updateStatus(this.fs, this.role, 'active', this.taskId, task)
       try {
         const result = await this.pi.run(task + (context ? '\n\nContext:\n' + context : ''))
         await updateStatus(this.fs, this.role, 'idle', this.taskId)
         return result
       } catch (err) {
         await updateStatus(this.fs, this.role, 'error', this.taskId)
         throw err
       }
     }
   }
   ```

5. `tests/phase0-scoped-agent.browser.test.ts`

**Phase 0 verification:**
```
createScopedHub(hub, ['atuafs.read', 'atuafs.list']) — callTool('atuafs.read') succeeds
createScopedHub — callTool('hive.spawn') throws PermissionError
createScopedHub — listTools() only returns allowed tools, not full hub list
createPathScopedFs(fs, { write: ['src/'] }) — writeFile('src/x.ts') succeeds
createPathScopedFs — writeFile('/.atua/plan.md') throws PathPermissionError
HiveAgent.run() — updates /.atua/status.json with correct state transitions
Two concurrent updateStatus calls — no JSON corruption (Web Lock enforces serialization)
```

---

## Phase 1 — Orchestrator + Single Sub-Agent

**Spec ref:** §5 (Orchestrator + Builder roles), §6 (handoff files)
**Goal:** Orchestrator spawns Builder via handoff file. Orchestrator detects completion via status watch.

**Execution order:**

1. `packages/pi-hive/src/roles/defaults/orchestrator.md` — Orchestrator role definition:
   ```markdown
   ---
   name: Orchestrator
   tools: ["*"]
   sessionMode: persistent
   spawnable-by: []
   ---
   You are the Orchestrator. You decompose tasks and delegate to sub-agents.
   Before delegating any task:
   1. Write a clear plan to /.atua/plan.md
   2. Create a handoff file at /.atua/handoffs/{taskId}.json
   3. Spawn the appropriate role via hive.{role}.run
   4. Monitor /.atua/status.json for completion
   5. Synthesize results and report to the user
   Never implement code directly. Always delegate implementation to Builder.
   ```

2. `packages/pi-hive/src/roles/defaults/builder.md` — Builder role definition with tool and path constraints

3. `packages/pi-hive/src/roles/role-loader.ts` — loads role markdown from `/.atua/roles/` or defaults:
   ```ts
   export async function loadRole(name: string, fs: AtuaFS): Promise<RoleConfig> {
     // Try custom first: /.atua/roles/{name.toLowerCase()}.md
     // Fall back to bundled defaults
   }
   ```

4. `packages/pi-hive/src/coordination/handoff.ts` — handoff file creation and consumption:
   ```ts
   export interface Handoff {
     taskId: string
     from: string
     to: string
     task: string
     context: { specsPath?: string; targetFiles?: string[]; constraints?: string[]; retryBudget: number }
     createdAt: number
   }
   
   export async function createHandoff(fs: AtuaFS, handoff: Handoff): Promise<void>
   export async function readHandoff(fs: AtuaFS, taskId: string): Promise<Handoff | null>
   export async function completeHandoff(fs: AtuaFS, taskId: string): Promise<void>
   ```

5. `packages/pi-hive/src/hive.ts` — `Hive` class, `spawn(role, options)`:
   ```ts
   export class Hive {
     private agents = new Map<string, HiveAgent>()
     private llmSemaphore = new Semaphore(3)  // max 3 concurrent LLM calls
     
     async spawn(role: string, options: SpawnOptions): Promise<HiveAgent> {
       const roleConfig = await loadRole(role, this.fs)
       const scopedHub = createScopedHub(this.hub, roleConfig.tools)
       const scopedFs = createPathScopedFs(this.fs, roleConfig.fsPaths)
       
       // Each role gets a scoped AtuaResourceLoader.
       // Skills, extensions, and prompts are loaded from role-specific paths first,
       // falling back to shared project paths.
       // This means Pi can accumulate role-specific knowledge over sessions —
       // an Architect role that has run 10 times has richer skills than a fresh one.
       const loader = new AtuaResourceLoader(scopedFs, {
         skillPaths: [
           `/.atua/roles/${role.toLowerCase()}/skills/`,  // role-specific skills
           '/.atua/skills/',                               // project-wide skills
         ],
         extensionPaths: [
           `/.atua/roles/${role.toLowerCase()}/extensions/`,  // role-specific extensions
           '/.atua/extensions/',                               // project-wide extensions
         ],
         promptPaths: [
           `/.atua/roles/${role.toLowerCase()}/prompts/`,
           '/.atua/prompts/',
         ],
         agentsFilePath: '/.atua/AGENTS.md',
         extensionFactories: options.extensionFactories ?? [],
       })
       await loader.reload()
       
       const pi = await createPiAgent({
         hub: scopedHub,
         fs: scopedFs,
         resourceLoader: loader,
         model: options.model ?? this.defaultModel,
         systemPrompt: roleConfig.systemPrompt,
         sessionId: `hive:${role}:${options.taskId}`,
       })
       
       // Register role tool on hub for synchronous delegation
       this.hub.registerTool(`hive.${role.toLowerCase()}.run`, {
         description: roleConfig.description,
         schema: { task: s.string(), context: s.optional(s.string()) },
         handler: async ({ task, context }) => {
           await this.llmSemaphore.acquire()
           try { return await agent.run(task, context) }
           finally { this.llmSemaphore.release() }
         },
       })
       
       const agent = new HiveAgent(role, options.taskId, pi, scopedHub, this.fs)
       this.agents.set(`${role}:${options.taskId}`, agent)
       return agent
     }
   }
   ```

6. `packages/pi-hive/src/agent/semaphore.ts` — hand-rolled semaphore:
   ```ts
   export class Semaphore {
     private queue: Array<() => void> = []
     private active = 0
     constructor(private max: number) {}
     async acquire() {
       if (this.active < this.max) { this.active++; return }
       await new Promise<void>(res => this.queue.push(res))
       this.active++
     }
     release() {
       this.active--
       this.queue.shift()?.()
     }
   }
   ```

7. `packages/pi-hive/src/index.ts` — `createHive(hub, fs, options)` → `Hive` instance

8. `tests/phase1-orchestrator.browser.test.ts`

**Phase 1 verification:**
```
hive.spawn('Builder', { taskId: 'test-001' }) — creates HiveAgent with scoped hub
Orchestrator spawns Builder → handoff file written at /.atua/handoffs/test-001.json
Builder reads handoff at startup → executes task → writes result to src/
Orchestrator watches /.atua/status.json → detects Builder 'idle' state
End-to-end: Orchestrator prompt 'Write a React component' → Builder writes src/Hello.tsx
4 concurrent spawns with semaphore limit 3 → 4th queues, unblocks when 3rd completes
```

---

## Phase 2 — Full Role Set + Quality Gates

**Spec ref:** §5 (all roles), §11 (quality gates)
**Goal:** All 6 default roles implemented. Quality gate pipeline runs automatically.

**Execution order:**

1. `packages/pi-hive/src/roles/defaults/architect.md` — read-only, writes specs
2. `packages/pi-hive/src/roles/defaults/reviewer.md` — read-only, writes feedback
3. `packages/pi-hive/src/roles/defaults/designer.md` — CSS/tokens write scope only
4. `packages/pi-hive/src/roles/defaults/inspector.md` — read + telemetry only

5. `packages/pi-hive/src/quality/retry-budget.ts`:
   ```ts
   export async function decrementBudget(fs: AtuaFS, taskId: string, blockerCount: number): Promise<number> {
     const handoff = await readHandoff(fs, taskId)
     handoff.context.retryBudget -= blockerCount
     await createHandoff(fs, handoff)  // update in place
     return handoff.context.retryBudget
   }
   ```

6. `packages/pi-hive/src/quality/escalation.ts`:
   ```ts
   export async function escalate(hub: AtuaHub, taskId: string, reason: string): Promise<void> {
     await hub.callTool('hive.orchestrator.notify', {
       event: 'escalation',
       taskId,
       reason,
       feedback: await readFeedback(/* ... */),
     })
   }
   ```

7. `packages/pi-hive/src/quality/gate-extension.ts` — Pi extension for Builder:
   ```ts
   // Registered as a Pi extension on Builder instances
   // Fires after every atuafs.write or atuafs.edit tool call on a buildable file
   onToolCall(['atuafs.write', 'atuafs.edit'], async ({ path }, hive, taskId) => {
     if (!isBuildableFile(path)) return
     
     const inspector = await hive.spawn('Inspector', { taskId: taskId + '-inspect' })
     const inspectionResult = await inspector.run(`Inspect ${path} and current preview state`)
     await hive.terminate('Inspector', taskId + '-inspect')
     
     if (inspectionResult.hasIssues) {
       const reviewer = await hive.spawn('Reviewer', { taskId: taskId + '-review' })
       await reviewer.run('Review issues from Inspector feedback')
       await hive.terminate('Reviewer', taskId + '-review')
       
       const remaining = await decrementBudget(this.fs, taskId, inspectionResult.blockerCount)
       if (remaining <= 0) {
         await escalate(this.hub, taskId, 'Retry budget exhausted')
       }
     }
   })
   ```

8. `packages/pi-hive/src/roles/role-registry.ts` — in-memory registry of loaded roles, `register(name, config)`, `get(name)`

9. `tests/phase2-full-roles.browser.test.ts`

**Phase 2 verification:**
```
Full pipeline: Orchestrator → Architect (writes .atua/specs/) → Builder → Inspector → Reviewer → Builder
Reviewer writes structured feedback to /.atua/feedback.md (severity/file/line format)
Builder reads feedback before next iteration
Retry budget: 3 blockers → budget decrements → at 0, escalation fires
Designer: writes valid OKLCH CSS variables to src/index.css
Designer: cannot write to src/components/ (path scope enforced)
Inspector: detects runtime error in preview → writes to feedback.md
```

---

## Phase 3 — External MCP Surface + Streaming Progress

**Spec ref:** §9 (Claude Desktop integration), §13 (observability)
**Depends on:** Phase 2, relay.atua.dev deployed

**Execution order:**

1. `packages/pi-hive/src/coordination/checkpoint.ts` — checkpoint write/restore:
   ```ts
   export interface HiveCheckpoint {
     checkpointId: string
     taskId: string
     planState: string
     completedTasks: string[]
     pendingTasks: string[]
     filesWritten: string[]
     createdAt: number
   }
   
   export async function saveCheckpoint(fs: AtuaFS, checkpoint: HiveCheckpoint): Promise<void>
   export async function loadLatestCheckpoint(fs: AtuaFS): Promise<HiveCheckpoint | null>
   ```

2. `packages/pi-hive/src/external/mcp-provider.ts` — registers `hive.*` tools on hub:
   ```
   hive.status           — {} → HiveStatus
   hive.spawn            — { role, taskId } → void (spawns agent)
   hive.terminate        — { role, taskId } | { all: true } → void
   hive.agent.status     — { role } → AgentStatus
   hive.log              — { role?, limit? } → AgentLogEntry[]
   hive.handoffs         — { taskId? } → HandoffRecord[]
   hive.broadcast        — { message } → void (sends to all active agents)
   ```

3. `packages/pi-hive/src/external/streaming-progress.ts` — wraps `pi.prompt` handler with streaming:
   ```ts
   // Orchestrator streams status updates back to caller
   // Each sub-agent completion appends a progress message to the stream
   async function* streamProgress(orchestrator: HiveAgent, task: string) {
     yield { type: 'status', message: 'Planning task...' }
     
     // Watch status.json for changes, yield updates
     for await (const update of watchStatus(this.fs)) {
       yield { type: 'progress', agent: update.role, state: update.state, task: update.currentTask }
       if (isCompleted(update)) break
     }
   }
   ```

4. `packages/pi-hive/src/agent/watchdog.ts`:
   ```ts
   export function startWatchdog(fs: AtuaFS, hub: AtuaHub, timeoutMs = 5 * 60 * 1000): () => void {
     const interval = setInterval(async () => {
       const status = await loadStatus(fs)
       const now = Date.now()
       for (const [role, agentStatus] of Object.entries(status.agents)) {
         if (agentStatus.state === 'active' && now - agentStatus.lastUpdate > timeoutMs) {
           console.warn(`Hive watchdog: ${role} timed out`)
           await hub.callTool('hive.terminate', { role, taskId: agentStatus.taskId })
           await hub.callTool('hive.orchestrator.notify', { event: 'agent_timeout', role })
         }
       }
     }, 30_000)
     return () => clearInterval(interval)
   }
   ```

5. `packages/pi-hive/src/db/schema.sql` — CatalystD1 tables (agent_log, agent_handoffs, agent_memory FTS5)

6. `packages/pi-hive/src/db/queries.ts` — typed query helpers

7. `tests/phase3-external.browser.test.ts`

**Phase 3 verification:**
```
hub.listTools() includes all hive.* tools
hive.status returns correct active agent count and build state
hive.log returns agent activity entries
Mock Claude Desktop: calls pi.prompt via hub → receives streaming progress updates (10+ messages)
Mock Claude Desktop: reads /.atua files via atuafs.read after Builder completes
Tab reload → loadLatestCheckpoint() returns saved state → Orchestrator resumes
Watchdog: agent stuck at 'active' for 6 minutes → terminates and notifies Orchestrator
hive.terminate({ all: true }) → all agents terminated, status shows all 'terminated'
```

---

## Phase 4 — Custom Roles + Observability

**Spec ref:** §5 (custom roles), §13 (observability)
**Depends on:** Phase 3

**Execution order:**

1. `packages/pi-hive/src/roles/role-loader.ts` — dynamic role loading from `/.atua/roles/`:
   ```ts
   export async function loadRole(name: string, fs: AtuaFS): Promise<RoleConfig> {
     // 1. Check in-memory registry
     const cached = roleRegistry.get(name)
     if (cached) return cached
     
     // 2. Try custom role file
     const customPath = `/.atua/roles/${name.toLowerCase()}.md`
     try {
       const content = await fs.readFile(customPath, 'utf8')
       const config = parseRoleMarkdown(content)
       roleRegistry.register(name, config)
       return config
     } catch {
       // 3. Fall back to bundled default
       return getDefaultRole(name)
     }
   }
   ```

2. `packages/pi-hive/src/roles/role-parser.ts` — parses role markdown with YAML frontmatter:
   ```ts
   // Extracts: name, tools array, sessionMode, spawnable-by, fsPaths
   // Body becomes systemPrompt
   export function parseRoleMarkdown(content: string): RoleConfig
   ```

3. Update `hive.spawn()` to call the updated `loadRole()` — custom roles now discoverable at runtime without code changes

4. `packages/pi-hive/src/db/queries.ts` — implement all typed helpers for CatalystD1 tables:
   - `logAgentAction(role, taskId, action, detail?)`
   - `recordHandoff(from, to, taskId, description, handoffFile?)`
   - `updateHandoffStatus(taskId, status, completedAt?)`
   - `searchAgentMemory(query, role?): MemoryEntry[]`
   - `storeAgentMemory(taskId, role, content, importance?)`

5. `tests/phase4-custom-roles.browser.test.ts`

**Phase 4 verification:**
```
Write /.atua/roles/dataengineer.md with custom frontmatter
hive.spawn('DataEngineer') resolves using custom role
DataEngineer tool scope from frontmatter enforced correctly
DataEngineer spawned → tools in frontmatter appear in hub.listTools() for that agent only
searchAgentMemory('TypeScript') returns entries from Architect session
storeAgentMemory saves entry → survives tab reload → searchAgentMemory finds it
```

---

## CatalystD1 Schema Reference

Deploy this schema before Phase 3 tests run:

```sql
-- Agent activity log
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_log_role ON agent_log(role);
CREATE INDEX IF NOT EXISTS agent_log_task ON agent_log(task_id);

-- Handoff audit trail
CREATE TABLE IF NOT EXISTS agent_handoffs (
  id INTEGER PRIMARY KEY,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_description TEXT NOT NULL,
  handoff_file TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Cross-agent searchable memory
CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory USING fts5(
  task_id UNINDEXED,
  role UNINDEXED,
  content,
  importance REAL UNINDEXED,
  created_at INTEGER UNINDEXED
);
```

---

## Critical Pre-Condition: AtuaFS Watch Events

Phase 1 requires the Orchestrator to watch `/.atua/status.json` for changes. This requires AtuaFS to expose file watch events. If `AtuaFS.watch(path, callback)` does not exist after Atua Phase 12, it must be added before Hive Phase 1 begins.

Minimum acceptable watch API:
```ts
// Polls OPFS for changes every N ms — not inotify, but sufficient
atua.fs.watch('/.atua/status.json', { interval: 500 }, (newContent) => {
  // called when file content changes
})
```

If Atua's AtuaFS does not have this, add it as part of Hive Phase 0 prep. It's a 30-line polling wrapper — not a blocking issue, just needs to exist.

---

## Concurrency Model Summary

Three distinct concurrency controls in Hive — understand which does what:

| Mechanism | Controls | Why |
|-----------|---------|-----|
| `Semaphore(3)` | Max concurrent LLM HTTP calls | Browser connection limits + rate limits |
| `Web Lock 'atua-hive-status'` | Concurrent writes to status.json | Prevent JSON corruption |
| `Web Lock 'atua-feedback'` | Concurrent appends to feedback.md | Prevent content corruption |

These are independent. An agent waiting for the LLM semaphore can still acquire a file lock. An agent holding a file lock does not block other LLM calls. Do not conflate them.
