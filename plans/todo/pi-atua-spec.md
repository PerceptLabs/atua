# Pi.dev × Atua Integration Spec

**Codename:** Conductor  
**Status:** Draft  
**Date:** 2026-03-03  
**Depends on:** Atua MCP Spec (Fabric), Atua Phase 13 complete  
**Supersedes:** ZeroClaw × Atua Spec (Claw) — Rust/WASM path replaced by native TypeScript path

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Why Pi.dev, Not ZeroClaw](#2-why-pidev-not-zeroclaw)
3. [Pi.dev Package Inventory](#3-pidev-package-inventory)
4. [Architecture Overview](#4-architecture-overview)
5. [Integration Layer: @aspect/pi-atua](#5-integration-layer-aspectpi-atua)
6. [Tool Mapping: Pi Tools → Catalyst Subsystems](#6-tool-mapping-pi-tools--catalyst-subsystems)
7. [LLM Routing: Three Modes](#7-llm-routing-three-modes)
8. [Session Persistence](#8-session-persistence)
9. [Memory System](#9-memory-system)
10. [Extensions in Browser Context](#10-extensions-in-browser-context)
11. [Skills & Prompt Templates](#11-skills--prompt-templates)
12. [Pi as MCP Provider](#12-pi-as-mcp-provider)
13. [Pi as MCP Consumer](#13-pi-as-mcp-consumer)
14. [Pi's MCP Servers in Atua Workers](#14-pis-mcp-servers-in-atua-workers)
15. [Pi Web UI Integration](#15-pi-web-ui-integration)
16. [Host Application Integration Patterns](#16-host-application-integration-patterns)
17. [Pi Packages in Browser](#17-pi-packages-in-browser)
18. [Security Model](#18-security-model)
19. [Browser Compatibility Surface](#19-browser-compatibility-surface)
20. [Testing Strategy](#20-testing-strategy)
21. [Implementation Phases](#21-implementation-phases)
22. [CC Kickoff Prompts](#22-cc-kickoff-prompts)
23. [Risk Assessment](#23-risk-assessment)
24. [Cleanroom Protocol](#24-cleanroom-protocol)

---

## 1. What This Is

Pi.dev is a TypeScript agent toolkit — a monorepo of layered packages: `pi-ai` (multi-provider LLM API), `pi-agent-core` (agent loop with tool calling and state management), `pi-coding-agent` (coding tools, sessions, extensions, skills), `pi-tui` (terminal UI), and `pi-web-ui` (browser chat components). These are the same packages that power OpenClaw.

Atua is a browser-native runtime — OPFS filesystem, wa-sqlite database, esbuild-wasm build pipeline, Worker process isolation, Service Worker networking, 96.2% Node.js API compatibility. Everything runs in a browser tab. No server.

This spec describes running Pi.dev's agent framework natively inside Atua. Not compiled to WASM. Not ported. The actual TypeScript packages, imported via esm.sh, running in browser context, with their tools wired to Atua's Catalyst subsystems through the MCP hub.

### What You Get

- A full autonomous AI agent running in a browser tab with no server backend
- Agent has persistent memory across sessions (wa-sqlite FTS5 + vector similarity in OPFS)
- Agent has persistent sessions (conversation history survives browser refresh)
- Agent can read/write files, build projects, inspect previews, query databases — all in-browser
- Agent supports 22+ LLM providers via pi-ai, or shares the host application's LLM client
- Agent is extensible via Pi's extension system — lifecycle hooks, tool gating, context engineering
- Agent is observable — every tool call logged as MCP transaction, sessions inspectable, memory searchable
- Agent is accessible from outside — external MCP clients can talk to the agent, review sessions, search memory
- Agent's capabilities expand automatically — every MCP server installed in Atua becomes a tool Pi can use
- Agent's web UI components render directly — chat panel, model selector, artifacts, streaming display

### What This Is NOT

- Not a WASM compilation of a Rust agent (that was ZeroClaw × Atua — superseded)
- Not a fork of Pi's packages (we use them as dependencies, MIT licensed)
- Not a reimplementation of Pi in a different language
- Not dependent on Pi upstream accepting changes (integration is an adapter layer)
- Not a thin wrapper — we implement real adapters for tools, sessions, memory, and extensions

### Relationship to Other Specs

**Atua MCP Spec (Fabric):** Defines the MCP hub, transports, internal providers, and external surface. This spec depends on Fabric — Pi connects to the hub as consumer and provider. Fabric's Section 10 is a high-level sketch; this spec is the full implementation plan.

**ZeroClaw × Atua Spec (Claw):** The earlier approach — compile ZeroClaw's Rust agent core to WASM, run it in a Worker with host bindings. Superseded. Pi is TypeScript, runs natively, no compilation step, no dependency surgery, no host bindings, no WASM binary size concerns. The ZeroClaw spec remains valid if someone wants a Rust-native agent in the browser, but Pi is the primary path for Atua.

---

## 2. Why Pi.dev, Not ZeroClaw

### The ZeroClaw Path

ZeroClaw is Rust. To run in a browser, we'd need to: strip tokio (the async runtime), replace rusqlite (C FFI) with host bindings to wa-sqlite, replace reqwest with host bindings to fetch(), compile to wasm32-wasip1, optimize the binary (3-8MB expected), write WIT interface definitions for every host binding, implement trait adapters for every I/O boundary, and manage the WASM ↔ JavaScript boundary for every tool call.

That's 8 implementation phases, each with significant risk. The tokio removal alone is rated high-severity/high-likelihood in the risk assessment. The WASM binary size is a medium risk. LLM streaming over host bindings dropping chunks is a medium risk.

### The Pi Path

Pi is TypeScript. It runs in a browser already — pi-web-ui proves this. The remaining packages (pi-ai, pi-agent-core, pi-coding-agent) are pure TypeScript with no native dependencies. They use `fetch()` for LLM calls (already browser-native), JSON for serialization (already browser-native), and TypeScript interfaces for tool definitions (already browser-native).

What Pi needs in the browser that it doesn't have today:

- **Tool backends.** Pi's default tools (read, write, edit, bash) call Node.js `fs` and `child_process`. In Atua, they call CatalystFS and CatalystProc through the MCP hub. This is an adapter, not a rewrite.
- **Session storage.** Pi's `SessionManager` has an in-memory backend and a filesystem backend. We add an OPFS backend via CatalystFS. One class.
- **Memory.** Pi doesn't have persistent memory. We add it via CatalystD1. New capability, not a replacement.
- **Package resolution.** Pi installs packages from npm via the OS. In Atua, CatalystPkg handles this via esm.sh. The `pi install` command routes to CatalystPkg.

No WASM compilation. No host bindings. No WIT definitions. No binary size optimization. No tokio removal. No dependency surgery. The agent loop, extension system, tool calling, streaming, context management — all unchanged.

### Comparison

| Dimension | ZeroClaw Path | Pi Path |
|-----------|--------------|---------|
| Language | Rust → WASM | TypeScript (native) |
| Compilation | cargo build + wasm-opt | None (esm.sh import) |
| Binary/bundle size | 3-8MB WASM | ~200KB JS (tree-shaken) |
| Async runtime | Strip tokio, manual polling | Native browser async/await |
| LLM calls | Host binding → fetch() | Direct fetch() |
| Database | Host binding → wa-sqlite | Direct CatalystD1 via hub |
| Tool boundary | WASM ↔ JS serialization per call | Direct function calls |
| Streaming | Chunked host bindings (risk of drops) | Native ReadableStream |
| Extension system | Rust trait objects (limited) | TypeScript modules (full Pi system) |
| Web UI | Separate, custom | pi-web-ui (existing Lit components) |
| MCP servers | WASM-compatible MCP (custom) | stdio via CatalystProc (standard) |
| LLM providers | Custom per-provider Rust code | pi-ai (22+ providers, existing) |
| Risk profile | 8 high/medium risks | 2 medium risks |
| Implementation phases | 8 phases | 6 phases |

The Pi path is strictly better for the browser context. ZeroClaw's strengths — <5MB RAM, <10ms cold start, trait-driven architecture — matter on servers. In the browser, TypeScript is the native language.

---

## 3. Pi.dev Package Inventory

### Core Packages

**@mariozechner/pi-ai** — Unified multi-provider LLM API.

What it does: Abstracts provider differences (OpenAI, Anthropic, Google, Ollama, OpenRouter, any OpenAI-compatible endpoint). Streaming via `ReadableStream`. Model selection via `getModel('provider', 'model-name')`. Thinking level shorthand (`sonnet:high`). Token estimation. Proxy support via `streamProxy()`. Custom stream functions via `streamFn`.

Browser compatibility: **Full.** Uses `fetch()` for all LLM calls. No Node.js dependencies. The `streamProxy` function routes through any URL. The `streamFn` override lets the host app inject its own LLM client.

Atua integration: Direct import via esm.sh. No adapter needed. The host application can optionally provide a `streamFn` to route Pi's LLM calls through its own backend.

**@mariozechner/pi-agent-core** — Agent runtime with tool calling and state management.

What it does: The `Agent` class — accepts a system prompt, model, tools, and optional configuration. Runs the agent loop: send messages to LLM, handle tool calls, feed results back, loop until done. Event streaming via `agent.subscribe()`. Tool definitions via TypeBox schemas. Steering (inject messages mid-turn) and follow-up (inject after turn) mechanisms. Context management via `transformContext()`. Custom message types via declaration merging. `convertToLlm()` for message filtering before LLM calls.

Browser compatibility: **Full.** Pure TypeScript. No I/O dependencies. The agent loop is async/await. Tool execution is a function call. Events are callbacks. All runs natively in browser.

Atua integration: Tools come from the MCP hub via `hub.listTools()`. Tool execution routes through `hub.callTool()`. No adapter needed for the agent loop itself — only for the tool source and executor.

**@mariozechner/pi-coding-agent** — Coding agent with built-in tools, sessions, extensions.

What it does: Wraps pi-agent-core with coding-specific defaults. Four built-in tools (read, write, edit, bash). Session persistence via `SessionManager` (in-memory or filesystem backends). Extension system — TypeScript modules that hook into lifecycle events (before LLM call, before compaction, on tool call, on session start). Skills system — on-demand capability packages. Prompt templates — reusable prompts expanded with `/name`. Package system — bundle extensions, skills, prompts, themes as npm packages. SDK mode via `createAgentSession()`.

Browser compatibility: **Partial.** The agent loop, extensions, skills, prompt templates, and SDK mode are pure TypeScript — browser-compatible. The built-in tools (read, write, edit, bash) call Node.js APIs — need adapters. The `SessionManager.filesystem` backend uses Node.js `fs` — needs an OPFS adapter. Package installation via `pi install` shells out — needs CatalystPkg adapter.

Atua integration: This is where the adapter layer lives. We replace the four built-in tools with Catalyst-backed implementations and add an OPFS session backend.

**@mariozechner/pi-web-ui** — Web components for AI chat interfaces.

What it does: Lit web components (built on mini-lit, their lightweight fork). `<chat-panel>` — complete chat interface with streaming, message history, file attachments, thinking display. `<agent-interface>` — lower-level component for custom layouts. `ModelSelector` — model picker overlay. Artifact rendering in sandboxed iframes (HTML, SVG, Markdown). Custom message renderers via `registerMessageRenderer()`. i18n support. Theming (including a Claude theme). `toolsFactory` for adding custom tools with runtime providers.

Browser compatibility: **Full.** These ARE browser components. Built for the browser. Lit renders in DOM natively.

Atua integration: Direct import and render. The components accept an `Agent` instance from pi-agent-core. Wire the agent to the hub, pass it to the components, everything works.

**@mariozechner/pi-tui** — Terminal UI library.

What it does: Terminal rendering with differential updates, markdown display with syntax highlighting, multi-line editor with autocomplete, loading spinners.

Browser compatibility: **Not applicable.** Terminal-specific. Not used in Atua.

Atua integration: Excluded. Pi-web-ui replaces it in browser context.

### Peripheral Packages

**@mariozechner/pi-mom** — Slack bot. Server-side. Not used in Atua.

**@mariozechner/pi-pods** — vLLM deployment CLI. Server-side. Not used in Atua, but the endpoints it creates are consumable by pi-ai if the user runs their own inference.

---

## 4. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                          Browser Tab                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Host Application                          │  │
│  │  (Bolt-like IDE, teaching platform, internal tool builder,   │  │
│  │   whatever product embeds Atua)                              │  │
│  │                                                              │  │
│  │  ┌──────────────────┐   ┌──────────────────────────────────┐│  │
│  │  │  Primary AI      │   │  Pi Agent (autonomous)           ││  │
│  │  │  (product's own  │   │                                  ││  │
│  │  │   LLM integration│   │  ┌────────────┐ ┌─────────────┐ ││  │
│  │  │   for user chat) │   │  │ pi-ai      │ │ pi-agent-   │ ││  │
│  │  │                  │   │  │ (LLM calls)│ │ core (loop) │ ││  │
│  │  │                  │   │  └─────┬──────┘ └──────┬───────┘ ││  │
│  │  │                  │   │        │               │         ││  │
│  │  │                  │   │  ┌─────┴───────────────┴───────┐ ││  │
│  │  │                  │   │  │ pi-coding-agent             │ ││  │
│  │  │                  │   │  │ (tools, sessions, extensions)│ ││  │
│  │  │                  │   │  └──────────────┬──────────────┘ ││  │
│  │  └──────────────────┘   └────────────────┬────────────────┘│  │
│  │                                          │                  │  │
│  │  ┌───────────────────────────────────────┴──────────────┐   │  │
│  │  │               @aspect/pi-atua                         │   │  │
│  │  │  (adapter layer: tools, sessions, memory, packages)   │   │  │
│  │  └───────────────────────────┬──────────────────────────┘   │  │
│  └──────────────────────────────┼──────────────────────────────┘  │
│                                 │                                  │
│  ┌──────────────────────────────┴──────────────────────────────┐  │
│  │                    Atua MCP Hub                              │  │
│  │                                                              │  │
│  │  catalyst.fs · catalyst.d1 · catalyst.build                  │  │
│  │  catalyst.proc · catalyst.pkg · catalyst.net                 │  │
│  │  catalyst.preview · catalyst.telemetry · catalyst.meta       │  │
│  │  pi.prompt · pi.session · pi.memory · pi.status              │  │
│  │  {installed-servers}.*                                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────┐ ┌───────────────┐ ┌─────────────────────────┐  │
│  │ pi-web-ui    │ │ CatalystFS    │ │ CatalystD1              │  │
│  │ (chat panel, │ │ (OPFS)        │ │ (wa-sqlite/OPFS)        │  │
│  │  artifacts)  │ │               │ │                         │  │
│  └──────────────┘ └───────────────┘ └─────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Data Flow: User Delegates Task to Pi

1. User is working in host application (e.g., Bolt-like IDE)
2. User or primary AI delegates a task: "Make this accessible and performant"
3. Host application calls `pi.prompt` via the MCP hub (or directly via Pi's SDK)
4. Pi's agent loop receives the message
5. Pi calls `hub.listTools()` — gets all available tools
6. Pi calls LLM via pi-ai (using its own provider config, or host app's shared client)
7. LLM responds with tool calls: read files, inspect DOM, check accessibility
8. Pi executes each tool via `hub.callTool()` — routed to Catalyst subsystems
9. Pi feeds tool results back to LLM, gets next action
10. Loop continues: edit files → build → preview → check metrics → verify
11. Pi stores relevant context in memory via CatalystD1
12. Pi returns final result
13. Host application shows result to user

### Data Flow: External Client Talks to Pi

1. Claude Desktop connects to Atua's MCP endpoint (StreamableHTTP)
2. Claude Desktop calls `pi.prompt({ message: "Review this codebase" })`
3. Hub routes to Pi provider via MessageChannel
4. Pi's agent loop runs autonomously — reads files, analyzes code, stores findings
5. Response flows back through hub → StreamableHTTP → Claude Desktop
6. Claude Desktop can also call `pi.memory.search` to see what Pi found
7. Claude Desktop can call `pi.session.history` to review the full conversation

---

## 5. Integration Layer: @aspect/pi-atua

This is the only new code. A thin adapter package that bridges Pi's expectations with Atua's capabilities. Everything else is Pi's existing packages used as-is.

### Package Structure

```
packages/pi-atua/
├── src/
│   ├── index.ts                 # Public API: createPiAgent(), PiAtua class
│   ├── tools/
│   │   ├── read.ts              # Read tool → catalyst.fs.read
│   │   ├── write.ts             # Write tool → catalyst.fs.write
│   │   ├── edit.ts              # Edit tool → catalyst.fs.read + catalyst.fs.write
│   │   ├── bash.ts              # Bash tool → catalyst.proc.spawn + wait
│   │   ├── grep.ts              # Grep tool → catalyst.fs.search
│   │   ├── find.ts              # Find tool → catalyst.fs.glob
│   │   ├── ls.ts                # Ls tool → catalyst.fs.readdir
│   │   └── hub-tools.ts         # Dynamic tools from MCP hub
│   ├── session/
│   │   ├── opfs-session.ts      # SessionManager backend → CatalystFS (OPFS)
│   │   └── d1-session.ts        # SessionManager backend → CatalystD1 (SQL)
│   ├── memory/
│   │   ├── memory-provider.ts   # MCP provider: pi.memory.*
│   │   ├── memory-store.ts      # CatalystD1 storage: FTS5 + vector
│   │   └── memory-schema.sql    # Table definitions
│   ├── provider/
│   │   ├── pi-provider.ts       # MCP provider: pi.prompt, pi.session.*, pi.status
│   │   └── registration.ts      # Hub registration logic
│   ├── packages/
│   │   └── browser-installer.ts # pi install → CatalystPkg
│   ├── auth/
│   │   └── browser-auth.ts      # AuthStorage → IndexedDB (encrypted)
│   └── web-ui/
│       └── atua-panel.ts        # Wrapper connecting pi-web-ui to Atua context
├── package.json
└── tsconfig.json
```

### Public API

```typescript
import { createPiAgent, PiAtua } from '@aspect/pi-atua';
import type { MCPHub } from '@aspect/catalyst-mcp';

// Simple: one function, agent ready
const pi = await createPiAgent({
  hub,                                    // Atua's MCP hub
  model: 'anthropic/claude-sonnet-4-5',   // or any pi-ai model string
  systemPrompt: 'You are a helpful coding assistant.',
  
  // Optional: use host app's LLM client
  streamFn: hostApp.llmClient,
  
  // Optional: configure memory
  memory: { enabled: true, maxEntries: 10000 },
  
  // Optional: load extensions
  extensions: ['./extensions/quality-gate.ts'],
  
  // Optional: configure capabilities
  capabilities: {
    fs: { scope: '/project', write: true },
    build: true,
    preview: true,
    proc: true,
    network: ['api.github.com', 'api.openai.com']
  }
});

// Pi is now:
// - Registered as MCP provider (pi.prompt, pi.session.*, pi.memory.*)
// - Subscribed to hub tools (catalyst.*, installed servers)
// - Ready to accept prompts
// - Web UI components available

// Talk to Pi directly
const response = await pi.prompt("Review the auth module for security issues");

// Or let external clients talk to Pi via hub
// (already registered — Claude Desktop can call pi.prompt)

// Access Pi's web UI components
const panel = pi.createChatPanel();
document.getElementById('agent-panel').appendChild(panel);

// Subscribe to Pi's events
pi.agent.subscribe((event) => {
  if (event.type === 'tool_call') {
    console.log(`Pi called: ${event.tool.name}`);
  }
});
```

### Full Control API

```typescript
// For host applications that want fine-grained control
const piAtua = new PiAtua({ hub });

// Configure LLM
piAtua.setModel('anthropic', 'claude-sonnet-4-5-20250929');
piAtua.setStreamFn(hostApp.llmClient);  // optional: share host's LLM
piAtua.setThinkingLevel('high');

// Configure tools
piAtua.addBuiltinTools();                 // read, write, edit, bash, grep, find, ls
piAtua.addHubTools();                     // all catalyst.* tools
piAtua.addHubTools({ namespace: 'github' }); // specific server's tools
piAtua.addCustomTool(myTool);            // app-specific tools

// Configure sessions
piAtua.setSessionBackend('d1');           // or 'opfs' or 'memory'

// Configure memory
piAtua.enableMemory({ maxEntries: 10000 });

// Load extensions
await piAtua.loadExtension('./extensions/auto-fix.ts');

// Register as MCP provider
piAtua.registerWithHub();

// Start the agent
const agent = await piAtua.createAgent({
  systemPrompt: 'You are a helpful coding assistant.'
});
```

---

## 6. Tool Mapping: Pi Tools → Catalyst Subsystems

Pi's built-in tools (read, write, edit, bash) assume a real filesystem and shell. The adapter maps them to Catalyst subsystems.

### Read Tool

```typescript
// Pi's native read tool: fs.readFile(path, 'utf-8')
// Atua adapter:

const readTool: AgentTool = {
  name: 'read',
  label: 'Read File',
  description: 'Read a file\'s contents',
  parameters: Type.Object({
    path: Type.String({ description: 'File path to read' }),
  }),
  execute: async (toolCallId, params, signal) => {
    const result = await hub.callTool('catalyst.fs.read', { 
      path: params.path 
    }, { caller: 'pi.agent' });
    
    return {
      content: [{ type: 'text', text: result.content }]
    };
  }
};
```

### Write Tool

```typescript
const writeTool: AgentTool = {
  name: 'write',
  label: 'Write File',
  description: 'Write content to a file, creating it if necessary',
  parameters: Type.Object({
    path: Type.String({ description: 'File path to write' }),
    content: Type.String({ description: 'Content to write' }),
  }),
  execute: async (toolCallId, params, signal) => {
    // Ensure parent directory exists
    const dir = params.path.substring(0, params.path.lastIndexOf('/'));
    if (dir) {
      await hub.callTool('catalyst.fs.mkdir', { 
        path: dir, recursive: true 
      }, { caller: 'pi.agent' });
    }
    
    await hub.callTool('catalyst.fs.write', {
      path: params.path,
      content: params.content
    }, { caller: 'pi.agent' });
    
    return {
      content: [{ type: 'text', text: `Wrote ${params.content.length} bytes to ${params.path}` }]
    };
  }
};
```

### Edit Tool

```typescript
const editTool: AgentTool = {
  name: 'edit',
  label: 'Edit File',
  description: 'Apply a targeted edit to an existing file',
  parameters: Type.Object({
    path: Type.String({ description: 'File path to edit' }),
    old_string: Type.String({ description: 'Exact string to find and replace' }),
    new_string: Type.String({ description: 'Replacement string' }),
  }),
  execute: async (toolCallId, params, signal) => {
    // Read current content
    const result = await hub.callTool('catalyst.fs.read', {
      path: params.path
    }, { caller: 'pi.agent' });
    
    const content = result.content as string;
    
    // Validate: old_string must appear exactly once
    const occurrences = content.split(params.old_string).length - 1;
    if (occurrences === 0) {
      return {
        content: [{ type: 'text', text: `Error: "${params.old_string}" not found in ${params.path}` }],
        isError: true
      };
    }
    if (occurrences > 1) {
      return {
        content: [{ type: 'text', text: `Error: "${params.old_string}" found ${occurrences} times in ${params.path}. Must be unique.` }],
        isError: true
      };
    }
    
    // Apply edit
    const newContent = content.replace(params.old_string, params.new_string);
    await hub.callTool('catalyst.fs.write', {
      path: params.path,
      content: newContent
    }, { caller: 'pi.agent' });
    
    return {
      content: [{ type: 'text', text: `Edited ${params.path}` }]
    };
  }
};
```

### Bash Tool

```typescript
const bashTool: AgentTool = {
  name: 'bash',
  label: 'Run Command',
  description: 'Execute a shell command',
  parameters: Type.Object({
    command: Type.String({ description: 'Command to execute' }),
    timeout: Type.Optional(Type.Number({ description: 'Timeout in milliseconds' })),
  }),
  execute: async (toolCallId, params, signal) => {
    // Parse command into program + args
    // CatalystProc handles this via its shell parser
    const proc = await hub.callTool('catalyst.proc.spawn', {
      command: '/bin/sh',
      args: ['-c', params.command],
      cwd: '/project'
    }, { caller: 'pi.agent' });
    
    const result = await hub.callTool('catalyst.proc.wait', {
      pid: proc.pid,
      timeout_ms: params.timeout || 30000
    }, { caller: 'pi.agent' });
    
    return {
      content: [{ type: 'text', text: result.output }]
    };
  }
};
```

### Additional Tools: grep, find, ls

```typescript
// These map directly to Catalyst tools
const grepTool: AgentTool = {
  name: 'grep',
  label: 'Search Files',
  description: 'Search file contents for a pattern',
  parameters: Type.Object({
    pattern: Type.String({ description: 'Search pattern (regex)' }),
    path: Type.Optional(Type.String({ description: 'Directory to search in' })),
  }),
  execute: async (toolCallId, params, signal) => {
    const result = await hub.callTool('catalyst.fs.search', {
      pattern: params.pattern,
      path: params.path || '/project'
    }, { caller: 'pi.agent' });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
};

const findTool: AgentTool = {
  name: 'find',
  label: 'Find Files',
  description: 'Find files matching a glob pattern',
  parameters: Type.Object({
    pattern: Type.String({ description: 'Glob pattern' }),
    cwd: Type.Optional(Type.String({ description: 'Starting directory' })),
  }),
  execute: async (toolCallId, params, signal) => {
    const result = await hub.callTool('catalyst.fs.glob', {
      pattern: params.pattern,
      cwd: params.cwd || '/project'
    }, { caller: 'pi.agent' });
    return { content: [{ type: 'text', text: result.paths.join('\n') }] };
  }
};

const lsTool: AgentTool = {
  name: 'ls',
  label: 'List Directory',
  description: 'List files in a directory',
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: 'Directory path' })),
  }),
  execute: async (toolCallId, params, signal) => {
    const result = await hub.callTool('catalyst.fs.readdir', {
      path: params.path || '/project'
    }, { caller: 'pi.agent' });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
};
```

### Hub Tools: Dynamic Discovery

Beyond the built-in tools, Pi automatically gets every tool on the hub.

```typescript
// @aspect/pi-atua discovers all hub tools and registers them with Pi
async function addHubTools(agent: Agent, hub: MCPHub, filter?: { namespace?: string }) {
  const allTools = await hub.listTools(filter);
  
  for (const tool of allTools) {
    // Skip tools we've already mapped as built-ins
    if (['catalyst.fs.read', 'catalyst.fs.write', /* etc */].includes(tool.name)) continue;
    
    // Create a Pi AgentTool that delegates to the hub
    const agentTool: AgentTool = {
      name: tool.name,
      label: tool.name.split('.').pop() || tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      execute: async (toolCallId, params, signal) => {
        const result = await hub.callTool(tool.name, params, { caller: 'pi.agent' });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        };
      }
    };
    
    agent.addTool(agentTool);
  }
}
```

This means Pi automatically gets access to: `catalyst.build.run`, `catalyst.preview.dom.query`, `catalyst.preview.dom.accessibility`, `catalyst.telemetry.webvitals`, `catalyst.d1.query`, `catalyst.pkg.install`, and every tool from every installed MCP server. No configuration. The hub is the source of truth.

---

## 7. LLM Routing: Three Modes

Pi-ai handles LLM calls. Inside Atua, there are three ways to configure where those calls go.

### Mode 1: Pi's Own Provider (Independent)

Pi manages its own API keys and provider configuration. The user enters their API key in Pi's setup flow (or the host application's settings). Pi calls the LLM directly via `fetch()`.

```typescript
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  // Pi calls Anthropic directly via pi-ai's fetch-based client
  // API key stored encrypted in IndexedDB via AuthStorage.create()
});
```

**When to use:** Standalone deployments. The user is running Pi as the primary agent. No host application backend. API keys stay in the browser.

### Mode 2: Host Application's LLM Client (Shared)

The host application already has an LLM backend — a proxy server that handles API keys, rate limiting, billing. Pi routes its LLM calls through the same backend via `streamFn`.

```typescript
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  streamFn: (model, context, options) => 
    streamProxy(model, context, {
      ...options,
      proxyUrl: 'https://api.bolt-like-product.com/llm',
      authToken: hostApp.sessionToken
    })
});
```

**When to use:** Bolt-like products, internal tools, any product that already has LLM infrastructure. The product controls billing, rate limits, model access. Pi uses the same pipe.

### Mode 3: Host Application's Function (Direct Injection)

The host application has a JavaScript function that makes LLM calls. Pi uses it directly. No proxy URL needed.

```typescript
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  streamFn: async (model, context, options) => {
    // Host app's existing LLM client
    return hostApp.completionStream({
      model: model.id,
      messages: context.messages,
      tools: context.tools,
      maxTokens: options.maxTokens,
      signal: options.signal
    });
  }
});
```

**When to use:** When the host application's LLM client is in the same browser context. No network hop. The function returns an AsyncIterable of streaming chunks.

### Model Selection

Regardless of routing mode, pi-ai's model selection works. The host can constrain which models Pi uses:

```typescript
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  allowedModels: [
    'anthropic/claude-sonnet-4-5-*',
    'anthropic/claude-haiku-4-5-*'
  ],
  // Pi can switch between these but not escape to other models
});
```

Or give Pi full freedom:

```typescript
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5-20250929',
  // No allowedModels constraint — Pi can use any model pi-ai supports
});
```

Pi can also use different models for different tasks via its extension system:

```typescript
// Extension that routes to cheaper models for routine operations
export default function costOptimizer(api: ExtensionAPI) {
  api.on('before_llm_call', (event, ctx) => {
    const lastMessage = ctx.messages[ctx.messages.length - 1];
    
    // Routine tool result processing → cheap model
    if (lastMessage.role === 'toolResult') {
      ctx.model = getModel('anthropic', 'claude-haiku-4-5-20251001');
    }
    // Complex reasoning → expensive model  
    if (ctx.messages.some(m => m.content?.includes('debug') || m.content?.includes('refactor'))) {
      ctx.model = getModel('anthropic', 'claude-sonnet-4-5-20250929');
    }
  });
}
```

---

## 8. Session Persistence

Pi has a `SessionManager` interface with pluggable backends. We add two browser-native backends.

### OPFS Backend (File-Based)

Sessions stored as JSON files in CatalystFS. Simple, inspectable, familiar to Pi users.

```typescript
import { SessionManager } from '@mariozechner/pi-coding-agent';

class OPFSSessionManager implements SessionManager {
  private basePath: string;
  
  constructor(private hub: MCPHub, basePath = '/.pi/sessions') {
    this.basePath = basePath;
  }
  
  async save(sessionId: string, data: SessionData): Promise<void> {
    const path = `${this.basePath}/${sessionId}.json`;
    await this.hub.callTool('catalyst.fs.write', {
      path,
      content: JSON.stringify(data, null, 2)
    }, { caller: 'pi.session' });
  }
  
  async load(sessionId: string): Promise<SessionData | null> {
    try {
      const result = await this.hub.callTool('catalyst.fs.read', {
        path: `${this.basePath}/${sessionId}.json`
      }, { caller: 'pi.session' });
      return JSON.parse(result.content as string);
    } catch {
      return null;
    }
  }
  
  async list(): Promise<SessionInfo[]> {
    const result = await this.hub.callTool('catalyst.fs.readdir', {
      path: this.basePath
    }, { caller: 'pi.session' });
    
    const sessions: SessionInfo[] = [];
    for (const entry of result.entries) {
      if (entry.name.endsWith('.json')) {
        const data = await this.load(entry.name.replace('.json', ''));
        if (data) {
          sessions.push({
            id: data.id,
            title: data.title,
            updatedAt: data.updatedAt,
            messageCount: data.messages.length
          });
        }
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  
  async delete(sessionId: string): Promise<void> {
    await this.hub.callTool('catalyst.fs.unlink', {
      path: `${this.basePath}/${sessionId}.json`
    }, { caller: 'pi.session' });
  }
}
```

### D1 Backend (SQL-Based)

Sessions stored in CatalystD1. Better for querying, searching, and handling large numbers of sessions.

```typescript
class D1SessionManager implements SessionManager {
  private initialized = false;
  
  constructor(private hub: MCPHub) {}
  
  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    
    await this.hub.callTool('catalyst.d1.execute', {
      sql: `CREATE TABLE IF NOT EXISTS pi_sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    }, { caller: 'pi.session' });
    
    await this.hub.callTool('catalyst.d1.execute', {
      sql: `CREATE INDEX IF NOT EXISTS idx_sessions_updated 
            ON pi_sessions(updated_at DESC)`
    }, { caller: 'pi.session' });
    
    this.initialized = true;
  }
  
  async save(sessionId: string, data: SessionData): Promise<void> {
    await this.ensureSchema();
    await this.hub.callTool('catalyst.d1.execute', {
      sql: `INSERT OR REPLACE INTO pi_sessions (id, title, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      params: [sessionId, data.title, JSON.stringify(data), data.createdAt, Date.now()]
    }, { caller: 'pi.session' });
  }
  
  async load(sessionId: string): Promise<SessionData | null> {
    await this.ensureSchema();
    const result = await this.hub.callTool('catalyst.d1.query', {
      sql: 'SELECT data FROM pi_sessions WHERE id = ?',
      params: [sessionId]
    }, { caller: 'pi.session' });
    
    if (result.rows.length === 0) return null;
    return JSON.parse(result.rows[0].data);
  }
  
  async list(): Promise<SessionInfo[]> {
    await this.ensureSchema();
    const result = await this.hub.callTool('catalyst.d1.query', {
      sql: 'SELECT id, title, updated_at, json_array_length(json_extract(data, "$.messages")) as msg_count FROM pi_sessions ORDER BY updated_at DESC',
      params: []
    }, { caller: 'pi.session' });
    
    return result.rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      messageCount: row.msg_count
    }));
  }
  
  async delete(sessionId: string): Promise<void> {
    await this.ensureSchema();
    await this.hub.callTool('catalyst.d1.execute', {
      sql: 'DELETE FROM pi_sessions WHERE id = ?',
      params: [sessionId]
    }, { caller: 'pi.session' });
  }
}
```

### Which Backend to Use

The host application chooses:

```typescript
const pi = await createPiAgent({
  hub,
  model: '...',
  sessionBackend: 'opfs',  // or 'd1' or 'memory'
});
```

`opfs` is simpler, good for small numbers of sessions, files are inspectable via DevTools. `d1` is better for many sessions, supports search, and handles concurrent access. `memory` is ephemeral, for testing or stateless deployments.

---

## 9. Memory System

Pi doesn't have persistent memory. This is the biggest capability Atua adds. The memory system gives Pi long-term recall across sessions.

### Schema

```sql
-- Core memory table
CREATE TABLE IF NOT EXISTS pi_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,                    -- LLM-generated summary for quick scanning
  embedding BLOB,                  -- Float32Array serialized as bytes
  importance REAL DEFAULT 0.5,     -- 0.0 to 1.0, affects retrieval ranking
  category TEXT,                   -- 'fact', 'preference', 'decision', 'context'
  source_session TEXT,             -- which session created this memory
  created_at INTEGER NOT NULL,
  accessed_at INTEGER NOT NULL,    -- updated on each retrieval
  access_count INTEGER DEFAULT 0   -- frequency tracking
);

-- FTS5 index for keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS pi_memories_fts USING fts5(
  content, summary,
  content='pi_memories',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS pi_memories_ai AFTER INSERT ON pi_memories BEGIN
  INSERT INTO pi_memories_fts(rowid, content, summary) 
  VALUES (new.rowid, new.content, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS pi_memories_ad AFTER DELETE ON pi_memories BEGIN
  INSERT INTO pi_memories_fts(pi_memories_fts, rowid, content, summary) 
  VALUES ('delete', old.rowid, old.content, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS pi_memories_au AFTER UPDATE ON pi_memories BEGIN
  INSERT INTO pi_memories_fts(pi_memories_fts, rowid, content, summary) 
  VALUES ('delete', old.rowid, old.content, old.summary);
  INSERT INTO pi_memories_fts(rowid, content, summary) 
  VALUES (new.rowid, new.content, new.summary);
END;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memories_category ON pi_memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON pi_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON pi_memories(accessed_at DESC);
```

### Memory Store Implementation

```typescript
class PiMemoryStore {
  private initialized = false;
  
  constructor(private hub: MCPHub) {}
  
  async store(entry: MemoryEntry): Promise<void> {
    await this.ensureSchema();
    
    const id = crypto.randomUUID();
    const embedding = entry.embedding 
      ? new Uint8Array(new Float32Array(entry.embedding).buffer) 
      : null;
    
    await this.hub.callTool('catalyst.d1.execute', {
      sql: `INSERT INTO pi_memories (id, content, summary, embedding, importance, category, source_session, created_at, accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, entry.content, entry.summary || null, embedding,
        entry.importance || 0.5, entry.category || 'context',
        entry.sessionId || null, Date.now(), Date.now()
      ]
    }, { caller: 'pi.memory' });
  }
  
  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    await this.ensureSchema();
    
    const limit = options?.limit || 10;
    const category = options?.category;
    
    // Hybrid search: FTS5 keyword matching + recency + importance weighting
    let sql = `
      SELECT m.*, bm25(pi_memories_fts) as text_score
      FROM pi_memories m
      JOIN pi_memories_fts fts ON m.rowid = fts.rowid
      WHERE pi_memories_fts MATCH ?
    `;
    const params: any[] = [query];
    
    if (category) {
      sql += ' AND m.category = ?';
      params.push(category);
    }
    
    // Composite score: text relevance * importance * recency decay
    sql += `
      ORDER BY (
        text_score * -1.0 * m.importance * 
        (1.0 / (1.0 + (? - m.accessed_at) / 86400000.0))
      ) DESC
      LIMIT ?
    `;
    params.push(Date.now(), limit);
    
    const result = await this.hub.callTool('catalyst.d1.query', {
      sql, params
    }, { caller: 'pi.memory' });
    
    // Update access tracking for returned results
    if (result.rows.length > 0) {
      const ids = result.rows.map((r: any) => r.id);
      await this.hub.callTool('catalyst.d1.execute', {
        sql: `UPDATE pi_memories SET accessed_at = ?, access_count = access_count + 1 
              WHERE id IN (${ids.map(() => '?').join(',')})`,
        params: [Date.now(), ...ids]
      }, { caller: 'pi.memory' });
    }
    
    return result.rows.map(this.rowToEntry);
  }
  
  async forget(id: string): Promise<void> {
    await this.hub.callTool('catalyst.d1.execute', {
      sql: 'DELETE FROM pi_memories WHERE id = ?',
      params: [id]
    }, { caller: 'pi.memory' });
  }
  
  async compact(options?: CompactOptions): Promise<void> {
    // Remove low-importance, rarely-accessed old memories
    const threshold = options?.olderThanDays || 90;
    const minImportance = options?.minImportance || 0.3;
    const maxEntries = options?.maxEntries || 10000;
    
    // Count current entries
    const countResult = await this.hub.callTool('catalyst.d1.query', {
      sql: 'SELECT COUNT(*) as count FROM pi_memories',
      params: []
    }, { caller: 'pi.memory' });
    
    if (countResult.rows[0].count > maxEntries) {
      // Delete oldest, least important, least accessed entries
      await this.hub.callTool('catalyst.d1.execute', {
        sql: `DELETE FROM pi_memories WHERE id IN (
          SELECT id FROM pi_memories 
          WHERE importance < ? AND accessed_at < ?
          ORDER BY (importance * access_count) ASC
          LIMIT ?
        )`,
        params: [
          minImportance,
          Date.now() - (threshold * 86400000),
          countResult.rows[0].count - maxEntries
        ]
      }, { caller: 'pi.memory' });
    }
  }
  
  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      content: row.content,
      summary: row.summary,
      importance: row.importance,
      category: row.category,
      sessionId: row.source_session,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count
    };
  }
}
```

### Memory Extension

Pi's extension system integrates memory into the agent loop:

```typescript
// Auto-memory extension: stores important context after each conversation turn
export default function autoMemory(api: ExtensionAPI) {
  const memoryStore = api.context.memoryStore; // PiMemoryStore instance
  
  // After each assistant response, extract memorable facts
  api.on('after_response', async (event, ctx) => {
    const lastAssistantMessage = ctx.messages
      .filter(m => m.role === 'assistant')
      .pop();
    
    if (!lastAssistantMessage) return;
    
    // Ask a cheap model to extract facts worth remembering
    const extraction = await api.context.extractMemories(lastAssistantMessage.content);
    
    for (const memory of extraction.memories) {
      await memoryStore.store({
        content: memory.content,
        summary: memory.summary,
        importance: memory.importance,
        category: memory.category,
        sessionId: ctx.session.id
      });
    }
  });
  
  // Before each LLM call, inject relevant memories
  api.on('before_llm_call', async (event, ctx) => {
    const lastUserMessage = ctx.messages
      .filter(m => m.role === 'user')
      .pop();
    
    if (!lastUserMessage) return;
    
    // Search memory for context relevant to the user's message
    const memories = await memoryStore.search(
      typeof lastUserMessage.content === 'string' 
        ? lastUserMessage.content 
        : 'recent context',
      { limit: 5 }
    );
    
    if (memories.length > 0) {
      // Inject memories as a system message before the conversation
      const memoryContext = memories
        .map(m => `[Memory: ${m.summary || m.content}]`)
        .join('\n');
      
      ctx.messages.unshift({
        role: 'user',
        content: `<relevant_memories>\n${memoryContext}\n</relevant_memories>`,
        timestamp: Date.now()
      });
    }
  });
}
```

---

## 10. Extensions in Browser Context

Pi's extension system is TypeScript modules that hook into lifecycle events. They work unchanged in the browser — the extension API is pure TypeScript with no I/O dependencies.

### What Works Unchanged

- **Lifecycle hooks:** `before_llm_call`, `after_response`, `on_tool_call`, `on_session_start`, `before_compaction` — all fire the same way.
- **Context manipulation:** `transformContext()`, `convertToLlm()` — pure function transformations, no I/O.
- **Tool gating:** Extensions can intercept tool calls and allow/deny them based on rules.
- **Message injection:** Extensions can add messages to the context before LLM calls.
- **Custom compaction:** Extensions can replace the default context compaction with custom logic.

### What Needs Adaptation

**Loading extensions from the filesystem.** Pi loads extensions from `~/.pi/agent/extensions/` or `.pi/extensions/`. In Atua, these paths map to CatalystFS:

```typescript
class BrowserExtensionLoader {
  constructor(private hub: MCPHub) {}
  
  async loadExtension(path: string): Promise<ExtensionModule> {
    // Read the extension source from CatalystFS
    const source = await this.hub.callTool('catalyst.fs.read', {
      path
    }, { caller: 'pi.extensions' });
    
    // Compile via esbuild-wasm
    const compiled = await this.hub.callTool('catalyst.build.run', {
      entryPoints: [path],
      format: 'esm',
      bundle: true
    }, { caller: 'pi.extensions' });
    
    // Create a blob URL and dynamically import
    const blob = new Blob([compiled.output], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const module = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);
    
    return module.default;
  }
}
```

**Extensions that shell out.** Some extensions might call `child_process.exec()`. In Atua, these route to `catalyst.proc.spawn` via the hub. Extensions that use Pi's built-in `bash` tool automatically get this — the bash tool already maps to CatalystProc.

### Atua-Specific Extensions

Extensions that leverage Atua's unique capabilities:

```typescript
// Quality gate extension: auto-checks builds and previews
export default function qualityGate(api: ExtensionAPI) {
  api.on('on_tool_call', async (event, ctx) => {
    // After any file write, auto-build and check
    if (event.tool.name === 'write' || event.tool.name === 'edit') {
      const buildResult = await ctx.hub.callTool('catalyst.build.run', {});
      
      if (!buildResult.success) {
        // Inject build errors as steering message
        api.steer({
          role: 'user',
          content: `Build failed after your edit:\n${buildResult.errors.join('\n')}\nPlease fix.`,
          timestamp: Date.now()
        });
      }
    }
  });
}
```

```typescript
// Accessibility checker: validates every preview change
export default function a11yChecker(api: ExtensionAPI) {
  api.on('after_response', async (event, ctx) => {
    // If the agent made file changes in this turn, check accessibility
    const toolCalls = ctx.messages.filter(m => m.role === 'toolResult');
    const hadFileChanges = toolCalls.some(m => 
      m.toolName === 'write' || m.toolName === 'edit'
    );
    
    if (hadFileChanges) {
      const a11y = await ctx.hub.callTool('catalyst.preview.dom.accessibility', {});
      const issues = findA11yIssues(a11y);
      
      if (issues.length > 0) {
        api.followUp({
          role: 'user',
          content: `Accessibility issues found:\n${issues.join('\n')}\nPlease fix these.`,
          timestamp: Date.now()
        });
      }
    }
  });
}
```

```typescript
// Performance monitor: watches Web Vitals and alerts on regressions
export default function perfMonitor(api: ExtensionAPI) {
  let lastMetrics: any = null;
  
  api.on('after_response', async (event, ctx) => {
    const metrics = await ctx.hub.callTool('catalyst.telemetry.webvitals', {});
    
    if (lastMetrics) {
      const clsDelta = metrics.CLS - lastMetrics.CLS;
      const lcpDelta = metrics.LCP - lastMetrics.LCP;
      
      if (clsDelta > 0.05 || lcpDelta > 500) {
        api.followUp({
          role: 'user',
          content: `Performance regression detected: CLS went from ${lastMetrics.CLS} to ${metrics.CLS}, LCP from ${lastMetrics.LCP}ms to ${metrics.LCP}ms. Please investigate.`,
          timestamp: Date.now()
        });
      }
    }
    
    lastMetrics = metrics;
  });
}
```

---

## 11. Skills & Prompt Templates

Pi's skills system — on-demand capability packages that add instructions and tools without bloating the system prompt — works in Atua with CatalystFS as the storage backend.

### Skill Loading

Skills are markdown files with YAML frontmatter. Pi loads them from `~/.pi/agent/skills/` or `.pi/skills/`. In Atua, these paths exist in CatalystFS:

```typescript
class BrowserSkillLoader {
  constructor(private hub: MCPHub) {}
  
  async listSkills(): Promise<SkillInfo[]> {
    const paths = [
      '/.pi/agent/skills',
      '/project/.pi/skills'
    ];
    
    const skills: SkillInfo[] = [];
    for (const basePath of paths) {
      try {
        const entries = await this.hub.callTool('catalyst.fs.readdir', {
          path: basePath
        }, { caller: 'pi.skills' });
        
        for (const entry of entries.entries) {
          if (entry.name.endsWith('.md')) {
            const content = await this.hub.callTool('catalyst.fs.read', {
              path: `${basePath}/${entry.name}`
            }, { caller: 'pi.skills' });
            
            const parsed = parseSkillFrontmatter(content.content);
            skills.push(parsed);
          }
        }
      } catch {
        // Directory doesn't exist — that's fine
      }
    }
    
    return skills;
  }
}
```

### Prompt Templates

Same pattern — markdown files loaded from CatalystFS. Users type `/template-name` to expand.

### Pre-installed Skills

`@aspect/pi-atua` ships with Atua-specific skills:

```markdown
---
name: atua-preview
description: Use Atua's preview system to inspect and validate UI
trigger: When asked to check, validate, or inspect a preview or UI
---

# Atua Preview Inspection

You have access to real DOM inspection tools. Use these instead of guessing.

## Available Tools

- `catalyst.preview.dom.query(selector)` — Get computed styles, bounding rects, accessibility info
- `catalyst.preview.dom.accessibility()` — Full accessibility tree
- `catalyst.preview.metrics()` — Real Web Vitals (LCP, FID, CLS)
- `catalyst.preview.errors()` — Runtime errors

## When to Use

After any file change that affects UI:
1. Build: `catalyst.build.run()`
2. Start preview: `catalyst.preview.start()`
3. Inspect: `catalyst.preview.dom.query('.your-element')`
4. Check metrics: `catalyst.preview.metrics()`
5. Check accessibility: `catalyst.preview.dom.accessibility()`

Do NOT guess from code what the UI looks like. Query it.
```

```markdown
---
name: atua-database
description: Use Atua's SQLite database for persistent data
trigger: When asked to work with a database, store data, or query data
---

# Atua Database (CatalystD1)

You have access to a full SQLite database with FTS5 support.

## Available Tools

- `catalyst.d1.execute(sql, params)` — Run INSERT/UPDATE/DELETE
- `catalyst.d1.query(sql, params)` — Run SELECT, returns rows
- `catalyst.d1.tables()` — List all tables
- `catalyst.d1.describe(table)` — Get table schema

## Best Practices

- Always use parameterized queries (`?` placeholders)
- Create indexes for columns you'll query frequently
- Use FTS5 for text search: `CREATE VIRTUAL TABLE x_fts USING fts5(column)`
- Data persists across sessions in OPFS
```

---

## 12. Pi as MCP Provider

Pi registers on the hub so external clients and other consumers can interact with it.

### Registration

```typescript
function registerPiProvider(hub: MCPHub, agent: Agent, memoryStore: PiMemoryStore, sessionManager: SessionManager) {
  hub.registerProvider({
    namespace: 'pi',
    transport: new MessageChannelTransport(),
    tools: [
      // === Agent Interaction ===
      {
        name: 'pi.prompt',
        description: 'Send a message to the Pi agent and get a streaming response',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to send' },
            session_id: { type: 'string', description: 'Session ID for continuity. Omit for new session.' },
            model: { type: 'string', description: 'Override model for this request' },
            thinking: { type: 'string', enum: ['off', 'low', 'medium', 'high'], description: 'Thinking level' }
          },
          required: ['message']
        }
      },
      {
        name: 'pi.cancel',
        description: 'Cancel the currently running agent operation',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'pi.status',
        description: 'Get current agent status',
        inputSchema: { type: 'object', properties: {} }
        // Returns: { state: 'idle' | 'thinking' | 'tool_calling' | 'streaming', 
        //            currentTool?: string, sessionId?: string, tokenUsage?: object }
      },
      
      // === Session Management ===
      {
        name: 'pi.session.list',
        description: 'List all saved agent sessions',
        inputSchema: { type: 'object', properties: {
          limit: { type: 'number', description: 'Max results' },
          offset: { type: 'number', description: 'Pagination offset' }
        }}
      },
      {
        name: 'pi.session.history',
        description: 'Get full conversation history for a session',
        inputSchema: {
          type: 'object',
          properties: { session_id: { type: 'string' } },
          required: ['session_id']
        }
      },
      {
        name: 'pi.session.delete',
        description: 'Delete a session',
        inputSchema: {
          type: 'object',
          properties: { session_id: { type: 'string' } },
          required: ['session_id']
        }
      },
      {
        name: 'pi.session.resume',
        description: 'Resume a previous session (load its context)',
        inputSchema: {
          type: 'object',
          properties: { session_id: { type: 'string' } },
          required: ['session_id']
        }
      },
      
      // === Memory ===
      {
        name: 'pi.memory.search',
        description: 'Search agent memory for relevant context',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            category: { type: 'string', enum: ['fact', 'preference', 'decision', 'context'] },
            limit: { type: 'number' }
          },
          required: ['query']
        }
      },
      {
        name: 'pi.memory.store',
        description: 'Manually store a memory entry',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            summary: { type: 'string' },
            category: { type: 'string', enum: ['fact', 'preference', 'decision', 'context'] },
            importance: { type: 'number', minimum: 0, maximum: 1 }
          },
          required: ['content']
        }
      },
      {
        name: 'pi.memory.forget',
        description: 'Delete a specific memory entry',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id']
        }
      },
      
      // === Extensions & Configuration ===
      {
        name: 'pi.extensions.list',
        description: 'List loaded extensions',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'pi.config.get',
        description: 'Get current agent configuration',
        inputSchema: { type: 'object', properties: {} }
        // Returns: model, thinking level, loaded extensions, tools, capabilities
      }
    ]
  });
}
```

### What External Clients Can Do

With Pi registered, Claude Desktop (or any MCP client) connecting to Atua can:

- **Talk to the agent:** `pi.prompt({ message: "Review the auth module" })` — Pi runs autonomously, returns when done.
- **Resume sessions:** `pi.session.resume({ session_id: "abc" })` then `pi.prompt(...)` — continues a previous conversation.
- **Inspect memory:** `pi.memory.search({ query: "auth security" })` — see what Pi remembers about auth security.
- **Check status:** `pi.status()` — is Pi idle? Currently using a tool? Which tool?
- **Review history:** `pi.session.history({ session_id: "abc" })` — read the full conversation.

---

## 13. Pi as MCP Consumer

Pi discovers and uses tools from the MCP hub. This is the other direction — Pi calling out to everything Atua provides.

### Tool Discovery

```typescript
// On initialization, Pi gets all available tools
const allTools = await hub.listTools();

// Pi sees:
// catalyst.fs.read, catalyst.fs.write, catalyst.fs.mkdir, ...
// catalyst.d1.query, catalyst.d1.execute, ...
// catalyst.build.run, catalyst.build.analyze, ...
// catalyst.preview.start, catalyst.preview.dom.query, ...
// catalyst.telemetry.webvitals, catalyst.telemetry.resources, ...
// github.search_repos, github.create_issue, ...  (if GitHub MCP server installed)
// supabase.query, supabase.insert, ...  (if Supabase MCP server installed)
```

### Tool Refresh

When new MCP servers are installed or removed, Pi's tool list updates:

```typescript
// Hub emits events when providers change
hub.on('provider_registered', (provider) => {
  const newTools = provider.tools.map(t => createAgentTool(t, hub));
  agent.addTools(newTools);
});

hub.on('provider_unregistered', (namespace) => {
  agent.removeTools(t => t.name.startsWith(namespace + '.'));
});
```

Pi never goes stale. Install a new MCP server → Pi can use it immediately.

### Tool Selection in System Prompt

With potentially hundreds of tools available, the system prompt needs to guide Pi on when to use what:

```typescript
const systemPrompt = `You are an autonomous coding agent running inside Atua, a browser-native runtime.

You have access to tools organized by namespace:

**File operations:** catalyst.fs.* — Read, write, edit, search files
**Build pipeline:** catalyst.build.* — Compile, analyze, check for errors
**Preview & DOM:** catalyst.preview.* — Start preview, inspect DOM, check accessibility
**Performance:** catalyst.telemetry.* — Web Vitals, resource timing, memory usage
**Database:** catalyst.d1.* — SQLite with FTS5, persistent storage
**Packages:** catalyst.pkg.* — Install npm packages
**Processes:** catalyst.proc.* — Run commands

When modifying UI code, ALWAYS:
1. Write the changes (write/edit tools)
2. Build (catalyst.build.run)
3. Inspect the result (catalyst.preview.dom.query)
4. Check metrics (catalyst.telemetry.webvitals)

Do NOT guess what the UI looks like. Query it with DOM tools.`;
```

---

## 14. Pi's MCP Servers in Atua Workers

Pi supports MCP servers via its `mcp.json` configuration. Inside Atua, these servers run in CatalystProc Workers with stdio over MessageChannel.

### How It Works

Pi's MCP adapter expects stdio transport — read JSON-RPC from stdin, write to stdout. CatalystProc provides exactly this via MessageChannel-backed streams. The server doesn't know it's in a browser.

```json
// /project/.pi/mcp.json — works inside Atua unchanged
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "/project/data.db"]
    }
  }
}
```

### Resolution Flow

1. Pi reads `mcp.json` from CatalystFS
2. For each server entry, Pi calls `catalyst.meta.install_server` via the hub
3. Atua resolves the npm package via CatalystPkg (esm.sh, OPFS cache)
4. Atua spawns a Worker via CatalystProc with capability-gated access
5. Worker gets stdin/stdout as MessageChannel streams
6. MCP server starts, writes initialization to stdout
7. Hub discovers the server's tools, registers under configured namespace
8. Pi's agent can now call the server's tools via the hub

### Dual Registration

Pi's servers register on the hub, not just with Pi. This means:
- Pi can call them (via hub routing)
- External clients can call them (via StreamableHTTP)
- Other consumers in Atua can call them (via MessageChannel)
- The host application's primary AI can call them too

One server installation, universal access.

---

## 15. Pi Web UI Integration

Pi-web-ui is already browser-native. Integration is straightforward.

### Direct Usage

```typescript
import { ChatPanel } from '@mariozechner/pi-web-ui';
import { Agent } from '@mariozechner/pi-agent-core';

// Create the agent (wired to Atua's hub)
const agent = await createPiAgent({ hub, model: '...' });

// Create the chat panel
const panel = document.createElement('chat-panel') as ChatPanel;
panel.agent = agent.rawAgent;  // pi-agent-core Agent instance
panel.enableAttachments = true;
panel.enableModelSelector = true;
panel.enableThinkingSelector = true;

// Handle events
panel.onApiKeyRequired = async (provider) => {
  // Show API key dialog or use host app's key
};

panel.onBeforeSend = async () => {
  // Pre-processing before each message
};

// Mount
document.getElementById('pi-panel').appendChild(panel);
```

### Artifact Rendering

Pi-web-ui renders artifacts (HTML, SVG, Markdown) in sandboxed iframes. Inside Atua, these artifacts can use the preview system:

```typescript
panel.sandboxUrlProvider = () => {
  // Use Atua's preview system for artifact sandboxing
  return hub.callTool('catalyst.preview.start', {}).then(r => r.url);
};
```

### Custom Tools Factory

Pi-web-ui supports custom tools that render in the UI:

```typescript
panel.toolsFactory = (agent, agentInterface, artifactsPanel, runtimeProvidersFactory) => {
  // Add a JavaScript REPL tool that runs in Atua's preview
  const replTool = createJavaScriptReplTool();
  replTool.runtimeProvidersFactory = runtimeProvidersFactory;
  return [replTool];
};
```

### Theming

Pi-web-ui supports themes. The host application can apply its own theme or use Pi's defaults:

```css
/* Use Pi's Claude theme */
@import '@mariozechner/mini-lit/themes/claude.css';

/* Or apply host app's theme variables */
:root {
  --pi-bg: var(--app-bg);
  --pi-text: var(--app-text);
  --pi-accent: var(--app-accent);
}
```

---

## 16. Host Application Integration Patterns

Pi inside Atua serves the host application. Here are the integration patterns.

### Pattern 1: Pi as Autonomous Background Agent

The host app's primary AI generates code. Pi runs in the background doing quality assurance.

```typescript
// Host app registers a file watcher
hub.on('tool_call_complete', async (transaction) => {
  if (transaction.tool === 'catalyst.fs.write' && transaction.caller !== 'pi.agent') {
    // Someone else wrote a file — trigger Pi to check it
    await pi.prompt(`A file was just modified: ${transaction.args.path}. 
                     Check the build, preview, accessibility, and performance.
                     Fix any issues you find.`);
  }
});
```

### Pattern 2: Pi as Delegated Task Runner

The primary AI delegates specific tasks to Pi when they need iterative work.

```typescript
// Primary AI decides to delegate
const result = await hub.callTool('pi.prompt', {
  message: 'Add comprehensive error handling to all API routes in src/routes/. Each route should have try-catch, proper error responses, and logging.',
  session_id: 'task-error-handling'
});
```

### Pattern 3: Pi as User-Facing Agent

Pi IS the primary AI. The host application is just the shell.

```typescript
// Simple: create agent, create UI, mount
const pi = await createPiAgent({ hub, model: 'anthropic/claude-sonnet-4-5' });
const panel = pi.createChatPanel();
document.getElementById('app').appendChild(panel);
// That's it. User talks to Pi directly.
```

### Pattern 4: Pi as Embeddable Assistant

The host application embeds Pi as a helper in a sidebar or panel.

```typescript
// Pi with restricted scope
const pi = await createPiAgent({
  hub,
  model: 'anthropic/claude-haiku-4-5',  // cheaper model for quick help
  systemPrompt: 'You are a code assistant. Help the user understand and navigate this project. Do not make changes unless explicitly asked.',
  capabilities: {
    fs: { scope: '/project', write: false },  // read-only
    build: false,
    preview: false,
    proc: false
  }
});
```

### Pattern 5: Multiple Pi Agents

Different agents for different roles.

```typescript
// Code writer — powerful model, full access
const coder = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5',
  systemPrompt: 'You are an expert coder. Write clean, well-tested code.',
  capabilities: { fs: { scope: '/project', write: true }, build: true, preview: true, proc: true }
});

// Reviewer — reads only, checks quality
const reviewer = await createPiAgent({
  hub,
  model: 'anthropic/claude-sonnet-4-5',
  systemPrompt: 'You are a code reviewer. Find bugs, security issues, and style problems. Never write code.',
  capabilities: { fs: { scope: '/project', write: false }, preview: true }
});

// Register both — external clients choose which to talk to
// coder registers as pi.coder.*
// reviewer registers as pi.reviewer.*
```

---

## 17. Pi Packages in Browser

Pi's package system (`pi install`, `pi list`, `pi update`) shells out to npm. In Atua, it routes through CatalystPkg.

### Installation

```typescript
class BrowserPackageInstaller {
  constructor(private hub: MCPHub) {}
  
  async install(specifier: string): Promise<void> {
    // Parse specifier: npm:@foo/bar, git:github.com/user/repo, etc.
    const parsed = parsePackageSpecifier(specifier);
    
    if (parsed.type === 'npm') {
      await this.hub.callTool('catalyst.pkg.install', {
        specifier: parsed.name + (parsed.version ? `@${parsed.version}` : '')
      }, { caller: 'pi.packages' });
    } else if (parsed.type === 'git') {
      // Clone via fetch, extract to CatalystFS
      const tarball = await this.hub.callTool('catalyst.net.fetch', {
        url: `https://github.com/${parsed.repo}/archive/refs/heads/main.tar.gz`
      }, { caller: 'pi.packages' });
      // Extract and install
    }
    
    // Discover extensions, skills, prompts, themes from package
    await this.discoverPackageContents(parsed.name);
  }
  
  private async discoverPackageContents(name: string): Promise<void> {
    // Read package.json for pi manifest
    // Auto-register extensions, skills, prompts, themes
  }
}
```

### Limitations

Pi packages that require native binaries won't work. Pi packages that use pure TypeScript/JavaScript — extensions, skills, prompt templates, themes — work fine. This covers the vast majority of the Pi package ecosystem.

---

## 18. Security Model

### Pi's Capabilities

The host application defines what Pi can do:

```typescript
interface PiCapabilities {
  fs?: {
    scope: string;         // base path Pi can access
    write: boolean;        // can Pi modify files
    watchable: boolean;    // can Pi watch for changes
  };
  build?: boolean;           // can Pi trigger builds
  preview?: boolean;         // can Pi start/inspect previews
  proc?: boolean | {
    allowedCommands: string[];  // restrict which commands Pi can run
  };
  network?: string[];        // allowed domains
  db?: boolean;              // can Pi query the database
  memory?: boolean;          // can Pi use persistent memory
  mcpServers?: string[];     // which MCP servers Pi can access
}
```

These capabilities map to the MCP hub's capability system. When Pi calls a tool through the hub, the hub checks Pi's registration capabilities before routing.

### API Key Isolation

Pi's API keys (for LLM providers) are stored separately from the host application's keys. Both use IndexedDB with chacha20poly1305 encryption, but different storage keys. Pi cannot access the host application's secrets, and vice versa, unless explicitly shared via the `streamFn` integration.

### Extension Sandboxing

Pi extensions run in the same context as Pi — they have the same capabilities. Extensions cannot escalate beyond Pi's configured capabilities because all tool calls go through the hub.

### Memory Privacy

Pi's memory is stored in CatalystD1 with a `pi_` table prefix. Other consumers can query it via `pi.memory.search` through the hub, but only if the host application allows it via MCP provider policy.

---

## 19. Browser Compatibility Surface

### What Works Natively

| Pi Component | Browser Compat | Notes |
|-------------|---------------|-------|
| pi-ai | Full | fetch() for LLM calls, ReadableStream for streaming |
| pi-agent-core | Full | Pure TypeScript, async/await, no I/O |
| pi-coding-agent (agent loop) | Full | Pure TypeScript |
| pi-coding-agent (tools) | Adapter needed | read/write/edit/bash → Catalyst |
| pi-coding-agent (sessions) | Adapter needed | fs backend → OPFS or D1 backend |
| pi-coding-agent (extensions) | Full | Pure TypeScript lifecycle hooks |
| pi-coding-agent (skills) | Full | Markdown files in CatalystFS |
| pi-coding-agent (packages) | Adapter needed | npm/git → CatalystPkg |
| pi-web-ui | Full | Already browser components |
| pi-tui | N/A | Terminal-specific, excluded |

### Node.js APIs Used by Pi

Pi's packages use a small set of Node.js APIs. Atua's unenv + CatalystEngine covers them:

| API | Used By | Atua Coverage |
|-----|---------|---------------|
| `fs.readFile` / `fs.writeFile` | pi-coding-agent tools | CatalystFS (OPFS) via tool adapters |
| `child_process.spawn` | pi-coding-agent bash tool | CatalystProc (Workers) via tool adapter |
| `path.join` / `path.resolve` | Various | unenv polyfill (browser-safe) |
| `crypto.randomUUID` | Session IDs, memory IDs | Web Crypto (native in browser) |
| `process.env` | API key access | CatalystEngine env simulation |
| `fetch` | pi-ai LLM calls | Native browser API |
| `ReadableStream` | pi-ai streaming | Native browser API |
| `URL` / `URLSearchParams` | Various | Native browser API |

No native modules. No C++ bindings. No WASM needed for Pi itself.

---

## 20. Testing Strategy

### Unit Tests — Adapter Layer

```
tools/read.ts      — Read from CatalystFS, return in Pi tool format
tools/write.ts     — Write to CatalystFS, handle mkdir, return confirmation
tools/edit.ts      — Read + replace + write, validate uniqueness
tools/bash.ts      — Spawn via CatalystProc, wait, return output
tools/hub-tools.ts — Dynamic tool creation from hub discovery
session/opfs.ts    — Save/load/list/delete sessions via CatalystFS
session/d1.ts      — Save/load/list/delete sessions via CatalystD1
memory/store.ts    — Store/search/forget/compact via CatalystD1 + FTS5
auth/browser.ts    — Encrypted key storage in IndexedDB
```

### Integration Tests — Pi + Hub

```
Agent discovers hub tools             — listTools() returns all catalyst.* tools
Agent calls catalyst.fs.read          — file content returned correctly
Agent calls catalyst.build.run        — build result returned correctly
Agent calls catalyst.preview.dom.query — DOM data returned correctly
Agent runs multi-step workflow         — write → build → preview → check metrics
Pi.prompt via external client          — StreamableHTTP → hub → Pi → response
Pi.memory.search via external client   — memory results returned
Session persistence                    — save session, reload page, resume session
Memory persistence                     — store memory, new session, search finds it
```

### Extension Tests

```
Quality gate extension fires after file write
Accessibility extension detects missing ARIA labels
Performance extension detects CLS regression
Custom extension can inject context before LLM call
Custom extension can gate tool calls
```

### End-to-End Tests

```
User sends message → Pi responds with file changes → build succeeds → preview works
Pi uses installed MCP server (e.g., GitHub) → tool call routed correctly
External client (mock Claude Desktop) talks to Pi via MCP
Pi with restricted capabilities cannot escape scope
Multiple Pi agents coexist without conflict
```

---

## 21. Implementation Phases

### Phase 0: Core Adapter — Tools + Agent Initialization

**Goal:** Pi agent boots inside Atua, calls basic tools via the hub.

**What gets built:**
- `@aspect/pi-atua` package scaffolding
- Tool adapters: read, write, edit, bash, grep, find, ls
- `createPiAgent()` function with minimal configuration
- Hub tool discovery and dynamic registration
- Pi-ai initialization with direct provider config

**Verification:**
- [ ] `createPiAgent()` returns a working agent
- [ ] Agent can read a file via `catalyst.fs.read`
- [ ] Agent can write a file via `catalyst.fs.write`
- [ ] Agent can edit a file (read, modify, write back)
- [ ] Agent can run a command via `catalyst.proc.spawn`
- [ ] Agent auto-discovers all hub tools
- [ ] Full agent loop: user prompt → LLM → tool calls → response

---

### Phase 1: Session Persistence

**Goal:** Agent sessions survive page reload and browser restart.

**What gets built:**
- `OPFSSessionManager` — sessions as JSON files in CatalystFS
- `D1SessionManager` — sessions as rows in CatalystD1
- Session resume on agent initialization
- Session listing and deletion

**Verification:**
- [ ] Create session, send messages, save
- [ ] Reload page, resume session, conversation continues
- [ ] List sessions, see correct titles and dates
- [ ] Delete session, confirm it's gone
- [ ] D1 backend handles 100+ sessions efficiently

---

### Phase 2: Memory System

**Goal:** Agent has long-term recall across sessions.

**What gets built:**
- `PiMemoryStore` — CatalystD1 with FTS5 + vector similarity
- Memory schema (tables, indexes, FTS triggers)
- Auto-memory extension (extract and store facts per turn)
- Memory injection extension (search and inject relevant memories before LLM calls)
- Memory compaction (prune old, low-importance entries)

**Verification:**
- [ ] Store a memory entry, search for it, find it
- [ ] FTS5 search returns relevant results for keyword queries
- [ ] Importance and recency weighting affect result ordering
- [ ] Memory compaction removes old, low-importance entries
- [ ] Auto-memory extension extracts facts from conversations
- [ ] Memory injection adds relevant context to LLM calls
- [ ] Memory persists across sessions and page reloads

---

### Phase 3: MCP Provider Registration

**Goal:** Pi is visible on the hub. External clients can interact with it.

**What gets built:**
- Pi provider registration (pi.prompt, pi.session.*, pi.memory.*, pi.status, pi.config.*)
- Tool handlers for each registered tool
- Streaming response support for pi.prompt
- Hub event listeners for provider changes (tool refresh)

**Verification:**
- [ ] `hub.listTools()` includes all pi.* tools
- [ ] External client calls `pi.prompt`, receives response
- [ ] External client calls `pi.session.list`, sees sessions
- [ ] External client calls `pi.memory.search`, finds memories
- [ ] External client calls `pi.status`, sees current state
- [ ] New MCP server installed → Pi's tool list updates automatically

---

### Phase 4: LLM Routing + Extensions

**Goal:** All three LLM routing modes work. Extensions load and fire correctly.

**What gets built:**
- Mode 1: Pi's own provider (direct fetch via pi-ai)
- Mode 2: Host app's proxy (streamProxy integration)
- Mode 3: Host app's function (streamFn injection)
- `BrowserExtensionLoader` — load extensions from CatalystFS
- `BrowserSkillLoader` — load skills from CatalystFS
- Pre-installed Atua-specific skills and extensions
- Model selection constraints (allowedModels)

**Verification:**
- [ ] Pi calls LLM directly via own API key
- [ ] Pi calls LLM via host app's proxy URL
- [ ] Pi calls LLM via host app's injected function
- [ ] Extension loads from CatalystFS, hooks fire correctly
- [ ] Skill loads from CatalystFS, agent uses it when triggered
- [ ] Quality gate extension auto-builds after file writes
- [ ] Model constraints prevent using disallowed models

---

### Phase 5: Web UI + Pi Package Support

**Goal:** Pi's chat UI renders. Pi packages install in browser.

**What gets built:**
- Pi-web-ui integration wrapper (`atua-panel.ts`)
- `ChatPanel` wired to Atua-backed agent
- Artifact rendering via Atua preview system
- `BrowserPackageInstaller` — pi install via CatalystPkg
- Package discovery (extensions, skills, prompts from installed packages)

**Verification:**
- [ ] Chat panel renders, user can type messages
- [ ] Streaming responses display token-by-token
- [ ] Artifacts render in sandboxed iframes
- [ ] Model selector works
- [ ] `pi install npm:@example/pi-tools` installs via CatalystPkg
- [ ] Installed package's extensions auto-load
- [ ] Installed package's skills available for use

---

## 22. CC Kickoff Prompts

### Kickoff (paste into CC)

```
Read docs/plans/pi-atua-spec.md. This is the spec for integrating Pi.dev's
TypeScript agent framework with Atua's browser-native runtime. Pi runs
natively (no WASM), tools route through the MCP hub, sessions and memory
persist via CatalystFS/CatalystD1.

Implement Phase 0 first. Each phase has a verification checklist — run it
before moving to the next phase. Commit after each phase:
git add -A && git commit -m "Pi-Atua Phase {N}: {description}"

Read the full Pi.dev source at:
- packages/pi-ai (npm: @mariozechner/pi-ai)
- packages/pi-agent-core (npm: @mariozechner/pi-agent-core)
- packages/pi-coding-agent (npm: @mariozechner/pi-coding-agent)
- packages/pi-web-ui (npm: @mariozechner/pi-web-ui)

All Pi packages are MIT licensed. Use them as dependencies, not forks.
Do not reference, examine, or search for WebContainers source code or
any proprietary competing runtime code.
```

### Between phases

```
Continue with Pi-Atua Phase {N} per docs/plans/pi-atua-spec.md.
Run verification checklist before committing.
```

---

## 23. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Pi packages import Node.js modules not covered by unenv | Medium | Medium | Test each import path. Pi's core packages use minimal Node APIs — mostly fs, path, crypto. All covered. |
| esm.sh fails to resolve Pi's dependency tree | Medium | Low | Pi's dependencies are standard (TypeBox, mini-lit, etc.). Pre-test resolution. Fall back to bundled version. |
| Pi-web-ui conflicts with host application's CSS/DOM | Medium | Medium | Shadow DOM isolation via Lit. Pi components encapsulate styles. Test in various host contexts. |
| Pi extension that assumes Node.js environment | Low | Medium | Document browser constraints. Most extensions are pure logic. Extensions using fs/child_process route through tools. |
| Memory search latency at scale (>10k entries) | Medium | Medium | FTS5 index, pagination, importance-based pruning via compact(). Benchmark early. |
| Pi upstream breaking changes | Medium | Low | Pin to specific versions. Pi publishes to npm with semver. Test before bumping. |
| LLM streaming drops chunks via streamFn | Low | Low | Pi-ai handles streaming natively via ReadableStream. No host binding boundary (unlike ZeroClaw path). |
| Multiple Pi agents competing for hub resources | Low | Low | Each agent has unique caller ID in hub transactions. Hub handles concurrent calls. |
| CORS blocking LLM provider calls in Mode 1 | Medium | High | Document CORS-friendly providers. Recommend proxy mode (Mode 2) for production. OpenRouter works without CORS issues. |

---

## 24. Cleanroom Protocol

### Allowed Sources
- Pi.dev monorepo (`pi-mono`, MIT license, public GitHub: github.com/badlogic/pi-mono)
- Atua/Catalyst spec and source code (own project)
- Atua MCP Spec (Fabric) (own project)
- This spec document
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`, MIT/Apache-2.0)
- Hono framework (MIT license)
- wa-sqlite (MIT license)
- MDN Web Docs for browser APIs
- npm package documentation for Pi's dependencies

### Not Accessed
- WebContainers source code or proprietary API
- Bolt.new source code
- StackBlitz proprietary technology
- Any decompiled or reverse-engineered competing runtime
- Any source code not under an open-source license

### Implementation Rules
- `@aspect/pi-atua` adapter code is original work
- Pi packages used as npm dependencies (MIT licensed), not forked or modified
- Tool adapters are original implementations routing to Catalyst subsystems
- Session backends are original implementations of Pi's `SessionManager` interface
- Memory system is original, using CatalystD1 for storage
- No copy-paste from any competing integration
- Pi-web-ui used as-is, not forked
