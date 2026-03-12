# Conductor (Pi-Atua) — Implementation Plan

**Companion to:** `pi-atua-spec.md`
**Package:** `@aspect/pi-atua`
**Purpose:** Execution guide for CC. Assumes Atua phases 0–12 are complete and all §17 success criteria pass.

---

## Pre-Flight Checklist

Before CC begins:

```bash
# Confirm Atua substrate exists
ls packages/atua-fs/       # AtuaFS package
ls packages/atua-d1/       # CatalystD1 package
ls packages/atua-proc/     # AtuaProc package
ls packages/atua-fabric/   # Fabric MCP hub — REQUIRED, must exist

# Confirm Fabric hub API
cat packages/atua-fabric/src/hub.ts | grep "export"
# Must export: AtuaHub, hub.listTools(), hub.callTool(), hub.registerTool()

# Confirm Pi packages are accessible
pnpm add @mariozechner/pi-ai@latest --dry-run
pnpm add @mariozechner/pi-agent-core@latest --dry-run
pnpm add @mariozechner/pi-coding-agent@latest --dry-run
pnpm add @mariozechner/pi-web-ui@latest --dry-run

# Confirm esm.sh can resolve Pi packages (browser import path check)
# Open browser console: await import('https://esm.sh/@mariozechner/pi-agent-core')
# Should resolve without error

# Confirm browser_wasi_shim (needed for Pi's fs operations)
ls node_modules/@bjorn3/browser_wasi_shim  # or check pnpm workspace
```

**Fabric dependency is a hard blocker.** `@aspect/pi-atua` cannot be built without the MCP hub existing. If Fabric is not implemented, Conductor cannot start. No workaround.

---

## Package Scaffold

Before Phase 0, create the package shell:

```bash
mkdir -p packages/pi-atua/src/{tools,session,memory,provider,packages,auth,web-ui}
```

`packages/pi-atua/package.json`:
```json
{
  "name": "@aspect/pi-atua",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@mariozechner/pi-ai": "latest",
    "@mariozechner/pi-agent-core": "latest",
    "@mariozechner/pi-coding-agent": "latest"
  },
  "peerDependencies": {
    "@aspect/atua-fabric": "workspace:*",
    "@aspect/atua-fs": "workspace:*",
    "@aspect/atua-d1": "workspace:*",
    "@aspect/atua-proc": "workspace:*"
  }
}
```

---

## Phase 0 — Core Adapter: Tools + Agent Initialization

**Spec ref:** §5, §9
**Goal:** Pi agent boots inside Atua. Calls basic tools via the hub. Full loop runs.

**Execution order:**
1. **Read Pi source first.** Before writing any adapter code, read the Pi package interfaces:
   - `@mariozechner/pi-coding-agent/src/index.ts` — `createAgentSession()` signature
   - `@mariozechner/pi-agent-core/src/tools.ts` — `Tool` interface Pi expects
   - `@mariozechner/pi-ai/src/index.ts` — `PiAI` constructor options

2. `packages/pi-atua/src/tools/read.ts`:
   ```ts
   // Pi tool: { name, description, schema, call }
   // Routes to: hub.callTool('atuafs.read', { path })
   export const readTool = (hub: AtuaHub): PiTool => ({
     name: 'read',
     description: 'Read file contents',
     schema: { path: { type: 'string' } },
     call: async ({ path }) => hub.callTool('atuafs.read', { path }),
   })
   ```

3. `packages/pi-atua/src/tools/write.ts` — routes to `hub.callTool('atuafs.write', { path, content })`

4. `packages/pi-atua/src/tools/edit.ts` — read → find unique string → replace → write. Validates uniqueness before writing.

5. `packages/pi-atua/src/tools/bash.ts` — routes to `hub.callTool('catalyst.proc.spawn', { command, cwd })`, waits for exit

6. `packages/pi-atua/src/tools/grep.ts` — `hub.callTool('atuafs.search', { pattern, path })`

7. `packages/pi-atua/src/tools/find.ts` — `hub.callTool('atuafs.glob', { pattern })`

8. `packages/pi-atua/src/tools/ls.ts` — `hub.callTool('atuafs.readdir', { path })`

9. `packages/pi-atua/src/tools/hub-tools.ts` — dynamic tool discovery:
   ```ts
   // Calls hub.listTools(), filters out tools Pi's core tools already cover,
   // maps remainder to Pi's Tool interface with mcpToolTopiTool()
   export async function getHubTools(hub: AtuaHub): Promise<PiTool[]>
   ```

10. `packages/pi-atua/src/index.ts` — `createPiAgent(options)`:
    ```ts
    export async function createPiAgent({ hub, model, systemPrompt, sessionId }: CreatePiAgentOptions) {
      const ai = new PiAI({ model, /* provider config */ })
      const tools = [
        readTool(hub), writeTool(hub), editTool(hub), bashTool(hub),
        grepTool(hub), findTool(hub), lsTool(hub),
        ...await getHubTools(hub),
      ]
      const agent = createAgentSession({ ai, tools, systemPrompt, sessionId })
      return agent
    }
    ```

11. `tests/phase0-core.browser.test.ts` — all Phase 0 verification items

**Phase 0 verification (all must pass):**
```
createPiAgent() returns a working agent instance
agent.run('What files are in /?') — calls hub atuafs.readdir, returns listing
agent.run('Write "hello" to /test.txt') — file appears in AtuaFS
agent.run('Read /test.txt') — returns "hello"
agent.run('Edit /test.txt: replace "hello" with "world"') — content updated
hub.listTools() result count matches tools Pi receives (dynamic discovery)
Full loop: prompt → LLM → tool call → result → LLM → final response
```

---

## Phase 1 — Session Persistence

**Spec ref:** §6 (session section)
**Goal:** Agent sessions survive page reload and browser restart.

**Execution order:**
1. **Read Pi session interface first:** `@mariozechner/pi-coding-agent/src/session.ts` — `SessionManager` interface methods: `save(session)`, `load(id)`, `list()`, `delete(id)`

2. `packages/pi-atua/src/session/opfs-session.ts` — `OPFSSessionManager implements SessionManager`:
   - `save`: serialize session → JSON → `atuafs.write('/.pi/sessions/{id}.json', json)`
   - `load`: `atuafs.read('/.pi/sessions/{id}.json')` → deserialize
   - `list`: `atuafs.readdir('/.pi/sessions/')` → metadata array
   - `delete`: `atuafs.unlink('/.pi/sessions/{id}.json')`

3. `packages/pi-atua/src/session/d1-session.ts` — `D1SessionManager implements SessionManager`:
   - Schema: `CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, updated_at INTEGER, data TEXT)`
   - `save`: `INSERT OR REPLACE INTO sessions`
   - `load`: `SELECT data FROM sessions WHERE id = ?` → parse JSON
   - `list`: `SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC`
   - `delete`: `DELETE FROM sessions WHERE id = ?`

4. Update `createPiAgent()` to accept `{ sessionBackend: 'opfs' | 'd1', sessionId?: string }` and wire session manager

5. `tests/phase1-sessions.browser.test.ts`

**Phase 1 verification:**
```
Create session, send 3 messages, save
Reload page (simulate: create new AtuaInstance, createPiAgent with same sessionId)
Load session — conversation history intact, correct message count
List sessions — correct titles and timestamps
Delete session — load returns null
D1 backend: 100 sessions created, list returns in < 100ms
```

---

## Phase 2 — Memory System

**Spec ref:** §7 (memory section)
**Goal:** Agent has long-term recall across sessions.

**Execution order:**
1. `packages/pi-atua/src/memory/memory-schema.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     importance REAL DEFAULT 0.5,
     access_count INTEGER DEFAULT 0,
     created_at INTEGER NOT NULL,
     last_accessed INTEGER
   );
   CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
     content, role, session_id,
     content='memories', content_rowid='id'
   );
   CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
     INSERT INTO memories_fts(rowid, content, role, session_id)
     VALUES (new.id, new.content, new.role, new.session_id);
   END;
   ```

2. `packages/pi-atua/src/memory/memory-store.ts` — `PiMemoryStore`:
   - `store(entry: MemoryEntry): Promise<void>` — INSERT + importance scoring
   - `search(query: string, limit = 10): Promise<MemoryResult[]>` — FTS5 MATCH with importance × recency weighting
   - `forget(id: number): Promise<void>` — soft delete (set importance = 0)
   - `compact(keepTop = 500): Promise<void>` — DELETE WHERE importance < threshold, keep top N by importance × recency

3. `packages/pi-atua/src/memory/memory-provider.ts` — registers `pi.memory.*` tools on hub:
   - `pi.memory.store({ content, importance? })`
   - `pi.memory.search({ query, limit? })`
   - `pi.memory.forget({ id })`
   - `pi.memory.compact()`

4. `packages/pi-atua/src/memory/auto-memory-extension.ts` — Pi extension that fires `after_turn`: extracts facts from assistant response → stores via `pi.memory.store`

5. `packages/pi-atua/src/memory/memory-injection-extension.ts` — Pi extension that fires `before_llm_call`: searches memories for query-relevant context → prepends to system prompt as `[MEMORY CONTEXT]`

6. `tests/phase2-memory.browser.test.ts`

**Phase 2 verification:**
```
store({ content: 'User prefers TypeScript', importance: 0.9 })
search('TypeScript') → returns stored entry as first result
FTS5: search('typescript') (lowercase) → still finds it (FTS5 is case-insensitive)
Importance + recency weighting: newer high-importance entry ranks above older low-importance
compact(keepTop=5) with 10 entries → 5 entries remain, lowest importance removed
Auto-memory extension extracts fact from conversation turn
Memory injection prepends relevant memories to next LLM call
Memory persists: close D1, reopen, search finds same memories
```

**Importance weighting formula (implement exactly):**
```ts
score = importance * 0.6 + recency_score * 0.4
recency_score = 1 / (1 + days_since_access)
```

---

## Phase 3 — MCP Provider Registration

**Spec ref:** §8
**Goal:** Pi is visible on the Fabric hub. External clients can call Pi tools.

**Execution order:**
1. **Read Fabric hub registration API first.** Confirm signature: `hub.registerProvider(namespace, toolDefs, handlers)`

2. `packages/pi-atua/src/provider/pi-provider.ts` — registers all `pi.*` tools:
   ```
   pi.prompt     — { message, sessionId? } → runs agent loop, returns response
   pi.status     — {} → { state, currentTask, sessionId }
   pi.session.list   — {} → session metadata array
   pi.session.get    — { id } → full session with history
   pi.session.delete — { id } → void
   pi.memory.search  — { query, limit? } → memory results
   pi.memory.store   — { content, importance? } → void
   pi.config.get     — { key } → value
   pi.config.set     — { key, value } → void
   ```

3. `packages/pi-atua/src/provider/registration.ts` — `registerPiProvider(hub, agent)`: called from `createPiAgent()`, wires all tools

4. Streaming support for `pi.prompt`: Fabric hub must support streaming tool responses. Check hub interface for `callToolStreaming` or equivalent. If not supported, add to Fabric first.

5. Hub tool auto-refresh: subscribe to `hub.onProvidersChanged()` → call `getHubTools(hub)` → update Pi's dynamic tool list

6. `tests/phase3-provider.browser.test.ts`

**Phase 3 verification:**
```
hub.listTools() includes 'pi.prompt', 'pi.status', 'pi.session.list', 'pi.memory.search'
Call pi.prompt via hub → agent runs → response returned
Call pi.session.list via hub → sessions from Phase 1 appear
Call pi.memory.search via hub → memories from Phase 2 appear
Call pi.status via hub → { state: 'idle', sessionId: '...' }
Install new MCP server → hub.listTools() grows → Pi's next call sees new tools
```

**Streaming gap:** If Fabric hub does not yet support streaming tool responses, `pi.prompt` returns the full response after completion (non-streaming). Document this as a limitation, file as a Fabric enhancement. Do not block Phase 3 on it.

---

## Phase 4 — LLM Routing + AtuaResourceLoader

**Spec ref:** §9 (LLM routing), §10 (extensions)
**Goal:** All three LLM routing modes work. `AtuaResourceLoader` bridges Pi's resource system to AtuaFS.

---

### Background: How Pi loads extensions, skills, and prompts

Pi's entire extension/skill/prompt/theme system flows through a single `ResourceLoader` interface passed to `createAgentSession()`. The default implementation (`DefaultResourceLoader`) reads from the real filesystem — `~/.pi/agent/extensions/`, `.pi/extensions/`, etc. In the browser these paths don't exist.

The correct approach: implement `ResourceLoader` for Atua, backed by AtuaFS. Everything else — Pi's event system, tool registration, skill injection — stays exactly as Pi designed it. We don't build a parallel loading system.

**The jiti problem:** Pi loads `.ts` extension files via `jiti` (TypeScript without compilation). jiti is Node.js only and will not run in the browser. Solution for user-authored extensions in AtuaFS: compile with esbuild-wasm first, then `dynamic import` via object URL. SDK callers who want to pass an inline factory (e.g. a host app adding a custom tool) pass it as an `ExtensionFactory` function directly — no file loading, no jiti.

**No built-in extensions.** Atua ships Pi as-is. The quality gate, plan mode, sub-agents, compaction strategies — none are pre-loaded. Pi writes them when asked. Users install packages. `extensionFactories: []` by default.

---

### Execution order

**LLM routing (implement first):**

1. `packages/pi-atua/src/llm/direct-provider.ts` — Mode 1 (direct): Pi calls provider via `pi-ai`. API key read from `AtuaAuthStorage` → `/.atua/auth.json`. Implement Anthropic and OpenRouter first.

2. `packages/pi-atua/src/llm/proxy-provider.ts` — Mode 2 (proxy): Pi posts to host app's proxy URL. `{ streamProxy: 'https://myapp.com/api/chat' }` in `createPiAgent` options.

3. `packages/pi-atua/src/llm/fn-provider.ts` — Mode 3 (function): `{ streamFn: async (messages) => ReadableStream }` injected at `createPiAgent` call time.

4. Update `createPiAgent()` to detect mode from options and configure `pi-ai` accordingly.

**AtuaResourceLoader (after LLM routing):**

5. Read `ResourceLoader` interface from `@mariozechner/pi-coding-agent` source before writing anything:
   ```bash
   cat node_modules/@mariozechner/pi-coding-agent/src/core/resource-loader.ts
   ```
   Confirm the exact interface: `getExtensions()`, `getSkills()`, `getPrompts()`, `getThemes()`, `getAgentsFiles()`, `reload()`. Do not guess — implement exactly what Pi expects.

6. `packages/pi-atua/src/resources/atua-resource-loader.ts` — implements `ResourceLoader` backed by AtuaFS:
   ```ts
   export class AtuaResourceLoader implements ResourceLoader {
     constructor(
       private fs: AtuaFS,
       private options: AtuaResourceLoaderOptions,
     ) {}
   
     // Skills: read /.atua/skills/*.md from AtuaFS
     getSkills(): Skill[] { ... }
   
     // Prompts: read /.atua/prompts/*.md from AtuaFS
     getPrompts(): PromptTemplate[] { ... }
   
     // Themes: read /.atua/themes/*.json from AtuaFS
     getThemes(): Theme[] { ... }
   
     // AGENTS.md equivalent: read /.atua/AGENTS.md if it exists
     getAgentsFiles(): AgentsFilesResult { ... }
   
     // Extensions: built-in factories + user-compiled extensions
     getExtensions(): Extension[] { ... }
   
     async reload(): Promise<void> {
       // Re-read all resources from AtuaFS
       // Re-compile any new/changed .ts extension files
     }
   }
   ```

7. `packages/pi-atua/src/resources/extension-compiler.ts` — compiles user `.ts` extensions from AtuaFS to object URLs using esbuild-wasm (already available from Atua Phase 4):
   ```ts
   export async function compileExtension(
     fs: AtuaFS,
     path: string,  // e.g. /.atua/extensions/my-ext.ts
   ): Promise<ExtensionFactory> {
     const source = await fs.readFile(path, 'utf8')
     const result = await esbuildWasm.transform(source, { loader: 'ts' })
     const blob = new Blob([result.code], { type: 'application/javascript' })
     const url = URL.createObjectURL(blob)
     const mod = await import(/* @vite-ignore */ url)
     URL.revokeObjectURL(url)
     return mod.default  // Pi extension factory: (pi: ExtensionAPI) => void
   }
   ```

9. Register `atua.pkg.reload` as a hub tool — this is the mechanism Pi uses to make its own writes take effect immediately:
   ```ts
   hub.registerTool('atua.pkg.reload', {
     description: 'Reload extensions, skills, and prompts from AtuaFS. Call after writing new extensions or skills.',
     schema: {},
     handler: async () => {
       await loader.reload()
       return { reloaded: true, extensions: loader.getExtensions().length, skills: loader.getSkills().length }
     },
   })
   ```
   This is how the self-extension loop closes: Pi writes `/.atua/extensions/quality-gate.ts` → calls `atua.pkg.reload` → extension is live for the current and all future sessions.

10. Wire `AtuaResourceLoader` into `createAgentSession()` in `createPiAgent()`:
   ```ts
   const loader = new AtuaResourceLoader(fs, {
     extensionFactories: [],  // No built-in extensions. Pi builds what it needs.
   })
   await loader.reload()

   const { session } = await createAgentSession({
     resourceLoader: loader,
     customTools: [atuaReadTool, atuaWriteTool, atuaEditTool, atuaBashTool],
     authStorage: new AtuaAuthStorage(fs),
     modelRegistry: new ModelRegistry(atuaAuthStorage),
     sessionManager: atuaSessionManager,
   })
   ```

   SDK callers (host apps) can pass `extensionFactories` via `createPiAgent` options if they want to inject behaviour programmatically — but Atua itself injects nothing.

11. `tests/phase4-resources.browser.test.ts`

**Phase 4 verification:**
```
Mode 1: Pi calls LLM directly with API key from /.atua/auth.json
Mode 2: Pi posts to mock proxy URL, receives streamed response
Mode 3: Pi calls injected streamFn, receives streamed response
AtuaResourceLoader.getSkills() → empty on fresh project
AtuaResourceLoader.getPrompts() → empty on fresh project
AtuaResourceLoader.getAgentsFiles() → empty on fresh project
Fresh session: hub.listTools() includes Atua substrate tools, no extensions registered
Self-extension loop:
  Pi writes /.atua/extensions/quality-gate.ts
  Pi calls atua.pkg.reload → loader.reload() triggered
  Extension now active → fires on next tool_execution_end event
  atua.pkg.reload returns { reloaded: true, extensions: 1, skills: 0 }
Self-skill loop:
  Pi writes /.atua/skills/react-patterns.md
  Pi calls atua.pkg.reload → loader.reload()
  getSkills() returns that skill → injected into next session system prompt
User extension with /.atua/extensions/custom.ts → compiles via esbuild-wasm → fires correctly
```

**CORS note (Mode 1):** Direct Anthropic calls from the browser fail due to CORS. Route via `wss://relay.atua.dev/llm/anthropic` (Atua Phase 11 relay). OpenRouter works without relay. Implement OpenRouter first to validate the full pipeline before wiring the relay.

---

## Phase 5 — Web UI + Pi Package Support

**Spec ref:** §11 (web UI), §12 (packages)
**Goal:** Pi's chat UI renders. Pi packages install in browser via AtuaFS.

---

### Background: Pi package format

A Pi package is any npm or git package with a `pi` key in `package.json` and the `pi-package` keyword. The `pi` key declares which directories contain extensions, skills, prompts, and themes:

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

If no `pi` key is present, Pi auto-discovers from `extensions/`, `skills/`, `prompts/`, `themes/` convention directories.

Pi normally installs packages by running `npm install` — which cannot run in the browser. `AtuaPackageInstaller` replaces this with a fetch-from-npm-registry pipeline that writes the package contents into AtuaFS.

---

### Execution order

**Web UI:**

1. Read `@mariozechner/pi-web-ui` source before writing the wrapper:
   ```bash
   cat node_modules/@mariozechner/pi-web-ui/src/chat-panel.ts
   ```
   Confirm `<chat-panel>` props: what does the `agent` prop expect? What events does it emit?

2. `packages/pi-atua/src/web-ui/atua-panel.ts` — wraps `<chat-panel>` Lit component:
   - Passes `session` from `createAgentSession()`
   - Wires artifact rendering to `hub.callTool('atua.preview.render', ...)`
   - Exports as React component via `@lit-labs/react` or plain `useEffect` wrapper

3. `packages/pi-atua/src/web-ui/model-selector.ts` — wraps Pi's `ModelSelector`, reads allowed models from `AtuaAuthStorage`, filters list

**Pi Package Installer:**

4. `packages/pi-atua/src/packages/atua-package-installer.ts` — `AtuaPackageInstaller`:

   **Install from npm:**
   ```ts
   async installNpm(spec: string) {
     // e.g. spec = 'npm:@aspect/quality-gate@1.0.0'
     // 1. Fetch tarball URL from registry.npmjs.org/{name}/{version}
     // 2. Fetch tarball as ArrayBuffer
     // 3. Decompress (pako or DecompressionStream API)
     // 4. Write package contents into AtuaFS at /.atua/packages/{name}/
     // 5. Read package.json → extract 'pi' key OR use convention directories
     // 6. Register discovered paths in /.atua/packages/installed.json
     // 7. Call atuaResourceLoader.reload() → new extensions/skills become active
   }
   ```

   **Install from git:**
   ```ts
   async installGit(spec: string) {
     // Use isomorphic-git (already in Atua substrate)
     // Clone into AtuaFS at /.atua/packages/git/{host}/{path}/
     // Then same steps 5-7 as npm install
   }
   ```

   **Install from AtuaFS local path:**
   ```ts
   async installLocal(path: string) {
     // Path is already in AtuaFS — just register in installed.json
     // Call atuaResourceLoader.reload()
   }
   ```

5. Register `atua.pkg.install`, `atua.pkg.remove`, `atua.pkg.list` as hub tools so Pi agent can install packages via tool calls:
   ```ts
   hub.registerTool('atua.pkg.install', {
     description: 'Install a pi package from npm, git, or local path',
     schema: { spec: s.string('Package spec e.g. npm:@aspect/quality-gate') },
     handler: async ({ spec }) => installer.install(spec),
   })
   ```

6. `AtuaResourceLoader.reload()` must re-scan `/.atua/packages/installed.json` and include newly installed package resources alongside user extensions and skills.

7. `tests/phase5-packages.browser.test.ts`

**Phase 5 verification:**
```
<AtuaPanel session={session} /> renders in React host — no console errors
User types message → streaming response appears token-by-token
Artifact (HTML output) renders in sandboxed iframe
Model selector shows available models, selection updates session model

Package install (npm):
  atua.pkg.install('npm:@aspect/atua-quality-gate') → tarball fetched, written to AtuaFS
  /.atua/packages/@aspect/atua-quality-gate/package.json readable
  loader.reload() → extension from package fires on tool_call event

Package install (local):
  atua.pkg.install('./my-ext') → registered in installed.json
  loader.reload() → extension active

Package remove:
  atua.pkg.remove('npm:@aspect/atua-quality-gate') → removed from installed.json
  loader.reload() → extension no longer fires

Pi agent self-installs a package via hub tool:
  Pi calls atua.pkg.install as a tool → package active without user intervention
```

**Lit + React interop:** `@mariozechner/pi-web-ui` uses Lit web components. Use `@lit-labs/react` (official, MIT licensed). If bundling issues arise, wrap with a plain `useEffect` that imperatively mounts `document.createElement('chat-panel')`.

**Tarball decompression:** npm tarballs are `.tar.gz`. Use `DecompressionStream` (built into browsers since Chrome 80 / Firefox 113) rather than pulling in a decompression library. Fall back to pako if DecompressionStream is unavailable.

---

## Integration Test Suite

After Phase 5, add a full end-to-end test that exercises the entire stack:

```ts
// tests/e2e-full-stack.browser.test.ts

const atua = await AtuaInstance.create()
const hub = atua.hub
const pi = await createPiAgent({
  hub,
  model: 'openrouter/anthropic/claude-sonnet-4-5',  // OpenRouter = no CORS
  systemPrompt: 'You are a coding assistant.',
})

// Full task: write file, read it back, build it
await pi.run('Write a TypeScript file at /src/greet.ts that exports a function greet(name: string) returning "Hello, {name}!"')

const content = await atua.fs.readFile('/src/greet.ts', 'utf8')
expect(content).toContain('export')
expect(content).toContain('greet')

// Memory persists
await pi.run('Remember that the user prefers TypeScript')
const memories = await hub.callTool('pi.memory.search', { query: 'TypeScript' })
expect(memories.length).toBeGreaterThan(0)

// Session persists
const sessionId = pi.sessionId
const pi2 = await createPiAgent({ hub, model: 'openrouter/...', sessionId })
// pi2 can resume — history accessible
const history = await hub.callTool('pi.session.get', { id: sessionId })
expect(history.messages.length).toBeGreaterThan(0)
```

---

## Risk Mitigations — Execution Notes

**ResourceLoader interface drift:** Pi's `ResourceLoader` interface is internal and not guaranteed stable. Before implementing `AtuaResourceLoader`, read the actual interface from source (`src/core/resource-loader.ts`) — not from docs or search results. If the interface changes between Pi versions, `AtuaResourceLoader` breaks. Pin `@mariozechner/pi-coding-agent` to an exact version and review the changelog before any version bump.

**jiti in browser:** Pi loads `.ts` extension files via jiti — Node.js only. Never attempt to run jiti in the browser. User-authored extensions in `/.atua/extensions/*.ts` go through the esbuild-wasm compilation pipeline. SDK callers who need to inject behaviour programmatically pass `ExtensionFactory` functions directly via `createPiAgent` options.

**Pi package import failures in browser:** If `@mariozechner/pi-agent-core` imports Node.js modules not covered by unenv, you'll see runtime errors like `'fs' module not found`. Fix: add the failing module to the unenv mock list, or route it through an Atua adapter. Do not silence the error — it means a real Node API is being called.

**esm.sh resolution failures:** Test each Pi package import via esm.sh in the browser console before wiring into the codebase. `await import('https://esm.sh/@mariozechner/pi-agent-core')`. If it fails, check esm.sh's build logs at `https://esm.sh/build?pkg=@mariozechner/pi-agent-core`.

**Pi version pinning:** Pin all `@mariozechner/*` packages to exact versions in `package.json`. Pi is pre-1.0 and breaking changes are expected. Set a reminder to review changelog before any version bump.

**Memory FTS5 not found:** wa-sqlite must be compiled with FTS5 support. The default wa-sqlite build includes it, but verify: `SELECT fts5('test')` in the browser console against a wa-sqlite instance. If FTS5 is missing, use the `wa-sqlite` WASM build that includes all extensions.

**npm tarball CORS:** Fetching from `registry.npmjs.org` directly should work (npm registry sends CORS headers). If it doesn't in a specific environment, proxy through the Atua relay. Do not hardcode a proxy assumption — test direct first.
