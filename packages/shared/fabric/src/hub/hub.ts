/**
 * MCPHub — Central routing kernel for Atua's MCP protocol.
 *
 * All subsystem interactions flow through the hub:
 * register providers → route tool calls → log transactions.
 */
import type {
  ProviderRegistration,
  ToolDefinition,
  ToolFilter,
  ToolResult,
  CallContext,
  Transaction,
  LogFilter,
  ProviderHealth,
} from './types.js';
import { ProviderRegistry } from './registry.js';
import { TransactionLog } from './transaction-log.js';

let txCounter = 0;

function generateTxId(): string {
  return `tx_${Date.now()}_${++txCounter}`;
}

export class MCPHub {
  private _registry: ProviderRegistry;
  private _log: TransactionLog;

  constructor(options?: { logCapacity?: number }) {
    this._registry = new ProviderRegistry();
    this._log = new TransactionLog(options?.logCapacity);
  }

  /**
   * Register a provider with the hub.
   * Throws if namespace is already registered.
   */
  registerProvider(registration: ProviderRegistration): void {
    this._registry.register(registration);
  }

  /**
   * Unregister a provider, disposing its transport.
   */
  unregisterProvider(namespace: string): void {
    this._registry.unregister(namespace);
  }

  /**
   * List all registered tools, optionally filtered.
   */
  listTools(filter?: ToolFilter): ToolDefinition[] {
    return this._registry.listTools(filter);
  }

  /**
   * Call a tool by its fully qualified name.
   * Format: "{namespace}.{tool_name}" — tool name without a dot is an error.
   *
   * Every call is logged to the transaction log with timing.
   */
  async callTool(
    name: string,
    args: unknown,
    context?: CallContext,
  ): Promise<ToolResult> {
    // Validate tool name format
    if (!name.includes('.')) {
      const error = `Invalid tool name '${name}': must be '{namespace}.{tool_name}'`;
      const tx: Transaction = {
        id: generateTxId(),
        timestamp: Date.now(),
        caller: context?.caller ?? 'unknown',
        provider: 'unknown',
        tool: name,
        args,
        error,
        durationMs: 0,
        transport: 'none',
      };
      this._log.append(tx);
      return { content: error, isError: true };
    }

    // Resolve the tool
    const resolved = this._registry.resolve(name);
    if (!resolved) {
      const error = `Tool '${name}' not found. Provider may not be registered.`;
      const tx: Transaction = {
        id: generateTxId(),
        timestamp: Date.now(),
        caller: context?.caller ?? 'unknown',
        provider: 'unknown',
        tool: name,
        args,
        error,
        durationMs: 0,
        transport: 'none',
      };
      this._log.append(tx);
      return { content: error, isError: true };
    }

    const { provider, toolDef } = resolved;
    const start = performance.now();
    const txId = generateTxId();
    const timestamp = Date.now();

    try {
      // Strip the namespace prefix — transport receives just the tool name
      const result = await provider.transport.call(toolDef.name, args);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      const tx: Transaction = {
        id: txId,
        timestamp,
        caller: context?.caller ?? 'unknown',
        provider: provider.namespace,
        tool: name,
        args,
        result: result.content,
        error: result.isError ? String(result.content) : undefined,
        durationMs,
        transport: provider.transport.type,
      };
      this._log.append(tx);

      return result;
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const errorMessage = err instanceof Error ? err.message : String(err);

      const tx: Transaction = {
        id: txId,
        timestamp,
        caller: context?.caller ?? 'unknown',
        provider: provider.namespace,
        tool: name,
        args,
        error: errorMessage,
        durationMs,
        transport: provider.transport.type,
      };
      this._log.append(tx);

      return { content: errorMessage, isError: true };
    }
  }

  /**
   * Query the transaction log.
   */
  getLog(filter?: LogFilter): Transaction[] {
    return this._log.query(filter);
  }

  /**
   * Get health status for all registered providers.
   */
  getProviderHealth(): Record<string, ProviderHealth> {
    return this._registry.getHealth();
  }
}
