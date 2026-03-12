/**
 * SyncClient — Browser-side WebSocket sync client
 *
 * Connects to a Deno server via WebSocket for bidirectional filesystem sync.
 * Buffers changes in OperationJournal during disconnection.
 * On reconnect, replays journal entries to sync state.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import {
  PROTOCOL_VERSION,
  type SyncMessage,
  type ConnectionState,
  type SyncResult,
  type FileOperation,
} from './protocol.js';
import { OperationJournal } from './OperationJournal.js';
import {
  ConflictResolver,
  type ConflictResolverConfig,
} from './ConflictResolver.js';

export interface SyncClientConfig {
  /** AtuaFS instance */
  fs: AtuaFS;
  /** Auto-sync on file changes (default: true) */
  autoSync?: boolean;
  /** Debounce interval for auto-sync in ms (default: 500) */
  debounceMs?: number;
  /** Conflict resolution config */
  conflict?: ConflictResolverConfig;
  /** Custom WebSocket constructor (for testing) */
  WebSocketClass?: typeof WebSocket;
}

type SyncEventType =
  | 'connected'
  | 'disconnected'
  | 'synced'
  | 'conflict'
  | 'error'
  | 'state-change';

export class SyncClient {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private readonly fs: AtuaFS;
  private readonly journal: OperationJournal;
  private readonly conflictResolver: ConflictResolver;
  private readonly autoSync: boolean;
  private readonly debounceMs: number;
  private readonly WSClass: typeof WebSocket;
  private clientId: string;
  private lastSyncTimestamp = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<Function>>();
  private url: string | null = null;

  constructor(config: SyncClientConfig) {
    this.fs = config.fs;
    this.autoSync = config.autoSync ?? true;
    this.debounceMs = config.debounceMs ?? 500;
    this.WSClass =
      config.WebSocketClass ??
      (typeof WebSocket !== 'undefined' ? WebSocket : (null as any));
    this.clientId = this.generateClientId();

    this.journal = new OperationJournal({ fs: config.fs });
    this.journal.load();

    this.conflictResolver = new ConflictResolver(config.conflict);
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Number of pending (unsynced) operations */
  get pendingCount(): number {
    return this.journal.count;
  }

  /**
   * Connect to a sync server.
   */
  async connect(url: string): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return;
    }

    this.url = url;
    this.setState('connecting');

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new this.WSClass(url);
      } catch (err: any) {
        this.setState('error');
        reject(new Error(`WebSocket connection failed: ${err?.message}`));
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.close();
        this.setState('error');
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        // Send handshake
        this.send({
          type: 'handshake',
          version: PROTOCOL_VERSION,
          clientId: this.clientId,
        });
        this.setState('connected');
        this.emit('connected');

        // Replay journal if there are pending operations
        if (this.journal.count > 0) {
          this.pushPending();
        }

        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        this.ws = null;
        this.setState('disconnected');
        this.emit('disconnected');
      };

      this.ws.onerror = (event: Event) => {
        clearTimeout(timeout);
        this.setState('error');
        this.emit('error', event);
        reject(new Error('WebSocket error'));
      };
    });
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /**
   * Push local changes to server.
   */
  async push(): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    const pending = this.journal.getPending();
    if (pending.length === 0) return result;

    if (this._state !== 'connected') {
      result.errors.push('Not connected');
      return result;
    }

    this.setState('syncing');
    this.send({ type: 'push', operations: pending });
    result.pushed = pending.length;
    this.setState('connected');

    return result;
  }

  /**
   * Pull remote changes from server.
   */
  async pull(): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    };

    if (this._state !== 'connected') {
      result.errors.push('Not connected');
      return result;
    }

    this.setState('syncing');
    this.send({ type: 'pull', since: this.lastSyncTimestamp });
    this.setState('connected');

    return result;
  }

  /**
   * Record a local file change and optionally push.
   */
  recordChange(
    type: FileOperation['type'],
    path: string,
    content?: string,
    newPath?: string,
  ): void {
    this.journal.record(type, path, content, newPath);

    if (this.autoSync && this._state === 'connected') {
      this.debouncedPush();
    }
  }

  /**
   * Subscribe to sync events.
   */
  on(event: SyncEventType, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  /** Get the operation journal for inspection/testing */
  getJournal(): OperationJournal {
    return this.journal;
  }

  // --- Private ---

  private send(message: SyncMessage): void {
    if (this.ws?.readyState === 1) {
      // WebSocket.OPEN
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const message = JSON.parse(raw) as SyncMessage;

      switch (message.type) {
        case 'ack':
          this.journal.acknowledge(message.operationIds);
          this.emit('synced');
          break;

        case 'changes':
          this.applyRemoteChanges(message.operations);
          break;

        case 'conflict':
          this.handleConflict(message);
          break;

        case 'error':
          this.emit('error', new Error(message.message));
          break;
      }
    } catch {
      // Malformed message — ignore
    }
  }

  private applyRemoteChanges(operations: FileOperation[]): void {
    for (const op of operations) {
      try {
        switch (op.type) {
          case 'write':
            if (op.content !== undefined) {
              // Ensure parent directory exists
              const dir = op.path.substring(
                0,
                op.path.lastIndexOf('/'),
              );
              if (dir) {
                try {
                  this.fs.mkdirSync(dir, { recursive: true });
                } catch {
                  // May already exist
                }
              }
              this.fs.writeFileSync(op.path, op.content);
            }
            break;

          case 'delete':
            try {
              this.fs.unlinkSync(op.path);
            } catch {
              // File may not exist
            }
            break;

          case 'mkdir':
            try {
              this.fs.mkdirSync(op.path, { recursive: true });
            } catch {
              // May already exist
            }
            break;

          case 'rename':
            if (op.newPath) {
              try {
                this.fs.renameSync(op.path, op.newPath);
              } catch {
                // Source may not exist
              }
            }
            break;
        }
      } catch {
        // Individual operation failures shouldn't stop processing
      }

      // Update last sync timestamp
      if (op.timestamp > this.lastSyncTimestamp) {
        this.lastSyncTimestamp = op.timestamp;
      }
    }
  }

  private async handleConflict(
    message: Extract<SyncMessage, { type: 'conflict' }>,
  ): Promise<void> {
    const resolution = await this.conflictResolver.resolve({
      path: message.path,
      localContent: message.local,
      remoteContent: message.remote,
      localTimestamp: Date.now(),
      remoteTimestamp: Date.now(),
    });

    // Apply resolution
    this.fs.writeFileSync(message.path, resolution.resolvedContent);
    this.emit('conflict', { path: message.path, resolution });
  }

  private pushPending(): void {
    const pending = this.journal.getPending();
    if (pending.length > 0) {
      this.send({ type: 'push', operations: pending });
    }
  }

  private debouncedPush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.pushPending();
    }, this.debounceMs);
  }

  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('state-change', state);
    }
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(...args);
        } catch {
          // Don't let callback errors propagate
        }
      }
    }
  }

  private generateClientId(): string {
    return `client-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
