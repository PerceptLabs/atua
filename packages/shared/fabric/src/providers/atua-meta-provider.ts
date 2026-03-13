/**
 * atua.meta MCP Provider — hub introspection as 6 MCP tools.
 *
 * Provides self-description, health monitoring, log access,
 * and server management (install, health).
 */
import type { MCPHub } from '../hub/hub.js';
import type { ServerManager } from '../hub/server-manager.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.meta';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('capabilities', 'List all registered providers, tool counts, and transport types', {}),
  tool('health', 'Get per-provider health status', {}),
  tool('log', 'Query the transaction log', {
    provider: { type: 'string', description: 'Filter by provider namespace' },
    tool: { type: 'string', description: 'Filter by tool name' },
    caller: { type: 'string', description: 'Filter by caller' },
    limit: { type: 'number', description: 'Max entries to return' },
  }),
  tool('version', 'Get runtime version info', {}),
  tool('install_server', 'Install and register a local MCP server', {
    name: { type: 'string', description: 'Unique server name', required: true },
    source: { type: 'string', description: 'Source specifier (local:/path or npm:package)', required: true },
    env: { type: 'object', description: 'Environment variables for the server' },
    capabilities: { type: 'object', description: 'Capability declarations (fs, network, db, proc, preview)', required: true },
  }),
  tool('server_health', 'Get status for all managed MCP servers', {}),
];

export function createAtuaMetaProvider(
  hub: MCPHub,
  serverManager?: ServerManager,
): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'capabilities': {
          const allTools = hub.listTools();
          const health = hub.getProviderHealth();

          // Group tools by registered provider namespace
          const healthKeys = Object.keys(health);
          const consolidated: Record<string, { toolCount: number; tools: string[]; status: string }> = {};

          for (const t of allTools) {
            // Find which registered provider owns this tool
            // e.g. atua.preview.dom.query → find "atua.preview" in healthKeys
            const providerNs = healthKeys.find((k) => t.name === k || t.name.startsWith(k + '.')) ?? t.name;
            if (!consolidated[providerNs]) {
              const h = health[providerNs];
              consolidated[providerNs] = {
                toolCount: 0,
                tools: [],
                status: h?.status ?? 'unknown',
              };
            }
            consolidated[providerNs].toolCount++;
            consolidated[providerNs].tools.push(t.name);
          }

          return {
            content: {
              providerCount: healthKeys.length,
              totalTools: allTools.length,
              providers: consolidated,
            },
          };
        }
        case 'health': {
          return { content: hub.getProviderHealth() };
        }
        case 'log': {
          const log = hub.getLog({
            provider: a.provider,
            tool: a.tool,
            caller: a.caller,
            limit: a.limit,
          });
          return {
            content: log.map((tx) => ({
              id: tx.id,
              timestamp: tx.timestamp,
              caller: tx.caller,
              provider: tx.provider,
              tool: tx.tool,
              durationMs: tx.durationMs,
              transport: tx.transport,
              error: tx.error,
            })),
          };
        }
        case 'version': {
          return {
            content: {
              version: '0.0.1',
              runtime: 'atua',
              platform: 'browser',
            },
          };
        }
        case 'install_server': {
          if (!serverManager) {
            return { content: 'ServerManager not configured', isError: true };
          }
          await serverManager.install({
            name: a.name,
            source: a.source,
            env: a.env,
            capabilities: a.capabilities,
          });
          return { content: { installed: true, name: a.name } };
        }
        case 'server_health': {
          if (!serverManager) {
            return { content: 'ServerManager not configured', isError: true };
          }
          const statuses = serverManager.getAllStatus();
          const result: Record<string, any> = {};
          for (const [name, status] of statuses) {
            result[name] = status;
          }
          return { content: result };
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
    capabilities: ['meta.capabilities', 'meta.health', 'meta.log'],
  });
}
