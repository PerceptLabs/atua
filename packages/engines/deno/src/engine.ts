/**
 * DenoEngine — Deno-in-WASM JavaScript execution engine
 *
 * Implements IEngine for the Deno runtime compiled to WebAssembly.
 * V8 jitless mode (interpreter only) compiled to WASM via Emscripten.
 *
 * When the WASM binary is unavailable, operates in stub mode using
 * the host environment's JS engine for basic evaluation. This enables
 * testing the infrastructure without the compiled binary.
 */
import type { IEngine, IModuleLoader, EngineInstanceConfig, EngineCapabilities }
  from '../../../shared/core/src/engine/interfaces.js';
import { OpsBridge } from './ops-bridge.js';
import type { OpsBridgeConfig } from './ops-bridge.js';
import { DenoWasmLoader } from './wasm-loader.js';
import type { DenoWasmInstance, WasmLoaderConfig } from './wasm-loader.js';

export interface DenoEngineConfig {
  fs?: unknown;
  net?: unknown;
  moduleLoader?: IModuleLoader;
  memoryLimit?: number;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
  wasm?: WasmLoaderConfig;
}

type EventHandler = (...args: unknown[]) => void;

export class DenoEngine implements IEngine {
  private opsBridge: OpsBridge;
  private wasmInstance: DenoWasmInstance | null = null;
  private moduleLoader: IModuleLoader | null;
  private handlers = new Map<string, EventHandler[]>();
  private _destroyed = false;
  private config: DenoEngineConfig;

  private constructor(config: DenoEngineConfig = {}) {
    this.config = config;
    this.moduleLoader = config.moduleLoader ?? null;
    this.opsBridge = new OpsBridge({
      fs: config.fs, net: config.net,
      env: config.env, cwd: config.cwd,
    });
  }

  static capabilities(): EngineCapabilities {
    return { name: 'deno', jspiRequired: true, wasmSize: 20 * 1024 * 1024, bootTime: 2000 };
  }

  static async create(config: DenoEngineConfig = {}): Promise<DenoEngine> {
    const engine = new DenoEngine(config);
    if (engine.moduleLoader) await engine.moduleLoader.initialize();

    const loader = DenoWasmLoader.getInstance(config.wasm);
    await loader.initialize();

    if (loader.getStatus() === 'ready') {
      engine.wasmInstance = await loader.createInstance(
        (opName, ...args) => engine.opsBridge.dispatch(opName, ...args),
      );
    }

    return engine;
  }

  get isWasmReady(): boolean { return this.wasmInstance !== null && !this.wasmInstance.destroyed; }
  getOpsBridge(): OpsBridge { return this.opsBridge; }

  async eval(code: string, filename = '<eval>'): Promise<unknown> {
    this.checkDestroyed();
    if (!this.wasmInstance) return this.evalStub(code, filename);
    try { return this.wasmInstance.execute(code); }
    catch (err) { this.emit('error', err); throw err; }
  }

  async evalFile(path: string): Promise<unknown> {
    this.checkDestroyed();
    const result = await this.opsBridge.dispatch('op_read_file_sync', path);
    if (!result.ok) throw new Error(`Failed to read file ${path}: ${result.error}`);
    return this.eval(String(result.value), path);
  }

  async createInstance(config: EngineInstanceConfig): Promise<IEngine> {
    return DenoEngine.create({
      fs: config.fs, net: config.net, moduleLoader: config.moduleLoader,
      memoryLimit: config.memoryLimit, timeout: config.timeout,
      env: config.env, cwd: config.cwd, wasm: this.config.wasm,
    });
  }

  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.wasmInstance) { this.wasmInstance.destroy(); this.wasmInstance = null; }
    this.opsBridge.destroy();
    this.emit('exit', 0);
    this.handlers.clear();
  }

  on(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event);
    if (list) { const idx = list.indexOf(handler); if (idx >= 0) list.splice(idx, 1); }
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) { try { h(...args); } catch {} }
  }

  private checkDestroyed(): void {
    if (this._destroyed) throw new Error('DenoEngine has been destroyed');
  }

  private evalStub(code: string, _filename: string): unknown {
    // Use indirect eval to evaluate as script (matches real Deno/V8 semantics).
    // Script mode returns the value of the last expression, no bare `return`.
    try { return (0, eval)(code); }
    catch (err) { this.emit('error', err); throw err; }
  }
}

export async function createDenoEngine(config: EngineInstanceConfig): Promise<IEngine> {
  return DenoEngine.create({
    fs: config.fs, net: config.net, moduleLoader: config.moduleLoader,
    memoryLimit: config.memoryLimit, timeout: config.timeout,
    env: config.env, cwd: config.cwd,
  });
}
