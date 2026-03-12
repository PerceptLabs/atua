# Catalyst Monorepo — Engine Abstraction & Dual Mode Architecture

> **Context:** Catalyst currently hardcodes QuickJS as the JS engine. This doc defines how to restructure as a monorepo where the engine is pluggable, enabling two distribution modes:
> - **Catalyst** (Workers mode) — QuickJS, lightweight, 505KB, embeddable, Workers-compatible
> - **Reaction** (Full mode) — Deno-in-WASM, V8 jitless, 100% Node compat, full npm

---

## 1. THE ABSTRACTION BOUNDARY

### Two Execution Contexts

This is the most important distinction in the architecture. Catalyst has two completely separate execution environments that must not be confused:

```
┌─────────────────────────────────────────────────────────────────┐
│  TOOLING CONTEXT                                                │
│  Where: QuickJS or Deno WASM instance (Web Worker)              │
│  What runs: build scripts, dev servers, linters, npm install    │
│  APIs available: fs, path, child_process, http — Node surface   │
│  Example: user types `npm run dev` in terminal                  │
│                                                                 │
│  This is where the ENGINE (QuickJS/Deno) and MODULE LOADER run. │
│  This context NEEDS Node.js APIs to function.                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  WORKER EXECUTION CONTEXT                                       │
│  Where: Service Worker (browser-native, no WASM engine)         │
│  What runs: pre-built Worker bundles, Nitro output, SSR         │
│  APIs available: Request, Response, fetch, env.*, ctx — Workers │
│  Example: CatalystWorkers loads a Nuxt bundle, handles requests │
│                                                                 │
│  This context MUST match Cloudflare Workers constraints.        │
│  No fs, no child_process, no Node APIs unless via nodejs_compat.│
└─────────────────────────────────────────────────────────────────┘
```

The tooling context runs your build. The Worker execution context runs your app. They are separate processes with separate APIs. `require('fs')` in a build script is fine — it's the tooling context using CatalystFS. `require('fs')` in a Worker bundle only works if the bundle was built with Cloudflare's `nodejs_compat` flag and goes through unenv, matching real Workers behavior.

This separation is why "Workers mode has fs" and "Workers mode is Cloudflare-compatible" are not contradictions. The tooling layer has fs. The Worker runtime does not (unless the Worker was built to expect it via nodejs_compat).

### Four Abstraction Boundaries

Four concerns are engine-specific or mode-specific. Everything else is shared.

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENGINE-SPECIFIC                               │
│                                                                 │
│  IEngine             How JS code executes (eval, lifecycle)     │
│  IModuleLoader       How require/import resolves (builtins,     │
│                      npm, relative paths — product decision)    │
│  CatalystProc        What WASM instance spawns per process      │
│  (wired at distribution level, not engine level)                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                     IEngine + IModuleLoader
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                    ENGINE-AGNOSTIC (shared)                      │
│                                                                 │
│  CatalystFS              OPFS filesystem                        │
│  CatalystNet             Fetch proxy + SW server                │
│  CatalystPkg             Package resolution + OPFS cache        │
│  CatalystDev             esbuild-wasm + HMR + preview           │
│  CatalystWorkers         Runtime shell + bindings (KV/D1/R2)    │
│  Nitro Preset            Build-time integration                 │
│  Framework Adapters      Astro, SvelteKit, Remix                │
└─────────────────────────────────────────────────────────────────┘
```

### IEngine — Pure Execution

The engine interface is strictly about executing JavaScript and managing WASM instances. It does NOT own module resolution — that's a separate interface because how imports resolve is a product decision, not an engine implementation detail.

```typescript
// packages/shared/engine-interface/src/engine.ts

export interface IEngine {
  /** Execute a string of JavaScript, return the result */
  eval(code: string): Promise<any>;

  /** Execute a file from the virtual filesystem */
  evalFile(path: string): Promise<any>;

  /** Create a new isolated instance (for CatalystProc child processes) */
  createInstance(config: EngineInstanceConfig): Promise<IEngine>;

  /** Destroy this instance, free WASM memory */
  destroy(): Promise<void>;

  /** Event emitter */
  on(event: 'console', handler: (level: string, ...args: any[]) => void): void;
  on(event: 'exit', handler: (code: number) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'timeout', handler: () => void): void;
  on(event: 'oom', handler: () => void): void;
}

export interface EngineInstanceConfig {
  fs: CatalystFS;
  net?: CatalystNet;
  moduleLoader: IModuleLoader;  // ← injected, not owned by engine
  memoryLimit?: number;    // MB
  timeout?: number;        // ms
  env?: Record<string, string>;
  cwd?: string;
}

export interface EngineCapabilities {
  name: 'quickjs' | 'deno';
  jspiRequired: boolean;
  wasmSize: number;          // bytes
  bootTime: number;          // ms estimate
}
```

### IModuleLoader — How Imports Resolve

Module resolution is a product-level choice, not an engine detail. Separating it means the same engine can serve different resolution strategies.

```typescript
// packages/shared/engine-interface/src/module-loader.ts

export interface IModuleLoader {
  /** Resolve a module specifier to loadable code or a builtin */
  resolve(specifier: string, referrer: string): Promise<ModuleResolution>;

  /** Which Node built-in modules are available */
  availableBuiltins(): string[];

  /** Module loading mode */
  capabilities: ModuleLoaderCapabilities;
}

export interface ModuleResolution {
  type: 'builtin' | 'file' | 'package' | 'not-found';
  source?: string;           // JS source code to execute
  path?: string;             // resolved filesystem path
  format?: 'cjs' | 'esm';
}

export interface ModuleLoaderCapabilities {
  nodeCompat: number;                   // 0.962 or 1.0
  nativeModuleResolution: boolean;      // false for QuickJS loaders, true for Deno
  npmStrategy: 'esm-sh' | 'native' | 'lockfile-only';
}
```

### Concrete Loader Implementations

The distribution package wires the engine to the appropriate loader:

```typescript
// packages/engines/quickjs/src/loaders/node-compat-loader.ts
// Default loader for Workers mode tooling context.
// require('fs') → unenv polyfill
// require('./foo') → CatalystFS read → eval
// require('express') → CatalystPkg → esm.sh → OPFS cache

// packages/engines/quickjs/src/loaders/strict-workers-loader.ts
// Hypothetical future: pure Workers globals, no Node builtins at all.
// require('fs') → throw Error('fs is not available in Workers mode')
// Only Web APIs + env bindings.

// packages/engines/deno/src/loaders/deno-native-loader.ts
// Deno's native npm: resolution + node: compat layer.
// import('npm:express') → Deno resolver → OPFS cache
// require('fs') → Deno's node:fs → ops bridge → CatalystFS
```

The distribution package picks both engine AND loader:

```typescript
// Catalyst (Workers mode) wires:
//   engine: QuickJSEngine
//   moduleLoader: NodeCompatLoader (unenv + CatalystPkg)

// Reaction (Full mode) wires:
//   engine: DenoEngine
//   moduleLoader: DenoNativeLoader (native npm: + node: resolution)
```

This means you could hypothetically run QuickJS with a strict Workers-only loader that refuses all Node builtins — same engine, different product behavior.

### How Each Engine Implements IEngine

**QuickJS (Workers mode):**
- `eval()` → `quickjs.evalCode(code)` in WASM
- `evalFile()` → read from CatalystFS → `quickjs.evalCode(contents)`
- `createInstance()` → new Web Worker → new QuickJS-WASM instance
- Module resolution: **delegated to injected IModuleLoader** (NodeCompatLoader by default)

**Deno (Reaction mode):**
- `eval()` → `deno.execute(code)` in WASM
- `evalFile()` → Deno's native file loading (reads from CatalystFS via ops)
- `createInstance()` → new Web Worker → new Deno-WASM instance
- Module resolution: **delegated to injected IModuleLoader** (DenoNativeLoader by default)

---

## 2. MONOREPO STRUCTURE

```
catalyst/
├── packages/
│   │
│   │── shared/                          # ENGINE-AGNOSTIC
│   │   ├── engine-interface/            # IEngine + IModuleLoader contracts
│   │   │   ├── src/
│   │   │   │   ├── engine.ts            # IEngine, EngineInstanceConfig
│   │   │   │   ├── module-loader.ts     # IModuleLoader, ModuleResolution
│   │   │   │   └── index.ts
│   │   │   └── package.json             # @aspect/catalyst-engine-interface
│   │   │
│   │   ├── fs/                          # CatalystFS — OPFS + watching
│   │   │   ├── src/
│   │   │   └── package.json             # @aspect/catalyst-fs
│   │   │
│   │   ├── net/                         # CatalystNet — fetch proxy + SW server
│   │   │   ├── src/
│   │   │   └── package.json             # @aspect/catalyst-net
│   │   │
│   │   ├── proc/                        # CatalystProc — process management
│   │   │   ├── src/                     # Takes IEngine, spawns via createInstance()
│   │   │   └── package.json             # @aspect/catalyst-proc
│   │   │
│   │   ├── pkg/                         # CatalystPkg — npm resolution + cache
│   │   │   ├── src/
│   │   │   │   ├── resolver.ts          # Registry resolution + esm.sh fetch
│   │   │   │   ├── cache.ts             # OPFS package cache
│   │   │   │   ├── lockfile.ts          # catalyst-lock.json management
│   │   │   │   ├── integrity.ts         # SHA-256 verification
│   │   │   │   └── index.ts
│   │   │   └── package.json             # @aspect/catalyst-pkg
│   │   │
│   │   ├── dev/                         # CatalystDev — esbuild + HMR
│   │   │   ├── src/
│   │   │   └── package.json             # @aspect/catalyst-dev
│   │   │
│   │   └── compliance/                  # Workers compliance test suite
│   │       ├── src/
│   │       │   ├── workers-compliance.test.ts
│   │       │   └── fixtures/
│   │       └── package.json             # @aspect/catalyst-compliance
│   │
│   ├── engines/                         # ENGINE-SPECIFIC
│   │   ├── quickjs/                     # QuickJS-WASM implementation
│   │   │   ├── src/
│   │   │   │   ├── engine.ts            # Implements IEngine
│   │   │   │   ├── host-bindings.ts     # unenv polyfills → QuickJS scope
│   │   │   │   ├── loaders/
│   │   │   │   │   ├── node-compat-loader.ts   # IModuleLoader: unenv + CatalystPkg
│   │   │   │   │   └── strict-workers-loader.ts # IModuleLoader: Workers-only globals
│   │   │   │   └── worker-entry.ts      # Web Worker entry for child processes
│   │   │   ├── wasm/                    # quickjs-emscripten WASM binary
│   │   │   └── package.json             # @aspect/catalyst-engine-quickjs
│   │   │
│   │   └── deno/                        # Deno-in-WASM (Reaction)
│   │       ├── src/
│   │       │   ├── engine.ts            # Implements IEngine
│   │       │   ├── ops-bridge.ts        # Deno ops → Catalyst browser backends
│   │       │   ├── libuv-shim.ts        # Tokio/libuv → browser async
│   │       │   ├── loaders/
│   │       │   │   └── deno-native-loader.ts   # IModuleLoader: native npm: + node:
│   │       │   └── worker-entry.ts      # Web Worker entry for child processes
│   │       ├── wasm/                    # Deno compiled to WASM (V8 jitless)
│   │       └── package.json             # @aspect/catalyst-engine-deno
│   │
│   ├── workers/                         # WORKERS COMPAT (engine-agnostic)
│   │   ├── catalyst-workers/            # Runtime shell + KV + R2
│   │   │   └── package.json             # @aspect/catalyst-workers
│   │   ├── catalyst-workers-d1/         # D1 (wa-sqlite, lazy)
│   │   │   └── package.json             # @aspect/catalyst-workers-d1
│   │   └── nitro-preset-catalyst/       # Nitro preset
│   │       └── package.json             # nitro-preset-catalyst
│   │
│   ├── adapters/                        # FRAMEWORK ADAPTERS (engine-agnostic)
│   │   ├── astro/                       # @aspect/catalyst-astro
│   │   ├── sveltekit/                   # @aspect/catalyst-sveltekit
│   │   └── remix/                       # @aspect/catalyst-remix
│   │
│   └── distributions/                   # CONSUMER-FACING PACKAGES
│       ├── catalyst/                    # Workers mode (QuickJS + everything)
│       │   ├── src/index.ts             # Wires QuickJS engine + NodeCompatLoader
│       │   └── package.json             # @aspect/catalyst
│       │
│       └── reaction/                    # Full mode (Deno + everything)
│           ├── src/index.ts             # Wires Deno engine + DenoNativeLoader
│           └── package.json             # @aspect/reaction
│
├── apps/
│   └── playground/                      # Demo app (can switch modes)
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## 3. THE SWAP MECHANISM

### Consumer Perspective

```typescript
// ─── Workers mode (lightweight, embeddable, 505KB) ───
import { Catalyst } from '@aspect/catalyst';

const runtime = await Catalyst.create({
  fs: { mounts: { '/project': { backend: 'opfs' } } },
  net: { allowlist: ['api.github.com'] },
  engine: { memoryLimit: 256, timeout: 30000 },
});

// ─── Full mode (Deno, V8, 100% npm) ───
import { Reaction } from '@aspect/reaction';

const runtime = await Reaction.create({
  fs: { mounts: { '/project': { backend: 'opfs' } } },
  net: { allowlist: ['api.github.com'] },
  engine: { memoryLimit: 512, timeout: 60000 },
});

// ─── SAME API FROM HERE DOWN ───
await runtime.engine.evalFile('/project/server.js');
const proc = runtime.proc.spawn('node', ['build.js']);
proc.stdout.on('data', (chunk) => console.log(chunk));
runtime.on('dev:build', (result) => { });
await runtime.destroy();
```

The consumer picks a package. The API is identical after that.

### Distribution Packages

```typescript
// packages/distributions/catalyst/src/index.ts
import { QuickJSEngine } from '@aspect/catalyst-engine-quickjs';
import { NodeCompatLoader } from '@aspect/catalyst-engine-quickjs/loaders';
import { createRuntime } from '@aspect/catalyst-core';

export class Catalyst {
  static async create(config: CatalystConfig) {
    return createRuntime({
      ...config,
      engineFactory: QuickJSEngine,
      moduleLoaderFactory: NodeCompatLoader,
    });
  }
}

export { Catalyst as default };
```

```typescript
// packages/distributions/reaction/src/index.ts
import { DenoEngine } from '@aspect/catalyst-engine-deno';
import { DenoNativeLoader } from '@aspect/catalyst-engine-deno/loaders';
import { createRuntime } from '@aspect/catalyst-core';

export class Reaction {
  static async create(config: ReactionConfig) {
    return createRuntime({
      ...config,
      engineFactory: DenoEngine,
      moduleLoaderFactory: DenoNativeLoader,
    });
  }
}

export { Reaction as default };
```

```typescript
// packages/shared/core/src/runtime.ts  (new shared package)
import type { IEngine, EngineFactory, IModuleLoader, ModuleLoaderFactory }
  from '@aspect/catalyst-engine-interface';

export interface RuntimeConfig {
  engineFactory: EngineFactory;
  moduleLoaderFactory: ModuleLoaderFactory;
  fs?: FSConfig;
  net?: NetConfig;
  proc?: ProcConfig;
  pkg?: PkgConfig;
  dev?: DevConfig;
  engine?: EngineConfig;
}

export async function createRuntime(config: RuntimeConfig): Promise<CatalystRuntime> {
  const fs = await CatalystFS.create(config.fs);
  const net = await CatalystNet.create(config.net);
  const pkg = await CatalystPkg.create({ fs });

  // Module loader is a product decision, wired by the distribution package
  const moduleLoader = await config.moduleLoaderFactory.create({ fs, net, pkg });

  const engine = await config.engineFactory.create({
    fs, net,
    moduleLoader,        // ← injected into engine, not owned by it
    memoryLimit: config.engine?.memoryLimit,
    timeout: config.engine?.timeout,
  });
  const proc = await CatalystProc.create({
    engineFactory: config.engineFactory,
    moduleLoaderFactory: config.moduleLoaderFactory,  // ← child processes get same loader
    fs, net,
    maxProcesses: config.proc?.maxProcesses,
  });
  const dev = config.dev ? await CatalystDev.create({ fs, engine, net }) : null;

  return new CatalystRuntime({ fs, net, engine, proc, pkg, dev });
}
```

### The CatalystProc Fix

Currently hardcoded to spawn QuickJS. With the interface:

```typescript
// packages/shared/proc/src/proc.ts

export class CatalystProc {
  private engineFactory: EngineFactory;

  static async create(config: { engineFactory: EngineFactory; fs: CatalystFS; /* ... */ }) {
    const proc = new CatalystProc();
    proc.engineFactory = config.engineFactory;
    // ...
    return proc;
  }

  async spawn(command: string, args: string[]): Promise<CatalystProcess> {
    // Create a new Web Worker
    const worker = new Worker(this.engineFactory.workerEntryUrl);

    // Worker loads the correct engine (QuickJS OR Deno)
    // and executes the command
    worker.postMessage({
      type: 'spawn',
      command,
      args,
      engineConfig: { /* fs handle, net handle, etc */ },
    });

    return new CatalystProcess(worker);
  }
}
```

The `engineFactory.workerEntryUrl` points to different Web Worker entry scripts:
- QuickJS: loads `quickjs-emscripten`, injects host bindings, runs code
- Deno: loads Deno-WASM, configures ops bridge, runs code

Same spawn mechanism, different WASM binary inside the Worker.

---

## 4. WHAT'S SHARED VS ENGINE-SPECIFIC

### Completely Shared (zero engine awareness)

| Package | Why it's engine-agnostic |
|---|---|
| `catalyst-fs` | OPFS operations. Both engines call the same FS API. |
| `catalyst-net` | Fetch proxy. Both engines route network the same way. |
| `catalyst-dev` | esbuild-wasm compilation. Operates on files, not engine. |
| `catalyst-workers` | Loads pre-built Worker bundles. Doesn't execute in QuickJS/Deno. |
| `catalyst-workers-d1` | wa-sqlite. Pure browser API. No engine involved. |
| `nitro-preset-catalyst` | Build-time only. Never sees the engine. |
| Framework adapters | Build-time only. Output fetch-handler bundles. |

### Engine-Specific

| Concern | QuickJS (Workers) | Deno (Reaction) |
|---|---|---|
| WASM binary | quickjs-emscripten (505KB) | Deno compiled to WASM (~15-30MB) |
| JS execution | `QuickJS.evalCode()` | `Deno.execute()` via ops |
| **IModuleLoader** | NodeCompatLoader (unenv + CatalystPkg + esm.sh) | DenoNativeLoader (native `npm:` + `node:`) |
| Node built-in modules | unenv polyfills injected as host bindings | Deno's native `node:` compat layer |
| Child process spawn | New Worker + new QuickJS instance + same loader | New Worker + new Deno instance + same loader |
| Sync I/O bridge | JSPI suspends QuickJS WASM | JSPI suspends Deno WASM |
| Node compat surface | 96.2% (unenv) | ~100% (Deno native) |
| `npm install` | CatalystPkg + esm.sh (lockfile-gated) | Deno's native npm resolution OR CatalystPkg |
| Boot time | ~100ms | ~1-3s |
| Total bundle | ~600KB | ~15-30MB (cached after first load) |

### Subtle Shared: CatalystPkg

In Workers mode, CatalystPkg is essential — it's how packages get resolved and loaded.

In Reaction mode, Deno has its own npm resolution via `npm:` specifiers. CatalystPkg could be bypassed entirely. But it's still useful for:
- OPFS caching (offline support)
- Lockfile management
- Consistency with the Workers mode workflow

So CatalystPkg stays shared but becomes optional in Reaction mode. Deno can use it or use its own resolution.

---

## 5. THE MODULE RESOLUTION SPLIT

Module resolution is a product decision, not an engine detail. The IModuleLoader interface makes this explicit — the distribution package wires the loader, not the engine.

### NodeCompatLoader (Workers mode — tooling context)

This loader runs in the **tooling context** (QuickJS executing build scripts, dev servers, etc.). It provides Node.js APIs so tooling works. This is NOT the Worker execution context.

```
require('fs')
  → NodeCompatLoader.resolve('fs')
    → type: 'builtin' → Return unenv polyfill (CatalystFS-backed)

require('./utils')
  → NodeCompatLoader.resolve('./utils', '/project/src/index.js')
    → type: 'file' → Read from CatalystFS, return source

require('express')
  → NodeCompatLoader.resolve('express')
    → Check OPFS cache (node_modules/express/)
    → If cached + lockfile match: type: 'package', return from cache
    → If lockfile exists but not cached: fetch from esm.sh with pinned version
    → If no lockfile: fetch from esm.sh (dev mode only, see below)
    → type: 'package', cache to OPFS
```

### DenoNativeLoader (Reaction mode)

Deno handles resolution internally. The loader is a thin adapter that defers to Deno's built-in `npm:` and `node:` resolution.

```
import express from 'npm:express'
  → DenoNativeLoader.resolve('npm:express')
    → Delegates to Deno's internal npm resolver
    → Downloads from registry (or OPFS cache)
    → type: 'package', Deno loads natively

require('fs')
  → DenoNativeLoader.resolve('fs')
    → type: 'builtin' → Deno's node:fs (real implementation, not polyfill)
    → I/O ops bridge to CatalystFS
```

### StrictWorkersLoader (hypothetical future)

A loader for pure Workers execution — no Node builtins at all. Only Web APIs and `env` bindings.

```
require('fs')
  → StrictWorkersLoader.resolve('fs')
    → throw Error('fs is not available in Workers mode. Use env.MY_KV or env.MY_R2.')
```

This could be used for testing that Worker bundles don't accidentally depend on Node APIs outside of `nodejs_compat`.

### CatalystPkg Lockfile Enforcement

CatalystPkg operates in two modes, controlled by the distribution package:

**Dev mode** (default in development):
- Live resolution from esm.sh allowed
- Packages cached to OPFS after first fetch
- `catalyst-lock.json` generated/updated automatically
- Integrity hashes (SHA-256) recorded per package

**Locked mode** (production builds, CI, reproducible environments):
- `catalyst-lock.json` REQUIRED — error if missing
- Only pinned versions from lockfile are fetched
- Integrity hash verification on every load from cache
- esm.sh fetch only for packages in the lockfile (no new resolution)
- Unknown specifiers → hard error, not silent fetch

```typescript
// packages/shared/pkg/src/index.ts

export interface PkgConfig {
  mode: 'dev' | 'locked';         // Distribution package sets this
  lockfilePath?: string;           // default: /project/catalyst-lock.json
  integrityCheck?: boolean;        // default: true in locked mode
  allowedRegistries?: string[];    // default: ['esm.sh', 'registry.npmjs.org']
}

export class CatalystPkg {
  async resolve(specifier: string): Promise<PackageResolution> {
    // 1. Check OPFS cache
    const cached = await this.cache.get(specifier);
    if (cached && this.verifyIntegrity(cached)) return cached;

    // 2. Check lockfile
    const locked = this.lockfile?.resolve(specifier);
    if (this.config.mode === 'locked' && !locked) {
      throw new Error(
        `Package "${specifier}" not in catalyst-lock.json. ` +
        `Run in dev mode first to resolve dependencies.`
      );
    }

    // 3. Fetch (with pinned version if lockfile exists)
    const version = locked?.version ?? 'latest';
    const result = await this.fetchFromEsmSh(specifier, version);

    // 4. Verify integrity if lockfile has hash
    if (locked?.integrity) {
      const hash = await this.computeSHA256(result.source);
      if (hash !== locked.integrity) {
        throw new Error(
          `Integrity check failed for "${specifier}@${version}". ` +
          `Expected ${locked.integrity}, got ${hash}.`
        );
      }
    }

    // 5. Cache and update lockfile (dev mode only)
    await this.cache.set(specifier, result);
    if (this.config.mode === 'dev') {
      await this.lockfile.update(specifier, result);
    }

    return result;
  }
}
```

The distribution package sets the mode:

```typescript
// Catalyst (Workers mode) — dev by default, locked in preview
const pkg = await CatalystPkg.create({
  fs,
  mode: config.production ? 'locked' : 'dev',
});

// Reaction (Full mode) — Deno handles resolution, CatalystPkg is cache-only
// DenoNativeLoader uses CatalystPkg.cache but not CatalystPkg.resolve
```

### What This Means for the Monorepo

Module loaders live inside engine packages (they know engine-specific binding patterns):

```
packages/engines/quickjs/src/loaders/node-compat-loader.ts
packages/engines/quickjs/src/loaders/strict-workers-loader.ts
packages/engines/deno/src/loaders/deno-native-loader.ts
```

CatalystPkg (`packages/shared/pkg/`) is shared infrastructure consumed by loaders:
- NodeCompatLoader calls `CatalystPkg.resolve()` for npm packages
- DenoNativeLoader uses `CatalystPkg.cache` for OPFS storage but resolves via Deno's native npm client

This separation means:
- Adding a new loader doesn't change the engine
- Adding a new engine doesn't change the loaders
- The lockfile/integrity system is shared across all loaders that use CatalystPkg

---

## 6. THE OPS BRIDGE (REACTION-SPECIFIC)

Deno's architecture uses "ops" — Rust functions exposed to JavaScript via V8 bindings. When JS calls `Deno.readFile()`, it invokes an op that calls into Rust, which calls the OS.

In Reaction mode, those ops need to call browser APIs instead of OS APIs:

```
Deno JS code
  → calls op_read_file (V8 → Rust boundary)
    → normally: Rust calls tokio::fs::read()
    → Reaction: Rust calls WASM import → JSPI bridge → CatalystFS.read()
```

This is the core engineering of the Deno-WASM compilation. Each Deno op gets a browser-backed implementation:

| Deno op category | Browser backend |
|---|---|
| `op_read_file`, `op_write_file`, `op_stat`, etc. | CatalystFS (OPFS) |
| `op_fetch` | CatalystNet (fetch proxy) |
| `op_spawn` | CatalystProc (Web Worker) |
| `op_crypto_*` | Web Crypto API (native) |
| `op_timer_*` | `setTimeout`/`setInterval` (native) |
| `op_net_listen`, `op_net_accept` | CatalystNet SW server |
| `op_worker_*` | Web Worker API (native) |

The JSPI sync bridge handles the async gap — Deno's Rust code expects sync returns from some ops, JSPI suspends the WASM execution while the browser resolves the async operation.

---

## 7. MIGRATION PATH — FROM CURRENT TO MONOREPO

### Critical Sequencing Rule

**Do not change behavior while restructuring.** Extract shared packages first (pure refactor, all tests pass). Only then introduce new interfaces, new loaders, or new engines. Mixing refactor risk with semantics risk is how monorepo migrations fail.

### Phase 1: Extract the Interface (no behavior change)

Current `@aspect/catalyst-engine` has QuickJS implementation mixed with the interface.

1. Define `IEngine` interface in new `engine-interface` package
2. Define `IModuleLoader` interface in `engine-interface` (but don't change how resolution works yet)
3. Refactor current engine to implement `IEngine`
4. Extract current module resolution into `NodeCompatLoader` implementing `IModuleLoader`
5. Refactor `CatalystProc` to accept `engineFactory` + `moduleLoaderFactory` instead of hardcoding QuickJS
6. All existing tests still pass — this is a refactor, not a feature change

### Phase 2: Restructure to Monorepo

Move from flat package structure to the directory layout above. Existing packages map directly:

```
catalyst-engine    → engines/quickjs/
catalyst-fs        → shared/fs/
catalyst-net       → shared/net/
catalyst-proc      → shared/proc/
catalyst-pkg       → shared/pkg/
catalyst-dev       → shared/dev/
catalyst-workers   → workers/catalyst-workers/
```

Add `distributions/catalyst/` that re-exports the QuickJS-based runtime with NodeCompatLoader wired. Existing consumers who import `@aspect/catalyst` see no change.

**Still no behavior change.** Just directory restructuring + distribution package wiring.

### Phase 3: CatalystPkg Lockfile Enforcement

Add locked mode to CatalystPkg. Integrity hash verification. Dev vs locked mode switch. This is a behavioral change but scoped to one package with clear opt-in semantics.

### Phase 4: Workers Compliance Gate

Add `packages/shared/compliance/` with the Workers compliance test suite (see Section 8). Run it against CatalystWorkers to validate the Worker execution context matches Cloudflare constraints. This gates the Worker execution context — not the tooling context.

### Phase 5: Deno Engine (Reaction)

This is the big work — compiling Deno to WASM with JSPI.

1. V8 jitless compiled to WASM via Emscripten
2. Deno's Rust runtime compiled to WASM via wasm-bindgen
3. Ops bridge wiring I/O to Catalyst browser backends
4. Tokio replaced with browser-async adapter
5. `engines/deno/` implements `IEngine`
6. `engines/deno/loaders/deno-native-loader.ts` implements `IModuleLoader`
7. `distributions/reaction/` re-exports the Deno-based runtime

### Phase 6: Reaction Stabilization

Run the full test suite against both engines. Run Workers compliance suite to verify Reaction mode's Worker execution context is still Cloudflare-compliant (it should be — same CatalystWorkers runtime shell). Identify gaps. Fix Deno-specific edge cases. Performance benchmarking.

### Backward Flow Rule

**Reaction's requirements MUST NOT flow backward into shared packages.** If Deno's ops bridge needs something from CatalystFS that Workers mode doesn't, that goes in `engines/deno/`, not `shared/fs/`. Shared packages evolve based on shared needs. Engine-specific needs stay in engine packages. This prevents Reaction from distorting Catalyst's Workers-pure core.

---

## 8. WORKERS COMPLIANCE GATE

If Catalyst claims "drop-in Workers runtime," that claim needs a test suite. The compliance gate validates the **Worker execution context** (Service Worker running pre-built bundles via CatalystWorkers) — NOT the tooling context (QuickJS/Deno running build scripts).

### Must-Pass: Workers Runtime APIs

These must work identically to Cloudflare Workers:

```
Request / Response / Headers / URL         — browser-native ✅
fetch() with standard options              — browser-native ✅
ReadableStream / WritableStream / Transform — browser-native ✅
TextEncoder / TextDecoder                  — browser-native ✅
crypto.subtle (Web Crypto)                 — browser-native ✅
structuredClone                            — browser-native ✅
AbortController / AbortSignal              — browser-native ✅
caches (CacheStorage API)                  — browser-native ✅
setTimeout / setInterval                   — browser-native ✅
console.*                                  — browser-native ✅
atob / btoa                                — browser-native ✅
Event / EventTarget                        — browser-native ✅
```

### Must-Pass: Execution Context

```
ctx.waitUntil(promise)                     — extends SW lifetime
ctx.passThroughOnException()               — sets fallthrough flag
export default { fetch(req, env, ctx) }    — module format loading
env.* contains configured bindings         — KV, D1, R2, secrets, vars
Multiple workers with route isolation      — pattern matching
Worker error → 500 (not SW crash)          — error boundary
```

### Must-Pass: Bindings API Shape

Each binding must match Cloudflare's published TypeScript types:

```
KVNamespace: get, put, delete, list, getWithMetadata
D1Database: prepare, exec, batch, dump
D1PreparedStatement: bind, first, all, raw, run
R2Bucket: get, put, delete, list, head
R2Object: body (ReadableStream), httpMetadata, customMetadata
```

### Must-Fail: Forbidden in Worker Context

These must NOT be available in the Worker execution context (they exist in the tooling context only):

```
require('fs')             — Error or undefined (unless nodejs_compat)
require('child_process')  — Error or undefined
require('net')            — Error or undefined
process.exit()            — Error or no-op
global.__dirname          — undefined
global.__filename         — undefined
```

If a Worker bundle was built with Cloudflare's `nodejs_compat` flag, it expects unenv polyfills for a subset of Node APIs. CatalystWorkers should provide these the same way `workerd` does — via unenv, with the same gaps and the same behaviors.

### Compliance Test Structure

```
packages/shared/compliance/
├── src/
│   ├── runtime-apis.test.ts        # Web APIs present and functional
│   ├── execution-context.test.ts   # waitUntil, passThroughOnException
│   ├── bindings-kv.test.ts         # KV API shape and behavior
│   ├── bindings-d1.test.ts         # D1 API shape and behavior
│   ├── bindings-r2.test.ts         # R2 API shape and behavior
│   ├── forbidden-apis.test.ts      # Node APIs absent in Worker scope
│   ├── module-format.test.ts       # export default { fetch } loading
│   └── error-isolation.test.ts     # Worker crash → 500, not SW death
├── fixtures/
│   ├── compat-worker.js            # Tests all runtime APIs
│   ├── binding-worker.js           # Tests all binding types
│   └── forbidden-worker.js         # Tries to access Node APIs
└── package.json                    # @aspect/catalyst-compliance
```

This suite runs in CI. Both Catalyst (Workers mode) and Reaction (Full mode) must pass it — the Worker execution context is the same CatalystWorkers runtime shell regardless of which engine runs the tooling layer.

---

## 9. WHEN TO USE WHICH

| Use Case | Catalyst (Workers) | Reaction (Full) |
|---|---|---|
| Embed code playground in docs | ✅ (505KB, instant boot) | ❌ (15MB overkill) |
| Tutorial site with live examples | ✅ | ❌ |
| Workers preview/testing | ✅ (native target) | ❌ |
| Full IDE experience | ❌ | ✅ (100% npm compat) |
| `npm install` heavy projects | ❌ (esm.sh limitations) | ✅ (native npm) |
| Run Next.js/Remix dev mode | ❌ | ✅ |
| Run Vite natively | ❌ | ✅ |
| Mobile browser / low-end device | ✅ (tiny footprint) | ❌ (15MB + RAM) |
| Offline-first lightweight tools | ✅ | ❌ |
| Enterprise IDE replacement | ❌ | ✅ |

Not competing products. Complementary modes of the same platform. Same filesystem, same networking, same security model, same bindings (KV/D1/R2). Different engine underneath.

---

## 10. PACKAGE DEPENDENCY GRAPH

```
@aspect/catalyst-engine-interface     ← IEngine + IModuleLoader contracts
    │
    ├── @aspect/catalyst-engine-quickjs   ← implements IEngine + ships NodeCompatLoader
    │       depends on: engine-interface, quickjs-emscripten, unenv
    │
    └── @aspect/catalyst-engine-deno      ← implements IEngine + ships DenoNativeLoader
            depends on: engine-interface, deno-wasm (custom build)

@aspect/catalyst-fs                   ← OPFS, no engine dependency
@aspect/catalyst-net                  ← fetch proxy, no engine dependency
@aspect/catalyst-proc                 ← depends on engine-interface (EngineFactory + ModuleLoaderFactory)
@aspect/catalyst-pkg                  ← depends on catalyst-fs, owns lockfile + integrity
@aspect/catalyst-dev                  ← depends on catalyst-fs, esbuild-wasm
@aspect/catalyst-compliance           ← depends on catalyst-workers (tests Worker execution context)

@aspect/catalyst-workers              ← depends on catalyst-fs (for KV/R2), no engine
@aspect/catalyst-workers-d1           ← depends on wa-sqlite, no engine
nitro-preset-catalyst                 ← build-time only, no runtime deps

@aspect/catalyst                      ← depends on EVERYTHING + engine-quickjs + NodeCompatLoader
@aspect/reaction                      ← depends on EVERYTHING + engine-deno + DenoNativeLoader
```

No circular dependencies. Engine packages depend only on the interface. Shared packages depend on each other (fs → net is fine, proc → engine-interface). Distribution packages pull it all together.
