/**
 * atua.d1 MCP Provider — wraps AtuaD1 (wa-sqlite) as 5 MCP tools.
 *
 * Exposes SQL query, execute, exec (DDL), batch, and table listing.
 */
import type { AtuaD1 } from '../../../../workers/atua-workers-d1/src/d1.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.d1';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('query', 'Execute a SELECT query and return rows', {
    sql: { type: 'string', description: 'SQL query', required: true },
    params: { type: 'array', description: 'Bind parameters' },
  }),
  tool('execute', 'Execute an INSERT/UPDATE/DELETE statement', {
    sql: { type: 'string', description: 'SQL statement', required: true },
    params: { type: 'array', description: 'Bind parameters' },
  }),
  tool('exec', 'Execute DDL (CREATE/DROP/ALTER)', {
    sql: { type: 'string', description: 'DDL statement', required: true },
  }),
  tool('batch', 'Execute multiple statements atomically', {
    statements: {
      type: 'array',
      description: 'Array of {sql, params?} objects',
      required: true,
    },
  }),
  tool('tables', 'List all tables with schema info', {}),
];

export function createAtuaD1Provider(d1: AtuaD1): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'query': {
          let stmt = d1.prepare(a.sql);
          if (a.params?.length) stmt = stmt.bind(...a.params);
          const result = await stmt.all();
          return { content: { results: result.results, meta: result.meta } };
        }
        case 'execute': {
          let stmt = d1.prepare(a.sql);
          if (a.params?.length) stmt = stmt.bind(...a.params);
          const result = await stmt.run();
          return { content: { meta: result.meta } };
        }
        case 'exec': {
          const result = await d1.exec(a.sql);
          return { content: result };
        }
        case 'batch': {
          const stmts = (a.statements as Array<{ sql: string; params?: unknown[] }>).map(
            (s) => {
              let stmt = d1.prepare(s.sql);
              if (s.params?.length) stmt = stmt.bind(...s.params);
              return stmt;
            },
          );
          const results = await d1.batch(stmts);
          return { content: results };
        }
        case 'tables': {
          const result = await d1
            .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all();
          return { content: result.results };
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
    capabilities: ['db.read', 'db.write'],
  });
}
