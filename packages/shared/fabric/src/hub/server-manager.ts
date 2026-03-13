/**
 * ServerManager — orchestrates local MCP server lifecycle.
 *
 * Handles: install, start, stop, restart, lazy initialization, hot reload.
 * Each server runs in its own Worker via ProcessManager.spawnServer().
 * Communication is MCP JSON-RPC over stdin/stdout via StdioTransport.
 */
import type { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';
import type { ProcessManager } from '../../../../shared/core/src/proc/ProcessManager.js';
import type { AtuaProcess } from '../../../../shared/core/src/proc/AtuaProcess.js';
import type {
  ServerConfig,
  ServerState,
  ServerStatus,
  ToolDefinition,
  Transport,
  ToolResult,
} from './types.js';
import type { MCPHub } from './hub.js';
import { StdioTransport } from '../transports/stdio.js';
import { CapabilityGate } from '../security/capability-gate.js';

interface ManagedServer {
  config: ServerConfig;
  state: ServerState;
  process: AtuaProcess | null;
  transport: StdioTransport | null;
  gate: CapabilityGate;
  tools: ToolDefinition[];
  startTime: number | null;
  error: string | null;
}

export interface ServerManagerDeps {
  hub: MCPHub;
  processManager: ProcessManager;
  fs: AtuaFS;
}

export class ServerManager {
  private _servers = new Map<string, ManagedServer>();
  private _hub: MCPHub;
  private _pm: ProcessManager;
  private _fs: AtuaFS;

  constructor(deps: ServerManagerDeps) {
    this._hub = deps.hub;
    this._pm = deps.processManager;
    this._fs = deps.fs;
  }

  /**
   * Install and register a local MCP server.
   *
   * 1. Validates config
   * 2. Resolves source code
   * 3. Starts server to discover tools, then stops it
   * 4. Registers a lazy provider on the hub
   */
  async install(config: ServerConfig): Promise<void> {
    if (this._servers.has(config.name)) {
      throw new Error(`Server '${config.name}' is already installed`);
    }

    // Validate source format
    if (!config.source.startsWith('local:') && !config.source.startsWith('npm:')) {
      throw new Error(
        `Unsupported source format: '${config.source}'. Use 'local:/path' or 'npm:package'`,
      );
    }

    // Resolve source code
    const code = await this._resolveSource(config.source);

    const gate = new CapabilityGate(config.capabilities);

    // Create the managed server entry
    const server: ManagedServer = {
      config,
      state: 'idle',
      process: null,
      transport: null,
      gate,
      tools: [],
      startTime: null,
      error: null,
    };
    this._servers.set(config.name, server);

    // Start server to discover tools, then stop
    try {
      await this._startServer(server, code);
      // Cache discovered tools and stop
      const tools = server.tools;
      await this._stopServer(server);

      // Restore cached tools for lazy registration
      server.tools = tools;
      server.state = 'idle';
    } catch (err) {
      this._servers.delete(config.name);
      throw new Error(
        `Failed to discover tools for server '${config.name}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Register lazy provider on the hub
    // Tool names are prefixed with server namespace
    const namespacedTools = server.tools.map((t) => ({
      ...t,
      name: `${config.name}.${t.name}`,
    }));

    const lazyTransport = new LazyStdioTransport(this, config.name);

    this._hub.registerProvider({
      namespace: config.name,
      tools: namespacedTools,
      transport: lazyTransport,
    });
  }

  /**
   * Start a server process and perform MCP handshake.
   */
  async start(name: string): Promise<void> {
    const server = this._servers.get(name);
    if (!server) throw new Error(`Server '${name}' not found`);
    if (server.state === 'ready') return;

    const code = await this._resolveSource(server.config.source);
    await this._startServer(server, code);
  }

  /**
   * Stop a running server.
   */
  async stop(name: string): Promise<void> {
    const server = this._servers.get(name);
    if (!server) throw new Error(`Server '${name}' not found`);
    await this._stopServer(server);
  }

  /**
   * Restart a server (stop then start).
   */
  async restart(name: string): Promise<void> {
    await this.stop(name);
    await this.start(name);
  }

  /**
   * Get status for a specific server.
   */
  getStatus(name: string): ServerStatus {
    const server = this._servers.get(name);
    if (!server) throw new Error(`Server '${name}' not found`);
    return this._toStatus(server);
  }

  /**
   * Get status for all managed servers.
   */
  getAllStatus(): Map<string, ServerStatus> {
    const result = new Map<string, ServerStatus>();
    for (const [name, server] of this._servers) {
      result.set(name, this._toStatus(server));
    }
    return result;
  }

  /**
   * Get the transport for a running server (used by LazyStdioTransport).
   */
  _getTransport(name: string): StdioTransport | null {
    return this._servers.get(name)?.transport ?? null;
  }

  /**
   * Clean up all servers.
   */
  dispose(): void {
    for (const server of this._servers.values()) {
      this._stopServer(server).catch(() => {});
    }
    this._servers.clear();
  }

  // ---- Internal ----

  private async _resolveSource(source: string): Promise<string> {
    if (source.startsWith('local:')) {
      const path = source.substring('local:'.length);
      if (!this._fs.existsSync(path)) {
        throw new Error(`Local source not found: ${path}`);
      }
      return this._fs.readFileSync(path, 'utf8') as string;
    }

    if (source.startsWith('npm:')) {
      const pkg = source.substring('npm:'.length);
      // Look for the package in the virtual node_modules
      const entryPath = `/node_modules/${pkg}/index.js`;
      if (!this._fs.existsSync(entryPath)) {
        throw new Error(
          `Package '${pkg}' not found in AtuaFS. Install via atua.pkg first.`,
        );
      }
      return this._fs.readFileSync(entryPath, 'utf8') as string;
    }

    throw new Error(`Unsupported source: ${source}`);
  }

  private async _startServer(server: ManagedServer, code: string): Promise<void> {
    server.state = 'starting';
    server.error = null;

    try {
      const proc = await this._pm.spawnServer(code, {
        env: server.config.env,
      });

      server.process = proc;

      // Wire crash handler
      proc.on('exit', () => {
        if (server.state === 'ready' || server.state === 'starting') {
          server.state = 'error';
          server.error = 'Server process exited unexpectedly';
          server.process = null;
          server.transport = null;
        }
      });

      // Create stdio transport and handshake
      const transport = new StdioTransport({ process: proc });
      server.transport = transport;

      const tools = await transport.initialize();
      server.tools = tools;
      server.state = 'ready';
      server.startTime = Date.now();
    } catch (err) {
      server.state = 'error';
      server.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  private async _stopServer(server: ManagedServer): Promise<void> {
    if (server.transport) {
      server.transport.dispose();
      server.transport = null;
    }

    if (server.process && server.process.state === 'running') {
      server.process.kill('SIGTERM');
    }
    server.process = null;
    server.state = 'stopped';
    server.startTime = null;
  }

  private _toStatus(server: ManagedServer): ServerStatus {
    return {
      name: server.config.name,
      state: server.state,
      tools: server.tools.map((t) => t.name),
      uptime: server.startTime ? Date.now() - server.startTime : 0,
      error: server.error ?? undefined,
    };
  }
}

/**
 * LazyStdioTransport — wrapper that starts the server on first call.
 * Coalesces concurrent callers to a single start operation.
 */
class LazyStdioTransport implements Transport {
  readonly type = 'stdio' as const;

  private _manager: ServerManager;
  private _serverName: string;
  private _starting: Promise<void> | null = null;
  private _disposed = false;

  constructor(manager: ServerManager, serverName: string) {
    this._manager = manager;
    this._serverName = serverName;
  }

  async call(tool: string, args: unknown): Promise<ToolResult> {
    if (this._disposed) {
      return { content: 'Transport disposed', isError: true };
    }

    // Lazy start
    const inner = this._manager._getTransport(this._serverName);
    if (!inner) {
      if (!this._starting) {
        this._starting = this._manager.start(this._serverName).finally(() => {
          this._starting = null;
        });
      }
      await this._starting;
    }

    const transport = this._manager._getTransport(this._serverName);
    if (!transport) {
      return { content: `Server '${this._serverName}' failed to start`, isError: true };
    }

    return transport.call(tool, args);
  }

  dispose(): void {
    this._disposed = true;
  }
}
