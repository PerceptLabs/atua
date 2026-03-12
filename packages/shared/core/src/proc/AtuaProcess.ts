/**
 * AtuaProcess — Represents a sandboxed child process
 *
 * Each process runs in its own AtuaEngine instance, providing:
 * - Isolated JavaScript scope (separate module cache, separate globals)
 * - Stdio streaming (stdout/stderr via console capture)
 * - Signal handling (SIGTERM for graceful, SIGKILL for immediate termination)
 * - Exit code tracking
 */
import type { IEngine } from '../engine/interfaces.js';

export type Signal = 'SIGTERM' | 'SIGKILL' | 'SIGINT';
export type ProcessState = 'starting' | 'running' | 'exited' | 'killed';

type ProcessEventHandler = (...args: any[]) => void;

export class AtuaProcess {
  readonly pid: number;
  private _state: ProcessState = 'starting';
  private _exitCode: number | null = null;
  private _stdoutChunks: string[] = [];
  private _stderrChunks: string[] = [];
  private _engine: IEngine | null = null;
  private _handlers = new Map<string, ProcessEventHandler[]>();
  private _startTime: number;

  constructor(pid: number) {
    this.pid = pid;
    this._startTime = Date.now();
  }

  get state(): ProcessState {
    return this._state;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get stdout(): string {
    return this._stdoutChunks.join('');
  }

  get stderr(): string {
    return this._stderrChunks.join('');
  }

  get uptime(): number {
    return Date.now() - this._startTime;
  }

  /** Attach the engine instance for this process */
  _setEngine(engine: IEngine): void {
    this._engine = engine;
    this._state = 'running';

    // Wire console events to stdout/stderr
    engine.on('console', (level: unknown, ...args: unknown[]) => {
      const text = args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
      if (level === 'error') {
        this._stderrChunks.push(text);
        this._emit('stderr', text);
      } else {
        this._stdoutChunks.push(text);
        this._emit('stdout', text);
      }
    });
  }

  /** Push stdout data from Worker bridge */
  _pushStdout(data: string): void {
    this._stdoutChunks.push(data);
    this._emit('stdout', data);
  }

  /** Push stderr data from Worker bridge */
  _pushStderr(data: string): void {
    this._stderrChunks.push(data);
    this._emit('stderr', data);
  }

  /** Set state directly (used by Worker flow which doesn't have an engine reference) */
  _setState(state: ProcessState): void {
    this._state = state;
  }

  /** Mark this process as exited with the given code */
  _exit(code: number): void {
    if (this._state !== 'running' && this._state !== 'starting') return;
    this._exitCode = code;
    this._state = 'exited';
    this._emit('exit', code);
    this._cleanup();
  }

  /** Mark this process as killed by signal */
  _killed(signal: Signal): void {
    if (this._state !== 'running' && this._state !== 'starting') return;
    this._exitCode = signal === 'SIGKILL' ? 137 : 143;
    this._state = 'killed';
    this._emit('exit', this._exitCode, signal);
    this._cleanup();
  }

  /** Send a signal to this process */
  kill(signal: Signal = 'SIGTERM'): boolean {
    if (this._state !== 'running' && this._state !== 'starting') return false;

    if (signal === 'SIGKILL') {
      // Immediate termination — dispose the engine
      this._killed(signal);
      return true;
    }

    // SIGTERM/SIGINT — graceful termination
    // Dispose the engine, which will cause any running eval to error
    this._killed(signal);
    return true;
  }

  /** Write to stdin (for future interactive process support) */
  write(data: string): void {
    if (this._state !== 'running') {
      throw new Error(`Cannot write to process ${this.pid}: state is ${this._state}`);
    }
    this._emit('stdin', data);
  }

  // ---- Event handling ----

  on(event: string, handler: ProcessEventHandler): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: ProcessEventHandler): this {
    const handlers = this._handlers.get(event);
    if (handlers) {
      this._handlers.set(
        event,
        handlers.filter((h) => h !== handler),
      );
    }
    return this;
  }

  once(event: string, handler: ProcessEventHandler): this {
    const wrapped = (...args: any[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  private _emit(event: string, ...args: any[]): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(...args);
      }
    }
  }

  private _cleanup(): void {
    if (this._engine) {
      try {
        this._engine.destroy().catch(() => {});
      } catch {
        // Ignore disposal errors
      }
      this._engine = null;
    }
  }
}
