/**
 * StdioBatcher — Batched stdio for Worker→main thread efficiency
 *
 * Instead of sending one postMessage per console.log call, accumulates
 * stdout/stderr chunks and flushes them as a single message containing
 * an array of strings. Flushing triggers on whichever comes first:
 *
 * - Byte threshold: 4KB of accumulated data (tunable)
 * - Time threshold: 16ms since first unflushed chunk (~1 frame at 60fps)
 * - Explicit flush: process exit, kill signal, or end() call
 *
 * This reduces MessagePort traffic from N messages to ~N/50 for chatty
 * processes while keeping latency under 16ms for interactive output.
 */

export interface StdioBatcherConfig {
  /** Flush after this many bytes accumulated (default: 4096) */
  batchBytes?: number;
  /** Flush after this many ms since first chunk (default: 16) */
  batchMs?: number;
}

export type FlushCallback = (stream: 'stdout' | 'stderr', chunks: string[]) => void;

export class StdioBatcher {
  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchBytes: number;
  private readonly batchMs: number;
  private readonly onFlush: FlushCallback;
  private _flushed = false;

  constructor(onFlush: FlushCallback, config: StdioBatcherConfig = {}) {
    this.onFlush = onFlush;
    this.batchBytes = config.batchBytes ?? 4096;
    this.batchMs = config.batchMs ?? 16;
  }

  /** Push a stdout chunk */
  pushStdout(data: string): void {
    this.stdoutBuffer.push(data);
    this.stdoutBytes += data.length;
    if (this.stdoutBytes >= this.batchBytes) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Push a stderr chunk */
  pushStderr(data: string): void {
    this.stderrBuffer.push(data);
    this.stderrBytes += data.length;
    if (this.stderrBytes >= this.batchBytes) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Flush all pending chunks immediately */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.stdoutBuffer.length > 0) {
      this.onFlush('stdout', this.stdoutBuffer.splice(0));
      this.stdoutBytes = 0;
    }
    if (this.stderrBuffer.length > 0) {
      this.onFlush('stderr', this.stderrBuffer.splice(0));
      this.stderrBytes = 0;
    }
  }

  /** End the batcher — flushes remaining and prevents further scheduling */
  end(): void {
    this.flush();
    this._flushed = true;
  }

  /** Number of pending stdout chunks */
  get pendingStdoutChunks(): number {
    return this.stdoutBuffer.length;
  }

  /** Number of pending stderr chunks */
  get pendingStderrChunks(): number {
    return this.stderrBuffer.length;
  }

  /** Total pending bytes across both streams */
  get pendingBytes(): number {
    return this.stdoutBytes + this.stderrBytes;
  }

  private scheduleFlush(): void {
    if (this._flushed) {
      this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, this.batchMs);
    }
  }
}
