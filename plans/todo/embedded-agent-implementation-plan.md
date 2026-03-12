# Embedded Agent — Implementation Plan

**Companion to:** `atua-embedded-agent-spec.md`
**Package:** `@aspect/atua-agent-gen` (the generator); no runtime package (generated code is self-contained)
**Purpose:** Execution guide for CC. Assumes Atua phases 0–12 complete, Conductor phases 0–5 complete, Hive Phase 0+ in progress. The spec defines what to build. This defines how.

---

## Pre-Flight Checklist

Before CC begins:

```bash
# Confirm Atua substrate
ls packages/atua-fs/          # AtuaFS — required for generated project files
ls packages/atua-d1/          # CatalystD1 — required for in-browser agent memory
ls packages/atua-proc/        # AtuaProc — required for agent preview execution
ls packages/atua-fabric/      # Fabric MCP hub — required for telemetry channel

# Confirm Conductor is operational
node -e "import('@aspect/pi-atua').then(m => console.log(Object.keys(m)))"
# Must include: createPiAgent

# Confirm Pi can generate files into AtuaFS
# (This is the mechanism Pi uses to generate the agent module into the user's project)
grep -r "atuafs.write" packages/pi-atua/src/tools/ --include="*.ts"
# Must find write tool

# Confirm wa-sqlite with FTS5
# In browser console:
# const db = await openDatabase(); db.exec("CREATE VIRTUAL TABLE test_fts USING fts5(content)");
# Must succeed — FTS5 required for agent memory in browser preview

# Confirm esbuild available (needed for txiki standalone compilation step)
npx esbuild --version
# Must return version

# Confirm Hono is installable via Atua's package system
# (Generated apps use Hono — Atua must be able to resolve it)
grep -r "hono" packages/atua-pkg/ --include="*.ts" -l
# OR: confirm esm.sh resolves Hono
# In browser console: await import('https://esm.sh/hono')

# Confirm txiki.js is available for Phase 3
# On dev machine:
tjs --version
# Must return 26.x+ (Hono-compatible HTTP server API)
# If not installed: build from source or download release binary
```

**Conductor dependency is a hard blocker.** The embedded agent generator IS a Pi skill — Pi generates the agent module the same way it generates any other application code. If Pi cannot write files to AtuaFS and execute them, this plan cannot start.

**txiki.js is NOT a blocker for Phases 0–2.** Phases 0–2 target browser preview and Cloudflare Workers only. txiki enters at Phase 3.

---

## Package Scaffold

The generator lives in the Atua workspace. It is NOT a runtime dependency of generated projects — it produces source files that Pi writes into user projects.

```bash
mkdir -p packages/atua-agent-gen/src/{templates,tools,skills,config,targets}
mkdir -p packages/atua-agent-gen/tests
```

`packages/atua-agent-gen/package.json`:
```json
{
  "name": "@aspect/atua-agent-gen",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {},
  "peerDependencies": {
    "@aspect/pi-atua": "workspace:*",
    "@aspect/atua-fs": "workspace:*",
    "@aspect/atua-d1": "workspace:*",
    "@aspect/atua-fabric": "workspace:*"
  }
}
```

**Critical distinction:** This package is a *code generator* consumed by Pi inside Atua. The generated output has ZERO imports from `@aspect/*`. Generated agent code uses only `fetch()`, SQL, and standard JS — no Atua runtime dependency in the deployed artifact.

---

## How the Generator Works

Before Phase 0, understand the execution model.

**Pi is the author.** When a user says "build me a support dashboard that auto-categorizes tickets," Pi/Hive generates the application code (Hono routes, React components, database schema) AND calls the agent generator to produce the `/src/agent/` directory. Pi does NOT hand-write agent code — it calls generator functions that produce correct, self-contained agent modules.

**The generator is a library of template functions.** Each function produces a file. Pi calls the right combination based on what the user described:

```ts
// What Pi calls internally:
import { generateAgentModule } from '@aspect/atua-agent-gen'

const files = await generateAgentModule({
  name: 'support-agent',
  description: 'Auto-categorizes tickets and drafts responses',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [
    { name: 'get-open-tickets', capability: 'database.tickets.select', /* ... */ },
    { name: 'categorize-ticket', capability: 'database.tickets.update', /* ... */ },
  ],
  grants: { database: { tables: ['tickets'], operations: ['select', 'update'] } },
  schedule: [{ trigger: 'cron', pattern: '*/15 * * * *', task: 'check-new-tickets' }],
  memory: { backend: 'sqlite', maxEntries: 5000 },
  target: 'cloudflare-workers',
})

// files = Map<string, string> — path → file content
// Pi writes each file to AtuaFS
for (const [path, content] of files) {
  await hub.callTool('atuafs.write', { path, content })
}
```

**The output is plain TypeScript.** No magic, no codegen markers, no framework imports. A developer can read every file, modify it, and never know a generator produced it. This is intentional — "standard output, not proprietary lock-in."

**Pi can also hand-edit generated files.** After the initial generation, if the user says "add Slack notifications," Pi reads the existing tool file, adds the new tool definition, and updates the run spec. The generator handles initial scaffolding; Pi handles iteration. Same pattern as how Pi generates and then edits React components.

---

## Phase 0 — Agent Module Template + Browser Preview

**Spec ref:** §4, §5, §7, §8
**Goal:** Generator produces a working agent module. Agent runs inside Atua's browser preview using wa-sqlite for memory and fetch() for model calls.

### Execution order

**Core types (write first — everything depends on these):**

1. `packages/atua-agent-gen/src/templates/types.ts` — the AgentRunSpec type definition that will be emitted into generated projects:
   ```ts
   export const TYPES_TEMPLATE = `
   // types.ts — Shared types for the embedded agent
   // Generated by Atua. Modify freely.

   export interface AgentRunSpec {
     name: string
     description: string
     model: ModelConfig
     grants: GrantConfig
     schedule: ScheduleEntry[]
     budget: BudgetConfig
     memory: MemoryConfig
     skills: SkillsConfig
     security: 'scoped' | 'supervised' | 'readonly'
   }

   export interface ModelConfig {
     provider: string
     model: string
     fallback?: string
     maxTokensPerCycle: number
   }

   export interface GrantConfig {
     database?: { tables: string[]; operations: ('select' | 'insert' | 'update' | 'delete')[] }
     api?: { routes: string[]; methods: string[] }
     external?: { url: string; methods: string[] }[]
     filesystem?: { read?: string[]; write?: string[] }
   }

   export interface ScheduleEntry {
     trigger: 'cron' | 'webhook' | 'event' | 'manual'
     pattern?: string   // cron expression for trigger='cron'
     path?: string      // webhook path for trigger='webhook'
     source?: string    // event source for trigger='event'
     task: string       // task name to execute
   }

   export interface BudgetConfig {
     maxCyclesPerHour: number
     maxTokensPerDay: number
     maxActionsPerCycle: number
   }

   export interface MemoryConfig {
     backend: 'sqlite'
     table: string
     maxEntries: number
     compactStrategy: 'importance-recency'
   }

   export interface SkillsConfig {
     directory: string
     autoReload: boolean
   }

   export interface ToolDef {
     name: string
     description: string
     capability: string
     schema: Record<string, unknown>
     handler: (input: any) => Promise<ToolResult>
   }

   export interface ToolResult {
     success: boolean
     data?: unknown
     error?: string
     importance?: number
   }

   export interface MemoryEntry {
     id?: number
     sessionId?: string
     role: string
     content: string
     importance: number
     accessCount?: number
     createdAt: number
     lastAccessed?: number
   }

   export interface CompleteRequest {
     system: string
     messages: { role: string; content: string }[]
     tools?: ToolSchema[]
     budget: BudgetConfig
   }

   export interface ToolSchema {
     name: string
     description: string
     input_schema: Record<string, unknown>
   }
   `
   ```

**Model adapter:**

2. `packages/atua-agent-gen/src/templates/model.ts` — generates the model adapter source:
   ```ts
   export function generateModelAdapter(): string {
     return `
   // model.ts — Provider-agnostic model adapter
   // Generated by Atua. Modify freely.
   import type { ModelConfig, CompleteRequest } from './types'

   const ENDPOINTS: Record<string, string> = {
     anthropic: 'https://api.anthropic.com/v1/messages',
     openai: 'https://api.openai.com/v1/chat/completions',
     openrouter: 'https://openrouter.ai/api/v1/chat/completions',
   }

   export class ModelAdapter {
     private cycleTokens = 0
     private dailyTokens = 0
     private dailyReset = Date.now()

     constructor(private config: ModelConfig) {}

     async complete(request: CompleteRequest): Promise<any> {
       // Reset daily counter at midnight
       if (Date.now() - this.dailyReset > 86_400_000) {
         this.dailyTokens = 0
         this.dailyReset = Date.now()
       }

       // Budget check
       if (this.dailyTokens >= request.budget.maxTokensPerDay) {
         throw new Error('Daily token budget exhausted')
       }

       try {
         return await this.call(this.config.provider, this.config.model, request)
       } catch (err) {
         if (this.config.fallback) {
           const [provider, model] = this.config.fallback.includes('/')
             ? this.config.fallback.split('/', 2)
             : [this.config.fallback, this.config.model]
           return await this.call(provider, model, request)
         }
         throw err
       }
     }

     private async call(provider: string, model: string, request: CompleteRequest): Promise<any> {
       const endpoint = ENDPOINTS[provider] ?? provider  // allow raw URL as provider
       const body = this.formatRequest(provider, model, request)

       const res = await fetch(endpoint, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           ...this.authHeaders(provider),
         },
         body: JSON.stringify(body),
       })

       if (!res.ok) {
         throw new Error(\\\`Model error [\\\${provider}] \\\${res.status}: \\\${await res.text()}\\\`)
       }

       const data = await res.json()
       this.accountTokens(data)
       return this.parseResponse(provider, data)
     }

     private formatRequest(provider: string, model: string, request: CompleteRequest): any {
       if (provider === 'anthropic') {
         return {
           model,
           max_tokens: Math.min(request.budget.maxTokensPerDay - this.dailyTokens, 4096),
           system: request.system,
           messages: request.messages,
           ...(request.tools?.length ? { tools: request.tools.map(t => ({
             name: t.name, description: t.description, input_schema: t.input_schema,
           })) } : {}),
         }
       }
       // OpenAI / OpenRouter format
       return {
         model,
         messages: [
           { role: 'system', content: request.system },
           ...request.messages,
         ],
         ...(request.tools?.length ? { tools: request.tools.map(t => ({
           type: 'function',
           function: { name: t.name, description: t.description, parameters: t.input_schema },
         })) } : {}),
       }
     }

     private parseResponse(provider: string, data: any): any {
       if (provider === 'anthropic') {
         const textBlock = data.content?.find((b: any) => b.type === 'text')
         const toolCalls = data.content?.filter((b: any) => b.type === 'tool_use') ?? []
         return {
           reasoning: textBlock?.text ?? '',
           toolCalls: toolCalls.map((t: any) => ({ name: t.name, input: t.input })),
           confidence: 0.5,
         }
       }
       // OpenAI / OpenRouter
       const choice = data.choices?.[0]?.message
       return {
         reasoning: choice?.content ?? '',
         toolCalls: (choice?.tool_calls ?? []).map((t: any) => ({
           name: t.function.name,
           input: JSON.parse(t.function.arguments),
         })),
         confidence: 0.5,
       }
     }

     private authHeaders(provider: string): Record<string, string> {
       // Runtime reads from environment — never embedded in source
       const key = typeof process !== 'undefined'
         ? process.env[\\\`\\\${provider.toUpperCase()}_API_KEY\\\`]
         : (globalThis as any).__env?.[\\\`\\\${provider.toUpperCase()}_API_KEY\\\`]
       if (!key) throw new Error(\\\`Missing API key for \\\${provider}. Set \\\${provider.toUpperCase()}_API_KEY.\\\`)
       if (provider === 'anthropic') {
         return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
       }
       return { 'Authorization': \\\`Bearer \\\${key}\\\` }
     }

     private accountTokens(data: any): void {
       const usage = data.usage
       if (!usage) return
       const tokens = (usage.input_tokens ?? usage.prompt_tokens ?? 0)
         + (usage.output_tokens ?? usage.completion_tokens ?? 0)
       this.cycleTokens += tokens
       this.dailyTokens += tokens
     }

     resetCycleTokens(): void { this.cycleTokens = 0 }
     getCycleTokens(): number { return this.cycleTokens }
     getDailyTokens(): number { return this.dailyTokens }
   }
   `
   }
   ```

**Memory module:**

3. `packages/atua-agent-gen/src/templates/memory.ts` — generates the memory module source. Two variants: one using raw SQL (portable), one using the Cloudflare D1 binding syntax. Both produce the same `AgentMemory` class.

   The SQL core is identical across all targets:
   ```ts
   export function generateMemory(target: 'generic' | 'cloudflare-d1'): string {
     // Returns memory.ts source
     // 'generic' uses a Database interface: { exec, run, query }
     // 'cloudflare-d1' uses env.DB.prepare().bind().run() / .all()
     // Both implement: store(), relevant(), compact(), forget()
     // FTS5 virtual table for full-text search
     // Importance × recency weighting for relevance ranking
   }
   ```

   **Critical: FTS5 trigger synchronization.** The FTS5 virtual table uses content-sync triggers. The `INSERT` trigger, `DELETE` trigger, and `UPDATE` trigger must all be generated. Without the delete trigger, `compact()` leaves orphaned FTS5 entries and search results return deleted memories. Test this explicitly.

**Tool system:**

4. `packages/atua-agent-gen/src/templates/tools.ts` — generates the tool registry source. The registry is generic — it holds `ToolDef` objects and enforces capability grants. The actual tool implementations are generated separately per application (step 8).

**Skill loader:**

5. `packages/atua-agent-gen/src/templates/skills.ts` — generates the skill loader source. Reads `*.md` files from a configured directory, concatenates their content, and appends it to the agent's system prompt. Simple enough that it doesn't need a template engine — just `readdir` + `readFile` + string concatenation.

**Config loader:**

6. `packages/atua-agent-gen/src/templates/config.ts` — generates the config loader. Imports `agent.config.ts`, validates it against the `AgentRunSpec` type at runtime (basic shape checks — no ArkType dependency in generated code), and returns the validated config.

**Agent loop + entrypoint:**

7. `packages/atua-agent-gen/src/templates/loop.ts` — generates the core observe-decide-act loop as specified in §4.2 of the spec. The loop function takes an `AgentContext` (assembled from model adapter, tool registry, memory, config) and runs one cycle.

   `packages/atua-agent-gen/src/templates/index.ts` — generates the agent entrypoint. Boots the agent: loads config, initializes memory (runs schema migration), registers tools, loads skills, starts scheduler.

**Domain-specific tool generator:**

8. `packages/atua-agent-gen/src/tools/generate-tools.ts` — this is the function Pi calls to generate application-specific tools. Pi provides the application's database schema, API routes, and external integrations. The generator produces tool definitions that reference the app's actual tables and endpoints:

   ```ts
   export function generateDomainTools(spec: {
     dbTables: { name: string; columns: string[]; grants: string[] }[]
     apiRoutes: { path: string; method: string; description: string }[]
     externalServices: { name: string; url: string; description: string }[]
   }): string {
     // Returns tools/<domain>.ts source
     // Each granted table gets CRUD tool definitions
     // Each API route gets a call tool
     // Each external service gets a notification/fetch tool
   }
   ```

**Run spec generator:**

9. `packages/atua-agent-gen/src/config/generate-config.ts` — generates `agent.config.ts` from Pi's understanding of what the user described. Pi calls this with the parsed intent:

   ```ts
   export function generateRunSpec(intent: {
     name: string
     description: string
     provider: string
     model: string
     tools: string[]      // tool capability names to grant
     schedule: ScheduleEntry[]
     security: 'scoped' | 'supervised' | 'readonly'
   }): string {
     // Returns agent.config.ts source
   }
   ```

**Top-level generator:**

10. `packages/atua-agent-gen/src/index.ts` — `generateAgentModule()`: the single entry point Pi calls. Orchestrates all template generators, returns `Map<string, string>`:

    ```ts
    export async function generateAgentModule(spec: AgentGenSpec): Promise<Map<string, string>> {
      const files = new Map<string, string>()

      files.set('/src/agent/types.ts', TYPES_TEMPLATE)
      files.set('/src/agent/model.ts', generateModelAdapter())
      files.set('/src/agent/memory.ts', generateMemory(spec.target === 'cloudflare-workers' ? 'cloudflare-d1' : 'generic'))
      files.set('/src/agent/tools.ts', generateToolRegistry())
      files.set('/src/agent/skills.ts', generateSkillLoader())
      files.set('/src/agent/config.ts', generateConfigLoader())
      files.set('/src/agent/loop.ts', generateAgentLoop())
      files.set('/src/agent/index.ts', generateEntrypoint(spec))
      files.set('/src/agent/tools/domain.ts', generateDomainTools(spec.domain))
      files.set('/agent.config.ts', generateRunSpec(spec.intent))

      // Initial skills (if Pi has context to seed them)
      if (spec.initialSkills?.length) {
        for (const skill of spec.initialSkills) {
          files.set(`/src/skills/${skill.name}.md`, skill.content)
        }
      }

      return files
    }
    ```

11. `tests/phase0-generator.test.ts` — unit tests for the generator (runs in Node, not browser — generator is build-time code)

12. `tests/phase0-browser-preview.browser.test.ts` — integration test: agent runs in Atua's browser preview

**Phase 0 verification:**

```
generateAgentModule({ ...supportDashboardSpec }) returns Map with 10+ files
Every generated file is valid TypeScript (tsc --noEmit passes)
No generated file imports from @aspect/* or any Atua-internal package
Generated types.ts defines AgentRunSpec, ToolDef, MemoryEntry, etc.
Generated model.ts handles Anthropic + OpenAI response formats
Generated memory.ts creates FTS5 table, stores entry, searches, compacts
Generated tools.ts enforces capability grants — ungrantable tool throws PermissionError

Browser preview integration:
  Pi generates a ticket dashboard with agent via generateAgentModule()
  Pi writes files to AtuaFS
  Agent boots in preview (index.ts → loads config → inits memory → registers tools)
  Agent categorizes a test ticket (manual trigger — no cron in preview)
  Agent stores reasoning in wa-sqlite memory
  Agent search returns the stored memory
  Agent rejects tool call outside capability grants
```

---

## Phase 1 — Pi Integration + Intent Detection

**Spec ref:** §10
**Depends on:** Phase 0, Conductor Phase 4 (LLM routing + ResourceLoader)

**Goal:** Pi detects agentic intent in user descriptions and automatically generates the agent module alongside application code. No manual invocation of the generator.

### Execution order

1. `packages/atua-agent-gen/src/skills/agentic-intent.md` — a Pi skill file that teaches Pi how to detect agentic intent and call the generator. This gets installed into `/.atua/skills/` when the agent-gen package is active:

   ```markdown
   # Agentic Intent Detection

   When the user describes an application, check if it needs embedded intelligence.
   
   ## Signal phrases (generate agent module if present)
   - "monitor", "watch", "check periodically", "keep an eye on"
   - "auto-categorize", "auto-label", "auto-tag", "classify automatically"
   - "draft responses", "suggest replies", "generate summaries"
   - "notify me when", "alert if", "escalate when"
   - "learn from", "improve over time", "adapt based on"
   - "daily digest", "weekly report", "summarize each morning"
   - "triage", "route to", "prioritize automatically"
   
   ## When intent is detected
   1. Generate the application code (Hono + React) as normal
   2. Call generateAgentModule() with:
      - Domain tools derived from the database schema you created
      - Schedule inferred from the user's timing language
      - Grants scoped to only the tables/routes the agent needs
      - Model set to claude-sonnet-4-6 (default) or user-specified
   3. Write agent module files to /src/agent/
   4. Write agent.config.ts to project root
   5. Seed /src/skills/ with initial knowledge if you have enough context
   
   ## When intent is NOT detected
   Do not generate agent code. The application is purely inert.
   ```

2. `packages/atua-agent-gen/src/tools/hub-tools.ts` — register generator functions as Fabric hub tools so Pi can call them:

   ```ts
   export function registerAgentGenTools(hub: AtuaHub): void {
     hub.registerTool('atua.agent.generate', {
       description: 'Generate an embedded agent module for the current project',
       schema: {
         name: { type: 'string' },
         description: { type: 'string' },
         target: { type: 'string', enum: ['cloudflare-workers', 'generic'] },
         // ... (AgentGenSpec fields)
       },
       handler: async (spec) => {
         const files = await generateAgentModule(spec)
         return { files: [...files.entries()].map(([path, content]) => ({ path, content })) }
       },
     })

     hub.registerTool('atua.agent.update-config', {
       description: 'Update the agent run spec without regenerating the full module',
       schema: { patch: { type: 'object' } },
       handler: async ({ patch }) => {
         // Read existing agent.config.ts, merge patch, write back
       },
     })

     hub.registerTool('atua.agent.add-skill', {
       description: 'Add a skill file to the agent',
       schema: { name: { type: 'string' }, content: { type: 'string' } },
       handler: async ({ name, content }) => {
         return { path: `/src/skills/${name}.md`, content }
       },
     })

     hub.registerTool('atua.agent.add-tool', {
       description: 'Add a tool definition to the agent',
       schema: {
         name: { type: 'string' },
         description: { type: 'string' },
         capability: { type: 'string' },
         schema: { type: 'object' },
         handlerCode: { type: 'string' },
       },
       handler: async (toolSpec) => {
         // Append tool definition to /src/agent/tools/domain.ts
       },
     })
   }
   ```

3. Update Conductor's `createPiAgent()` initialization to call `registerAgentGenTools(hub)` when the agent-gen package is present.

4. `tests/phase1-intent.browser.test.ts`

**Phase 1 verification:**

```
User: "Build me a ticket dashboard" (no agentic signals)
→ Pi generates Hono + React app
→ /src/agent/ directory does NOT exist
→ No agent.config.ts generated

User: "Build me a ticket dashboard that auto-categorizes new tickets"
→ Pi detects "auto-categorizes" as agentic intent
→ Pi generates Hono + React app AND calls atua.agent.generate
→ /src/agent/ directory exists with all module files
→ agent.config.ts exists with grants scoped to tickets table
→ schedule includes event trigger on ticket insert

User: "Build me a dashboard that sends me a daily summary of open issues"
→ Pi detects "daily summary" as agentic intent
→ schedule includes cron: '0 9 * * *'
→ tools include a summarization tool

User: "Now add Slack notifications when tickets are escalated"
→ Pi reads existing /src/agent/tools/domain.ts
→ Pi adds notify-slack tool definition
→ Pi updates agent.config.ts grants to include external Slack webhook
→ Pi does NOT regenerate the full module — edits existing files
```

---

## Phase 2 — Cloudflare Workers Deployment

**Spec ref:** §9.1
**Depends on:** Phase 1, Atua deployment pipeline

**Goal:** Generated app + agent deploys to Cloudflare Workers. Agent runs on scheduled events and webhooks. D1 for persistence.

### Execution order

**Build-time target adaptation:**

1. `packages/atua-agent-gen/src/targets/cloudflare.ts` — generates Workers-specific files:

   ```ts
   export function generateCloudflareTarget(spec: AgentGenSpec): Map<string, string> {
     const files = new Map<string, string>()

     // D1 memory adapter — replaces generic SQLite with env.DB binding
     files.set('/src/agent/memory.ts', generateMemory('cloudflare-d1'))

     // Wrangler config additions
     files.set('/wrangler.agent.toml', generateWranglerAgentConfig(spec))

     // Scheduled handler
     files.set('/src/agent/scheduled.ts', generateScheduledHandler(spec))

     // D1 migration
     files.set('/migrations/0001_agent_memory.sql', generateMemoryMigration())

     return files
   }
   ```

2. `packages/atua-agent-gen/src/targets/cloudflare-scheduled.ts` — generates the Scheduled Event handler:

   ```ts
   export function generateScheduledHandler(spec: AgentGenSpec): string {
     return `
   // scheduled.ts — Cloudflare Scheduled Event handler
   import { createAgent } from './index'
   import config from '../../agent.config'

   export async function handleScheduled(
     event: ScheduledEvent,
     env: Env,
     ctx: ExecutionContext,
   ): Promise<void> {
     const agent = createAgent(env, config)

     // Match cron pattern to task
     const tasks = config.schedule
       .filter(s => s.trigger === 'cron' && matchesCron(s.pattern, event.cron))
       .map(s => s.task)

     for (const task of tasks) {
       ctx.waitUntil(agent.runTask(task))
     }
   }
   `
   }
   ```

3. `packages/atua-agent-gen/src/targets/cloudflare-wrangler.ts` — generates wrangler.toml additions:

   ```toml
   # Agent additions to wrangler.toml
   [[d1_databases]]
   binding = "DB"
   database_name = "app-db"
   database_id = "<generated-at-deploy-time>"

   [triggers]
   crons = ["*/15 * * * *"]  # Derived from agent.config.ts schedule
   ```

4. `packages/atua-agent-gen/src/targets/cloudflare-migration.ts` — generates D1 migration SQL for agent memory tables:

   ```sql
   -- 0001_agent_memory.sql
   CREATE TABLE IF NOT EXISTS agent_memory (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     importance REAL DEFAULT 0.5,
     access_count INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_accessed INTEGER
   );

   -- D1 supports FTS5
   CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
     content, role,
     content='agent_memory', content_rowid='id'
   );

   CREATE TRIGGER IF NOT EXISTS agent_memory_ai AFTER INSERT ON agent_memory BEGIN
     INSERT INTO agent_memory_fts(rowid, content, role)
     VALUES (new.id, new.content, new.role);
   END;

   CREATE TRIGGER IF NOT EXISTS agent_memory_ad AFTER DELETE ON agent_memory BEGIN
     INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, role)
     VALUES ('delete', old.id, old.content, old.role);
   END;

   -- Agent telemetry log
   CREATE TABLE IF NOT EXISTS agent_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task TEXT NOT NULL,
     action TEXT NOT NULL,
     tokens_used INTEGER DEFAULT 0,
     duration_ms INTEGER DEFAULT 0,
     error TEXT,
     created_at INTEGER NOT NULL
   );
   ```

5. Update `generateAgentModule()` to call `generateCloudflareTarget()` when `target === 'cloudflare-workers'` and merge the Workers-specific files into the output.

6. Update the generated `index.ts` entrypoint to wire the Hono app's `export default` to include both `fetch` and `scheduled` handlers:

   ```ts
   // Generated app entrypoint — combines app + agent
   import app from './app'
   import { handleScheduled } from './agent/scheduled'

   export default {
     fetch: app.fetch,
     scheduled: handleScheduled,
   }
   ```

7. `tests/phase2-cloudflare.test.ts` — uses Miniflare (Cloudflare's local simulator) to test the full stack

**Phase 2 verification:**

```
generateAgentModule({ target: 'cloudflare-workers', ... }) produces D1 memory adapter
Generated wrangler.toml includes D1 binding and cron triggers
Generated migration SQL creates agent_memory + FTS5 tables
D1 migration applies cleanly in Miniflare

Miniflare end-to-end:
  Deploy generated app + agent to Miniflare
  Trigger scheduled event → agent loop fires
  Agent reads from D1 (tickets table)
  Agent calls model (mock endpoint in test)
  Agent writes categorization to D1
  Agent stores reasoning in agent_memory via FTS5
  Agent search returns stored memory
  Agent respects budget — exceeding maxCyclesPerHour stops execution
  Webhook route /agent/notify → triggers triage task → agent runs

Key check: NO environment variable contains an API key in wrangler.toml
API keys must come from `wrangler secret put ANTHROPIC_API_KEY`
```

**Miniflare version:** Use `miniflare@3` — it supports D1, Scheduled Events, and Durable Objects. Install as devDependency only. If Miniflare does not support FTS5 in D1, fall back to LIKE-based search in tests and note the limitation.

---

## Phase 3 — txiki.js Standalone Target

**Spec ref:** §9.2
**Depends on:** Phase 0

**Goal:** Generated app + agent compiles to a standalone txiki.js binary. Single file, runs anywhere, no Node.js dependency.

### Pre-flight (txiki-specific)

```bash
# Confirm txiki version
tjs --version
# Must be 26.x+ (Hono-compatible server, tjs:sqlite, Web Streams)

# Confirm tjs:sqlite works
tjs eval "import { Database } from 'tjs:sqlite'; const db = new Database(':memory:'); db.exec('SELECT 1'); console.log('ok')"
# Must print 'ok'

# Confirm tjs compile works
echo 'console.log("hello")' > /tmp/test.js
tjs compile /tmp/test.js /tmp/test-bin
/tmp/test-bin
# Must print 'hello'

# Confirm Hono runs on txiki
echo '
import { Hono } from "https://esm.sh/hono"
const app = new Hono()
app.get("/", (c) => c.text("ok"))
export default app
' > /tmp/hono-test.js
tjs serve /tmp/hono-test.js &
sleep 1
curl -s http://localhost:8000/
# Must return 'ok'
kill %1

# Confirm tjs:sqlite supports FTS5
tjs eval "
import { Database } from 'tjs:sqlite';
const db = new Database(':memory:');
db.exec('CREATE VIRTUAL TABLE t USING fts5(content)');
db.exec(\"INSERT INTO t VALUES ('hello world')\");
const rows = db.prepare('SELECT * FROM t WHERE t MATCH ?').all('hello');
console.log(rows.length === 1 ? 'FTS5 ok' : 'FTS5 MISSING');
"
# Must print 'FTS5 ok'
```

### Execution order

1. `packages/atua-agent-gen/src/targets/txiki.ts` — generates txiki-specific files:

   ```ts
   export function generateTxikiTarget(spec: AgentGenSpec): Map<string, string> {
     const files = new Map<string, string>()

     // txiki SQLite adapter — uses tjs:sqlite import
     files.set('/src/agent/memory.ts', generateMemory('txiki'))

     // txiki entrypoint — uses tjs serve + setInterval for cron
     files.set('/src/agent/index.ts', generateTxikiEntrypoint(spec))

     // Build script
     files.set('/build.sh', generateTxikiBuildScript(spec))

     return files
   }
   ```

2. `packages/atua-agent-gen/src/templates/memory-txiki.ts` — txiki-specific memory adapter:

   ```ts
   export function generateTxikiMemory(): string {
     return `
   // memory.ts — txiki.js SQLite adapter
   import { Database } from 'tjs:sqlite'
   import type { MemoryConfig, MemoryEntry } from './types'

   export class AgentMemory {
     private db: Database

     constructor(private config: MemoryConfig) {
       this.db = new Database(config.dbPath ?? './agent.db')
       this.migrate()
     }

     private migrate(): void {
       this.db.exec(\\\`
         CREATE TABLE IF NOT EXISTS \\\${this.config.table} (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           session_id TEXT,
           role TEXT NOT NULL,
           content TEXT NOT NULL,
           importance REAL DEFAULT 0.5,
           access_count INTEGER DEFAULT 0,
           created_at INTEGER NOT NULL,
           last_accessed INTEGER
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS \\\${this.config.table}_fts USING fts5(
           content, role,
           content='\\\${this.config.table}', content_rowid='id'
         );
         -- Insert trigger
         CREATE TRIGGER IF NOT EXISTS \\\${this.config.table}_ai AFTER INSERT ON \\\${this.config.table} BEGIN
           INSERT INTO \\\${this.config.table}_fts(rowid, content, role)
           VALUES (new.id, new.content, new.role);
         END;
         -- Delete trigger (REQUIRED for compact)
         CREATE TRIGGER IF NOT EXISTS \\\${this.config.table}_ad AFTER DELETE ON \\\${this.config.table} BEGIN
           INSERT INTO \\\${this.config.table}_fts(\\\${this.config.table}_fts, rowid, content, role)
           VALUES ('delete', old.id, old.content, old.role);
         END;
       \\\`)
     }

     // store(), relevant(), compact() — same SQL as other targets
   }
   `
   }
   ```

3. `packages/atua-agent-gen/src/targets/txiki-entrypoint.ts` — generates the txiki-native entrypoint that combines the Hono server with agent scheduling:

   ```ts
   export function generateTxikiEntrypoint(spec: AgentGenSpec): string {
     return `
   // index.ts — txiki.js entrypoint: Hono server + agent scheduler
   import app from '../app'
   import { createAgent } from './agent'
   import config from '../../agent.config'

   // Boot agent
   const agent = createAgent(config)
   await agent.init()

   // Start cron schedules
   for (const entry of config.schedule) {
     if (entry.trigger === 'cron') {
       const intervalMs = cronToMs(entry.pattern)  // simplified: cron → ms interval
       setInterval(() => agent.runTask(entry.task), intervalMs)
       console.log(\\\`[agent] Scheduled "\\\${entry.task}" every \\\${intervalMs / 1000}s\\\`)
     }
   }

   // Register webhook routes on the Hono app
   for (const entry of config.schedule) {
     if (entry.trigger === 'webhook') {
       app.post(entry.path, async (c) => {
         const input = await c.req.json().catch(() => ({}))
         await agent.runTask(entry.task, input)
         return c.json({ ok: true })
       })
     }
   }

   // Health endpoint
   app.get('/agent/health', (c) => c.json({
     status: 'running',
     dailyTokens: agent.model.getDailyTokens(),
     memoryEntries: agent.memory.count(),
     uptime: process.uptime?.() ?? 0,
   }))

   // Export for tjs serve
   export default app
   `
   }
   ```

4. `packages/atua-agent-gen/src/targets/txiki-build.ts` — generates the build script:

   ```ts
   export function generateTxikiBuildScript(spec: AgentGenSpec): string {
     return `#!/bin/bash
   set -e

   echo "[build] Bundling with esbuild..."
   npx esbuild src/index.ts \\
     --bundle \\
     --outfile=dist/bundle.js \\
     --external:tjs:* \\
     --format=esm \\
     --platform=neutral \\
     --target=es2023 \\
     --minify

   echo "[build] Compiling standalone binary..."
   tjs compile dist/bundle.js dist/${spec.name}

   echo "[build] Done: dist/${spec.name}"
   ls -lh dist/${spec.name}
   `
   }
   ```

5. `tests/phase3-txiki.test.ts` — requires txiki.js installed on CI. If unavailable, skip with clear message.

**Phase 3 verification:**

```
generateAgentModule({ target: 'txiki', ... }) produces txiki-specific files
Generated memory.ts imports from 'tjs:sqlite' (not better-sqlite3 or D1)
Generated index.ts uses setInterval for cron (not Cloudflare Scheduled Events)
Generated build.sh bundles and compiles to standalone binary

End-to-end (requires txiki on machine):
  Generate ticket dashboard + agent targeting txiki
  Run build.sh → produces standalone binary
  Execute binary → Hono server starts on port 8000
  curl localhost:8000/api/tickets → returns data
  Wait for scheduled interval → agent loop fires
  Agent writes to agent.db (SQLite file on disk)
  curl localhost:8000/agent/health → returns status with token count
  Kill and restart binary → agent.db persists → memory intact
  Binary size < 10MB (txiki ~5MB + bundled JS)
```

**Hono adapter note:** txiki.js 26.3.0 ships a Hono-compatible server API via `export default { fetch }`. Confirm the exact adapter import path. If txiki needs a Hono adapter shim, write a minimal one (< 20 lines) that bridges `tjs.serve()` to Hono's `app.fetch()`. Do not pull in a large adapter library.

**esbuild externals:** `--external:tjs:*` is critical. esbuild must NOT attempt to bundle txiki's built-in modules (`tjs:sqlite`, `tjs:path`, etc.). If esbuild does not support the `tjs:` protocol in `--external`, use `--external:tjs:sqlite --external:tjs:path` explicitly for each used module.

**Cron simplification:** Full cron parsing is complex. For V1, support a subset: `*/N * * * *` (every N minutes), `0 N * * *` (daily at hour N), `0 0 * * N` (weekly on day N). Document the limitation. Users who need full cron can replace `cronToMs()` with a proper cron library post-generation.

---

## Phase 4 — Telemetry + Remote Management

**Spec ref:** §11
**Depends on:** Phase 2 (deployed agent exists to report from)

**Goal:** Deployed agent reports telemetry to Atua. Atua can push config and skill updates without redeploying.

### Execution order

1. `packages/atua-agent-gen/src/templates/telemetry.ts` — generates the telemetry module:

   ```ts
   export function generateTelemetry(): string {
     return `
   // telemetry.ts — Reports to Atua, queues offline
   import type { AgentEvent, AtuaCommand } from './types'

   export class AgentTelemetry {
     private ws: WebSocket | null = null
     private queue: AgentEvent[] = []
     private commandHandler: ((cmd: AtuaCommand) => Promise<void>) | null = null

     constructor(private endpoint?: string) {
       if (endpoint) this.connect()
     }

     private connect(): void {
       try {
         this.ws = new WebSocket(this.endpoint!)
         this.ws.onopen = () => this.flush()
         this.ws.onmessage = (e) => this.handleCommand(JSON.parse(e.data))
         this.ws.onclose = () => {
           this.ws = null
           // Reconnect after 30s
           setTimeout(() => this.connect(), 30_000)
         }
       } catch {
         this.ws = null
       }
     }

     emit(event: AgentEvent): void {
       if (this.ws?.readyState === WebSocket.OPEN) {
         this.ws.send(JSON.stringify(event))
       } else {
         this.queue.push(event)
         // Cap offline queue at 1000 events
         if (this.queue.length > 1000) this.queue.shift()
       }
     }

     private flush(): void {
       while (this.queue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
         this.ws.send(JSON.stringify(this.queue.shift()!))
       }
     }

     onCommand(handler: (cmd: AtuaCommand) => Promise<void>): void {
       this.commandHandler = handler
     }

     private async handleCommand(cmd: AtuaCommand): Promise<void> {
       await this.commandHandler?.(cmd)
     }
   }
   `
   }
   ```

2. Wire telemetry into the generated agent loop — emit `cycle-complete` after each successful cycle, `error` on failure, `budget-warning` when thresholds are approached.

3. Wire command handling into the agent entrypoint:
   - `update-config` → re-read and validate run spec, swap live config
   - `update-skill` → write skill file to disk/D1, trigger skill reload
   - `pause` / `resume` → toggle scheduler
   - `run-now` → execute named task immediately
   - `compact-memory` → trigger memory compaction
   - `report-status` → emit full status telemetry event

4. `packages/atua-agent-gen/src/templates/telemetry-types.ts` — add `AgentEvent` and `AtuaCommand` types to the generated types.ts template.

5. **Atua-side (ide.atua.dev):** Create the agent dashboard panel. This is a Hashbrown component in the IDE:

   ```ts
   // packages/atua-ui/src/panels/agent-dashboard.tsx
   // Connects via WebSocket to deployed agent
   // Displays: live event stream, memory browser, skill editor,
   //           config editor, agent log, health indicator
   ```

   **This is a separate implementation effort** that depends on Hashbrown integration (Sizzle). If Sizzle is not ready, implement as a basic React panel without Hashbrown's generative UI — upgrade later.

6. `tests/phase4-telemetry.test.ts`

**Phase 4 verification:**

```
Generated agent includes telemetry module
Agent emits cycle-complete after successful loop
Agent emits error on model failure
Agent queues events when WebSocket disconnected
Agent flushes queue on reconnect (verify order preserved)
Queue caps at 1000 events — oldest dropped

Command handling:
  Send update-config → agent reloads config without restart
  Send update-skill → agent writes skill file, reloads skills
  Send pause → agent stops scheduled tasks
  Send resume → agent resumes scheduled tasks
  Send run-now → agent executes named task immediately
  Send report-status → agent emits full status event

Atua dashboard:
  Connects to deployed agent WebSocket
  Displays live event stream
  Skill editor: edit skill → push → agent confirms reload
  Config editor: edit schedule → push → agent confirms reload
```

---

## Phase 5 — Bridge Agent

**Spec ref:** §9.4
**Depends on:** Phase 3 (txiki standalone works)

**Goal:** The Atua bridge (`@aspect/atua-bridge`) includes a local txiki agent that operates as a development collaborator.

### Execution order

1. Define the bridge agent's fixed tool set (not generated per-project — this is a standard agent that ships with the bridge):

   ```ts
   // Bridge agent tools
   const BRIDGE_AGENT_TOOLS = [
     'fs.read',         // Read files from user's project
     'fs.write',        // Write files (with approval)
     'fs.grep',         // Search file contents
     'fs.glob',         // Find files by pattern
     'fs.watch',        // Watch for changes
     'shell.exec',      // Run shell commands (with approval)
     'git.status',      // Git status
     'git.diff',        // Git diff
     'git.log',         // Git log
     'lint.run',        // Run project linter
     'test.run',        // Run project tests
     'summarize.dir',   // Summarize directory structure for context
   ]
   ```

2. `packages/atua-bridge/src/agent/bridge-agent.ts` — the bridge agent entrypoint. Uses `createAgent()` from the same generated pattern but with fixed tools and a bridge-specific system prompt:

   ```ts
   const agent = createAgent({
     model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
     grants: { filesystem: { read: ['./'], write: ['./.atua/agent-output/'] } },
     security: 'supervised',  // Every write/exec requires user approval
   })
   ```

3. `packages/atua-bridge/src/agent/mcp-server.ts` — registers the bridge agent as an MCP tool provider on Atua's Fabric hub:

   ```ts
   hub.registerTool('bridge.agent.ask', {
     description: 'Ask the local bridge agent to analyze or act on the project',
     handler: async ({ prompt }) => agent.runTask('respond', { prompt }),
   })
   hub.registerTool('bridge.agent.summarize', {
     description: 'Get a summary of the project directory for context',
     handler: async ({ path }) => agent.runTask('summarize', { path }),
   })
   ```

4. Update bridge startup to optionally boot the agent. Controlled by environment variable `ATUA_BRIDGE_AGENT=true` or bridge config file.

5. `tests/phase5-bridge.test.ts`

**Phase 5 verification:**

```
Bridge starts with ATUA_BRIDGE_AGENT=true → agent boots
Bridge agent registers tools on Fabric hub
hub.callTool('bridge.agent.summarize', { path: '.' }) → returns directory summary
hub.callTool('bridge.agent.ask', { prompt: 'What test frameworks does this project use?' })
  → agent reads package.json, test files → returns answer

Approval flow:
  Agent decides to write a file → supervisor mode requires approval
  Approval callback fires → user accepts → file written
  Approval callback fires → user denies → agent logs denial, continues

MCP integration:
  Claude Desktop connects to bridge MCP server
  Claude Desktop calls bridge.agent.summarize → gets project context
  Claude Desktop calls bridge.agent.ask → gets analysis
  Bridge agent pre-filters context → sends summary (not 10,000-file listing)
```

---

## Phase 6 — Durable Object + Workflow Agents

**Spec ref:** §9.1 (DO/Workflow subsections)
**Depends on:** Phase 2

**Goal:** Generator produces Durable Object agents for stateful real-time behavior and Cloudflare Workflow agents for multi-step resilient pipelines.

### Execution order

1. `packages/atua-agent-gen/src/targets/cloudflare-do.ts` — generates a Durable Object agent class:

   ```ts
   // Generated DO agent — maintains WebSocket connections, persistent state
   export class AgentDO implements DurableObject {
     private state: DurableObjectState
     private agent: Agent

     constructor(state: DurableObjectState, env: Env) {
       this.state = state
       this.agent = createAgent(env, config)
     }

     async fetch(request: Request): Promise<Response> {
       // WebSocket upgrade for real-time monitoring
       // HTTP for manual triggers
     }

     async alarm(): Promise<void> {
       // Durable Object alarm for periodic agent cycles
       await this.agent.runTask('monitor')
       this.state.storage.setAlarm(Date.now() + 60_000) // Next cycle in 60s
     }
   }
   ```

2. `packages/atua-agent-gen/src/targets/cloudflare-workflow.ts` — generates a Workflow agent:

   ```ts
   // Generated Workflow agent — multi-step with durable checkpointing
   export class MonitoringWorkflow extends WorkflowEntrypoint<Env, Params> {
     async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
       // Step 1: Detect
       const anomaly = await step.do('detect', async () => {
         return agent.runTask('detect-anomaly')
       })

       if (!anomaly.detected) return

       // Step 2: Diagnose (survives restart)
       const diagnosis = await step.do('diagnose', async () => {
         return agent.runTask('diagnose', { anomaly })
       })

       // Step 3: Attempt fix
       const fixed = await step.do('fix-attempt', async () => {
         return agent.runTask('attempt-fix', { diagnosis })
       })

       if (fixed.success) return

       // Step 4: Escalate
       await step.do('escalate', async () => {
         return agent.runTask('escalate', { anomaly, diagnosis, fixAttempt: fixed })
       })
     }
   }
   ```

3. Intent detection update — teach Pi to recognize when a Durable Object or Workflow is the right pattern:
   - Real-time WebSocket monitoring → DO
   - Multi-step remediation with retry → Workflow
   - Simple periodic check → Scheduled Event (Phase 2)

4. `tests/phase6-do-workflow.test.ts`

**Phase 6 verification:**

```
Generator produces DO class when intent requires real-time monitoring
Generator produces Workflow class when intent requires multi-step pipeline
DO agent: WebSocket connection → receives live telemetry
DO alarm: fires every 60s → agent loop runs
Workflow: step 1 completes → step 2 starts → simulate crash → restart → step 2 resumes (not step 1)
Workflow escalation: all fix attempts fail → escalation tool fires → Slack notification sent
```

---

## Integration Test Suite

After Phase 4, add a full end-to-end test that exercises the entire pipeline from user prompt to deployed agent:

```ts
// tests/e2e-embedded-agent.browser.test.ts

// 1. User describes an app with agentic behavior
const atua = await AtuaInstance.create()
const hub = atua.hub
const pi = await createPiAgent({ hub, model: 'openrouter/anthropic/claude-sonnet-4-6' })

await pi.run(`
  Build me a support ticket dashboard.
  - Users can submit tickets via a form
  - Every 15 minutes, auto-categorize uncategorized tickets
  - Draft response suggestions for each ticket
  - Notify Slack when a ticket is marked urgent
`)

// 2. Verify application code generated
const appIndex = await atua.fs.readFile('/src/index.ts', 'utf8')
expect(appIndex).toContain('Hono')
expect(appIndex).toContain('tickets')

// 3. Verify agent module generated
const agentIndex = await atua.fs.readFile('/src/agent/index.ts', 'utf8')
expect(agentIndex).toContain('createAgent')

const config = await atua.fs.readFile('/agent.config.ts', 'utf8')
expect(config).toContain('cron')
expect(config).toContain('tickets')
expect(config).toContain('categorize')

// 4. Verify agent module is self-contained (no Atua imports)
const agentFiles = await atua.fs.readdir('/src/agent/')
for (const file of agentFiles) {
  const content = await atua.fs.readFile(`/src/agent/${file}`, 'utf8')
  expect(content).not.toContain('@aspect/')
  expect(content).not.toContain('atua-')
}

// 5. Verify agent runs in preview
const { previewUrl } = await atua.run('/src/index.ts')
const healthRes = await fetch(`${previewUrl}/agent/health`)
expect(healthRes.status).toBe(200)
const health = await healthRes.json()
expect(health.status).toBe('running')

// 6. Verify agent categorizes a ticket (manual trigger in preview)
await fetch(`${previewUrl}/agent/notify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ task: 'categorize', ticketId: 'test-1' }),
})
// Wait for agent cycle
await new Promise(resolve => setTimeout(resolve, 5000))
const ticketRes = await fetch(`${previewUrl}/api/tickets/test-1`)
const ticket = await ticketRes.json()
expect(ticket.category).toBeTruthy()
```

---

## Risk Mitigations — Execution Notes

**Template escaping hell.** The generator produces TypeScript source code as template literal strings inside TypeScript source files. This means triple-nested escaping for backticks, `${}` interpolations, and string literals inside generated code. **Test every template by generating it, writing to disk, and running `tsc --noEmit` against the output.** If a template produces invalid TypeScript, it's a bug in the generator, not in the generated code. Consider using a simple file-based template approach (read `.ts.template` files from disk) rather than template literals if escaping becomes unmanageable.

**D1 FTS5 availability.** Cloudflare D1 supports FTS5 as of 2024, but verify in Miniflare tests. If FTS5 is unavailable in D1, fall back to `LIKE`-based search with the `%query%` pattern. Document the performance tradeoff (LIKE is O(n), FTS5 is O(log n)). The generated code should include a `FTS5_AVAILABLE` check and graceful degradation.

**txiki.js Hono adapter stability.** txiki's Hono compatibility was introduced in 26.3.0 and is new. Test the exact version. If the adapter breaks on edge cases (streaming responses, large bodies, WebSocket upgrade), file upstream and implement a minimal shim. The shim should be < 30 lines mapping `tjs.serve()` to Hono's `app.fetch()`.

**txiki.js cross-compilation.** `tjs compile` produces a binary for the host platform. Cross-compilation (e.g., building ARM64 on x86_64) requires building txiki from source with a cross-compiler toolchain. For Phase 3 V1, only target the host platform. Cross-compilation is Phase 3.1 work.

**Generated code must not leak API keys.** Every template that touches model configuration must read keys from environment variables at runtime, never from the generated source. Add a CI check: `grep -r "sk-" /src/agent/ && exit 1` — fail if any file contains what looks like an API key literal.

**Agent loop runaway.** A bug in the agent loop (infinite tool calls, model returning tool calls on every response) could exhaust the token budget instantly. The `maxActionsPerCycle` budget limit in the run spec is the first defense. The generated loop must enforce it with a hard counter that throws after N actions, not a soft check the model can reason around.

**Skill injection attacks.** If the agent has filesystem write access to `/src/skills/`, a compromised model response could write a malicious skill that alters the agent's behavior on next reload. The generated skill loader should validate skill files: reject files > 50KB, reject files containing `import` or `require` (skills are markdown knowledge, not executable code), log every skill load event.

**WebSocket reconnection storms.** If many deployed agents lose connection to Atua simultaneously (Atua downtime, network partition), they will all attempt to reconnect at the same time when connectivity is restored. The generated telemetry module must use jittered exponential backoff: `delay = min(30000, 1000 * 2^attempt) + random(0, 1000)`.

**Pi over-generating.** Pi might detect "agentic intent" too aggressively — e.g., interpreting "I want a dashboard that shows ticket status" as needing an agent. The intent detection skill should err on the side of NOT generating an agent. When uncertain, Pi should ask the user: "Would you like this app to actively monitor and categorize tickets, or just display them?" This is cheaper than generating and then removing an unwanted agent module.

---

## SQLite Schema Reference

Used by all targets (table names configurable via run spec):

```sql
-- Agent memory with FTS5
CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(
  content, role,
  content='agent_memory', content_rowid='id'
);

-- Insert sync trigger
CREATE TRIGGER IF NOT EXISTS agent_memory_ai AFTER INSERT ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(rowid, content, role)
  VALUES (new.id, new.content, new.role);
END;

-- Delete sync trigger (REQUIRED — without this, compact() corrupts FTS index)
CREATE TRIGGER IF NOT EXISTS agent_memory_ad AFTER DELETE ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, role)
  VALUES ('delete', old.id, old.content, old.role);
END;

-- Update sync trigger
CREATE TRIGGER IF NOT EXISTS agent_memory_au AFTER UPDATE ON agent_memory BEGIN
  INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, role)
  VALUES ('delete', old.id, old.content, old.role);
  INSERT INTO agent_memory_fts(rowid, content, role)
  VALUES (new.id, new.content, new.role);
END;

-- Agent activity log
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  action TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_log_task ON agent_log(task);
CREATE INDEX IF NOT EXISTS agent_log_created ON agent_log(created_at);

-- Telemetry offline queue (for disconnected operation)
CREATE TABLE IF NOT EXISTS agent_telemetry_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

---

## Deployment Target Decision Tree

Pi uses this logic to select the right target when generating:

```
User says "deploy to Cloudflare" or project has wrangler.toml?
  → target: cloudflare-workers
  → Uses: D1, Scheduled Events, optional DO/Workflow

User says "deploy to Docker" or "deploy to VPS" or "self-hosted"?
  → target: generic (Node.js compatible)
  → Uses: better-sqlite3, node-cron, express/Hono on Node

User says "standalone" or "single binary" or "Raspberry Pi" or "edge"?
  → target: txiki
  → Uses: tjs:sqlite, setInterval, tjs compile

User says "local agent" or "on my machine" or project is bridge-connected?
  → target: bridge
  → Uses: txiki embedded, supervised security mode

No deployment target specified?
  → Default: cloudflare-workers (Atua's primary target)
  → Pi informs user: "I'll deploy this to Cloudflare Workers with D1."
```
