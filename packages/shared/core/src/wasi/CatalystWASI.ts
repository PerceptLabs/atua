/**
 * CatalystWASI — Run WASI binaries inside Catalyst
 *
 * Executes wasm32-wasi compiled binaries with CatalystFS-backed filesystem.
 * Supports stdout/stderr capture, environment variables, args, and preopened dirs.
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import { WASIBindings, type WASIConfig } from './WASIBindings.js';

export interface WASIExecConfig {
  /** Arguments passed to the WASI program */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Preopened directories: WASI path -> CatalystFS path */
  preopens?: Record<string, string>;
  /** Stdout callback (called incrementally) */
  stdout?: (data: string) => void;
  /** Stderr callback (called incrementally) */
  stderr?: (data: string) => void;
  /** Stdin provider (return null for EOF) */
  stdin?: () => string | null;
}

export interface WASIExecResult {
  /** Program exit code (0 = success) */
  exitCode: number;
  /** Collected stdout output */
  stdout: string;
  /** Collected stderr output */
  stderr: string;
}

export interface CatalystWASIConfig {
  /** CatalystFS instance for filesystem access */
  fs?: CatalystFS;
  /** Default preopened directories */
  preopens?: Record<string, string>;
}

export class CatalystWASI {
  private readonly fs?: CatalystFS;
  private readonly defaultPreopens: Record<string, string>;

  private constructor(config: CatalystWASIConfig = {}) {
    this.fs = config.fs;
    this.defaultPreopens = config.preopens ?? { '/': '/' };
  }

  /**
   * Create a new CatalystWASI instance.
   */
  static create(config: CatalystWASIConfig = {}): CatalystWASI {
    return new CatalystWASI(config);
  }

  /**
   * Execute a WASI binary from a Uint8Array.
   */
  async exec(
    wasmBinary: Uint8Array,
    config: WASIExecConfig = {},
  ): Promise<WASIExecResult> {
    const wasiConfig: WASIConfig = {
      fs: this.fs,
      args: config.args ?? ['program'],
      env: config.env ?? {},
      preopens: config.preopens ?? this.defaultPreopens,
      stdout: config.stdout,
      stderr: config.stderr,
      stdin: config.stdin,
    };

    const bindings = new WASIBindings(wasiConfig);
    const imports = bindings.getImports();

    try {
      const module = await WebAssembly.compile(wasmBinary);
      const instance = await WebAssembly.instantiate(module, imports);

      // Set memory reference
      const memory = instance.exports.memory as WebAssembly.Memory;
      if (memory) {
        bindings.setMemory(memory);
      }

      // Call _start (WASI entry point)
      const start = instance.exports._start as Function;
      if (!start) {
        throw new Error('WASI module missing _start export');
      }

      try {
        start();
      } catch (err: any) {
        // proc_exit throws a special error object
        if (err?.__wasi_exit) {
          return {
            exitCode: err.exitCode,
            stdout: bindings.getStdout(),
            stderr: bindings.getStderr(),
          };
        }
        // Propagate real errors
        return {
          exitCode: 1,
          stdout: bindings.getStdout(),
          stderr: bindings.getStderr() + (err?.message ?? String(err)),
        };
      }

      return {
        exitCode: bindings.getExitCode() ?? 0,
        stdout: bindings.getStdout(),
        stderr: bindings.getStderr(),
      };
    } catch (err: any) {
      // Handle WASI exit from within compilation/instantiation
      if (err?.__wasi_exit) {
        return {
          exitCode: err.exitCode,
          stdout: bindings.getStdout(),
          stderr: bindings.getStderr(),
        };
      }
      throw err;
    }
  }

  /**
   * Execute a WASI binary from a file path on CatalystFS.
   */
  async execFile(
    path: string,
    config: WASIExecConfig = {},
  ): Promise<WASIExecResult> {
    if (!this.fs) {
      throw new Error('CatalystFS required for execFile');
    }

    const content = this.fs.readFileSync(path);
    let binary: Uint8Array;
    if (content instanceof ArrayBuffer) {
      binary = new Uint8Array(content);
    } else if (typeof content === 'string') {
      // Shouldn't normally be string for .wasm files
      binary = new TextEncoder().encode(content);
    } else {
      binary = new Uint8Array(content as ArrayBuffer);
    }

    // Set default args to include the filename
    if (!config.args) {
      config = { ...config, args: [path] };
    }

    return this.exec(binary, config);
  }
}
