/**
 * @aspect/reaction — Distribution package for Full mode (Deno-in-WASM)
 *
 * Wires DenoEngine + DenoNativeLoader for 100% Node.js compatibility.
 *
 * Usage:
 *   import { Reaction } from '@aspect/reaction';
 *   const runtime = await Reaction.create({ name: 'my-app' });
 *   await runtime.engine.evalFile('/project/server.js');
 */

import { Catalyst } from '../../../shared/core/src/catalyst.js';
import type { CatalystConfig } from '../../../shared/core/src/catalyst.js';
import { createDenoEngine } from '../../../engines/deno/src/engine.js';
import { createDenoNativeLoader } from '../../../engines/deno/src/loaders/deno-native-loader.js';

export interface ReactionConfig extends Omit<CatalystConfig, 'engineFactory' | 'moduleLoaderFactory'> {
  wasm?: { wasmUrl?: string; cache?: boolean };
}

export class Reaction {
  static async create(config: ReactionConfig = {}): Promise<Catalyst> {
    return Catalyst.create({
      ...config,
      engineFactory: createDenoEngine,
      moduleLoaderFactory: createDenoNativeLoader,
    });
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
export { Catalyst } from '../../../shared/core/src/catalyst.js';

// Re-exports — tiered engine architecture
export {
  QuickJSEngine, NativeEngine, NativeModuleLoader, TieredEngine,
  CodeValidator, checkCode, validateImports, runInSandbox,
  CatalystHTTPServer, createHTTPServer, getHTTPModuleSource,
  CatalystDNS, getDNSModuleSource,
  CatalystTCPSocket, CatalystTCPServer, createConnection, getNetModuleSource,
  tlsConnect, createTLSServer, getTLSModuleSource,
  pipeProcesses, pipeToFile, pipeFromFile, teeProcess, collectOutput, collectErrors,
  CatalystCluster, getClusterModuleSource,
  NpmRegistryClient, AddonRegistry, NpmProcessRunner,
  WorkersComplianceGate,
} from '../../../shared/core/src/index.js';
export type {
  NativeEngineConfig, TieredEngineConfig,
  ValidationResult, ValidatorConfig,
  RequestHandler, SerializedHTTPRequest, SerializedHTTPResponse,
  DNSConfig, TCPConnectionOptions, TLSConnectionOptions,
  ClusterWorker, ClusterSettings,
  NpmRegistryConfig, PackageMetadata, InstallResult, AddonEntry,
  NpmProcessRunnerConfig, ScriptRunResult, ScriptPhase,
  ComplianceResult, ComplianceError, ComplianceWarning,
} from '../../../shared/core/src/index.js';
