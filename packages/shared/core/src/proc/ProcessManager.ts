/**
 * ProcessManager — Manages sandboxed child processes
 *
 * Each child process runs in its own Web Worker with native V8 execution,
 * providing true thread-level isolation. If Workers are unavailable
 * (sandboxed environments), falls back to inline execution via
 * new Function() on the main thread.
 *
 * Features:
 * - exec(): Run code, wait for completion, return stdout/stderr
 * - spawn(): Start code, stream stdout/stderr in real-time
 * - kill(): SIGTERM via MessagePort, SIGKILL via Worker.terminate()
 * - Process tree management (PID tracking, listing)
 * - WorkerPool with configurable maxWorkers limit
 * - StdioBatcher for efficient Worker→main thread stdio
 * - AtuaFS access from Workers via MessagePort proxy
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import { AtuaWASI } from '../wasi/AtuaWASI.js';
import { AtuaProcess, type Signal } from './AtuaProcess.js';
import { WorkerPool } from './WorkerPool.js';
import { WorkerBridge } from './WorkerBridge.js';
import { SIGNALS } from './worker-template.js';

export interface ProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // ms, default 30000
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid: number;
}

export interface ProcessManagerConfig {
  fs?: AtuaFS;
  maxProcesses?: number; // default 32
  maxWorkers?: number; // default 8 — WorkerPool limit
  /** Dedicated pool for long-running MCP server Workers. Default 4. */
  serverMaxWorkers?: number;
  /** Force inline mode (skip Worker detection) */
  forceInline?: boolean;
}

export class ProcessManager {
  private nextPid = 1;
  private processes = new Map<number, AtuaProcess>();
  private bridges = new Map<number, WorkerBridge>();
  private fs?: AtuaFS;
  private maxProcesses: number;
  private pool: WorkerPool;
  private serverPool: WorkerPool;
  private forceInline: boolean;

  constructor(config: ProcessManagerConfig = {}) {
    this.fs = config.fs;
    this.maxProcesses = config.maxProcesses ?? 32;
    this.forceInline = config.forceInline ?? false;
    this.pool = new WorkerPool({ maxWorkers: config.maxWorkers ?? 8 });
    this.serverPool = new WorkerPool({ maxWorkers: config.serverMaxWorkers ?? 4 });
  }

  /**
   * Execute a WASI binary file from AtuaFS.
   * Returns collected stdout, stderr, and exit code.
   */
  async execWasm(
    path: string,
    args: string[] = [],
    options: ProcessOptions = {},
  ): Promise<ExecResult> {
    if (!this.fs) {
      throw new Error('AtuaFS required for WASI execution');
    }

    const pid = this.nextPid++;
    const wasi = AtuaWASI.create({ fs: this.fs });

    try {
      const result = await wasi.execFile(path, {
        args: [path, ...args],
        env: options.env,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        pid,
      };
    } catch (err: any) {
      return {
        stdout: '',
        stderr: err?.message ?? String(err),
        exitCode: 1,
        pid,
      };
    }
  }

  /**
   * Execute code and wait for completion.
   * Returns collected stdout, stderr, and exit code.
   */
  async exec(code: string, options: ProcessOptions = {}): Promise<ExecResult> {
    const proc = this.spawn(code, options);

    return new Promise<ExecResult>((resolve, reject) => {
      const timeout = options.timeout ?? 30000;
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (timeout > 0) {
        timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error(`Process ${proc.pid} timed out after ${timeout}ms`));
        }, timeout);
      }

      proc.on('exit', (exitCode: number) => {
        if (timer) clearTimeout(timer);
        resolve({
          stdout: proc.stdout,
          stderr: proc.stderr,
          exitCode,
          pid: proc.pid,
        });
      });
    });
  }

  /**
   * Spawn a new process that runs the given code.
   * Returns immediately with an AtuaProcess handle.
   * Tries Worker-based isolation first, falls back to inline.
   */
  spawn(code: string, options: ProcessOptions = {}): AtuaProcess {
    if (this.processes.size >= this.maxProcesses) {
      throw new Error(`Maximum process limit (${this.maxProcesses}) reached`);
    }

    const pid = this.nextPid++;
    const proc = new AtuaProcess(pid);
    this.processes.set(pid, proc);

    // Clean up when process exits
    proc.on('exit', () => {
      // Keep in process list for a short time so callers can read stdout/stderr
      setTimeout(() => this.processes.delete(pid), 1000);
    });

    // Start the process asynchronously
    this.startProcess(proc, code, options).catch(() => {
      // If start fails, mark as exited with error
      if (proc.state === 'starting' || proc.state === 'running') {
        proc._exit(1);
      }
    });

    return proc;
  }

  /**
   * Start a process — tries Worker first, falls back to inline.
   */
  private async startProcess(
    proc: AtuaProcess,
    code: string,
    options: ProcessOptions,
  ): Promise<void> {
    if (proc.state === 'killed' || proc.state === 'exited') return;

    // Try Worker-based isolation first (unless forced inline)
    if (!this.forceInline) {
      const canUseWorker = await this.pool.isWorkerSupported();
      if (canUseWorker) {
        try {
          await this.startWorkerProcess(proc, code, options);
          return;
        } catch {
          // Worker failed — fall through to inline
          console.warn(
            '[atua] Worker process failed, falling back to inline mode',
          );
        }
      }
    }

    // Fallback: inline execution via new Function() on the main thread
    await this.startInlineProcess(proc, code, options);
  }

  /** Start a process in a Web Worker (true thread isolation) */
  private async startWorkerProcess(
    proc: AtuaProcess,
    code: string,
    _options: ProcessOptions,
  ): Promise<void> {
    const handle = this.pool.spawn(proc.pid);
    const bridge = new WorkerBridge(handle, this.fs);
    this.bridges.set(proc.pid, bridge);

    // Wait for Worker to boot
    await bridge.waitReady();

    if (proc.state === 'killed' || proc.state === 'exited') {
      this.pool.terminate(proc.pid);
      this.bridges.delete(proc.pid);
      return;
    }

    proc._setState('running');

    // Execute code, streaming stdio back
    const result = await bridge.exec(code, {
      onStdout: (data) => proc._pushStdout(data),
      onStderr: (data) => proc._pushStderr(data),
    });

    if (proc.state === 'running') {
      proc._exit(result.exitCode);
    }
    this.pool.release(proc.pid);
    this.bridges.delete(proc.pid);
  }

  /**
   * Start a process inline on the main thread (fallback).
   *
   * Uses new Function() with a scoped console proxy — no global mutation.
   * The console proxy routes output to the process's stdout/stderr buffers.
   */
  private async startInlineProcess(
    proc: AtuaProcess,
    code: string,
    options: ProcessOptions,
  ): Promise<void> {
    // Check state before starting
    if (proc.state === 'killed' || proc.state === 'exited') return;

    proc._setState('running');

    // Build scoped console proxy — routes to process stdout/stderr
    const consoleProxy = {
      log: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
      info: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
      debug: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
      warn: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
      error: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStderr(text);
      },
      dir: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
      trace: () => {},
      time: () => {},
      timeEnd: () => {},
      clear: () => {},
      table: (...args: unknown[]) => {
        const text = args.map(a => typeof a === 'string' ? a : stringifyArg(a)).join(' ') + '\n';
        proc._pushStdout(text);
      },
    };

    // Build scoped process object
    const processObj = {
      env: { ...(options.env ?? {}) },
      cwd: () => options.cwd ?? '/',
      chdir: () => {},
      platform: 'browser',
      arch: 'wasm32',
      version: 'v22.0.0',
      versions: { node: '22.0.0' },
      pid: proc.pid,
      ppid: 0,
      argv: ['node'],
      argv0: 'node',
      execArgv: [],
      execPath: '/usr/local/bin/node',
      title: 'atua',
      exit: (exitCode: number) => {
        if (proc.state === 'running') proc._exit(exitCode ?? 0);
      },
      nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
        Promise.resolve().then(() => fn(...args));
      },
      on: function() { return this; },
      off: function() { return this; },
      once: function() { return this; },
      emit: () => false,
      removeListener: function() { return this; },
      removeAllListeners: function() { return this; },
    };

    // Minimal require stub
    const requireFn = (name: string) => {
      const err = new Error(`MODULE_NOT_FOUND: Cannot find module '${name}'`);
      (err as any).code = 'MODULE_NOT_FOUND';
      throw err;
    };

    try {
      const fn = new Function(
        'console', 'process', 'require',
        'module', 'exports',
        '__filename', '__dirname', 'global',
        code,
      );
      const mod: { exports: unknown } = { exports: {} };
      fn(
        consoleProxy,
        processObj,
        requireFn,
        mod, mod.exports,
        '<process>', '/',
        typeof globalThis !== 'undefined' ? globalThis : {},
      );

      if (proc.state === 'running') {
        proc._exit(0);
      }
    } catch {
      // Runtime error
      if (proc.state === 'running') {
        proc._exit(1);
      }
    }
  }

  /**
   * Spawn a long-running server process in a dedicated Worker.
   * Unlike spawn(), the Worker stays alive after code executes —
   * it keeps listening for stdin messages (e.g. MCP JSON-RPC).
   * Uses a dedicated server Worker pool separate from the exec/spawn pool.
   */
  async spawnServer(code: string, options: ProcessOptions = {}): Promise<AtuaProcess> {
    if (this.processes.size >= this.maxProcesses) {
      throw new Error(`Maximum process limit (${this.maxProcesses}) reached`);
    }

    const canUseWorker = !this.forceInline && await this.serverPool.isWorkerSupported();
    if (!canUseWorker) {
      throw new Error('Server processes require Worker support');
    }

    const pid = this.nextPid++;
    const proc = new AtuaProcess(pid);
    this.processes.set(pid, proc);

    // Clean up when process exits
    proc.on('exit', () => {
      setTimeout(() => this.processes.delete(pid), 1000);
    });

    const handle = this.serverPool.spawn(pid);
    const bridge = new WorkerBridge(handle, this.fs);
    this.bridges.set(pid, bridge);

    await bridge.waitReady();

    if (proc.state === 'killed' || proc.state === 'exited') {
      this.serverPool.terminate(pid);
      this.bridges.delete(pid);
      return proc;
    }

    proc._setState('running');

    // Wire AtuaProcess.write() → WorkerBridge.writeStdin() → Worker stdin
    proc.on('stdin', (data: string) => {
      bridge.writeStdin(data);
    });

    // Start server mode — Worker stays alive after code runs
    bridge.startServer(code, {
      onStdout: (data) => proc._pushStdout(data),
      onStderr: (data) => proc._pushStderr(data),
      onExit: (exitCode) => {
        if (proc.state === 'running') {
          proc._exit(exitCode);
        }
        this.serverPool.release(pid);
        this.bridges.delete(pid);
      },
    });

    return proc;
  }

  /** Send a signal to a process */
  kill(pid: number, signal: Signal = 'SIGTERM'): boolean {
    const proc = this.processes.get(pid);
    if (!proc) return false;

    // For Worker-based processes, use Worker.terminate() for SIGKILL
    // Try both pools — process could be in either
    if (signal === 'SIGKILL') {
      this.pool.terminate(pid);
      this.serverPool.terminate(pid);
      this.bridges.delete(pid);
    } else {
      // SIGTERM — send via MessagePort for graceful shutdown
      const signalNum = SIGNALS[signal] ?? 15;
      this.pool.signal(pid, signalNum);
      this.serverPool.signal(pid, signalNum);
    }

    return proc.kill(signal);
  }

  /** Get a process by PID */
  getProcess(pid: number): AtuaProcess | undefined {
    return this.processes.get(pid);
  }

  /** List all tracked processes */
  listProcesses(): AtuaProcess[] {
    return [...this.processes.values()];
  }

  /** List only running processes */
  listRunning(): AtuaProcess[] {
    return this.listProcesses().filter((p) => p.state === 'running');
  }

  /** Kill all running processes */
  killAll(signal: Signal = 'SIGTERM'): void {
    for (const proc of this.processes.values()) {
      if (proc.state === 'running' || proc.state === 'starting') {
        this.kill(proc.pid, signal);
      }
    }
  }

  /** Clean up all Workers and resources */
  dispose(): void {
    this.pool.dispose();
    this.serverPool.dispose();
  }

  /** Get the number of currently tracked processes */
  get processCount(): number {
    return this.processes.size;
  }

  /** Get the number of running processes */
  get runningCount(): number {
    return this.listRunning().length;
  }

  /** Get the WorkerPool for inspection */
  get workerPool(): WorkerPool {
    return this.pool;
  }
}

/** Safely stringify an argument for console output */
function stringifyArg(a: unknown): string {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  try { return JSON.stringify(a); }
  catch { return String(a); }
}
