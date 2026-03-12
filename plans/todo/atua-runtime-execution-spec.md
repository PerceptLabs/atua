# Atua Runtime Execution Model

**Status:** Draft — supersedes `catalyst-tiered-engine-plan.md` Phase B (QuickJS Tier 0)
**Date:** 2026-03-09
**Depends on:** Atua unified spec (hyperkernel), AtuaBox spec (`atua-linux-sandbox-spec.md`)
**Replaces:** The QuickJS-as-security-gate model from the tiered engine plan

---

## Table of Contents

1. [What Changed and Why](#1-what-changed-and-why)
2. [Competitive Landscape: How Others Solve This](#2-competitive-landscape-how-others-solve-this)
3. [The Execution Context Model](#3-the-execution-context-model)
4. [Tier 1: Static Analysis Gate](#4-tier-1-static-analysis-gate)
5. [Tier 2: Worker Sandbox](#5-tier-2-worker-sandbox)
6. [Tier 3: AtuaBox (Linux Sandbox)](#6-tier-3-atuabox-linux-sandbox)
7. [The ExecutionContext Interface](#7-the-executioncontext-interface)
8. [Routing: Who Decides Which Tier](#8-routing-who-decides-which-tier)
9. [ShadowRealm: Future Tier 0](#9-shadowrealm-future-tier-0)
10. [What Happens to QuickJS](#10-what-happens-to-quickjs)
11. [BrowserPod: Competitive Reference](#11-browserpod-competitive-reference)
12. [Implications for Existing Specs](#12-implications-for-existing-specs)
13. [Implementation Changes](#13-implementation-changes)
14. [Decision Log](#14-decision-log)

---

## 1. What Changed and Why

The original tiered engine plan defined three tiers:

- **Tier 0:** QuickJS WASM sandbox — validates code before execution (syntax, infinite loops, memory limits)
- **Tier 1:** NativeEngine (V8 Worker) — executes validated code at full speed
- **Tier 2:** QuickJS as Cloudflare Workers compliance gate

This document removes QuickJS as Tier 0 and replaces the three-tier model with a simpler, more powerful execution context system. Here's why.

### QuickJS Tier 0 Was Solving an Imaginary Problem

Every threat QuickJS catches is already handled — better — by other parts of the system:

| Threat | QuickJS catches it | What else catches it better |
|---|---|---|
| Syntax errors | Yes (~50ms) | OXC parser or `new Function()` (~microseconds) |
| Infinite loops | Yes (interrupt callback) | `Worker.terminate()` with timeout — hard kill, then spawn a new Worker |
| Memory bombs | Yes (configurable limit) | Browser enforces per-Worker memory limits natively |
| Prototype pollution | Yes (separate engine) | Worker already has its own global scope |
| `eval()` / `Function()` escape | Yes (can restrict) | Worker scope shadowing already planned in NativeEngine bootstrap |
| Malicious native code | **No** | **AtuaBox** — real hardware-level isolation |

QuickJS adds ~1MB of WASM download, ~50-100ms of validation latency on every code execution, and requires maintaining compatibility with a second JavaScript engine that has subtly different semantics from V8. The codebase audit already found that `runInSandbox()` falls back to `new Function(code)` (syntax check only) when QuickJS isn't available — so the "security gate" has a backdoor that's open by default.

### Workers Are Already Sandboxes

A Web Worker runs in its own global scope, on its own thread, with its own event loop. `Worker.terminate()` is a hard kill — the browser reclaims all memory, all handles, all state. Spawning a new Worker takes ~1ms. This is strictly better than QuickJS for timeout/memory enforcement because:

1. V8 Workers run at full speed until the timeout — timing reflects real algorithmic complexity, not QuickJS's ~100x slower interpretation speed.
2. `Worker.terminate()` is a kernel-level process kill. QuickJS's interrupt callback is cooperative — it depends on the engine checking the callback between bytecode instructions. A tight native loop can delay the interrupt.
3. Worker memory is tracked by the browser's process manager. QuickJS memory limits are self-reported.

### The Real Security Gap Is Native Code

Neither QuickJS nor Workers nor ShadowRealm can safely run `npm install` for a package with a malicious postinstall script that calls `gcc` and `make`. The actual security boundary Atua needs is between "JavaScript code the agent wrote" (Worker is fine) and "arbitrary Linux binaries from the npm ecosystem" (needs AtuaBox). QuickJS doesn't help with the hard case.

---

## 2. Competitive Landscape: How Others Solve This

### WebContainers (StackBlitz)

Proprietary WASM kernel. Runs Node.js workloads in-browser via a custom kernel that emulates Linux syscalls at the WASM level. No CPU emulation — Node.js is compiled to WASM directly. Patented invisible-iframe networking relay. Covers ~85-90% of npm packages. Falls down on native addons (no `gcc`, no `make`, no C compilation). Used by Bolt, StackBlitz, and several AI coding products.

**What they do for sandboxing:** The WASM kernel IS the sandbox. Code runs in WASM linear memory, can't escape. No separate validation tier. Timeout enforcement via the browser's ability to kill the tab/Worker.

### BrowserPod (Leaning Technologies)

Brand new (beta launched Feb 2026). Built by the CheerpX team — the same people who built WebVM, a full x86 Linux VM running in the browser via x86-to-WASM JIT recompilation.

BrowserPod takes a different architectural approach from both WebContainers and Atua:

**CheerpOS layer.** They split CheerpX into two components: the x86-to-WASM JIT engine, and the Linux syscall emulation layer (internally called "CheerpOS"). CheerpOS is a WASM kernel that emulates Linux syscalls, similar in concept to Atua's hyperkernel and WebContainers. But unlike Atua's hyperkernel (which targets WASI guests), CheerpOS targets fully compiled language runtimes — they take the actual Node.js C++ source code, compile it to WASM via their Cheerp C/C++ compiler, and run it against the CheerpOS syscall layer. This means real Node.js V8, real libuv, real npm — not polyfills.

**Multi-language from day one.** Node.js 22 shipped first. Python, Ruby on Rails, Go, Rust runtimes are on their 2026 roadmap. Each language runtime is compiled to WASM independently and runs against the same CheerpOS kernel. By end of 2026, they plan to integrate the full CheerpX x86 JIT for Linux-class workloads — meaning arbitrary x86 binaries, Docker containers, React Native toolchains.

**Portals.** Their networking feature. Services running inside a BrowserPod instance can be exposed to the internet via managed URLs — similar to ngrok but fully client-side. This is competitive with Atua's ServiceWorker + relay architecture for preview URLs.

**Key differentiator from Atua:** BrowserPod is proprietary software (free for personal/OSS, commercial license required). No hyperkernel you can inspect. No `no_std` Rust kernel you can audit. It's a black box compared to Atua's architecture. Also, BrowserPod is a runtime/sandbox product, not a creative IDE or agentic platform — it's what you'd embed inside your own product. In that sense, it competes more directly with WebContainers than with Atua-the-product.

**What BrowserPod validates for Atua:** The market demand for browser-native sandboxed execution is real. The CheerpOS architecture — compile real runtimes to WASM, run against a browser-native kernel — is close to what Atua does with the hyperkernel + unenv polyfills. The fact that Leaning Technologies (10+ years of WASM deep tech) arrived at nearly the same architecture independently is strong validation. Their CheerpX integration plan (x86 JIT for native binaries by end of 2026) mirrors AtuaBox's v86 approach, further confirming that the "fast WASM kernel + optional heavy Linux sandbox" two-tier model is where the market is converging.

### Apptron (tractordev)

v86 x86 JIT emulator running Alpine Linux via the Wanix Plan 9-inspired kernel. Full Linux environment in the browser — `apk add` anything, real `git`, real `gcc`, VSCode-based editor. Everything resets on page load except persisted mount points. Virtual networking with DHCP across browser tabs.

**What they do for sandboxing:** The entire Linux environment IS the sandbox — it's inside v86's WASM emulator. No separate validation. If something goes wrong, close the tab.

### container2wasm (NTT Labs)

Converts Docker images into self-contained WASM blobs. Bochs (x86_64) or TinyEMU (RISC-V) emulator + Linux kernel + container filesystem, all packaged as a single WASM module. Pre-boots via `wizer` to minimize startup latency. Runs on any WASM host including browsers.

**What they do for sandboxing:** The WASM module IS the sandbox. The emulated CPU can't escape WASM linear memory.

### The Pattern

Every serious project in this space converges on the same insight: **WASM linear memory is the sandbox.** Nobody uses a separate validation engine as a pre-flight security gate. The execution environment itself provides isolation.

---

## 3. The Execution Context Model

Atua replaces the old QuickJS → NativeEngine tiered pipeline with three execution contexts behind a unified interface. The agent (Pi/Conductor) and the capability system decide which context to use. Code flows directly to the right context — no pre-flight validation step.

```
┌────────────────────────────────────────────────────────────────┐
│                    ExecutionContext interface                    │
│                                                                │
│  eval(code, opts?) → Promise<ExecResult>                       │
│  spawn(command, args?, opts?) → Promise<ProcessResult>         │
│  destroy() → Promise<void>                                     │
│  status() → ContextStatus                                      │
│                                                                │
├──────────────────┬──────────────────┬─────────────────────────┤
│                  │                  │                           │
│  WorkerContext   │  AtuaBoxContext  │  InlineContext            │
│                  │                  │  (future ShadowRealm)     │
│  V8 Worker       │  v86 Linux       │                           │
│  + terminate()   │  + serial shell  │  Same-thread              │
│  + unenv polys   │  + 9p bridge     │  scope-isolated           │
│  + Comlink RPC   │  + snapshot      │  eval only                │
│                  │                  │                           │
│  ~1ms spawn      │  ~1-3s restore   │  ~0ms (sync)              │
│  ~50MB memory    │  ~170-550MB      │  ~0MB overhead            │
│                  │                  │                           │
│  For:            │  For:            │  For:                     │
│  App code        │  Native binaries │  Trivial expressions      │
│  Build tools     │  npm postinstall │  Structured completions   │
│  Hashbrown RT    │  Untrusted deps  │  Pure data transforms     │
│  Agent-written   │  Docker images   │  Config generation        │
│  code            │  Compilation     │                           │
└──────────────────┴──────────────────┴─────────────────────────┘
```

### The Key Insight

The old model was: validate → then execute. A serial pipeline where validation was a separate engine (QuickJS) from execution (V8 Worker).

The new model is: **pick the right execution boundary for the trust level.** Trusted code goes to a Worker (fast, killable). Untrusted native code goes to AtuaBox (slow, completely isolated). Trivial expressions go inline (zero overhead). No pre-flight validation engine needed — the execution environment IS the security boundary.

---

## 4. Tier 1: Static Analysis Gate

QuickJS Tier 0 is replaced by a lightweight, zero-download static analysis pass. This is NOT an execution engine — it's a fast syntactic check that runs before any execution context is created.

### What It Does

```typescript
// packages/shared/core/src/validation/StaticAnalysis.ts

export interface AnalysisResult {
  valid: boolean;
  errors: string[];       // syntax errors
  warnings: string[];     // suspicious patterns (advisory, not blocking)
  estimatedRisk: 'low' | 'medium' | 'high';
}

export function analyzeCode(code: string): AnalysisResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Syntax check — fastest possible path
  try {
    new Function(code);
  } catch (e) {
    return { valid: false, errors: [e.message], warnings: [], estimatedRisk: 'low' };
  }

  // 2. Static AST scan for suspicious patterns (advisory)
  //    Uses OXC parser if available, regex fallback if not
  const patterns = scanForPatterns(code);
  if (patterns.hasEval) warnings.push('Uses eval() — dynamic code execution');
  if (patterns.hasFunctionConstructor) warnings.push('Uses Function() constructor');
  if (patterns.hasProtoAccess) warnings.push('Accesses __proto__ or Object.prototype');
  if (patterns.hasProcessEnv) warnings.push('Accesses process.env');
  if (patterns.hasRequireFs) warnings.push('Requires fs module');

  // 3. Risk estimation (informs routing, not blocking)
  const estimatedRisk = patterns.hasEval || patterns.hasFunctionConstructor
    ? 'high'
    : patterns.hasProtoAccess ? 'medium' : 'low';

  return { valid: true, errors, warnings, estimatedRisk };
}
```

### What It Costs

- **Download:** 0KB. Uses `new Function()` (built-in) + optional OXC if already loaded for Rolldown.
- **Latency:** <1ms for syntax check. <5ms with AST scan.
- **Maintenance:** Zero — no separate engine semantics to keep compatible.

### What It Doesn't Do

- Does NOT execute code.
- Does NOT catch infinite loops (that's the Worker's job via `terminate()`).
- Does NOT catch memory bombs (that's the browser's job).
- Does NOT enforce security boundaries (that's the execution context's job).
- Does NOT block on warnings — it informs routing decisions.

---

## 5. Tier 2: Worker Sandbox

The primary execution environment. Replaces the old "Tier 1 NativeEngine" and absorbs Tier 0's security responsibilities.

### Architecture

```typescript
// packages/shared/core/src/execution/WorkerContext.ts

export class WorkerContext implements ExecutionContext {
  private worker: Worker;
  private proxy: Remote<WorkerAPI>;  // Comlink

  static async create(config: WorkerContextConfig): Promise<WorkerContext> {
    const worker = new Worker(bootstrapBlobUrl, { type: 'module' });
    const proxy = wrap<WorkerAPI>(worker);

    // Initialize: load unenv polyfills, set up AtuaFS bridge, shadow browser globals
    await proxy.init({
      fsPort: config.fsPort,       // MessagePort to AtuaFS
      netPort: config.netPort,     // MessagePort to network proxy
      env: config.env,             // process.env values
      cwd: config.cwd,             // working directory
      nodeVersion: config.nodeVersion ?? '22.0.0',
    });

    return new WorkerContext(worker, proxy, config);
  }

  async eval(code: string, opts: EvalOpts = {}): Promise<ExecResult> {
    const timeout = opts.timeoutMs ?? 30_000;

    // The Worker IS the sandbox. Timeout IS the security.
    const result = await Promise.race([
      this.proxy.eval(code),
      this.timeoutPromise(timeout),
    ]);

    return result;
  }

  async spawn(command: string, args: string[] = [], opts: SpawnOpts = {}): Promise<ProcessResult> {
    // For Node.js-compatible commands (node, npx, tsc, etc.)
    return this.proxy.spawn(command, args, opts);
  }

  async destroy(): Promise<void> {
    this.worker.terminate();  // Hard kill. Browser reclaims everything.
    // Spawn a new Worker for the pool if needed — ~1ms
  }

  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        this.worker.terminate();  // Kill the Worker
        reject(new TimeoutError(`Execution exceeded ${ms}ms`));
      }, ms);
    });
  }
}
```

### Worker Bootstrap

The Worker bootstrap (already designed in the unified spec) sets up the Node.js-compatible environment:

1. Import unenv polyfills (fs → AtuaFS, crypto → WebCrypto, path, buffer, stream, http → fetch)
2. Import AtuaFS bridge via Comlink on the MessagePort
3. Set up `require()` backed by unenv + AtuaFS module cache
4. Shadow dangerous browser globals (`window`, `document`, `location`, `localStorage`, etc.)
5. Inject Node.js globals (`process`, `Buffer`, `__dirname`, `__filename`, `global`)
6. Ready signal → eval() available

### Why Workers Are Sufficient Security

A Worker is an OS-level thread with its own memory space. `Worker.terminate()` is not a polite request — it's `pthread_cancel` at the browser engine level. The Worker's entire JavaScript heap is deallocated. There is no way for code running inside a terminated Worker to continue executing, leak memory, or maintain handles.

Compared to QuickJS:

| Dimension | QuickJS interrupt | Worker.terminate() |
|---|---|---|
| Kill mechanism | Cooperative callback between bytecode ops | Browser engine kills the thread |
| Tight loop escape | Can delay interrupt for thousands of ops | Immediate — browser doesn't wait for JS |
| Memory cleanup | Manual — must call `dispose()` on QuickJS context | Automatic — entire heap freed by browser |
| Speed of execution | ~100x slower than V8 | Full V8 speed |
| Semantic compatibility | Different engine — subtle behavior differences | Same V8 engine as the rest of Chrome |
| Cost | ~1MB WASM download + instantiation | ~1ms to spawn, 0 bytes download |

---

## 6. Tier 3: AtuaBox (Linux Sandbox)

Defined fully in `atua-linux-sandbox-spec.md`. Summary of its role in the execution model:

AtuaBox boots real Alpine Linux inside v86's x86 JIT emulator. It provides hardware-level isolation — the guest OS runs inside WASM linear memory, behind a virtual CPU, with controlled filesystem apertures via virtio-9p. This is for:

- `npm install` with native postinstall scripts that call `gcc`/`make`
- Running arbitrary Linux binaries (ImageMagick, FFmpeg, LaTeX, etc.)
- Executing untrusted dependency code in complete isolation
- Testing Docker environments via container2wasm

The agent escalates to AtuaBox when a task requires something a Worker can't provide. See the AtuaBox spec for the full MCP tool surface (`box.spawn`, `box.exec`, `box.snapshot`, `box.destroy`).

---

## 7. The ExecutionContext Interface

All three tiers implement the same interface. The agent, Hashbrown runtime, and the Fabric hub don't know or care which implementation is running.

```typescript
// packages/shared/core/src/execution/types.ts

export interface ExecutionContext {
  /** Execute JavaScript code, return result */
  eval(code: string, opts?: EvalOpts): Promise<ExecResult>;

  /** Spawn a command (node, npx, shell, etc.) */
  spawn(command: string, args?: string[], opts?: SpawnOpts): Promise<ProcessResult>;

  /** Hard-kill the execution environment */
  destroy(): Promise<void>;

  /** Current status */
  status(): ContextStatus;
}

export interface EvalOpts {
  timeoutMs?: number;        // default: 30000 for Worker, 60000 for AtuaBox
  env?: Record<string, string>;
  cwd?: string;
  functions?: Record<string, (...args: unknown[]) => Promise<unknown>>; // host functions
}

export interface SpawnOpts {
  timeoutMs?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  streaming?: boolean;       // stream stdout/stderr as they arrive
}

export interface ExecResult {
  value: unknown;            // return value (eval) or exit code (spawn)
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type ContextStatus =
  | { state: 'idle' }
  | { state: 'executing'; startedAt: number }
  | { state: 'destroyed' };
```

### Three Implementations

```typescript
// Worker — fast, killable, for all JS/TS execution
export class WorkerContext implements ExecutionContext { /* ... */ }

// AtuaBox — heavy, isolated, for native binaries and untrusted code
export class AtuaBoxContext implements ExecutionContext {
  // Delegates to box.exec MCP tool under the hood
  async eval(code: string, opts?: EvalOpts): Promise<ExecResult> {
    // Write code to temp file via 9p, then: node /tmp/eval.js
    const tmpPath = '/mnt/atua/.atua/tmp/eval.js';
    await this.shell.exec(`cat > ${tmpPath} << 'ATUA_EOF'\n${code}\nATUA_EOF`);
    return this.shell.exec(`node ${tmpPath}`, opts?.timeoutMs);
  }

  async spawn(command: string, args?: string[], opts?: SpawnOpts): Promise<ProcessResult> {
    // Direct shell execution inside the Linux sandbox
    const cmd = [command, ...(args ?? [])].join(' ');
    return this.shell.exec(cmd, opts?.timeoutMs);
  }
}

// Inline — zero overhead, for trivial expressions (future ShadowRealm)
export class InlineContext implements ExecutionContext {
  async eval(code: string, opts?: EvalOpts): Promise<ExecResult> {
    // Same-thread eval with scope restriction
    // Currently: new Function() in a with() block to shadow globals
    // Future: ShadowRealm.evaluate() when browsers ship it
    const fn = new Function('__scope', `with(__scope) { return (${code}); }`);
    const result = fn(this.scopeProxy);
    return { value: result, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  }
}
```

---

## 8. Routing: Who Decides Which Tier

### The Capability System Decides

The agent doesn't pick an execution context directly. The routing is determined by what the code needs and how much it's trusted:

```typescript
// packages/shared/core/src/execution/ContextRouter.ts

export class ContextRouter {
  route(request: ExecRequest): ExecutionContext {
    // 1. Trivial expressions → InlineContext
    if (request.type === 'expression' && request.trusted && request.estimatedRisk === 'low') {
      return this.inlinePool.acquire();
    }

    // 2. Native binary or Docker → AtuaBox
    if (request.requiresLinux || request.requiresNativeBinary) {
      return this.atuaBoxPool.acquire();
    }

    // 3. Untrusted code that needs isolation beyond Workers → AtuaBox
    if (request.trust === 'untrusted' && request.source === 'npm-postinstall') {
      return this.atuaBoxPool.acquire();
    }

    // 4. Everything else → WorkerContext (default)
    return this.workerPool.acquire();
  }
}
```

### Trust Levels

| Source | Trust level | Default context |
|---|---|---|
| Agent-written app code (Pi/Conductor) | High | WorkerContext |
| User-edited code in IDE | High | WorkerContext |
| Hashbrown runtime functions | High | WorkerContext (or InlineContext for simple expressions) |
| npm package code (already installed) | Medium | WorkerContext |
| npm postinstall scripts | Low | AtuaBox (if available) or WorkerContext with strict timeout |
| User-uploaded scripts | Low | WorkerContext with short timeout |
| Unknown external code | Untrusted | AtuaBox |

### Agent Learning

The agent accumulates knowledge about which tools and packages require AtuaBox. This is stored in `/skills/` as MCP tool metadata:

```json
{
  "tool": "bash",
  "escalation_rules": [
    { "pattern": "convert|mogrify", "requires": "atuabox", "reason": "ImageMagick: native x86 binary" },
    { "pattern": "ffmpeg|ffprobe", "requires": "atuabox", "reason": "FFmpeg: native x86 binary" },
    { "pattern": "gcc|g\\+\\+|make", "requires": "atuabox", "reason": "C/C++ compilation" },
    { "pattern": "cargo build", "requires": "atuabox", "reason": "Rust compilation" }
  ]
}
```

First encounter: try Worker → fail (ENOENT) → retry in AtuaBox → succeed → save rule. Second encounter: route directly to AtuaBox.

---

## 9. ShadowRealm: Future Tier 0

TC39's ShadowRealm proposal is at Stage 2.7 as of February 2025. It provides a fresh JavaScript global environment with separate intrinsics, executing synchronously in the same thread.

### What ShadowRealm Is

```typescript
const realm = new ShadowRealm();
const result = realm.evaluate('1 + 1'); // → 2
const fn = await realm.importValue('./module.js', 'doStuff');
fn(); // runs in the realm's global scope
```

A ShadowRealm shares the same thread and heap as the host but has its own global object, its own `Object.prototype`, its own built-ins. Cross-realm communication is restricted to primitive values and wrapped functions (the "callable boundary"). No object references can leak across realms.

### What ShadowRealm Is NOT

- **Not a security sandbox.** The proposal explicitly says it doesn't provide availability protection. An infinite loop in a ShadowRealm blocks the host thread.
- **Not a memory sandbox.** Shares the same heap. No memory limits.
- **Not a network sandbox.** Web API exposure is still being defined (Stage 2.7 open question). The current direction excludes network APIs, but this isn't finalized.
- **Not shipped anywhere.** No browser ships it. Estimated: 2026-2027 at earliest.

### How Atua Would Use ShadowRealm (When Available)

ShadowRealm is perfect for the `InlineContext` — same-thread, synchronous evaluation of simple expressions and data transforms where the overhead of spawning a Worker is unnecessary:

```typescript
class InlineContext implements ExecutionContext {
  private realm: ShadowRealm;

  constructor() {
    this.realm = new ShadowRealm();
    // Inject safe host functions via importValue
  }

  async eval(code: string): Promise<ExecResult> {
    const result = this.realm.evaluate(code);
    return { value: result, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  }
}
```

Use cases: Hashbrown `useStructuredCompletion()` evaluating a chart config expression. Pi evaluating a JSON transform. Pure functions with no side effects.

ShadowRealm is NOT suitable for replacing Workers as the primary execution context — it can't be killed on timeout and doesn't provide memory isolation.

### Polyfill Strategy

Until ShadowRealm ships, `InlineContext` uses `new Function()` with a `with()` block to shadow globals. This is weaker isolation (same global scope accessible via tricks) but acceptable because InlineContext is only used for trusted, trivial expressions:

```typescript
// Polyfill: scope-restricted eval
const shadowedGlobals = {
  window: undefined, document: undefined, localStorage: undefined,
  fetch: undefined, XMLHttpRequest: undefined, WebSocket: undefined,
  // ... all browser globals nulled
};
const fn = new Function('__scope', `with(__scope) { return (${code}); }`);
const result = fn(new Proxy(shadowedGlobals, { has: () => true }));
```

The `Proxy` with `has: () => true` makes the `with()` block intercept all variable lookups, preventing access to anything not in the scope object. This is the same technique Salesforce uses for their Lightning Locker Service (pre-ShadowRealm).

---

## 10. What Happens to QuickJS

QuickJS is NOT removed from Atua entirely. It just stops being a pre-flight security gate.

### Where QuickJS Stays

**Hashbrown's internal runtime.** Hashbrown ships its own QuickJS WASM (~1MB) for executing LLM-generated runtime functions. The `@aspect/atua-ui` spec (Layer 3, Runtime Replacement) already replaces this with CatalystProc — but Hashbrown-without-Atua still uses QuickJS. We don't modify Hashbrown itself.

**Potential future use: edge deployment.** For embedded agents deployed to constrained environments (Raspberry Pi, bare metal) where a full V8 runtime isn't available, QuickJS via txiki.js remains the NanoClaw execution path. This is the embedded agent spec's domain, not the IDE's.

### Where QuickJS Goes Away

- **Tier 0 validation** — replaced by static analysis (§4)
- **`SandboxRunner.ts`** — replaced by WorkerContext with timeout
- **`runInSandbox()`** — replaced by `ContextRouter.route()` → WorkerContext
- **`TieredEngine.ts`** — replaced by `ContextRouter` + `ExecutionContext` interface
- **`quickjs-emscripten` dependency in `@aspect/atua-core`** — removed. Saves ~1MB download.

### Migration Path

| Old component | New component | Notes |
|---|---|---|
| `QuickJSEngine` | Removed from core | Stays in `@aspect/atua-embedded` for NanoClaw |
| `NativeEngine` | `WorkerContext` | Same architecture, cleaner interface |
| `TieredEngine` | `ContextRouter` | Routes to the right context instead of serial pipeline |
| `CodeValidator` (Tier 0) | `analyzeCode()` | Static analysis only, no execution |
| `SandboxRunner` | `WorkerContext.eval()` with timeout | Worker.terminate() replaces QuickJS interrupt |

---

## 11. BrowserPod: Competitive Reference

BrowserPod deserves a dedicated section because it's the closest direct competitor to Atua's runtime layer and validates several of Atua's architectural decisions.

### Architecture Comparison

| Dimension | Atua Hyperkernel | BrowserPod (CheerpOS) | WebContainers |
|---|---|---|---|
| **Kernel** | Rust `no_std` WASM (~30KB) | C++ WASM (CheerpOS, proprietary) | Custom WASM (proprietary) |
| **Node.js approach** | unenv polyfills + WASI guests | Compile real Node.js C++ to WASM via Cheerp | Compile Node.js V8 internals to WASM |
| **Filesystem** | OPFS via AtuaFS | Block-based streaming VFS | WASM-managed block store |
| **Networking** | ServiceWorker + relay | Portals (managed public URLs) | Invisible iframe relay (patented) |
| **Native binary support** | AtuaBox (v86, opt-in) | CheerpX integration (x86 JIT, planned EOY 2026) | Not supported |
| **License** | Open source (Atua core) | Proprietary (free for personal/OSS) | Proprietary |
| **Multi-language** | Via WASI guests (Pyodide, etc.) | Compiled runtimes (Node, Python, Ruby planned) | Node.js only |
| **IDE included** | Yes (build.atua.dev, ide.atua.dev) | No (embeddable library) | StackBlitz IDE |
| **Agent framework** | Pi/Conductor (built-in) | None (bring your own) | None |

### What BrowserPod Does Better

- **Node.js fidelity.** Compiling real Node.js to WASM via Cheerp gives higher compatibility than unenv polyfills. Edge cases in `fs`, `child_process`, `cluster` just work because it's the real C++ code.
- **Portals.** Public URLs for in-browser services are a clean abstraction. Atua's relay serves a similar purpose but Portals are more polished as a feature.
- **Multi-process.** Real process isolation via WebWorkers with CheerpOS coordinating. Each process is a separate Worker with its own WASM instance.

### What Atua Does Better

- **Open kernel.** Atua's hyperkernel is `no_std` Rust you can read, audit, and modify. ~30KB WASM. BrowserPod's CheerpOS is a black box.
- **Agent integration.** Pi/Conductor, Hive, Fabric MCP hub — the agentic stack is native. BrowserPod is a runtime you embed; Atua is a platform that thinks.
- **Dual-tier isolation.** Hyperkernel (fast) + AtuaBox (heavy isolation). BrowserPod plans CheerpX integration for native binaries but hasn't shipped it yet.
- **Generative UI.** Hashbrown/Sizzle integration means the agent can compose React components, not just execute code.
- **Standard output.** Generated apps are standard React + Hono that deploy anywhere. BrowserPod apps run inside BrowserPod.

### Strategic Implications

BrowserPod is a runtime library, not an IDE or agent platform. It doesn't compete with Atua-the-product. It competes with Atua's hyperkernel as an embeddable execution layer. If BrowserPod achieves significantly better Node.js compatibility than unenv polyfills (likely, given they're compiling real Node.js), Atua might consider:

1. **Ignore it.** unenv covers ~85-90% of npm. Good enough for an IDE + agent platform.
2. **Embed it.** Use BrowserPod as an alternative execution backend behind the `ExecutionContext` interface, for use cases where unenv compatibility isn't sufficient. Proprietary license is a blocker for this.
3. **Learn from it.** The CheerpOS architecture (compile language runtimes to WASM against a kernel syscall layer) could inform a future Atua enhancement where specific native runtimes are compiled to WASM and run as hyperkernel guests, rather than relying on polyfills.

Option 1 is correct for now. Revisit if BrowserPod open-sources CheerpOS (unlikely) or if unenv compatibility proves insufficient for real-world projects.

---

## 12. Implications for Existing Specs

### `catalyst-tiered-engine-plan.md`

**Phase A (Native Engine): Unchanged.** NativeEngine becomes WorkerContext. Same architecture.

**Phase B (Tier 0 Validation Layer): Replaced.** QuickJS as security gate is removed. Replace with `analyzeCode()` static analysis. `TieredEngine.ts` becomes `ContextRouter.ts`.

**Phase C onwards: Unchanged.** HTTP server, TCP bridge, cluster module, Deno API surface — all still valid. They operate inside WorkerContext.

### `atua-unified-spec.md`

**§7 (Worker Execution + Sandbox Validation):** Sandbox section rewrites. Remove QuickJS execution path. `runInSandbox()` → `WorkerContext.eval()` with timeout. Static analysis replaces QuickJS validation.

**§12 (WASI Guest Targets):** Unchanged. WASI guests (Rolldown, wa-sqlite, Pyodide) are hyperkernel-level, orthogonal to the execution context model.

### `hashbrown-atua-spec.md`

**Layer 3 (Runtime Replacement):** Simplified. `AtuaRuntime` no longer calls QuickJS validation before CatalystProc execution. It goes directly to WorkerContext:

```typescript
export class AtuaRuntime implements HashbrownRuntime {
  async execute(code: string): Promise<unknown> {
    // Static analysis only (advisory, not blocking)
    const analysis = analyzeCode(code);
    if (!analysis.valid) throw new RuntimeError(analysis.errors.join(', '));

    // Direct to Worker — no QuickJS pre-flight
    return this.workerContext.eval(code, { timeoutMs: 10_000, functions: this.functions });
  }
}
```

### `catalyst-codebase-audit.md`

The audit identified `quickjs-emscripten` as correctly used. This document formally removes it from core. The audit's other findings (hand-rolled semver, WASI bindings, tar parser, etc.) remain valid and unaffected.

---

## 13. Implementation Changes

### Files to Remove

```
packages/core/src/validation/SandboxRunner.ts     — replaced by WorkerContext
packages/core/src/engines/TieredEngine.ts          — replaced by ContextRouter
packages/core/src/validation/CodeValidator.ts       — replaced by analyzeCode()
```

### Files to Create

```
packages/shared/core/src/execution/types.ts              — ExecutionContext interface
packages/shared/core/src/execution/WorkerContext.ts       — V8 Worker implementation
packages/shared/core/src/execution/InlineContext.ts       — Same-thread eval (ShadowRealm-ready)
packages/shared/core/src/execution/AtuaBoxContext.ts      — v86 Linux sandbox adapter
packages/shared/core/src/execution/ContextRouter.ts       — Trust-based routing
packages/shared/core/src/execution/WorkerPool.ts          — Pre-warmed Worker pool
packages/shared/core/src/validation/StaticAnalysis.ts     — analyzeCode() — syntax + AST scan
```

### Files to Modify

```
packages/core/src/CatalystProc.ts     — use WorkerContext instead of TieredEngine
packages/core/src/index.ts            — export new execution API
package.json                          — remove quickjs-emscripten from core deps
```

### Dependency Changes

```diff
- "quickjs-emscripten": "^0.29.0"    // removed from @aspect/atua-core
  "comlink": "^4.4.1"                 // already needed
  # No new dependencies added
```

Net effect: **-1MB download** (QuickJS WASM removed), **-50-100ms latency per execution** (no pre-flight validation), **~200 lines of new code** (ContextRouter + StaticAnalysis), **~500 lines of removed code** (TieredEngine, SandboxRunner, CodeValidator).

---

## 14. Decision Log

| Decision | Chosen | Alternatives considered | Rationale |
|---|---|---|---|
| Remove QuickJS Tier 0 | Yes | Keep but make optional, keep as default | Every threat it catches is handled better by Workers. Costs 1MB + 50-100ms. Codebase audit found the fallback bypasses it entirely. |
| Replace with static analysis | OXC/`new Function()` | Keep QuickJS for syntax only, use no validation at all | Static analysis is ~microsecond, zero download. Catches syntax errors (the only thing that actually blocks execution). |
| Worker as primary sandbox | `Worker.terminate()` | QuickJS interrupt, ShadowRealm, iframe sandbox | Workers are already V8 isolates. `terminate()` is a hard kill. ~1ms spawn. Same engine as production. |
| AtuaBox for native code | v86 + Alpine Linux | container2wasm only, cloud sandbox, no support | v86 JIT is fastest browser x86 emulator. Alpine has 30K+ packages. Proven by Apptron. |
| ShadowRealm as future InlineContext | Watch, don't depend | Polyfill now, ignore entirely | Stage 2.7, no browser ships it. `with()` + Proxy polyfill is sufficient for the InlineContext use case. |
| Keep QuickJS for embedded agents | Yes, in `@aspect/atua-embedded` | Remove entirely, use V8 everywhere | txiki.js (QuickJS-based) is the NanoClaw runtime for constrained deployment targets. Different product surface. |
| BrowserPod integration | Monitor, don't embed | Embed as alternative backend, ignore | Proprietary license blocks embedding. Their CheerpOS architecture validates Atua's approach. Revisit if they open-source. |
