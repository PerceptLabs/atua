/**
 * StdioTransport — MCP JSON-RPC 2.0 over AtuaProcess stdin/stdout.
 *
 * Implements the Transport interface for communicating with MCP servers
 * running inside browser Workers via process.stdin/stdout.
 *
 * Protocol:
 * - Line-delimited JSON (newline-separated JSON-RPC messages)
 * - Writes requests to process.write() (→ Worker stdin)
 * - Reads responses from process.on('stdout') (← Worker stdout)
 * - Matches responses by JSON-RPC id
 */
import type { AtuaProcess } from '../../../../shared/core/src/proc/AtuaProcess.js';
import type { Transport, ToolDefinition, ToolResult, ParameterDef } from '../hub/types.js';

export interface StdioTransportOptions {
  process: AtuaProcess;
  /** Timeout per tool call in ms. Default 30000. */
  timeout?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class StdioTransport implements Transport {
  readonly type = 'stdio' as const;

  private _process: AtuaProcess;
  private _timeout: number;
  private _nextId = 1;
  private _pending = new Map<number, PendingRequest>();
  private _buffer = '';
  private _disposed = false;
  private _onStdout: ((data: string) => void) | null = null;
  private _onExit: ((code: number) => void) | null = null;

  constructor(options: StdioTransportOptions) {
    this._process = options.process;
    this._timeout = options.timeout ?? 30000;

    // Wire stdout → line parser
    this._onStdout = (data: string) => this._handleStdout(data);
    this._process.on('stdout', this._onStdout);

    // Wire exit → reject all pending
    this._onExit = () => this._handleProcessExit();
    this._process.on('exit', this._onExit);
  }

  /**
   * Perform the MCP initialization handshake and discover tools.
   *
   * 1. Send initialize → receive server info
   * 2. Send notifications/initialized
   * 3. Send tools/list → receive tool definitions
   */
  async initialize(): Promise<ToolDefinition[]> {
    // Step 1: Initialize
    await this._sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'atua-fabric', version: '0.0.1' },
    });

    // Step 2: Initialized notification (no id, no response expected)
    this._sendNotification('notifications/initialized');

    // Step 3: Discover tools
    const toolsResult = await this._sendRequest('tools/list', {});
    const mcpTools = toolsResult?.tools ?? [];

    return mcpTools.map((t: any) => this._convertTool(t));
  }

  /**
   * Call a tool on the MCP server.
   * Strips the server namespace prefix — transport receives just the tool name.
   */
  async call(tool: string, args: unknown): Promise<ToolResult> {
    if (this._disposed) {
      return { content: 'Transport disposed', isError: true };
    }

    // Strip namespace prefix to get the MCP tool name
    // e.g. "myserver.greet" → "greet"
    const dotIndex = tool.lastIndexOf('.');
    const mcpToolName = dotIndex >= 0 ? tool.substring(dotIndex + 1) : tool;

    try {
      const result = await this._sendRequest('tools/call', {
        name: mcpToolName,
        arguments: args,
      });

      // MCP tool results have content array: [{ type: "text", text: "..." }]
      if (result?.content && Array.isArray(result.content)) {
        const textParts = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        return { content: textParts.length === 1 ? textParts[0] : textParts };
      }

      return { content: result };
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }

  /**
   * Graceful shutdown: send shutdown notification, wait 5s, then kill.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Send shutdown notification
    try {
      this._sendNotification('notifications/shutdown');
    } catch {
      // Process may already be dead
    }

    // Reject all pending requests
    for (const [id, pending] of this._pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('Transport disposed'));
      this._pending.delete(id);
    }

    // Kill process after grace period
    const proc = this._process;
    setTimeout(() => {
      if (proc.state === 'running') {
        proc.kill('SIGTERM');
      }
    }, 5000);

    // Unwire listeners
    if (this._onStdout) this._process.off('stdout', this._onStdout);
    if (this._onExit) this._process.off('exit', this._onExit);
  }

  // ---- Internal ----

  private _sendRequest(method: string, params: unknown): Promise<any> {
    if (this._disposed) {
      return Promise.reject(new Error('Transport disposed'));
    }

    const id = this._nextId++;

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (this._timeout > 0) {
        timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${this._timeout}ms`));
        }, this._timeout);
      }

      this._pending.set(id, { resolve, reject, timer });

      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
      this._process.write(message + '\n');
    });
  }

  private _sendNotification(method: string, params?: unknown): void {
    const message: any = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    this._process.write(JSON.stringify(message) + '\n');
  }

  private _handleStdout(data: string): void {
    this._buffer += data;
    let newlineIdx: number;

    while ((newlineIdx = this._buffer.indexOf('\n')) !== -1) {
      const line = this._buffer.substring(0, newlineIdx).trim();
      this._buffer = this._buffer.substring(newlineIdx + 1);
      if (line.length === 0) continue;

      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {
        // Malformed JSON — skip (could be server debug output)
      }
    }
  }

  private _handleMessage(msg: any): void {
    // JSON-RPC response — has id and (result or error)
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this._pending.get(msg.id);
      if (!pending) return; // Unknown id — ignore

      this._pending.delete(msg.id);
      if (pending.timer) clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }
    // Notifications from server (no id) — currently ignored
  }

  private _handleProcessExit(): void {
    // Reject all pending requests
    for (const [id, pending] of this._pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('MCP server process exited'));
      this._pending.delete(id);
    }
  }

  /**
   * Convert MCP tool schema to Fabric ToolDefinition.
   * MCP tools have inputSchema (JSON Schema), Fabric uses Record<string, ParameterDef>.
   */
  private _convertTool(mcpTool: any): ToolDefinition {
    const parameters: Record<string, ParameterDef> = {};
    const schema = mcpTool.inputSchema;

    if (schema?.properties) {
      const required = new Set(schema.required ?? []);
      for (const [name, prop] of Object.entries(schema.properties)) {
        const p = prop as any;
        parameters[name] = {
          type: p.type ?? 'string',
          description: p.description,
          required: required.has(name),
        };
      }
    }

    return {
      name: mcpTool.name,
      description: mcpTool.description ?? '',
      parameters,
    };
  }
}
