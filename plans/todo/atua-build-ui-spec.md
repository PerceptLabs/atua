# Atua Build UI/UX Specification

**Status:** Draft
**Date:** 2026-03-10
**Depends on:** Hashbrown × Atua (`hashbrown-atua-spec.md`), Conductor (`pi-atua-spec.md`)
**Source:** Decisions from "Review of Atua and recent conversations" session (2026-03-07)

---

## 1. Design Philosophy

Canvas-first. The IDE is a canvas, not a code editor with panels bolted on. The shell (navigation, agent interface, project management) is fixed and minimal. The canvas is infinitely malleable — Pi can reshape it into kanban boards, dashboards, data tables, or anything else via Hashbrown components registered at runtime.

The output is standard React + Hono apps that people recognize and can deploy anywhere. Not proprietary runtime-locked artifacts.

---

## 2. Three Product Surfaces

### `build.atua.dev` — Canvas-First Creative IDE

The primary creative surface. Visual, spatial, designed for non-technical and technical users alike. Projects are canvases, not file trees. The agent is always present. Code exists but isn't the default view.

### `ide.atua.dev` — Professional Classic IDE

v0-style but more powerful. File tree, editor panes, terminal, preview. For developers who want a traditional IDE experience with Atua's agent and runtime underneath. Same engine, different chrome.

### `agent.atua.dev` — Headless MCP Surface

No human UI. Pure MCP endpoint. External agents (Claude Code, OpenClaw, Cursor, any MCP client) connect and drive Atua programmatically. Exposes structured build feedback, runtime observation streams, database as a tool, deployment as a tool, and cross-session memory.

All three surfaces share the same Atua engine. The difference is the shell layer.

---

## 3. The Floating Agent Interface

### The Circle (FAB)

A floating circle button, always visible, always accessible. This is the agent's presence indicator.

**Color states:**
| Color | Meaning |
|---|---|
| Idle (subtle pulse) | Agent is available, no active task |
| Active (steady glow) | Agent is thinking or executing |
| Waiting (amber) | Agent needs user input or approval |
| Error (red pulse) | Something failed, needs attention |
| Success (green flash) | Task completed successfully |

**Behavior:**
- Tap → opens the chat card
- Long press → quick actions menu (new project, switch surface, settings)
- Drag → repositions (remembers position per project)
- The circle is always on top of everything except system dialogs

### The Chat Card

A floating card that opens from the circle. Not a sidebar, not a panel — a card that floats over the canvas.

**Contains:**
- Chat input (multiline, supports @ mentions for files/components)
- Conversation history (scrollable)
- Surface switcher inside the card (build / ide / agent tabs)
- Model selector
- Current task status
- Quick action buttons (build, preview, deploy)

**Behavior:**
- Opens/closes via the circle
- Can be resized by dragging edges
- Can be minimized to just the input bar
- Persists position and size per project
- Chat is always available regardless of what the canvas shows
- The floating chat bar in Building mode is the minimized version of this card

### Satellite Bubbles

When Hive spawns sub-agents, each gets a small satellite bubble orbiting the main circle.

**Each bubble shows:**
- Agent role (Architect, Builder, Reviewer, etc.) as an icon or initial
- Current state (working, idle, blocked)
- Tap → shows that agent's activity log

**Behavior:**
- Bubbles appear when sub-agents spawn, disappear when they terminate
- Typically 1-3 visible at any time (Hive limits concurrent agents)
- If >4 sub-agents, overflow into a "+N" indicator
- Bubbles orbit the circle at a fixed radius, evenly spaced

---

## 4. IDE Modes (build.atua.dev)

### Genesis Mode

**When:** New project, blank canvas. No files exist yet.

**Layout:**
- Centered prompt input (large, inviting, no distractions)
- The circle is visible but the canvas is empty
- Subtle suggestions below the prompt ("Build a SaaS dashboard", "Create a portfolio site", "Start from template")
- Background is clean — no file trees, no panels, no clutter

**Behavior:**
- User types their intent → agent begins planning
- Transitions to Planning mode when the agent produces a plan

### Planning Mode

**When:** Agent has decomposed the request into a plan. Before code is written.

**Layout:**
- Hashbrown-rendered interactive plan cards on the canvas
- Each card is a task (design components, set up data model, implement auth, etc.)
- Cards are spatial — draggable, reorderable, groupable
- The chat card is open, showing the agent's planning conversation
- No file tree yet — files don't exist

**Card anatomy:**
- Title (task name)
- Status (pending, in progress, complete, blocked)
- Estimated complexity (simple, moderate, complex)
- Dependencies (lines connecting cards)
- Expand → shows subtasks and implementation notes

**Behavior:**
- User can approve the plan, modify cards, add cards, remove cards
- User can tap a card to discuss it with the agent
- When user approves → agent begins building, transitions to Building mode
- Plan cards persist in `.atua/plan.md` and as Hashbrown components

### Building Mode

**When:** Agent is actively writing code and building the app.

**Layout:**
- App preview takes full viewport (the thing being built IS the main view)
- Persistent floating chat bar at bottom (minimized chat card)
- The circle with satellite bubbles visible
- Agent activity ambient but not intrusive — status text on the chat bar
- File changes stream as notifications (subtle, dismissable)

**Interaction: Tap-to-Select for Spatial Context**
- User taps any element in the preview
- Element gets highlighted with a selection indicator
- The selected element becomes context for the next chat message
- "Make this button bigger" → agent knows which button
- "Change this section's layout" → agent knows which section
- Selection persists until user taps elsewhere or sends a message

**Behavior:**
- Preview updates live as the agent writes code (HMR via Rolldown/esbuild)
- Build errors show as a non-blocking notification on the chat bar
- User can type in the chat bar at any time — doesn't interrupt the agent
- Agent activity is visible but ambient: the chat bar shows what the agent is doing
- Expanding the chat bar → full chat card with conversation history

---

## 5. Multi-Project Tab Strip

A horizontal tab strip at the top of the viewport. Each tab is a project.

**Tab anatomy:**
- Project name (editable)
- Color indicator (user-chosen or auto-assigned)
- Status dot (building, error, idle)
- Close button (with unsaved changes warning)

**Linked project groups:**
- Projects can be linked into groups (e.g., frontend + backend + shared library)
- Linked projects share a color band
- Changes in one linked project can trigger awareness in another (agent notices)
- Each tab still has its own isolated Pi agent instance

**Behavior:**
- New tab → Genesis mode
- Switch tab → instant (each project's state is in OPFS, loads immediately)
- Drag to reorder
- Right-click → duplicate, link to group, move to new window
- Each tab maintains its own conversation history, agent state, and canvas layout

---

## 6. Malleable Canvas via Hashbrown

The shell (circle, card, tabs, bubbles) is fixed. The canvas is infinitely malleable.

Pi can write and register Hashbrown components at runtime. This means:

- Agent can transform the canvas into a kanban board for task management
- Agent can render a data table for database exploration
- Agent can show a dependency graph for package analysis
- Agent can create a design token explorer for theming
- Agent can build a custom dashboard for monitoring

These aren't pre-built views. The agent generates them as Hashbrown components in response to context. "Show me my database schema" → agent writes a schema visualization component, registers it, renders it on the canvas. The component persists until the user dismisses it or navigates away.

The canvas in Planning mode IS this system — plan cards are Hashbrown components generated by the agent.

---

## 7. First-Time Onboarding

A conversational setup wizard, not a configuration form.

**Flow:**
1. User lands on `build.atua.dev` for the first time
2. A speech bubble appears from the circle: "Hey! I'm [agent name]. What are we building?"
3. Based on the response, the agent asks clarifying questions (one at a time, not a form)
4. Agent bootstraps its own configuration: model preference, API key entry (or proxy setup), default framework preference
5. Transitions to Genesis mode with the first project prompt ready

**Principles:**
- Never show a settings panel during onboarding
- Every configuration question is a natural language conversation
- The agent explains what each choice means if the user seems unsure
- Sensible defaults for everything — user can skip any question
- Settings are always editable later via the chat ("change my default framework to SvelteKit")

---

## 8. Implementation Notes

### Shell Components (Fixed)

These are standard React components, not Hashbrown:
- `<FloatingCircle />` — the FAB with color states
- `<ChatCard />` — the floating chat interface
- `<SatelliteBubbles />` — Hive agent indicators
- `<TabStrip />` — multi-project tabs
- `<ChatBar />` — minimized chat in Building mode
- `<SelectionOverlay />` — tap-to-select in Building mode

### Canvas Components (Malleable)

These are Hashbrown components, generated and registered by Pi at runtime:
- Plan cards (Planning mode)
- App preview frame (Building mode)
- Any visualization the agent generates
- Custom dashboards, data explorers, etc.

### Package

Shell components live in `@aspect/atua-ui` (the Sizzle package). Canvas components are generated by Pi and registered via Hashbrown's runtime component registry.

### Dependencies

- `@aspect/atua-ui` (Hashbrown integration — Sizzle spec)
- `@aspect/pi-atua` (Conductor — agent interface)
- `@aspect/pi-hive` (Hive — satellite bubbles)
- Atua Fabric (MCP hub — all tool calls)

---

## 9. Decisions Log

| Decision | Chosen | Rationale |
|---|---|---|
| Agent interface | Floating circle + card | Always present, never obstructs, works on mobile |
| Chat position | Floating, not sidebar | Doesn't consume layout space, user positions it |
| Preview in Building | Full viewport | The app IS the main view, not a secondary panel |
| Tap-to-select | Direct DOM selection | Spatial context without file/line navigation |
| Canvas approach | Hashbrown-malleable | Agent can generate any view, not limited to pre-built panels |
| Onboarding | Conversational | No forms, no settings panels, agent-driven setup |
| Tab isolation | One Pi per tab | No cross-contamination, clean context per project |
| Plan visualization | Spatial cards | Kanban-like, visual, reorderable, not a text list |
