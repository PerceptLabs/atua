/**
 * IEngine + IModuleLoader — Engine-agnostic abstraction boundary
 *
 * Re-exported from engine/interfaces.ts for the new engines/ directory structure.
 * Both QuickJSEngine and NativeEngine implement these interfaces.
 */
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
} from '../engine/interfaces.js';

export type { EngineConfig, ConsoleLevel } from '../engine/CatalystEngine.js';
