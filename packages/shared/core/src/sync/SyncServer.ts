/**
 * SyncServer — Server-side sync handler
 *
 * Handles WebSocket connections from SyncClients.
 * Processes push/pull requests and sends change notifications.
 * Designed to work with both Deno and Node.js WebSocket APIs.
 *
 * This is the protocol handler — the actual HTTP server and WebSocket
 * upgrade is handled by the consumer (Deno.serve, Hono, etc.)
 */
import {
  PROTOCOL_VERSION,
  type SyncMessage,
  type FileOperation,
  generateOpId,
} from './protocol.js';

export interface SyncServerConfig {
  /** Apply a file operation to the server's filesystem */
  applyOperation?: (op: FileOperation) => Promise<void>;
  /** Read file content from server filesystem */
  readFile?: (path: string) => Promise<string | null>;
  /** Conflict resolution strategy */
  conflictStrategy?: 'local' | 'remote' | 'last-write-wins';
}

export interface ServerClient {
  id: string;
  send: (data: string) => void;
  lastSync: number;
}

export class SyncServer {
  private clients = new Map<string, ServerClient>();
  private operations: FileOperation[] = [];
  private readonly applyOp?: (op: FileOperation) => Promise<void>;
  private readonly readFile?: (path: string) => Promise<string | null>;
  private readonly conflictStrategy: string;

  constructor(config: SyncServerConfig = {}) {
    this.applyOp = config.applyOperation;
    this.readFile = config.readFile;
    this.conflictStrategy = config.conflictStrategy ?? 'last-write-wins';
  }

  /**
   * Handle a new WebSocket connection.
   * Returns a message handler function.
   */
  handleConnection(
    send: (data: string) => void,
  ): (message: string) => void {
    let client: ServerClient | null = null;

    return (rawMessage: string) => {
      try {
        const message = JSON.parse(rawMessage) as SyncMessage;

        switch (message.type) {
          case 'handshake':
            if (message.version !== PROTOCOL_VERSION) {
              send(
                JSON.stringify({
                  type: 'error',
                  message: `Protocol version mismatch: expected ${PROTOCOL_VERSION}, got ${message.version}`,
                  code: 'VERSION_MISMATCH',
                }),
              );
              return;
            }
            client = {
              id: message.clientId,
              send,
              lastSync: 0,
            };
            this.clients.set(client.id, client);
            // Send ack
            send(JSON.stringify({ type: 'ack', operationIds: [] }));
            break;

          case 'push':
            if (!client) return;
            this.handlePush(client, message.operations);
            break;

          case 'pull':
            if (!client) return;
            this.handlePull(client, message.since);
            break;
        }
      } catch {
        send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          }),
        );
      }
    };
  }

  /**
   * Handle client disconnection.
   */
  handleDisconnection(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Record a server-side file change and notify connected clients.
   */
  recordServerChange(
    type: FileOperation['type'],
    path: string,
    content?: string,
    newPath?: string,
  ): void {
    const op: FileOperation = {
      id: generateOpId(),
      type,
      path,
      timestamp: Date.now(),
    };
    if (content !== undefined) op.content = content;
    if (newPath !== undefined) op.newPath = newPath;

    this.operations.push(op);
    this.notifyClients([op]);
  }

  /**
   * Get all operations since a timestamp.
   */
  getOperationsSince(timestamp: number): FileOperation[] {
    return this.operations.filter((op) => op.timestamp > timestamp);
  }

  /** Get connected client count */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Get total operation count */
  get operationCount(): number {
    return this.operations.length;
  }

  // --- Private ---

  private handlePush(
    client: ServerClient,
    operations: FileOperation[],
  ): void {
    const ackIds: string[] = [];

    for (const op of operations) {
      // Apply operation to server filesystem
      if (this.applyOp) {
        this.applyOp(op).catch(() => {
          // Log error but continue
        });
      }

      this.operations.push(op);
      ackIds.push(op.id);
    }

    // Acknowledge all operations
    client.send(JSON.stringify({ type: 'ack', operationIds: ackIds }));

    // Notify other clients
    this.notifyClientsExcept(client.id, operations);
  }

  private handlePull(client: ServerClient, since: number): void {
    const ops = this.getOperationsSince(since);
    client.send(JSON.stringify({ type: 'changes', operations: ops }));
    client.lastSync = Date.now();
  }

  private notifyClients(operations: FileOperation[]): void {
    const message = JSON.stringify({
      type: 'changes',
      operations,
    });
    for (const client of this.clients.values()) {
      try {
        client.send(message);
      } catch {
        // Client may have disconnected
      }
    }
  }

  private notifyClientsExcept(
    excludeId: string,
    operations: FileOperation[],
  ): void {
    const message = JSON.stringify({
      type: 'changes',
      operations,
    });
    for (const [id, client] of this.clients) {
      if (id === excludeId) continue;
      try {
        client.send(message);
      } catch {
        // Client may have disconnected
      }
    }
  }
}
