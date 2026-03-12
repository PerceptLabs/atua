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
