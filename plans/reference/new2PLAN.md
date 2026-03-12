# Lua-First Embedded Agent Runtime

## Summary
Build a greenfield agent runtime that is **Lua-first**, but ships as both:
1. a **stable C ABI + Lua module** for embedding in host applications, and
2. a **standalone CLI/runtime** built on the same engine.

V1 should target **Lua 5.4 and LuaJIT**, support **hybrid local/cloud model backends**, and include **native multi-agent orchestration, tool execution, and persistent memory**. The architecture should keep the core in Lua wherever practical, with only thin native adapters where Lua alone is not sufficient.

## Implementation Changes
### Core architecture
- Split the system into three layers:
  - `core`: pure-Lua runtime state machine, agent scheduler, prompt/context assembly, tool dispatch, memory API, workflow coordination.
  - `native shim`: minimal C layer exposing a stable ABI, loading Lua, wiring host callbacks, and providing optional accelerated adapters.
  - `product surfaces`: Lua package for embedding and a CLI/standalone wrapper that uses the same runtime APIs.
- Make the runtime event-driven rather than thread-driven:
  - agents exchange typed messages through mailboxes;
  - tool calls, model requests, and storage operations are async job boundaries;
  - hosts can drive execution in polling or callback style.
- Treat multi-agent as a first-class model:
  - supervisor, worker, and router roles are built-in runtime concepts;
  - orchestration is graph-based, not ad hoc recursive prompting;
  - each agent run has explicit budget, capabilities, and memory scope.

### Public interfaces and contracts
- Define a stable C ABI for host applications:
  - create/destroy runtime;
  - register model, tool, storage, logging, and approval adapters;
  - start/resume/cancel runs;
  - stream events and outputs.
- Expose a Lua-facing API that mirrors the ABI but feels idiomatic:
  - `runtime.new(config)`
  - `runtime:register_tool(...)`
  - `runtime:register_model(...)`
  - `runtime:start(run_spec)`
  - `runtime:resume(session_id)`
  - `runtime:step()` / `runtime:drain()`
- Standardize adapter interfaces:
  - model adapters: `complete`, `stream`, capabilities metadata, token/accounting hooks;
  - tool adapters: schema, capability tag, sync/async execution, structured result/error;
  - storage adapters: sessions, messages, artifacts, embeddings/recall, checkpoints;
  - approval/security adapters: allow/deny/escalate for sensitive actions.
- Make the CLI a thin wrapper over the same runtime contracts, not a separate execution path.

### Memory, security, and portability
- Ship **SQLite as the default durable backend** with a storage adapter boundary so hosts can swap in filesystem or custom storage later.
- Include three security modes with identical APIs:
  - `trusted`
  - `sandboxed`
  - `host-mediated`
- Use capability grants for tools, filesystem, network, model access, and inter-agent communication.
- Keep the pure-Lua core portable across Lua 5.4 and LuaJIT with a small compatibility layer for:
  - JSON/msgpack handling
  - time/UUID helpers
  - async/event-loop integration
  - optional native acceleration
- Prefer optional native modules for performance-sensitive paths only, such as streaming IO, embeddings, or process management.

### Developer experience and packaging
- Publish as:
  - a Lua package for embedding;
  - a native library exposing the C ABI;
  - a standalone executable for local use and testing.
- Provide a declarative run spec for agents/workflows:
  - agent definitions;
  - tool grants;
  - model routing rules;
  - memory scope;
  - budgets/timeouts;
  - security mode.
- Include structured event output for hosts and CLI:
  - lifecycle events
  - tool requests/results
  - model usage
  - memory writes/reads
  - approval decisions
- Document a “minimal embed” example in C and Lua, plus one non-Lua host example using the C ABI.

## Test Plan
- Compatibility matrix:
  - Lua 5.4
  - LuaJIT
  - CLI and embedded modes against the same conformance suite
- Multi-agent scenarios:
  - supervisor delegating to workers
  - routing between specialized agents
  - cancellation, timeout, and partial failure handling
- Persistence scenarios:
  - checkpoint/resume after interruption
  - session replay
  - concurrent runs sharing the same SQLite backend safely
- Security scenarios:
  - denied capability use
  - host-mediated approval flow
  - sandboxed mode preventing undeclared tool/network/fs access
- Backend scenarios:
  - hosted model adapter
  - local model adapter
  - fallback/routing behavior when one backend is unavailable
- API parity tests:
  - same run spec produces equivalent behavior through CLI, Lua API, and C ABI.

## Assumptions and Defaults
- This is a **new project**, not a change to an existing codebase.
- V1 optimizes for **application developers embedding the runtime**, while still treating the standalone runtime as first-class.
- “Parity” means V1 must include **multi-agent orchestration, tools, and durable memory**, not just single-agent chat/tool calling.
- SQLite is the default durable store; custom storage remains supported through adapters.
- The runtime core stays in Lua unless a native shim is required for ABI stability, host integration, or critical performance.
- The CLI is a wrapper around the same engine and must not introduce behavior that embedded hosts cannot access.
