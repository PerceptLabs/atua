/**
 * @aspect/atua-deno — Distribution package for Full mode (Deno-in-WASM)
 *
 * Wires DenoEngine + DenoNativeLoader for 100% Node.js compatibility.
 *
 * Usage:
 *   import { Reaction } from '@aspect/atua-deno';
 *   const runtime = await Reaction.create({ name: 'my-app' });
 *   await runtime.eval('console.log("hello")');
 */

import { Atua } from '../../../shared/core/src/atua.js';
import type { AtuaConfig } from '../../../shared/core/src/atua.js';

export interface ReactionConfig extends AtuaConfig {
  wasm?: { wasmUrl?: string; cache?: boolean };
}

export class Reaction {
  static async create(config: ReactionConfig = {}): Promise<Atua> {
    return Atua.create(config);
  }
}

// Re-exports — Deno engine
export { DenoEngine, createDenoEngine, OpsBridge, DenoWasmLoader, DenoNativeLoader, createDenoNativeLoader,
  buildDenoNamespace, getDenoNamespaceSource }
  from '../../../engines/deno/src/index.js';
export type { DenoEngineConfig, OpsBridgeConfig, OpResult, DenoWasmInstance, WasmLoaderConfig, WasmCapabilities,
  WasmLoaderStatus, DenoApiConfig }
  from '../../../engines/deno/src/index.js';

// Re-exports — core runtime
export { Atua } from '../../../shared/core/src/atua.js';

// Re-exports — engine + validation
export {
  NativeEngine, NativeModuleLoader,
  checkCode, validateImports,
  AtuaHTTPServer, createHTTPServer, getHTTPModuleSource,
  AtuaDNS, getDNSModuleSource,
  AtuaTCPSocket, AtuaTCPServer, createConnection, getNetModuleSource,
  tlsConnect, createTLSServer, getTLSModuleSource,
  pipeProcesses, pipeToFile, pipeFromFile, teeProcess, collectOutput, collectErrors,
  AtuaCluster, getClusterModuleSource,
  AddonRegistry, NpmProcessRunner,
  WorkersComplianceGate,
} from '../../../shared/core/src/index.js';
export type {
  NativeEngineConfig,
  RequestHandler, SerializedHTTPRequest, SerializedHTTPResponse,
  DNSConfig, TCPConnectionOptions, TLSConnectionOptions,
  ClusterWorker, ClusterSettings,
  AddonEntry,
  NpmProcessRunnerConfig, ScriptRunResult, ScriptPhase,
  ComplianceResult, ComplianceError, ComplianceWarning,
} from '../../../shared/core/src/index.js';
