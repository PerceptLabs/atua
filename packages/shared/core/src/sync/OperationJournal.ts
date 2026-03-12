/**
 * OperationJournal — Append-only log of filesystem mutations
 *
 * Buffers filesystem changes during disconnection.
 * On reconnect, replays journal entries to the server.
 * Supports compaction to prevent unbounded growth.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import {
  type FileOperation,
  type FileOperationType,
  generateOpId,
} from './protocol.js';

export interface JournalConfig {
  /** AtuaFS instance for persistence */
  fs?: AtuaFS;
  /** Path to store journal data (default: /.sync-journal.json) */
  journalPath?: string;
  /** Max operations before auto-compaction (default: 1000) */
  maxOperations?: number;
}

export class OperationJournal {
  private operations: FileOperation[] = [];
  private readonly fs?: AtuaFS;
  private readonly journalPath: string;
  private readonly maxOperations: number;

  constructor(config: JournalConfig = {}) {
    this.fs = config.fs;
    this.journalPath = config.journalPath ?? '/.sync-journal.json';
    this.maxOperations = config.maxOperations ?? 1000;
  }

  /** Load journal from persistent storage */
  load(): void {
    if (!this.fs) return;
    try {
      const raw = this.fs.readFileSync(this.journalPath, 'utf-8') as string;
      const data = JSON.parse(raw);
      if (Array.isArray(data.operations)) {
        this.operations = data.operations;
      }
    } catch {
      // No journal yet
    }
  }

  /** Save journal to persistent storage */
  save(): void {
    if (!this.fs) return;
    try {
      this.fs.writeFileSync(
        this.journalPath,
        JSON.stringify({ version: 1, operations: this.operations }),
      );
    } catch {
      // Non-fatal
    }
  }

  /** Record a filesystem operation */
  record(type: FileOperationType, path: string, content?: string, newPath?: string): FileOperation {
    const op: FileOperation = {
      id: generateOpId(),
      type,
      path,
      timestamp: Date.now(),
    };
    if (content !== undefined) op.content = content;
    if (newPath !== undefined) op.newPath = newPath;

    this.operations.push(op);

    // Auto-compact if too many operations
    if (this.operations.length > this.maxOperations) {
      this.compact();
    }

    this.save();
    return op;
  }

  /** Record a write operation */
  recordWrite(path: string, content: string): FileOperation {
    return this.record('write', path, content);
  }

  /** Record a delete operation */
  recordDelete(path: string): FileOperation {
    return this.record('delete', path);
  }

  /** Record a mkdir operation */
  recordMkdir(path: string): FileOperation {
    return this.record('mkdir', path);
  }

  /** Record a rename operation */
  recordRename(oldPath: string, newPath: string): FileOperation {
    return this.record('rename', oldPath, undefined, newPath);
  }

  /**
   * Get all pending operations (not yet acknowledged by server).
   */
  getPending(): FileOperation[] {
    return [...this.operations];
  }

  /**
   * Get operations since a given timestamp.
   */
  getSince(timestamp: number): FileOperation[] {
    return this.operations.filter((op) => op.timestamp >= timestamp);
  }

  /**
   * Acknowledge operations — remove them from the journal.
   */
  acknowledge(operationIds: string[]): void {
    const idSet = new Set(operationIds);
    this.operations = this.operations.filter((op) => !idSet.has(op.id));
    this.save();
  }

  /**
   * Compact the journal — collapse operations to minimal set.
   *
   * Rules:
   * 1. write → write → write ⟹ final write only
   * 2. write → delete ⟹ delete only (if file existed before journal start)
   * 2b. create → write → delete ⟹ nothing (if file didn't exist before)
   * 3. rename A→B → rename B→C ⟹ rename A→C
   * 4. write A → rename A→B ⟹ delete A + write B
   * 5. mkdir → rmdir ⟹ nothing (if dir didn't exist before)
   *
   * @param knownPaths - Set of paths known to exist before the journal started.
   *   When provided, enables Rules 2b and 5 (created-then-deleted elimination).
   *   Without it, all paths are assumed to pre-exist (safe default).
   */
  compact(knownPaths?: Set<string>): void {
    if (this.operations.length === 0) return;

    const known = knownPaths ?? new Set<string>();
    const hasKnownPaths = knownPaths !== undefined;

    // Per-path net effect state machine
    type WrittenState = { type: 'written'; content?: string; created: boolean; timestamp: number; id: string };
    type DeletedState = { type: 'deleted'; timestamp: number; id: string };
    type MkdirState = { type: 'mkdir'; created: boolean; timestamp: number; id: string };
    type NetEffect = WrittenState | DeletedState | MkdirState;

    const pathState = new Map<string, NetEffect>();

    // Rename chains: each entry tracks originalPath → finalPath
    const renameChains: Array<{
      from: string;
      to: string;
      timestamp: number;
      id: string;
    }> = [];

    for (const op of this.operations) {
      switch (op.type) {
        case 'write': {
          const existing = pathState.get(op.path);
          let created: boolean;
          if (!hasKnownPaths) {
            // Without knownPaths, assume all paths pre-existed (safe default)
            created = false;
          } else if (existing && existing.type !== 'deleted') {
            // Preserve the created flag from the existing state
            created = existing.created;
          } else {
            // New path or path was deleted — check if it was known before
            created = !known.has(op.path);
          }
          pathState.set(op.path, {
            type: 'written',
            content: op.content,
            created,
            timestamp: op.timestamp,
            id: op.id,
          });
          break;
        }

        case 'delete': {
          const existing = pathState.get(op.path);
          if (
            hasKnownPaths &&
            existing &&
            existing.type !== 'deleted' &&
            existing.created
          ) {
            // Rule 2b / Rule 5: created in journal then deleted → nothing
            pathState.delete(op.path);
          } else {
            // Rule 2: existed before → keep the delete
            pathState.set(op.path, {
              type: 'deleted',
              timestamp: op.timestamp,
              id: op.id,
            });
          }
          break;
        }

        case 'mkdir': {
          let created: boolean;
          if (!hasKnownPaths) {
            created = false;
          } else {
            created = !known.has(op.path);
          }
          pathState.set(op.path, {
            type: 'mkdir',
            created,
            timestamp: op.timestamp,
            id: op.id,
          });
          break;
        }

        case 'rename': {
          const src = op.path;
          const dst = op.newPath!;
          const srcState = pathState.get(src);

          // Check for existing rename chain ending at src
          const chainIdx = renameChains.findIndex((r) => r.to === src);

          if (srcState && srcState.type === 'written') {
            // Rule 4: write A → rename A→B ⟹ handle A + write B
            if (srcState.created) {
              // A was created in this journal — no need to tell server to delete it
              pathState.delete(src);
            } else {
              // A existed before — server needs to know A is gone
              pathState.set(src, {
                type: 'deleted',
                timestamp: op.timestamp,
                id: generateOpId(),
              });
            }
            pathState.set(dst, {
              type: 'written',
              content: srcState.content,
              created: hasKnownPaths ? !known.has(dst) : false,
              timestamp: op.timestamp,
              id: op.id,
            });

            // If there was a rename chain ending at src, remove it
            if (chainIdx >= 0) {
              renameChains.splice(chainIdx, 1);
            }
          } else if (chainIdx >= 0) {
            // Rule 3: rename chain — extend the existing chain
            renameChains[chainIdx].to = dst;
            renameChains[chainIdx].timestamp = op.timestamp;
            renameChains[chainIdx].id = op.id;
            pathState.delete(src);
          } else {
            // Regular rename — start a new chain
            renameChains.push({
              from: src,
              to: dst,
              timestamp: op.timestamp,
              id: op.id,
            });
            pathState.delete(src);
          }
          break;
        }
      }
    }

    // Emit compacted operations
    const compacted: FileOperation[] = [];

    for (const [path, state] of pathState) {
      const op: FileOperation = {
        id: state.id,
        type: state.type === 'written' ? 'write' : state.type === 'deleted' ? 'delete' : state.type,
        path,
        timestamp: state.timestamp,
      };
      if (state.type === 'written' && state.content !== undefined) {
        op.content = state.content;
      }
      compacted.push(op);
    }

    for (const chain of renameChains) {
      compacted.push({
        id: chain.id,
        type: 'rename',
        path: chain.from,
        newPath: chain.to,
        timestamp: chain.timestamp,
      });
    }

    compacted.sort((a, b) => a.timestamp - b.timestamp);
    this.operations = compacted;
    this.save();
  }

  /** Get the number of pending operations */
  get count(): number {
    return this.operations.length;
  }

  /** Clear all operations */
  clear(): void {
    this.operations = [];
    this.save();
  }
}
