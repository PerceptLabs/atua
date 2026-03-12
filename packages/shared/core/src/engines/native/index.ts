/**
 * NativeEngine — Browser-native JavaScript execution
 */
export { NativeEngine } from './NativeEngine.js';
export type { NativeEngineConfig } from './NativeEngine.js';
export { NativeModuleLoader } from './NativeModuleLoader.js';
export { getWorkerBootstrapSource } from './WorkerBootstrap.js';
export type { WorkerBootstrapConfig } from './WorkerBootstrap.js';
export { getShadowGlobalsCode, getNodeGlobalsCode, getBootstrapPreamble } from './GlobalScope.js';
