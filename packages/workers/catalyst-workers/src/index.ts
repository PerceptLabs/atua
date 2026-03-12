/**
 * @aspect/catalyst-workers — Cloudflare Workers runtime emulation
 *
 * Provides browser-native implementations of KV, R2, and D1 (via separate package)
 * backed by IndexedDB and OPFS, plus a runtime shell for loading and executing
 * Worker bundles with bindings and route matching.
 */

// Bindings
export { CatalystKV } from './bindings/kv.js';
export { CatalystR2 } from './bindings/r2.js';
export type {
  // KV types
  KVGetType,
  KVPutOptions,
  KVListOptions,
  KVListKey,
  KVListResult,
  KVValueWithMetadata,
  // R2 types
  R2PutOptions,
  R2ListOptions,
  R2HttpMetadata,
  R2ObjectMetadata,
  R2ObjectBody,
  R2Objects,
  // D1 types
  D1Result,
  D1Meta,
  D1ExecResult,
} from './bindings/types.js';

// Runtime shell
export { CatalystWorkers, matchRoute } from './runtime.js';
export type {
  WorkerFetchHandler,
  WorkerModule,
  WorkerConfig,
  CatalystWorkersConfig,
} from './runtime.js';

// Execution context
export { CatalystExecutionContext } from './context.js';

// Workers globals
export { injectWorkersGlobals } from './globals.js';

// Wrangler config parser
export { parseWranglerConfig } from './wrangler-config.js';
export type { BindingConfig, ParsedWranglerConfig } from './wrangler-config.js';
