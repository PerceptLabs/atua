/**
 * IEngine + IModuleLoader — Engine-agnostic abstraction boundary
 *
 * These interfaces define the contract between the engine layer (QuickJS, Deno)
 * and the rest of the system. The engine is a configuration choice, not an
 * architectural constraint.
 *
 * IEngine: Pure execution — eval, evalFile, createInstance, destroy, events.
 * IModuleLoader: How imports resolve — builtins, filesystem, npm packages.
 *
 * The distribution package wires engine + loader:
 *   Catalyst: QuickJSEngine + NodeCompatLoader
 *   Reaction: DenoEngine + DenoNativeLoader (future)
 */

// =========================================================================
// IEngine — Pure Execution
// =========================================================================

/** Configuration for creating an engine instance */
export interface EngineInstanceConfig {
  /** Virtual filesystem */
  fs?: unknown;
  /** Network proxy */
  net?: unknown;
  /** Module loader to use */
  moduleLoader?: IModuleLoader;
  /** Memory limit in MB */
  memoryLimit?: number;
  /** Execution timeout in ms */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/** Engine capability metadata */
export interface EngineCapabilities {
  name: string;
  jspiRequired: boolean;
  wasmSize: number;
  bootTime: number;
}

/**
 * IEngine — the abstraction for JavaScript execution.
 *
 * Strictly about executing JavaScript and managing WASM instances.
 * Does NOT own module resolution — that's IModuleLoader's job.
 */
export interface IEngine {
  /** Execute a string of JavaScript, return the result */
  eval(code: string, filename?: string): Promise<unknown>;

  /** Execute a file from the virtual filesystem */
  evalFile(path: string): Promise<unknown>;

  /** Create a new isolated instance (for child processes) */
  createInstance(config: EngineInstanceConfig): Promise<IEngine>;

  /** Destroy this instance, free WASM memory */
  destroy(): Promise<void>;

  /** Subscribe to engine events */
  on(event: string, handler: (...args: unknown[]) => void): void;

  /** Unsubscribe from engine events */
  off(event: string, handler: (...args: unknown[]) => void): void;
}

/** Factory function that creates an IEngine from config */
export type EngineFactory = (config: EngineInstanceConfig) => Promise<IEngine>;

// =========================================================================
// IModuleLoader — How Imports Resolve
// =========================================================================

/** Result of resolving a module specifier */
export interface ModuleResolution {
  type: 'builtin' | 'file' | 'package' | 'not-found';
  source?: string;
  path?: string;
  format?: 'cjs' | 'esm';
}

/** Module loader capability metadata */
export interface ModuleLoaderCapabilities {
  /** Node.js compatibility level (0-1) */
  nodeCompat: number;
  /** Whether the loader uses native module resolution (Deno) vs polyfilled */
  nativeModuleResolution: boolean;
  /** Strategy for resolving npm packages */
  npmStrategy: 'esm-sh' | 'native' | 'lockfile-only';
}

/**
 * IModuleLoader — module resolution abstraction.
 *
 * Separating resolution from execution means the same engine can serve
 * different resolution strategies:
 *   - NodeCompatLoader: unenv polyfills + CatalystPkg (esm.sh)
 *   - DenoNativeLoader: native npm: + node: resolution (future)
 *   - StrictWorkersLoader: Workers-only globals, no Node builtins (future)
 */
export interface IModuleLoader {
  /** Initialize async resources (load builtin sources, etc.) */
  initialize(): Promise<void>;

  /** List all available builtin module names */
  availableBuiltins(): string[];

  /** Get the source code for a pre-loaded builtin module */
  getBuiltinSource(name: string): string | undefined;

  /** Resolve a module specifier to source code (sync — called from require()) */
  resolveModule(specifier: string): string | null;

  /** Module loading capabilities */
  readonly capabilities: ModuleLoaderCapabilities;
}

/** Factory function that creates an IModuleLoader */
export type ModuleLoaderFactory = (config: ModuleLoaderConfig) => IModuleLoader;

/** Configuration for creating a module loader */
export interface ModuleLoaderConfig {
  /** Virtual filesystem for file-based module resolution */
  fs?: unknown;
  /** Environment variables (passed to process module) */
  env?: Record<string, string>;
}
