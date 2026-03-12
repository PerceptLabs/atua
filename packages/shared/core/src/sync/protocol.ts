/**
 * Sync Protocol — Shared types between SyncClient (browser) and SyncServer (Deno)
 *
 * Defines the WebSocket message format for bidirectional filesystem sync.
 */

/** Protocol version for handshake compatibility */
export const PROTOCOL_VERSION = 1;

/** Types of filesystem operations */
export type FileOperationType = 'write' | 'delete' | 'mkdir' | 'rename';

/** A single filesystem mutation */
export interface FileOperation {
  id: string;
  type: FileOperationType;
  path: string;
  /** Content for 'write' operations (base64-encoded for binary) */
  content?: string;
  /** New path for 'rename' operations */
  newPath?: string;
  /** Timestamp when the operation was recorded (ms since epoch) */
  timestamp: number;
}

/** Messages sent over WebSocket */
export type SyncMessage =
  | HandshakeMessage
  | PushMessage
  | PullMessage
  | ChangesMessage
  | ConflictMessage
  | AckMessage
  | ErrorMessage;

/** Initial handshake to verify protocol version */
export interface HandshakeMessage {
  type: 'handshake';
  version: number;
  clientId: string;
}

/** Client pushes local changes to server */
export interface PushMessage {
  type: 'push';
  operations: FileOperation[];
}

/** Client requests changes since a timestamp */
export interface PullMessage {
  type: 'pull';
  since: number;
}

/** Server sends changes to client */
export interface ChangesMessage {
  type: 'changes';
  operations: FileOperation[];
}

/** Server reports a conflict */
export interface ConflictMessage {
  type: 'conflict';
  path: string;
  local: string;
  remote: string;
  operationId: string;
}

/** Server acknowledges received operations */
export interface AckMessage {
  type: 'ack';
  operationIds: string[];
}

/** Error message */
export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

/** Connection states */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

/** Result of a sync operation */
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

/** Conflict resolution strategy */
export type ConflictStrategy = 'local' | 'remote' | 'merge' | 'ask';

/** Generate a unique operation ID */
export function generateOpId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
