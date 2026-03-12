/**
 * atua.build MCP Provider — wraps BuildPipeline as 3 MCP tools.
 *
 * Cross-provider routing: before building, reads the entry point
 * through hub.callTool("atua.fs.read", ...) to prove routing works.
 * The actual build uses AtuaFS directly (sync/async boundary).
 */
import type { BuildPipeline, BuildResult } from '../../../../shared/core/src/dev/BuildPipeline.js';
import type { MCPHub } from '../hub/hub.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.build';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('run', 'Run a build', {
    entryPoint: { type: 'string', description: 'Entry point path (default: /src/index.tsx)' },
    outDir: { type: 'string', description: 'Output directory (default: /dist)' },
    minify: { type: 'boolean', description: 'Minify output' },
  }),
  tool('status', 'Get last build status', {}),
  tool('resolve', 'Resolve an import specifier to a file path', {
    specifier: { type: 'string', description: 'Import specifier', required: true },
    from: { type: 'string', description: 'Importing file path', required: true },
  }),
];

export function createAtuaBuildProvider(
  pipeline: BuildPipeline,
  hub: MCPHub,
): ProviderRegistration {
  let lastResult: BuildResult | null = null;

  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'run': {
          const entryPoint = a.entryPoint ?? '/src/index.tsx';

          // Cross-provider routing: read the entry point through the hub
          // This proves that atua.build routes to atua.fs via the hub
          const readResult = await hub.callTool(
            'atua.fs.read',
            { path: entryPoint },
            { caller: NS },
          );

          if (readResult.isError) {
            return {
              content: `Entry point '${entryPoint}' not readable: ${readResult.content}`,
              isError: true,
            };
          }

          // Actual build uses BuildPipeline (which reads fs directly for sync operations)
          const result = await pipeline.build({
            entryPoint,
            outDir: a.outDir,
            minify: a.minify,
          });

          lastResult = result;

          return {
            content: {
              outputPath: result.outputPath,
              hash: result.hash,
              cached: result.cached,
              duration: result.duration,
              errors: result.errors,
            },
          };
        }
        case 'status': {
          if (!lastResult) {
            return { content: { built: false } };
          }
          return {
            content: {
              built: true,
              outputPath: lastResult.outputPath,
              hash: lastResult.hash,
              cached: lastResult.cached,
              duration: lastResult.duration,
              errorCount: lastResult.errors.length,
            },
          };
        }
        case 'resolve': {
          // Simple relative path resolution
          const from = a.from as string;
          const specifier = a.specifier as string;

          if (specifier.startsWith('.')) {
            const dir = from.substring(0, from.lastIndexOf('/'));
            const resolved = dir + '/' + specifier.replace(/^\.\//, '');
            return { content: { resolved } };
          }

          return { content: { resolved: specifier, external: true } };
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
    capabilities: ['build'],
  });
}
