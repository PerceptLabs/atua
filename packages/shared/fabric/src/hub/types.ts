/**
 * Fabric MCP Hub — Core type definitions
 *
 * These interfaces define the contract for the MCP Hub kernel:
 * provider registration, tool routing, transaction logging, and transport.
 */

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ParameterDef {
  type: string;
  description?: string;
  required?: boolean;
}

export interface ToolDefinition {
  /** Fully qualified name: "{namespace}.{tool_name}" */
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  returns?: string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Transport interface for provider communication.
 *
 * The type union includes future transports for forward-compatible typing.
 * Phase 0 only implements MessageChannelTransport.
 */
export interface Transport {
  readonly type: 'message-channel' | 'stdio' | 'streamable-http';
  call(tool: string, args: unknown): Promise<ToolResult>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Provider registration
// ---------------------------------------------------------------------------

export interface ProviderRegistration {
  /** Unique namespace, e.g. "atua.fs", "echo" */
  namespace: string;
  tools: ToolDefinition[];
  transport: Transport;
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Call context
// ---------------------------------------------------------------------------

export interface CallContext {
  /** Who is calling — provider namespace or "external" */
  caller: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Transaction log
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  timestamp: number;
  caller: string;
  provider: string;
  tool: string;
  args: unknown;
  result?: unknown;
  error?: string;
  durationMs: number;
  transport: string;
}

// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: unknown;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ToolFilter {
  namespace?: string;
  name?: string;
}

export interface LogFilter {
  caller?: string;
  provider?: string;
  tool?: string;
  since?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Provider health
// ---------------------------------------------------------------------------

export interface ProviderHealth {
  status: 'active' | 'inactive';
  toolCount: number;
  namespace: string;
}

// ---------------------------------------------------------------------------
// Server management (Phase 3 — stdio transport)
// ---------------------------------------------------------------------------

export interface ServerConfig {
  name: string;
  source: string; // 'npm:pkg', 'local:/path'
  env?: Record<string, string>;
  capabilities: Capabilities;
}

export interface Capabilities {
  fs?: 'none' | { scope: string; write: boolean };
  network?: 'none' | string[];
  db?: 'none' | 'catalyst.d1';
  proc?: 'none' | 'spawn' | 'full';
  preview?: boolean;
}

export type ServerState = 'idle' | 'starting' | 'ready' | 'error' | 'stopped';

export interface ServerStatus {
  name: string;
  state: ServerState;
  tools: string[];
  uptime: number;
  error?: string;
}
