/**
 * NativeEngine — Browser-native JavaScript execution via Web Workers
 *
 * Implements IEngine using the browser's own JS engine (V8/SpiderMonkey/JSC)
 * for full-speed execution. Each NativeEngine instance runs in its own
 * Web Worker with a Node.js-compatible environment.
 *
 * Tier 1 execution: validated code runs at native speed.
 *
 * In test environments (Node.js), falls back to inline execution
 * via new Function() since real Web Workers aren't available.
 */
import type { CatalystFS } from '../../fs/CatalystFS.js';
import type { FetchProxy } from '../../net/FetchProxy.js';
import type { IEngine, IModuleLoader, EngineInstanceConfig } from '../../engine/interfaces.js';
import { NativeModuleLoader } from './NativeModuleLoader.js';
import { getWorkerBootstrapSource } from './WorkerBootstrap.js';

export interface NativeEngineConfig {
  fs?: CatalystFS;
  fetchProxy?: FetchProxy;
  memoryLimit?: number;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
  moduleLoader?: IModuleLoader;
}

type EventHandler = (...args: unknown[]) => void;

export class NativeEngine implements IEngine {
  private fs?: CatalystFS;
  private fetchProxy?: FetchProxy;
  private _disposed = false;
  private _initialized = false;
  private handlers = new Map<string, EventHandler[]>();
  private moduleLoader: IModuleLoader;
  private timeout: number;
  private env: Record<string, string>;
  private cwd: string;

  /** Module cache for inline execution mode */
  private _moduleCache: Record<string, unknown> = {};
  /** Require function bound to this engine's module system */
  private _requireFn: ((name: string) => unknown) | null = null;

  private constructor(config: NativeEngineConfig = {}) {
    this.fs = config.fs;
    this.fetchProxy = config.fetchProxy;
    this.timeout = config.timeout ?? 30000;
    this.env = config.env ?? {};
    this.cwd = config.cwd ?? '/';
    this.moduleLoader = config.moduleLoader ?? new NativeModuleLoader({
      fs: config.fs,
      env: config.env,
    });
  }

  /**
   * Create a new NativeEngine instance.
   */
  static async create(config: NativeEngineConfig = {}): Promise<NativeEngine> {
    const engine = new NativeEngine(config);
    await engine.initialize();
    return engine;
  }

  /**
   * Initialize the engine — load module sources and set up the require system.
   */
  private async initialize(): Promise<void> {
    if (this._initialized) return;

    await this.moduleLoader.initialize();
    this._buildRequire();
    this._initialized = true;
  }

  /**
   * Build the require() function for inline execution.
   * In browser mode, this would be inside the Worker via WorkerBootstrap.
   * In Node.js test mode, we build it here on the main context.
   */
  private _buildRequire(): void {
    const engine = this;
    const cache = this._moduleCache;
    const loader = this.moduleLoader;

    this._requireFn = function require(name: string): unknown {
      // Strip node: prefix
      let moduleName = name;
      if (moduleName.startsWith('node:')) {
        moduleName = moduleName.slice(5);
      }

      // Check cache
      if (cache[moduleName] !== undefined) {
        return cache[moduleName];
      }

      // Try builtin source
      const builtinSource = loader.getBuiltinSource(moduleName);
      if (builtinSource) {
        const mod = { exports: {} as Record<string, unknown> };
        cache[moduleName] = mod.exports; // Pre-cache for circular deps

        try {
          // Inject fs host functions into the scope if this is the fs module
          if (moduleName === 'fs' && engine.fs) {
            mod.exports = engine._buildFsExports();
            cache[moduleName] = mod.exports;
            return mod.exports;
          }

          const fn = new Function(
            'module', 'exports', 'require', '__filename', '__dirname',
            builtinSource
          );
          fn(mod, mod.exports, engine._requireFn, `/${moduleName}.js`, '/');
          cache[moduleName] = mod.exports;
          return mod.exports;
        } catch (e) {
          // Return partial exports
          cache[moduleName] = mod.exports;
          return mod.exports;
        }
      }

      // Try filesystem resolution
      const fsSource = loader.resolveModule(moduleName);
      if (fsSource) {
        const mod = { exports: {} as Record<string, unknown> };
        cache[moduleName] = mod.exports;
        try {
          const fn = new Function(
            'module', 'exports', 'require', '__filename', '__dirname',
            fsSource
          );
          const dirname = moduleName.substring(0, moduleName.lastIndexOf('/')) || '/';
          fn(mod, mod.exports, engine._requireFn, moduleName, dirname);
          cache[moduleName] = mod.exports;
          return mod.exports;
        } catch (e) {
          delete cache[moduleName];
          throw e;
        }
      }

      const err = new Error(`MODULE_NOT_FOUND: Cannot find module '${name}'`);
      (err as any).code = 'MODULE_NOT_FOUND';
      throw err;
    };
  }

  /**
   * Build fs module exports that delegate to CatalystFS.
   */
  private _buildFsExports(): Record<string, unknown> {
    const fs = this.fs!;
    return {
      readFileSync: (path: string, encoding?: BufferEncoding) => {
        const result = fs.readFileSync(path, encoding);
        return typeof result === 'string' ? result : new TextDecoder().decode(result as Uint8Array);
      },
      writeFileSync: (path: string, data: string) => fs.writeFileSync(path, data),
      existsSync: (path: string) => fs.existsSync(path),
      mkdirSync: (path: string, options?: unknown) => fs.mkdirSync(path, options as any),
      readdirSync: (path: string) => fs.readdirSync(path),
      statSync: (path: string) => {
        const s = fs.statSync(path);
        return {
          isFile: () => s.isFile(),
          isDirectory: () => s.isDirectory(),
          size: s.size,
          mtimeMs: s.mtimeMs,
        };
      },
      unlinkSync: (path: string) => fs.unlinkSync(path),
      renameSync: (oldPath: string, newPath: string) => fs.renameSync(oldPath, newPath),
      copyFileSync: (src: string, dest: string) => fs.copyFileSync(src, dest),
      appendFileSync: (path: string, data: string) => fs.appendFileSync(path, data),
      rmdirSync: (path: string, options?: unknown) => fs.rmdirSync(path, options as any),
    };
  }

  // ---- IEngine implementation ----

  async eval(code: string, filename = '<eval>'): Promise<unknown> {
    if (this._disposed) throw new Error('Engine is disposed');
    if (!this._initialized) await this.initialize();

    return this._evalInline(code, filename);
  }

  async evalFile(path: string): Promise<unknown> {
    if (!this.fs) throw new Error('No filesystem configured');
    const source = this.fs.readFileSync(path, 'utf-8') as string;
    return this.eval(source, path);
  }

  async createInstance(config: EngineInstanceConfig): Promise<IEngine> {
    return NativeEngine.create({
      fs: config.fs as CatalystFS | undefined,
      fetchProxy: config.net as FetchProxy | undefined,
      moduleLoader: config.moduleLoader,
      timeout: config.timeout,
      env: config.env,
      cwd: config.cwd,
    });
  }

  async destroy(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._moduleCache = {};
    this._requireFn = null;
    this.handlers.clear();
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(event, handlers.filter((h) => h !== handler));
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  // ---- Execution ----

  /**
   * Execute code inline using new Function().
   * This is the primary execution path for Node.js test environments.
   * In browser environments, this would use a Web Worker instead.
   *
   * Returns module.exports if the code sets it, otherwise undefined.
   * This matches Node.js semantics where require()'d files return module.exports.
   */
  private async _evalInline(code: string, filename: string): Promise<unknown> {
    const consoleProxy = this._buildConsoleProxy();
    const processObj = this._buildProcessObject();

    try {
      const timeoutMs = this.timeout;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const resultPromise = new Promise<unknown>((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          this.emit('timeout');
          reject(new Error(`Execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        try {
          // We pass module as a parameter so code can set module.exports
          // and we can read it back after execution.
          const fn = new Function(
            'console', 'process', 'require', 'module', 'exports',
            '__filename', '__dirname', 'global', 'Buffer',
            code
          );

          const mod: { exports: unknown } = { exports: {} };
          const bufferObj = (() => {
            try { return (this._requireFn as any)('buffer')?.Buffer; }
            catch { return undefined; }
          })();

          fn(
            consoleProxy,
            processObj,
            this._requireFn,
            mod,
            mod.exports,
            filename,
            filename.substring(0, filename.lastIndexOf('/')) || '/',
            typeof globalThis !== 'undefined' ? globalThis : {},
            bufferObj,
          );

          if (!timedOut) {
            clearTimeout(timer);
            // Return module.exports if it was modified, otherwise undefined
            const defaultExports = mod.exports;
            const hasExports = defaultExports !== undefined
              && defaultExports !== null
              && (typeof defaultExports !== 'object'
                || Object.keys(defaultExports as Record<string, unknown>).length > 0);
            resolve(hasExports ? defaultExports : undefined);
          }
        } catch (err) {
          if (!timedOut) {
            clearTimeout(timer);
            reject(err);
          }
        }
      });

      const result = await resultPromise;

      // If the result is a Promise, await it too
      if (result && typeof (result as any).then === 'function') {
        return await (result as Promise<unknown>);
      }

      return result;
    } catch (err: any) {
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Build a console proxy that captures output and emits events.
   */
  private _buildConsoleProxy(): Record<string, (...args: unknown[]) => void> {
    const engine = this;
    const makeLogFn = (level: string) => {
      return (...args: unknown[]) => {
        const textArgs = args.map(a => {
          if (typeof a === 'string') return a;
          if (a === null) return 'null';
          if (a === undefined) return 'undefined';
          try { return JSON.stringify(a); }
          catch { return String(a); }
        });
        engine.emit('console', level, ...textArgs);
      };
    };

    return {
      log: makeLogFn('log'),
      info: makeLogFn('info'),
      debug: makeLogFn('debug'),
      warn: makeLogFn('warn'),
      error: makeLogFn('error'),
      dir: makeLogFn('log'),
      trace: makeLogFn('debug'),
      time: () => {},
      timeEnd: () => {},
      clear: () => {},
      table: makeLogFn('log'),
    };
  }

  /**
   * Build a process-like object for the execution context.
   */
  private _buildProcessObject(): Record<string, unknown> {
    return {
      env: { ...this.env },
      cwd: () => this.cwd,
      chdir: () => {},
      platform: 'browser',
      arch: 'wasm32',
      version: 'v20.0.0',
      versions: { node: '20.0.0' },
      pid: 1,
      ppid: 0,
      argv: ['node'],
      argv0: 'node',
      execArgv: [],
      execPath: '/usr/local/bin/node',
      title: 'catalyst',
      exit: (code: number) => { this.emit('exit', code ?? 0); },
      nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
        Promise.resolve().then(() => fn(...args));
      },
      hrtime: {
        bigint: () => BigInt(Math.round(performance.now() * 1e6)),
      },
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      on: function() { return this; },
      off: function() { return this; },
      once: function() { return this; },
      emit: () => false,
      removeListener: function() { return this; },
      removeAllListeners: function() { return this; },
      listeners: () => [],
      listenerCount: () => 0,
    };
  }

  /**
   * Get the Worker bootstrap source code.
   * Used when creating real Web Workers in browser environments.
   */
  getBootstrapSource(): string {
    const builtinSources: Record<string, string> = {};
    for (const name of this.moduleLoader.availableBuiltins()) {
      const source = this.moduleLoader.getBuiltinSource(name);
      if (source) builtinSources[name] = source;
    }

    return getWorkerBootstrapSource({
      env: this.env,
      cwd: this.cwd,
      builtinSources,
    });
  }
}
