/**
 * atua.proc MCP Provider — wraps ProcessManager as 6 MCP tools.
 *
 * Provides process lifecycle management through the hub.
 */
import type { ProcessManager } from '../../../../shared/core/src/proc/ProcessManager.js';
import type { ProviderRegistration, ToolResult } from '../hub/types.js';
import { createProvider } from './base-provider.js';

const NS = 'atua.proc';

function tool(name: string, description: string, parameters: Record<string, any>) {
  return { name: `${NS}.${name}`, description, parameters };
}

const TOOLS = [
  tool('exec', 'Execute code and wait for completion', {
    code: { type: 'string', description: 'JavaScript code to execute', required: true },
    cwd: { type: 'string', description: 'Working directory' },
    env: { type: 'object', description: 'Environment variables' },
    timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
  }),
  tool('spawn', 'Spawn a process (returns immediately with pid)', {
    code: { type: 'string', description: 'JavaScript code to execute', required: true },
    cwd: { type: 'string', description: 'Working directory' },
    env: { type: 'object', description: 'Environment variables' },
    timeout: { type: 'number', description: 'Timeout in ms' },
  }),
  tool('kill', 'Send a signal to a process', {
    pid: { type: 'number', description: 'Process ID', required: true },
    signal: { type: 'string', description: 'Signal name (SIGTERM, SIGKILL, SIGINT)' },
  }),
  tool('list', 'List all tracked processes', {}),
  tool('wait', 'Wait for a process to exit', {
    pid: { type: 'number', description: 'Process ID', required: true },
    timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
  }),
  tool('info', 'Get process details by PID', {
    pid: { type: 'number', description: 'Process ID', required: true },
  }),
];

export function createAtuaProcProvider(pm: ProcessManager): ProviderRegistration {
  async function handler(toolName: string, args: unknown): Promise<ToolResult> {
    const a = args as Record<string, any>;
    const shortName = toolName.substring(NS.length + 1);

    try {
      switch (shortName) {
        case 'exec': {
          const result = await pm.exec(a.code, {
            cwd: a.cwd,
            env: a.env,
            timeout: a.timeout,
          });
          return {
            content: {
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
              pid: result.pid,
            },
          };
        }
        case 'spawn': {
          const proc = pm.spawn(a.code, {
            cwd: a.cwd,
            env: a.env,
            timeout: a.timeout,
          });
          return { content: { pid: proc.pid } };
        }
        case 'kill': {
          const success = pm.kill(a.pid, a.signal ?? 'SIGTERM');
          return { content: { success } };
        }
        case 'list': {
          const procs = pm.listProcesses();
          return {
            content: procs.map((p) => ({
              pid: p.pid,
              state: p.state,
              exitCode: p.exitCode,
              uptime: p.uptime,
            })),
          };
        }
        case 'wait': {
          const proc = pm.getProcess(a.pid);
          if (!proc) {
            return { content: `Process ${a.pid} not found`, isError: true };
          }

          // Already exited
          if (proc.state === 'exited' || proc.state === 'killed') {
            return {
              content: {
                exitCode: proc.exitCode,
                stdout: proc.stdout,
                stderr: proc.stderr,
              },
            };
          }

          // Wait for exit with timeout
          const timeout = a.timeout ?? 30000;
          const result = await new Promise<ToolResult>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null;

            const onExit = (exitCode: number) => {
              if (timer) clearTimeout(timer);
              resolve({
                content: {
                  exitCode,
                  stdout: proc.stdout,
                  stderr: proc.stderr,
                },
              });
            };

            proc.once('exit', onExit);

            if (timeout > 0) {
              timer = setTimeout(() => {
                proc.off('exit', onExit);
                resolve({
                  content: `Process ${a.pid} wait timed out after ${timeout}ms`,
                  isError: true,
                });
              }, timeout);
            }
          });
          return result;
        }
        case 'info': {
          const proc = pm.getProcess(a.pid);
          if (!proc) {
            return { content: `Process ${a.pid} not found`, isError: true };
          }
          return {
            content: {
              pid: proc.pid,
              state: proc.state,
              exitCode: proc.exitCode,
              uptime: proc.uptime,
              stdout: proc.stdout,
              stderr: proc.stderr,
            },
          };
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
    capabilities: ['proc.exec', 'proc.spawn', 'proc.kill'],
  });
}
