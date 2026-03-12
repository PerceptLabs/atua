/**
 * Atua — Top-level factory for creating a fully-wired Atua instance
 *
 * Composes all layers: AtuaFS, ExecutionContext, ProcessManager,
 * PackageManager, BuildPipeline, HMRManager.
 *
 * Uses WorkerContext (V8 Workers) for code execution instead of QuickJS.
 */
import { AtuaFS } from './fs/AtuaFS.js';
import { FetchProxy, type FetchProxyConfig } from './net/FetchProxy.js';
import { ProcessManager } from './proc/ProcessManager.js';
import { PackageManager, type PackageManagerConfig } from './pkg/PackageManager.js';
import { BuildPipeline, type BuildConfig, type Transpiler } from './dev/BuildPipeline.js';
import { HMRManager } from './dev/HMRManager.js';
import { WorkerContext } from './execution/WorkerContext.js';
import type { ExecResult } from './execution/types.js';

export interface AtuaConfig {
  /** Instance name (used for persistence) */
  name?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Fetch proxy configuration */
  fetch?: FetchProxyConfig;
  /** Package manager configuration */
  packages?: Omit<PackageManagerConfig, 'fs'>;
  /** Build pipeline configuration */
  build?: {
    transpiler?: Transpiler;
    config?: BuildConfig;
  };
  /** Execution timeout in ms */
  timeout?: number;
}

export class Atua {
  readonly fs: AtuaFS;
  readonly processes: ProcessManager;
  readonly packages: PackageManager;
  readonly buildPipeline: BuildPipeline;
  readonly hmr: HMRManager;
  readonly fetchProxy?: FetchProxy;

  private _workerContext: WorkerContext | null = null;
  private env: Record<string, string>;
  private cwd: string;
  private timeout: number;

  private constructor(
    fs: AtuaFS,
    fetchProxy: FetchProxy | undefined,
    processes: ProcessManager,
    packages: PackageManager,
    buildPipeline: BuildPipeline,
    hmr: HMRManager,
    env: Record<string, string>,
    cwd: string,
    timeout: number,
  ) {
    this.fs = fs;
    this.fetchProxy = fetchProxy;
    this.processes = processes;
    this.packages = packages;
    this.buildPipeline = buildPipeline;
    this.hmr = hmr;
    this.env = env;
    this.cwd = cwd;
    this.timeout = timeout;
  }

  /**
   * Create a new Atua instance with all layers wired together.
   */
  static async create(config: AtuaConfig = {}): Promise<Atua> {
    const fs = await AtuaFS.create(config.name ?? 'atua');

    const fetchProxy = config.fetch ? new FetchProxy(config.fetch) : undefined;

    const processes = new ProcessManager({ fs });

    const packages = new PackageManager({
      fs,
      ...config.packages,
    });

    const buildPipeline = new BuildPipeline(fs, config.build?.transpiler);

    const hmr = new HMRManager(fs, buildPipeline, config.build?.config);

    return new Atua(
      fs,
      fetchProxy,
      processes,
      packages,
      buildPipeline,
      hmr,
      config.env ?? {},
      config.cwd ?? '/',
      config.timeout ?? 30_000,
    );
  }

  /**
   * Get or create the WorkerContext (lazy-initialized).
   */
  getWorkerContext(): WorkerContext {
    if (!this._workerContext) {
      this._workerContext = new WorkerContext({
        fs: this.fs,
        env: this.env,
        cwd: this.cwd,
        timeout: this.timeout,
      });
    }
    return this._workerContext;
  }

  /**
   * Evaluate JavaScript code via WorkerContext.
   */
  async eval(code: string): Promise<ExecResult> {
    const ctx = this.getWorkerContext();
    return ctx.eval(code);
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.hmr.stop();
    this.processes.killAll();
    this._workerContext?.destroy().catch(() => {});
    this._workerContext = null;
    this.fs.destroy();
  }
}

/**
 * createRuntime — Convenience factory for creating an Atua instance.
 */
export async function createRuntime(config: AtuaConfig = {}): Promise<Atua> {
  return Atua.create(config);
}
