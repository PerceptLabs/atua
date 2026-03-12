/**
 * ConflictResolver — Handles sync conflicts between local and remote changes
 *
 * Strategies:
 * - local: Always prefer local version
 * - remote: Always prefer remote version
 * - merge: Attempt three-way merge for text files, fall back to conflict markers
 * - ask: Defer to consumer via callback
 */
import type { ConflictStrategy } from './protocol.js';

export interface ConflictInfo {
  path: string;
  localContent: string;
  remoteContent: string;
  localTimestamp: number;
  remoteTimestamp: number;
}

export interface ConflictResolution {
  /** Which content to use */
  resolvedContent: string;
  /** How it was resolved */
  method: 'local' | 'remote' | 'merged' | 'manual';
}

export type ConflictCallback = (
  info: ConflictInfo,
) => Promise<ConflictResolution>;

export interface ConflictResolverConfig {
  strategy?: ConflictStrategy;
  onConflict?: ConflictCallback;
}

export class ConflictResolver {
  private readonly strategy: ConflictStrategy;
  private readonly onConflict?: ConflictCallback;

  constructor(config: ConflictResolverConfig = {}) {
    this.strategy = config.strategy ?? 'remote';
    this.onConflict = config.onConflict;
  }

  /**
   * Resolve a conflict between local and remote content.
   */
  async resolve(info: ConflictInfo): Promise<ConflictResolution> {
    switch (this.strategy) {
      case 'local':
        return {
          resolvedContent: info.localContent,
          method: 'local',
        };

      case 'remote':
        return {
          resolvedContent: info.remoteContent,
          method: 'remote',
        };

      case 'merge':
        return this.attemptMerge(info);

      case 'ask':
        if (this.onConflict) {
          return this.onConflict(info);
        }
        // Fall back to last-write-wins if no callback
        return this.lastWriteWins(info);

      default:
        return this.lastWriteWins(info);
    }
  }

  /**
   * Attempt to merge text content. Falls back to conflict markers.
   */
  private attemptMerge(info: ConflictInfo): ConflictResolution {
    const localLines = info.localContent.split('\n');
    const remoteLines = info.remoteContent.split('\n');

    // Simple heuristic: if files are identical, no conflict
    if (info.localContent === info.remoteContent) {
      return { resolvedContent: info.localContent, method: 'merged' };
    }

    // If one is empty, use the other
    if (!info.localContent.trim()) {
      return { resolvedContent: info.remoteContent, method: 'remote' };
    }
    if (!info.remoteContent.trim()) {
      return { resolvedContent: info.localContent, method: 'local' };
    }

    // Simple line-by-line merge: if lines match, keep them;
    // otherwise add conflict markers
    const merged: string[] = [];
    const maxLen = Math.max(localLines.length, remoteLines.length);
    let hasConflict = false;

    let i = 0;
    while (i < maxLen) {
      const localLine = localLines[i] ?? '';
      const remoteLine = remoteLines[i] ?? '';

      if (localLine === remoteLine) {
        merged.push(localLine);
        i++;
      } else {
        // Find the extent of the conflicting block
        hasConflict = true;
        const conflictLocalLines: string[] = [];
        const conflictRemoteLines: string[] = [];

        // Collect differing lines until they match again or end
        let j = i;
        while (j < maxLen) {
          const ll = localLines[j] ?? '';
          const rl = remoteLines[j] ?? '';
          if (ll === rl && j > i) break;
          if (j < localLines.length) conflictLocalLines.push(ll);
          if (j < remoteLines.length) conflictRemoteLines.push(rl);
          j++;
        }

        merged.push('<<<<<<< LOCAL');
        merged.push(...conflictLocalLines);
        merged.push('=======');
        merged.push(...conflictRemoteLines);
        merged.push('>>>>>>> REMOTE');
        i = j;
      }
    }

    return {
      resolvedContent: merged.join('\n'),
      method: hasConflict ? 'merged' : 'merged',
    };
  }

  /**
   * Last-write-wins: use whichever content has the newer timestamp.
   */
  private lastWriteWins(info: ConflictInfo): ConflictResolution {
    if (info.localTimestamp >= info.remoteTimestamp) {
      return { resolvedContent: info.localContent, method: 'local' };
    }
    return { resolvedContent: info.remoteContent, method: 'remote' };
  }
}
