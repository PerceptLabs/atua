/**
 * @aspect/atua-fabric — MCP Hub for Atua
 *
 * Unified protocol layer: every subsystem registers as a provider,
 * every consumer calls tools through the hub.
 */

// Hub
export { MCPHub } from './hub/hub.js';
export { ProviderRegistry } from './hub/registry.js';
export { TransactionLog } from './hub/transaction-log.js';

// Transports
export { MessageChannelTransport } from './transports/message-channel.js';
export type { ToolHandler } from './transports/message-channel.js';

// Providers
export { createProvider } from './providers/base-provider.js';
export type { ProviderConfig, ProviderHandler } from './providers/base-provider.js';
export { createAtuaFsProvider } from './providers/atua-fs-provider.js';
export { createAtuaD1Provider } from './providers/atua-d1-provider.js';
export { createAtuaBuildProvider } from './providers/atua-build-provider.js';

// Types
export type {
  ToolDefinition,
  ParameterDef,
  ProviderRegistration,
  CallContext,
  Transaction,
  ToolResult,
  Transport,
  ToolFilter,
  LogFilter,
  ProviderHealth,
} from './hub/types.js';
