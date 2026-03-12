/**
 * Engines — All engine implementations and the shared IEngine interface
 *
 * QuickJSEngine: WASM-sandboxed execution (Tier 0 validation, Tier 2 Workers compat)
 * NativeEngine: Browser-native execution via Web Workers (Tier 1 full speed)
 * TieredEngine: Validates via Tier 0, executes via Tier 1 (added in Phase B)
 */
export { QuickJSEngine } from './QuickJSEngine.js';
export type { EngineConfig, ConsoleLevel } from './QuickJSEngine.js';

export { NativeEngine } from './native/index.js';
export type { NativeEngineConfig } from './native/index.js';
export { NativeModuleLoader } from './native/index.js';
export { getWorkerBootstrapSource, getShadowGlobalsCode, getNodeGlobalsCode } from './native/index.js';

export { TieredEngine } from './TieredEngine.js';
export type { TieredEngineConfig } from './TieredEngine.js';

export type {
  IEngine,
  IModuleLoader,
  EngineFactory,
  ModuleLoaderFactory,
  EngineInstanceConfig,
  EngineCapabilities,
  ModuleResolution,
  ModuleLoaderCapabilities,
  ModuleLoaderConfig,
} from './IEngine.js';
