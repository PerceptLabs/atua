/**
 * atua.net MCP Provider — wraps FetchProxy as 3 MCP tools.
 *
 * Provides network access control and proxied fetch through the hub.
 */
import type { FetchProxy } from '../../../../shared/core/src/net/FetchProxy.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.net';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('fetch', 'Fetch a URL through the proxy (respects allowlist/blocklist)', {
    url: { type: 'string', description: 'URL to fetch', required: true },
    method: { type: 'string', description: 'HTTP method (default: GET)' },
    headers: { type: 'object', description: 'Request headers' },
    body: { type: 'string', description: 'Request body' },
  }),
  tool('config', 'Get current FetchProxy configuration', {}),
  tool('allowed', 'Check if a URL is allowed by the proxy', {
    url: { type: 'string', description: 'URL to check', required: true },
  }),
];

export function createAtuaNetProvider(proxy: FetchProxy): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'fetch': {
          const init: RequestInit = {};
          if (a.method) init.method = a.method;
          if (a.headers) init.headers = a.headers;
          if (a.body) init.body = a.body;

          const response = await proxy.fetch(a.url, init);
          return {
            content: {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              url: response.url,
              body: response.body,
            },
          };
        }
        case 'config': {
          return { content: proxy.getConfig() };
        }
        case 'allowed': {
          return { content: { allowed: proxy.isDomainAllowed(a.url) } };
        }
        default:
          return { content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (err) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }
  }

  return createProvider({
    namespace: NS,
    tools: TOOLS,
    handler,
    capabilities: ['net.fetch'],
  });
}
