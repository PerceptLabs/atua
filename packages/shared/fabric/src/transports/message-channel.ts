/**
 * MessageChannel transport — direct in-process call transport.
 *
 * Phase 0: wraps a handler function for same-thread communication.
 * Future phases will use actual MessagePort pairs for Worker isolation.
 */
import type { Transport, ToolResult } from '../hub/types.js';

export type ToolHandler = (tool: string, args: unknown) => Promise<ToolResult>;

export class MessageChannelTransport implements Transport {
  readonly type = 'message-channel' as const;
  private _handler: ToolHandler;
  private _disposed = false;

  constructor(handler: ToolHandler) {
    this._handler = handler;
  }

  async call(tool: string, args: unknown): Promise<ToolResult> {
    if (this._disposed) {
      return { content: null, isError: true };
    }
    return this._handler(tool, args);
  }

  dispose(): void {
    this._disposed = true;
  }
}
