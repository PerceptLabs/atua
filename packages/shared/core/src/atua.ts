/**
 * Atua — Top-level factory for creating a fully-wired Atua instance
 *
 * Composes all layers: AtuaFS, AtuaEngine, ProcessManager,
 * PackageManager, BuildPipeline, HMRManager.
 */
import { AtuaFS } from './fs/AtuaFS.js';
import { AtuaEngine, type EngineConfig } from './engine/AtuaEngine.js';
import type { IEngine, EngineFactory, EngineInstanceConfig, ModuleLoaderFactory } from './engine/interfaces.js';
import { NativeEngine } from './engines/native/NativeEngine.js';
import { FetchProxy, type FetchProxyConfig } from './net/FetchProxy.js';
import { ProcessManager } from './proc/ProcessManager.js';
import { PackageManager, type PackageManagerConfig } from './pkg/PackageManager.js';
import { BuildPipeline, type BuildConfig, type Transpiler } from './dev/BuildPipeline.js';
import { HMRManager } from './dev/HMRManager.js';

export interface AtuaConfig {
  /** Instance name (used for persistence) */
  name?: string;
  /** Engine configuration */
  engine?: Omit<EngineConfig, 'fs' | 'fetchProxy'>;
  /** Fetch proxy configuration */
  fetch?: FetchProxyConfig;
  /** Package manager configuration */
  packages?: Omit<PackageManagerConfig, 'fs'>;
  /** Build pipeline configuration */
  build?: {
    transpiler?: Transpiler;
    config?: BuildConfig;
  };
  /** Custom engine factory — allows swapping QuickJS for another engine */
  engineFactory?: EngineFactory;
  /** Custom module loader factory — allows swapping NodeCompatLoader */
  moduleLoaderFactory?: ModuleLoaderFactory;
}

export class Atua {
  readonly fs: AtuaFS;
  readonly processes: ProcessManager;
  readonly packages: PackageManager;
  readonly buildPipeline: BuildPipeline;
  readonly hmr: HMRManager;
  readonly fetchProxy?: FetchProxy;

  private _engine: IEngine | null = null;
  private engineConfig: Omit<EngineConfig, 'fs' | 'fetchProxy'>;
  private _engineFactory?: EngineFactory;
  private _moduleLoaderFactory?: ModuleLoaderFactory;

  private constructor(
    fs: AtuaFS,
    engineConfig: Omit<EngineConfig, 'fs' | 'fetchProxy'>,
    fetchProxy: FetchProxy | undefined,
    processes: ProcessManager,
    packages: PackageManager,
    buildPipeline: BuildPipeline,
    hmr: HMRManager,
    engineFactory?: EngineFactory,
    moduleLoaderFactory?: ModuleLoaderFactory,
  ) {
    this.fs = fs;
    this.engineConfig = engineConfig;
    this.fetchProxy = fetchProxy;
    this.processes = processes;
    this.packages = packages;
    this.buildPipeline = buildPipeline;
    this.hmr = hmr;
    this._engineFactory = engineFactory;
    this._moduleLoaderFactory = moduleLoaderFactory;
  }

  /**
   * Create a new Atua instance with all layers wired together.
   */
  static async create(config: AtuaConfig = {}): Promise<Atua> {
    const fs = await AtuaFS.create(config.name ?? 'atua');

    const fetchProxy = config.fetch ? new FetchProxy(config.fetch) : undefined;

    const processes = new ProcessManager({
      fs,
      engineFactory: config.engineFactory,
    });

    const packages = new PackageManager({
      fs,
      ...config.packages,
    });

    const buildPipeline = new BuildPipeline(fs, config.build?.transpiler);

    const hmr = new HMRManager(fs, buildPipeline, config.build?.config);

    return new Atua(
      fs,
      config.engine ?? {},
      fetchProxy,
      processes,
      packages,
      buildPipeline,
      hmr,
      config.engineFactory,
      config.moduleLoaderFactory,
    );
  }

  /**
   * Get or create the engine (lazy-initialized).
   * Uses the custom engineFactory if provided, otherwise defaults to AtuaEngine.
   */
  async getEngine(): Promise<IEngine> {
    if (!this._engine) {
      if (this._engineFactory) {
        this._engine = await this._engineFactory({
          fs: this.fs,
          net: this.fetchProxy,
          env: this.engineConfig.env,
          moduleLoader: this._moduleLoaderFactory
            ? this._moduleLoaderFactory({ fs: this.fs, env: this.engineConfig.env })
            : undefined,
        });
      } else {
        this._engine = await AtuaEngine.create({
          fs: this.fs,
          fetchProxy: this.fetchProxy,
          ...this.engineConfig,
        });
      }
    }
    return this._engine;
  }

  /**
   * Evaluate JavaScript code in the sandbox.
   */
  async eval(code: string, filename?: string): Promise<any> {
    const engine = await this.getEngine();
    return engine.eval(code, filename);
  }

  /**
   * Evaluate async JavaScript code (supports await, fetch, etc.).
   * Requires an AtuaEngine (not available with custom engine factories).
   */
  async evalAsync(code: string, filename?: string): Promise<any> {
    const engine = await this.getEngine();
    if (typeof (engine as any).evalAsync !== 'function') {
      throw new Error('evalAsync requires AtuaEngine (not available with custom engine factory)');
    }
    return (engine as any).evalAsync(code, filename);
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.hmr.stop();
    this.processes.killAll();
    this._engine?.destroy().catch(() => {});
    this._engine = null;
    this.fs.destroy();
  }
}

/** Engine type selector for createRuntime */
export type EngineType = 'quickjs' | 'native';

/**
 * createRuntime — Convenience factory for creating an Atua instance
 * with custom engine and module loader factories.
 *
 * This is the primary entry point for distribution packages that want
 * to wire a specific engine + loader combination.
 *
 * @param config - Atua configuration
 * @param engineType - Engine to use: 'quickjs' (default) or 'native'
 */
export async function createRuntime(
  config: AtuaConfig = {},
  engineType: EngineType = 'quickjs',
): Promise<Atua> {
  if (engineType === 'native' && !config.engineFactory) {
    config = {
      ...config,
      engineFactory: (cfg: EngineInstanceConfig) => NativeEngine.create({
        fs: cfg.fs as AtuaFS | undefined,
        fetchProxy: cfg.net as FetchProxy | undefined,
        moduleLoader: cfg.moduleLoader,
        memoryLimit: cfg.memoryLimit,
        timeout: cfg.timeout,
        env: cfg.env,
        cwd: cfg.cwd,
      }),
    };
  }
  return Atua.create(config);
}
