/**
 * Engines — Native V8 execution engine and shared IEngine interface
 *
 * NativeEngine: Browser-native execution via Web Workers
 */
export { NativeEngine } from './native/index.js';
export type { NativeEngineConfig } from './native/index.js';
export { NativeModuleLoader } from './native/index.js';
export { getWorkerBootstrapSource, getShadowGlobalsCode, getNodeGlobalsCode } from './native/index.js';

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
