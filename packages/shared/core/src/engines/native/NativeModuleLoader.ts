/**
 * NativeModuleLoader — IModuleLoader for browser-native execution context
 *
 * Provides require() backed by unenv polyfills + CatalystFS.
 * Unlike NodeCompatLoader (which returns source strings for QuickJS eval),
 * this loader returns actual JavaScript module objects since we're running
 * in the browser's native JS engine.
 *
 * The module sources are the same (unenv bridge + catalyst host bindings),
 * but they're executed via new Function() rather than QuickJS evalCode().
 */
import type { CatalystFS } from '../../fs/CatalystFS.js';
import type { IModuleLoader, ModuleLoaderCapabilities, ModuleLoaderConfig } from '../../engine/interfaces.js';
import { UNENV_MODULES, STUB_MODULES, getStubModuleSource } from '../../engine/host-bindings/unenv-bridge.js';

export class NativeModuleLoader implements IModuleLoader {
  private fs?: CatalystFS;
  private env?: Record<string, string>;
  private initialized = false;

  private _builtinSources: Record<string, () => Promise<string>> = {};
  private _builtinSourceCode: Record<string, string> = {};

  readonly capabilities: ModuleLoaderCapabilities = {
    nodeCompat: 0.962,
    nativeModuleResolution: false,
    npmStrategy: 'esm-sh',
  };

  constructor(config: ModuleLoaderConfig = {}) {
    this.fs = config.fs as CatalystFS | undefined;
    this.env = config.env;
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    // Catalyst host bindings
    this._builtinSources = {
      path: async () => (await import('../../engine/host-bindings/path.js')).getPathSource(),
      events: async () => (await import('../../engine/host-bindings/events.js')).getEventsSource(),
      buffer: async () => (await import('../../engine/host-bindings/buffer.js')).getBufferSource(),
      process: async () =>
        (await import('../../engine/host-bindings/process.js')).getProcessSource(this.env),
      assert: async () => (await import('../../engine/host-bindings/assert.js')).getAssertSource(),
      util: async () => (await import('../../engine/host-bindings/util.js')).getUtilSource(),
      url: async () => (await import('../../engine/host-bindings/url.js')).getUrlSource(),
      timers: async () => (await import('../../engine/host-bindings/timers.js')).getTimersSource(),
    };

    // unenv-backed modules
    for (const [name, getSource] of Object.entries(UNENV_MODULES)) {
      this._builtinSources[name] = async () => getSource();
    }

    // Stub modules
    for (const name of STUB_MODULES) {
      this._builtinSources[name] = async () => getStubModuleSource(name);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    for (const [name, getSource] of Object.entries(this._builtinSources)) {
      if (!this._builtinSourceCode[name]) {
        this._builtinSourceCode[name] = await getSource();
      }
    }

    if (this.fs) {
      this._builtinSourceCode['fs'] = this.getFsModuleSource();
    }

    this.initialized = true;
  }

  availableBuiltins(): string[] {
    return Object.keys(this._builtinSourceCode);
  }

  getBuiltinSource(name: string): string | undefined {
    return this._builtinSourceCode[name];
  }

  resolveModule(specifier: string): string | null {
    if (!this.fs) return null;

    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      const resolved = this.resolveModulePath(specifier);
      try {
        return this.fs.readFileSync(resolved, 'utf-8') as string;
      } catch {
        return null;
      }
    }

    const nmPath = `/node_modules/${specifier}`;

    try {
      const pkgJson = this.fs.readFileSync(`${nmPath}/package.json`, 'utf-8') as string;
      const pkg = JSON.parse(pkgJson);
      const main = pkg.main || 'index.js';
      return this.fs.readFileSync(`${nmPath}/${main}`, 'utf-8') as string;
    } catch {
      // no package.json
    }

    try {
      return this.fs.readFileSync(`${nmPath}/index.js`, 'utf-8') as string;
    } catch {
      // not found
    }

    return null;
  }

  private getFsModuleSource(): string {
    return `
  module.exports.readFileSync = globalThis.__catalyst_fs_readFileSync;
  module.exports.writeFileSync = globalThis.__catalyst_fs_writeFileSync;
  module.exports.existsSync = globalThis.__catalyst_fs_existsSync;
  module.exports.mkdirSync = globalThis.__catalyst_fs_mkdirSync;
  module.exports.readdirSync = globalThis.__catalyst_fs_readdirSync;
  module.exports.statSync = globalThis.__catalyst_fs_statSync;
  module.exports.unlinkSync = globalThis.__catalyst_fs_unlinkSync;
  module.exports.renameSync = globalThis.__catalyst_fs_renameSync;
  module.exports.copyFileSync = globalThis.__catalyst_fs_copyFileSync;
  module.exports.appendFileSync = globalThis.__catalyst_fs_appendFileSync;
  module.exports.rmdirSync = globalThis.__catalyst_fs_rmdirSync;
`;
  }

  private resolveModulePath(moduleName: string): string {
    if (!moduleName.endsWith('.js') && !moduleName.endsWith('.json') && !moduleName.endsWith('.ts')) {
      if (this.fs?.existsSync(moduleName + '.js')) return moduleName + '.js';
      if (this.fs?.existsSync(moduleName + '/index.js')) return moduleName + '/index.js';
      if (this.fs?.existsSync(moduleName)) return moduleName;
      return moduleName + '.js';
    }
    return moduleName;
  }
}
