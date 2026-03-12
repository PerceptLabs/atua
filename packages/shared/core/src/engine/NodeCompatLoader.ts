/**
 * NodeCompatLoader — IModuleLoader implementation for Workers mode
 *
 * Provides Node.js-compatible module resolution using:
 * - Custom catalyst host bindings (path, events, buffer, process, etc.)
 * - unenv-backed modules (crypto, os, stream, http, etc.)
 * - Stub modules for unavailable APIs (net, tls, dns, etc.)
 * - CatalystFS for filesystem-based module resolution
 *
 * This is the default loader for Catalyst (Workers mode).
 * Reaction (Full mode) uses DenoNativeLoader instead.
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import type { IModuleLoader, ModuleLoaderCapabilities, ModuleLoaderConfig } from './interfaces.js';
import { UNENV_MODULES, STUB_MODULES, getStubModuleSource } from './host-bindings/unenv-bridge.js';

export class NodeCompatLoader implements IModuleLoader {
  private fs?: CatalystFS;
  private env?: Record<string, string>;
  private initialized = false;

  /** Async source loaders for builtin modules */
  private _builtinSources: Record<string, () => Promise<string>> = {};

  /** Cached source code after initialization */
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

  /**
   * Register all builtin module source loaders.
   * Sources are loaded asynchronously in initialize().
   */
  private registerBuiltins(): void {
    // 1. Custom catalyst host bindings
    this._builtinSources = {
      path: async () => (await import('./host-bindings/path.js')).getPathSource(),
      events: async () => (await import('./host-bindings/events.js')).getEventsSource(),
      buffer: async () => (await import('./host-bindings/buffer.js')).getBufferSource(),
      process: async () =>
        (await import('./host-bindings/process.js')).getProcessSource(this.env),
      assert: async () => (await import('./host-bindings/assert.js')).getAssertSource(),
      util: async () => (await import('./host-bindings/util.js')).getUtilSource(),
      url: async () => (await import('./host-bindings/url.js')).getUrlSource(),
      timers: async () => (await import('./host-bindings/timers.js')).getTimersSource(),
    };

    // 2. unenv-backed modules (crypto, os, stream, http, querystring, string_decoder, zlib)
    for (const [name, getSource] of Object.entries(UNENV_MODULES)) {
      this._builtinSources[name] = async () => getSource();
    }

    // 3. Stub modules (net, tls, dns, etc. — clear error messages)
    for (const name of STUB_MODULES) {
      this._builtinSources[name] = async () => getStubModuleSource(name);
    }
  }

  /**
   * Initialize the loader by loading all builtin source strings.
   * Must be called before getBuiltinSource() or availableBuiltins().
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load all source strings asynchronously
    for (const [name, getSource] of Object.entries(this._builtinSources)) {
      if (!this._builtinSourceCode[name]) {
        this._builtinSourceCode[name] = await getSource();
      }
    }

    // Add fs module source if filesystem is available
    if (this.fs) {
      this._builtinSourceCode['fs'] = this.getFsModuleSource();
    }

    this.initialized = true;
  }

  /** List all available builtin module names */
  availableBuiltins(): string[] {
    return Object.keys(this._builtinSourceCode);
  }

  /** Get the pre-loaded source code for a builtin module */
  getBuiltinSource(name: string): string | undefined {
    return this._builtinSourceCode[name];
  }

  /**
   * Resolve a module specifier to source code from CatalystFS.
   * Synchronous — called from the require() host function.
   * Returns null if the module is not found.
   */
  resolveModule(specifier: string): string | null {
    if (!this.fs) return null;

    // Relative or absolute path
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      const resolved = this.resolveModulePath(specifier);
      try {
        return this.fs.readFileSync(resolved, 'utf-8') as string;
      } catch {
        return null;
      }
    }

    // Node modules: try /node_modules/{name}
    const nmPath = `/node_modules/${specifier}`;

    // Try package.json main
    try {
      const pkgJson = this.fs.readFileSync(`${nmPath}/package.json`, 'utf-8') as string;
      const pkg = JSON.parse(pkgJson);
      const main = pkg.main || 'index.js';
      return this.fs.readFileSync(`${nmPath}/${main}`, 'utf-8') as string;
    } catch {
      // no package.json
    }

    // Try index.js
    try {
      return this.fs.readFileSync(`${nmPath}/index.js`, 'utf-8') as string;
    } catch {
      // not found
    }

    return null;
  }

  /** Get the fs module source that delegates to CatalystFS host functions */
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

  /** Resolve a relative module path, adding .js extension if needed */
  private resolveModulePath(moduleName: string): string {
    if (!moduleName.endsWith('.js') && !moduleName.endsWith('.json') && !moduleName.endsWith('.ts')) {
      if (this.fs?.existsSync(moduleName + '.js')) return moduleName + '.js';
      if (this.fs?.existsSync(moduleName + '/index.js')) return moduleName + '/index.js';
      if (this.fs?.existsSync(moduleName)) return moduleName;
      return moduleName + '.js'; // default
    }
    return moduleName;
  }
}
