/**
 * atua.pkg MCP Provider — wraps PackageManager as 5 MCP tools.
 *
 * Provides package lifecycle management through the hub.
 */
import type { PackageManager } from '../../../../shared/core/src/pkg/PackageManager.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.pkg';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('install', 'Install a package (resolve, fetch, cache)', {
    name: { type: 'string', description: 'Package name', required: true },
    version: { type: 'string', description: 'Version range (default: latest)' },
  }),
  tool('resolve', 'Check if a package is installed and get its path', {
    name: { type: 'string', description: 'Package name', required: true },
  }),
  tool('list', 'List all installed packages', {}),
  tool('remove', 'Remove an installed package', {
    name: { type: 'string', description: 'Package name', required: true },
  }),
  tool('clear', 'Clear all installed packages', {}),
];

export function createAtuaPkgProvider(pm: PackageManager): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'install': {
          const info = await pm.install(a.name, a.version);
          return {
            content: {
              name: info.name,
              version: info.version,
              path: info.path,
              cached: info.cached,
            },
          };
        }
        case 'resolve': {
          const resolved = pm.resolve(a.name);
          return { content: { resolved } };
        }
        case 'list': {
          return { content: pm.list() };
        }
        case 'remove': {
          await pm.remove(a.name);
          return { content: { success: true } };
        }
        case 'clear': {
          await pm.clear();
          return { content: { success: true } };
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
    capabilities: ['pkg.install', 'pkg.resolve', 'pkg.remove'],
  });
}
