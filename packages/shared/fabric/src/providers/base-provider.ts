/**
 * Base provider helper — factory for creating MCP provider registrations.
 *
 * Reduces boilerplate: pass namespace, tool definitions, and a handler function;
 * get back a fully formed ProviderRegistration with MessageChannelTransport.
 */
import type { ProviderRegistration, ToolDefinition, ToolResult } from '../hub/types.js';
import { MessageChannelTransport } from '../transports/message-channel.js';

export type ProviderHandler = (tool: string, args: unknown) => Promise<ToolResult>;

export interface ProviderConfig {
  namespace: string;
  tools: ToolDefinition[];
  handler: ProviderHandler;
  capabilities?: string[];
}

/**
 * Create a ProviderRegistration from a simplified config.
 */
export function createProvider(config: ProviderConfig): ProviderRegistration {
  const transport = new MessageChannelTransport(config.handler);

  return {
    namespace: config.namespace,
    tools: config.tools,
    transport,
    capabilities: config.capabilities,
  };
}
