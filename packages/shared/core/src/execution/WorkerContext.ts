/**
 * WorkerContext — V8 Worker execution context.
 *
 * Primary execution environment for Atua. Each eval() runs in a
 * Web Worker with its own V8 isolate. Timeout enforcement via
 * Worker.terminate() — a hard kill with full memory reclamation.
 *
 * Uses the existing WorkerPool + WorkerBridge from src/proc/
 * with a rewritten worker-template that boots native V8 (no QuickJS).
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import type {
  ExecutionContext,
  EvalOpts,
  SpawnOpts,
  ExecResult,
  ProcessResult,
  ContextStatus,
} from './types.js';
import { WorkerPool } from '../proc/WorkerPool.js';
import { WorkerBridge } from '../proc/WorkerBridge.js';

export interface WorkerContextConfig {
  fs?: AtuaFS;
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  maxWorkers?: number;
}

export class WorkerContext implements ExecutionContext {
  private pool: WorkerPool;
  private fs?: AtuaFS;
  private env: Record<string, string>;
  private cwd: string;
  private defaultTimeout: number;
  private _destroyed = false;
  private _status: ContextStatus = { state: 'idle' };
  private nextPid = 1;

  constructor(config: WorkerContextConfig = {}) {
    this.fs = config.fs;
    this.env = config.env ?? {};
    this.cwd = config.cwd ?? '/';
    this.defaultTimeout = config.timeout ?? 30_000;
    this.pool = new WorkerPool({ maxWorkers: config.maxWorkers ?? 8 });
  }

  async eval(code: string, opts?: EvalOpts): Promise<ExecResult> {
    if (this._destroyed) {
      throw new Error('WorkerContext is destroyed');
    }

    const timeout = opts?.timeoutMs ?? this.defaultTimeout;
    const start = performance.now();
    this._status = { state: 'executing', startedAt: Date.now() };

    // Check if Workers are available
    const canUseWorker = await this.pool.isWorkerSupported();
    if (!canUseWorker) {
      // Fallback to inline execution (same-thread, no isolation)
      return this.evalInline(code, start);
    }

    const pid = this.nextPid++;
    const handle = this.pool.spawn(pid);
    const bridge = new WorkerBridge(handle, this.fs);

    let stdout = '';
    let stderr = '';

    try {
      await bridge.waitReady();

      const result = await Promise.race([
        bridge.exec(code, {
          onStdout: (data) => { stdout += data; },
          onStderr: (data) => { stderr += data; },
        }),
        this.timeoutPromise(timeout, pid),
      ]);

      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };
      this.pool.release(pid);

      return {
        value: undefined,
        stdout,
        stderr,
        durationMs,
        timedOut: false,
      };
    } catch (err) {
      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };

      const isTimeout = (err as Error).message?.includes('timed out');
      if (isTimeout) {
        this.pool.terminate(pid);
        return { value: undefined, stdout, stderr, durationMs, timedOut: true };
      }

      this.pool.release(pid);
      return {
        value: undefined,
        stdout,
        stderr: stderr + (err as Error).message,
        durationMs,
        timedOut: false,
      };
    }
  }

  async spawn(command: string, args?: string[], opts?: SpawnOpts): Promise<ProcessResult> {
    // Spawn builds a shell command and evals it
    const cmd = [command, ...(args ?? [])].join(' ');
    const code = `
      const { execSync } = require('child_process');
      try {
        const result = execSync(${JSON.stringify(cmd)}, { encoding: 'utf-8' });
        console.log(result);
      } catch (e) {
        console.error(e.stderr || e.message);
        process.exit(e.status || 1);
      }
    `;
    const result = await this.eval(code, opts);
    return { ...result, exitCode: result.timedOut ? 124 : 0 };
  }

  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;
    this._status = { state: 'destroyed' };
    this.pool.dispose();
  }

  status(): ContextStatus {
    return this._status;
  }

  private timeoutPromise(ms: number, pid: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        this.pool.terminate(pid);
        reject(new Error(`Execution timed out after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Fallback inline execution for environments without Workers.
   * Creates scoped console/process objects — no global mutation.
   */
  private async evalInline(code: string, start: number): Promise<ExecResult> {
    let stdout = '';
    let stderr = '';

    const consoleProxy = {
      log: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
      info: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
      debug: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
      warn: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
      error: (...args: unknown[]) => { stderr += args.map(String).join(' ') + '\n'; },
      dir: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
      trace: () => {},
      time: () => {},
      timeEnd: () => {},
      clear: () => {},
      table: (...args: unknown[]) => { stdout += args.map(String).join(' ') + '\n'; },
    };

    const processObj = {
      env: { ...this.env },
      cwd: () => this.cwd,
      platform: 'browser',
      version: 'v22.0.0',
      exit: () => {},
      nextTick: (fn: () => void) => Promise.resolve().then(fn),
    };

    try {
      const fn = new Function(
        'console', 'process', '__filename', '__dirname',
        code,
      );
      fn(consoleProxy, processObj, '<eval>', '/');

      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };
      return { value: undefined, stdout, stderr, durationMs, timedOut: false };
    } catch (err) {
      const durationMs = performance.now() - start;
      this._status = { state: 'idle' };
      return {
        value: undefined,
        stdout,
        stderr: stderr + (err as Error).message + '\n',
        durationMs,
        timedOut: false,
      };
    }
  }
}
