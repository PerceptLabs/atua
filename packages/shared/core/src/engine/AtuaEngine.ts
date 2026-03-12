/**
 * AtuaEngine — QuickJS-WASM JS execution engine
 *
 * Implements IEngine for the QuickJS runtime.
 * Runs user code inside QuickJS compiled to WebAssembly.
 * JSPI/Asyncify variant auto-detection.
 * Host bindings for fs, console, fetch.
 *
 * Architecture:
 * - Module loading delegated to IModuleLoader (NodeCompatLoader by default)
 * - Built-in modules are pre-eval'd at init time and stored in globalThis.__atua_modules
 * - require() is a pure JS function inside QuickJS that reads from the module cache
 * - Filesystem module loading uses a host bridge that returns source strings (not handles)
 * - This avoids QuickJS handle lifetime issues with host function callbacks
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import type { FetchProxy } from '../net/FetchProxy.js';
import type { IEngine, IModuleLoader, EngineInstanceConfig } from './interfaces.js';
import { NodeCompatLoader } from './NodeCompatLoader.js';

export interface EngineConfig {
  fs?: AtuaFS;
  fetchProxy?: FetchProxy;
  memoryLimit?: number; // MB, default 256
  timeout?: number; // ms, default 30000
  env?: Record<string, string>;
  /** Module loader — defaults to NodeCompatLoader if not provided */
  moduleLoader?: IModuleLoader;
}

export type ConsoleLevel = 'log' | 'error' | 'warn' | 'info' | 'debug';

type EventHandler = (...args: any[]) => void;

export class AtuaEngine implements IEngine {
  private context: any;
  private runtime: any;
  private module: any;
  private fs?: AtuaFS;
  private fetchProxy?: FetchProxy;
  private _disposed = false;
  private _builtinsLoaded = false;
  private _fsBindingsInjected = false;
  private handlers = new Map<string, EventHandler[]>();
  private consoleLogs: Array<{ level: ConsoleLevel; args: any[] }> = [];
  private moduleLoader: IModuleLoader;

  private constructor() {
    // Placeholder — initialized in create()
    this.moduleLoader = null!;
  }

  /**
   * Create a new AtuaEngine instance.
   * Auto-detects JSPI vs Asyncify variant.
   */
  static async create(config: EngineConfig = {}): Promise<AtuaEngine> {
    const engine = new AtuaEngine();
    engine.fs = config.fs;
    engine.fetchProxy = config.fetchProxy;

    // Create module loader if not provided
    engine.moduleLoader = config.moduleLoader ?? new NodeCompatLoader({
      fs: config.fs,
      env: config.env,
    });

    const { getQuickJS } = await import('quickjs-emscripten');
    engine.module = await getQuickJS();

    // Create runtime with limits
    engine.runtime = engine.module.newRuntime();
    const memoryLimit = (config.memoryLimit ?? 256) * 1024 * 1024;
    engine.runtime.setMemoryLimit(memoryLimit);
    engine.runtime.setMaxStackSize(1024 * 1024); // 1MB stack

    // Create context
    engine.context = engine.runtime.newContext();

    // Inject host bindings
    engine.injectConsole();
    engine.injectRequireSystem();

    // Inject fetch binding if proxy provided
    if (engine.fetchProxy) {
      const { injectFetchBinding } = await import('../net/fetch-host-binding.js');
      injectFetchBinding(engine.context, engine.runtime, engine.fetchProxy);
    }

    return engine;
  }

  // ---- IEngine: createInstance ----

  /**
   * Create a new isolated AtuaEngine instance.
   * Used by ProcessManager for child processes.
   */
  async createInstance(config: EngineInstanceConfig): Promise<IEngine> {
    return AtuaEngine.create({
      fs: config.fs as AtuaFS | undefined,
      fetchProxy: config.net as FetchProxy | undefined,
      moduleLoader: config.moduleLoader,
      memoryLimit: config.memoryLimit,
      timeout: config.timeout,
      env: config.env,
    });
  }

  // ---- IEngine: destroy ----

  /**
   * Async destroy — IEngine contract.
   * Delegates to synchronous dispose().
   */
  async destroy(): Promise<void> {
    this.dispose();
  }

  /** Inject console.log/error/warn/info/debug that forward to host */
  private injectConsole(): void {
    const ctx = this.context;

    const makeLogFn = (level: ConsoleLevel) => {
      return ctx.newFunction(`console_${level}`, (...argHandles: any[]) => {
        const args = argHandles.map((h: any) => {
          try {
            return ctx.dump(h);
          } catch {
            return String(h);
          }
        });
        this.consoleLogs.push({ level, args });
        this.emit('console', level, ...args);
      });
    };

    const consoleObj = ctx.newObject();
    for (const level of ['log', 'error', 'warn', 'info', 'debug'] as ConsoleLevel[]) {
      const fn = makeLogFn(level);
      ctx.setProp(consoleObj, level, fn);
      fn.dispose();
    }
    ctx.setProp(ctx.global, 'console', consoleObj);
    consoleObj.dispose();
  }

  /**
   * Set up the require() system.
   * - Installs require() as a pure JS function inside QuickJS
   * - Installs a host bridge for reading module sources via the module loader
   */
  private injectRequireSystem(): void {
    const ctx = this.context;
    const engine = this;

    // Initialize the module registry inside QuickJS
    const initResult = ctx.evalCode(`globalThis.__atua_modules = {};`);
    if (initResult.value) initResult.value.dispose();
    if (initResult.error) initResult.error.dispose();

    // Host function: reads module source via the module loader.
    // Returns source string on success, or undefined if not found.
    const requireSourceFn = ctx.newFunction('__atua_require_source', (nameHandle: any) => {
      const moduleName = ctx.getString(nameHandle);
      const source = engine.moduleLoader.resolveModule(moduleName);
      if (source !== null) {
        return ctx.newString(source);
      }
      return ctx.undefined;
    });
    ctx.setProp(ctx.global, '__atua_require_source', requireSourceFn);
    requireSourceFn.dispose();

    // Install require() as a pure JS function inside QuickJS.
    // Module caching happens entirely within QuickJS (no host handle reuse).
    // The host function only provides source code strings.
    const requireCode = `
globalThis.require = function require(name) {
  // Check cache first
  if (globalThis.__atua_modules[name] !== undefined) {
    return globalThis.__atua_modules[name];
  }

  // Try to load from host (filesystem)
  if (typeof globalThis.__atua_require_source === 'function') {
    var source = globalThis.__atua_require_source(name);
    if (typeof source === 'string') {
      // Create module context and pre-cache for circular dependency support
      var module = { exports: {} };
      var exports = module.exports;
      var __filename = name;
      var __dirname = name.substring(0, name.lastIndexOf('/')) || '/';
      globalThis.__atua_modules[name] = module.exports;
      eval(source);
      // Update cache in case module.exports was reassigned
      globalThis.__atua_modules[name] = module.exports;
      return module.exports;
    }
  }

  var err = new Error("MODULE_NOT_FOUND: Cannot find module '" + name + "'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
};
`;
    const rr = ctx.evalCode(requireCode, '<require-init>');
    if (rr.value) rr.value.dispose();
    if (rr.error) {
      const errMsg = ctx.dump(rr.error);
      rr.error.dispose();
      console.error('[AtuaEngine] Failed to init require():', errMsg);
    }
  }

  /**
   * Load all built-in module sources and pre-eval them into the context.
   * Called lazily on first eval().
   * Delegates to the module loader for source code.
   */
  async loadBuiltins(): Promise<void> {
    if (this._builtinsLoaded) return;

    const ctx = this.context;

    // Initialize the module loader (loads builtin source strings)
    await this.moduleLoader.initialize();

    // Inject fs host functions BEFORE pre-eval (so fs module can bind them)
    if (this.fs && !this._fsBindingsInjected) {
      this.injectFsBindings();
      this._fsBindingsInjected = true;
    }

    // Pre-eval all built-in modules from the loader into __atua_modules.
    for (const name of this.moduleLoader.availableBuiltins()) {
      const source = this.moduleLoader.getBuiltinSource(name);
      if (source) {
        const wrapped = `globalThis.__atua_modules["${name}"] = (function() { var module = { exports: {} }; var exports = module.exports;\n${source}\n; return module.exports; })();`;
        const result = ctx.evalCode(wrapped, `<builtin:${name}>`);
        if (result.error) {
          const err = ctx.dump(result.error);
          result.error.dispose();
          console.error(`[AtuaEngine] Failed to pre-eval builtin '${name}':`, JSON.stringify(err));
        } else if (result.value) {
          result.value.dispose();
        }
      }
    }

    this._builtinsLoaded = true;
  }

  /** Inject fs host functions into the QuickJS context */
  injectFsBindings(): void {
    if (!this.fs) return;
    const ctx = this.context;
    const fs = this.fs;

    const makeFsFunc = (name: string, impl: (...args: any[]) => any) => {
      const fn = ctx.newFunction(name, (...handles: any[]) => {
        const args = handles.map((h: any) => {
          try {
            return ctx.dump(h);
          } catch {
            return ctx.getString(h);
          }
        });
        try {
          const result = impl(...args);
          if (result === undefined || result === null) return ctx.undefined;
          if (typeof result === 'string') return ctx.newString(result);
          if (typeof result === 'boolean') return result ? ctx.true : ctx.false;
          if (typeof result === 'number') return ctx.newNumber(result);
          // For objects/arrays, serialize to JSON
          return ctx.newString(JSON.stringify(result));
        } catch (err: any) {
          return { error: ctx.newError(err.message || String(err)) };
        }
      });
      ctx.setProp(ctx.global, `__atua_fs_${name}`, fn);
      fn.dispose();
    };

    makeFsFunc('readFileSync', (path: string, encoding?: string) => {
      const result = fs.readFileSync(path, encoding as BufferEncoding);
      return typeof result === 'string' ? result : new TextDecoder().decode(result as Uint8Array);
    });

    makeFsFunc('writeFileSync', (path: string, data: string) => {
      fs.writeFileSync(path, data);
    });

    makeFsFunc('existsSync', (path: string) => fs.existsSync(path));

    makeFsFunc('mkdirSync', (path: string, options?: string) => {
      const opts = options ? JSON.parse(options) : undefined;
      fs.mkdirSync(path, opts);
    });

    makeFsFunc('readdirSync', (path: string) => fs.readdirSync(path));

    makeFsFunc('statSync', (path: string) => {
      const s = fs.statSync(path);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
    });

    makeFsFunc('unlinkSync', (path: string) => fs.unlinkSync(path));
    makeFsFunc('renameSync', (oldPath: string, newPath: string) => fs.renameSync(oldPath, newPath));
    makeFsFunc('copyFileSync', (src: string, dest: string) => fs.copyFileSync(src, dest));
    makeFsFunc('appendFileSync', (path: string, data: string) => fs.appendFileSync(path, data));
    makeFsFunc('rmdirSync', (path: string, opts?: string) => {
      const options = opts ? JSON.parse(opts) : undefined;
      fs.rmdirSync(path, options);
    });
  }

  /**
   * Evaluate JavaScript code in the QuickJS sandbox.
   */
  async eval(code: string, filename = '<eval>'): Promise<any> {
    if (this._disposed) throw new Error('Engine is disposed');

    // Ensure builtins are loaded (also injects fs bindings if needed)
    await this.loadBuiltins();

    const result = this.context.evalCode(code, filename);
    if (result.error) {
      const err = this.context.dump(result.error);
      result.error.dispose();
      this.emit('error', err);
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
    }

    const value = this.context.dump(result.value);
    result.value.dispose();
    return value;
  }

  /**
   * Evaluate JavaScript code that may use async operations (fetch, etc).
   * Wraps the code in an async IIFE, waits for all pending operations,
   * and returns the final result.
   *
   * The last expression in the code is automatically transformed into a
   * return statement so its value is captured.
   */
  async evalAsync(code: string, filename = '<eval-async>'): Promise<any> {
    if (this._disposed) throw new Error('Engine is disposed');
    await this.loadBuiltins();

    const ctx = this.context;

    // Clear async result container
    let r = ctx.evalCode(
      'globalThis.__atua_async = { done: false, value: undefined, error: undefined };',
    );
    if (r.value) r.value.dispose();
    if (r.error) r.error.dispose();

    // Transform the code: add `return` to the last expression so the
    // async function returns it. Then embed directly in an async IIFE.
    const transformedCode = this.addReturnToLastExpression(code);
    const wrapped = `(async function() {
  try {
    var __v = await (async function() {
${transformedCode}
    })();
    globalThis.__atua_async = { done: true, value: __v };
  } catch (__e) {
    globalThis.__atua_async = { done: true, value: undefined, error: String(__e.message || __e) };
  }
})();`;

    const result = ctx.evalCode(wrapped, filename);
    if (result.error) {
      const err = ctx.dump(result.error);
      result.error.dispose();
      this.emit('error', err);
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
    }
    result.value.dispose(); // Promise handle — we read result from the global

    // Execute any immediately resolved microtasks
    this.runtime.executePendingJobs();

    // Poll for completion (async operations like fetch)
    const timeout = 30000;
    const start = Date.now();

    while (true) {
      const check = ctx.evalCode('globalThis.__atua_async.done');
      let done = false;
      if (check.value) {
        done = ctx.dump(check.value) === true;
        check.value.dispose();
      }
      if (check.error) check.error.dispose();

      if (done) break;
      if (Date.now() - start > timeout) {
        throw new Error('evalAsync timed out waiting for async operations');
      }

      await new Promise((resolve) => setTimeout(resolve, 5));
      this.runtime.executePendingJobs();
    }

    // Read the result
    const readResult = ctx.evalCode('globalThis.__atua_async');
    if (readResult.error) {
      readResult.error.dispose();
      throw new Error('Failed to read async result');
    }
    const resultObj = ctx.dump(readResult.value);
    readResult.value.dispose();

    if (resultObj.error) {
      this.emit('error', resultObj.error);
      throw new Error(resultObj.error);
    }

    return resultObj.value;
  }

  /**
   * Transform code so the last expression statement becomes a return statement.
   * This allows async IIFEs to return the value of the last expression.
   */
  private addReturnToLastExpression(code: string): string {
    const lines = code.split('\n');

    // Walk backwards to find the last meaningful expression line
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();

      // Skip empty lines, comments, and closing braces
      if (
        !trimmed ||
        trimmed === '}' ||
        trimmed === '};' ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*')
      ) {
        continue;
      }

      // If it starts with a declaration or control-flow keyword, don't transform
      if (
        /^(var|let|const|if|else|for|while|do|switch|function|class|try|catch|finally|throw|return|break|continue)\b/.test(
          trimmed,
        )
      ) {
        break;
      }

      // It's an expression — wrap it with return
      const expr = trimmed.replace(/;$/, '');
      const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
      lines[i] = `${indent}return (${expr});`;
      break;
    }

    return lines.join('\n');
  }

  /**
   * Evaluate a file from AtuaFS.
   */
  async evalFile(path: string): Promise<any> {
    if (!this.fs) throw new Error('No filesystem configured');
    const source = this.fs.readFileSync(path, 'utf-8') as string;
    return this.eval(source, path);
  }

  /** Get captured console logs */
  getConsoleLogs(): Array<{ level: ConsoleLevel; args: any[] }> {
    return [...this.consoleLogs];
  }

  /** Clear captured console logs */
  clearConsoleLogs(): void {
    this.consoleLogs = [];
  }

  // ---- Event emitter ----

  on(event: string, handler: EventHandler): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(event, handlers.filter((h) => h !== handler));
    }
    return this;
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  /** Dispose the engine, freeing all resources */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    try {
      this.context?.dispose();
    } catch {}
    try {
      this.runtime?.dispose();
    } catch {}
    this.handlers.clear();
  }
}
