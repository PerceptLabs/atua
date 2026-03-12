/**
 * atua.fs MCP Provider — wraps AtuaFS as 10 MCP tools.
 *
 * All filesystem operations are exposed through the hub.
 */
import type { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.fs';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('read', 'Read file contents', {
    path: { type: 'string', description: 'File path', required: true },
    encoding: { type: 'string', description: 'Encoding (default: utf-8)' },
  }),
  tool('write', 'Write content to a file', {
    path: { type: 'string', description: 'File path', required: true },
    content: { type: 'string', description: 'File content', required: true },
    encoding: { type: 'string', description: 'Encoding (default: utf-8)' },
  }),
  tool('mkdir', 'Create a directory', {
    path: { type: 'string', description: 'Directory path', required: true },
    recursive: { type: 'boolean', description: 'Create parent directories' },
  }),
  tool('readdir', 'List directory entries', {
    path: { type: 'string', description: 'Directory path', required: true },
  }),
  tool('stat', 'Get file metadata (size, mtime, isDirectory)', {
    path: { type: 'string', description: 'File path', required: true },
  }),
  tool('unlink', 'Delete a file', {
    path: { type: 'string', description: 'File path', required: true },
  }),
  tool('rename', 'Rename or move a file', {
    oldPath: { type: 'string', description: 'Current path', required: true },
    newPath: { type: 'string', description: 'New path', required: true },
  }),
  tool('exists', 'Check if a file or directory exists', {
    path: { type: 'string', description: 'Path to check', required: true },
  }),
  tool('copy', 'Copy a file', {
    src: { type: 'string', description: 'Source path', required: true },
    dest: { type: 'string', description: 'Destination path', required: true },
  }),
  tool('watch', 'Watch a path for changes (fire-and-forget)', {
    path: { type: 'string', description: 'Path to watch', required: true },
    recursive: { type: 'boolean', description: 'Watch recursively' },
  }),
];

export function createAtuaFsProvider(fs: AtuaFS): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'read': {
          const content = fs.readFileSync(a.path, a.encoding ?? 'utf-8');
          return { content: typeof content === 'string' ? content : Array.from(content) };
        }
        case 'write': {
          fs.writeFileSync(a.path, a.content, a.encoding ? { encoding: a.encoding } : undefined);
          return { content: { success: true } };
        }
        case 'mkdir': {
          fs.mkdirSync(a.path, { recursive: a.recursive ?? false });
          return { content: { success: true } };
        }
        case 'readdir': {
          const entries = fs.readdirSync(a.path);
          return { content: entries };
        }
        case 'stat': {
          const stat = fs.statSync(a.path);
          return {
            content: {
              size: stat.size,
              mtime: stat.mtimeMs ?? stat.mtime?.getTime?.() ?? 0,
              isDirectory: stat.isDirectory(),
              isFile: stat.isFile(),
            },
          };
        }
        case 'unlink': {
          fs.unlinkSync(a.path);
          return { content: { success: true } };
        }
        case 'rename': {
          fs.renameSync(a.oldPath, a.newPath);
          return { content: { success: true } };
        }
        case 'exists': {
          return { content: fs.existsSync(a.path) };
        }
        case 'copy': {
          fs.copyFileSync(a.src, a.dest);
          return { content: { success: true } };
        }
        case 'watch': {
          fs.watch(a.path, { recursive: a.recursive ?? false }, () => {
            // Fire-and-forget — events are handled by the watcher callback
          });
          return { content: { watching: true, path: a.path } };
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
    capabilities: ['fs.read', 'fs.write', 'fs.watch'],
  });
}
