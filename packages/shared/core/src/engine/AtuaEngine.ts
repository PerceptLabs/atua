/**
 * AtuaEngine — DEPRECATED stub
 *
 * QuickJS-emscripten has been removed. This stub preserves the export
 * for backward compatibility but throws at runtime. Use NativeEngine
 * or WorkerContext instead.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import type { FetchProxy } from '../net/FetchProxy.js';
import type { IEngine, IModuleLoader, EngineInstanceConfig } from './interfaces.js';

export interface EngineConfig {
  fs?: AtuaFS;
  fetchProxy?: FetchProxy;
  memoryLimit?: number;
  timeout?: number;
  env?: Record<string, string>;
  moduleLoader?: IModuleLoader;
}

export type ConsoleLevel = 'log' | 'error' | 'warn' | 'info' | 'debug';

export class AtuaEngine implements IEngine {
  private constructor() {}

  static async create(_config: EngineConfig = {}): Promise<AtuaEngine> {
    throw new Error(
      'AtuaEngine is no longer available. quickjs-emscripten has been removed. ' +
      'Use NativeEngine or WorkerContext instead.',
    );
  }

  async createInstance(_config: EngineInstanceConfig): Promise<IEngine> {
    throw new Error('AtuaEngine is deprecated');
  }

  async eval(_code: string): Promise<any> {
    throw new Error('AtuaEngine is deprecated');
  }

  async evalFile(_path: string): Promise<any> {
    throw new Error('AtuaEngine is deprecated');
  }

  async evalAsync(_code: string): Promise<any> {
    throw new Error('AtuaEngine is deprecated');
  }

  getConsoleLogs(): Array<{ level: ConsoleLevel; args: any[] }> {
    return [];
  }

  clearConsoleLogs(): void {}

  on(_event: string, _handler: (...args: any[]) => void): void {}
  off(_event: string, _handler: (...args: any[]) => void): void {}

  dispose(): void {}
  async destroy(): Promise<void> {}
}
