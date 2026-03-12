/**
 * DenoNativeLoader — IModuleLoader using Deno's native resolution
 *
 * Provides ~100% Node.js compatibility via Deno's native node: compat.
 * Builtins delegate to Deno's runtime; npm: specifiers resolved natively.
 */
import type { IModuleLoader, ModuleLoaderCapabilities, ModuleLoaderConfig }
  from '../../../../shared/core/src/engine/interfaces.js';

export class DenoNativeLoader implements IModuleLoader {
  private fs: unknown;
  private initialized = false;

  readonly capabilities: ModuleLoaderCapabilities = {
    nodeCompat: 1.0,
    nativeModuleResolution: true,
    npmStrategy: 'native',
  };

  constructor(config: ModuleLoaderConfig = {}) {
    this.fs = config.fs;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  availableBuiltins(): string[] {
    return [
      'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process',
      'cluster', 'console', 'constants', 'crypto', 'dgram',
      'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events',
      'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module',
      'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
      'process', 'punycode', 'querystring', 'readline', 'readline/promises',
      'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
      'string_decoder', 'sys', 'test', 'timers', 'timers/promises', 'tls',
      'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm',
      'wasi', 'worker_threads', 'zlib',
    ];
  }

  getBuiltinSource(name: string): string | undefined {
    if (!this.availableBuiltins().includes(name)) return undefined;
    return `module.exports = globalThis.__deno_node_require("node:${name}");`;
  }

  resolveModule(specifier: string): string | null {
    const builtinName = specifier.replace(/^node:/, '');
    if (this.availableBuiltins().includes(builtinName)) {
      return this.getBuiltinSource(builtinName) ?? null;
    }
    if (specifier.startsWith('npm:') || specifier.startsWith('https:') || specifier.startsWith('http:')) {
      return null; // Deno handles natively
    }
    if (specifier.startsWith('./') || specifier.startsWith('/') || specifier.startsWith('../')) {
      return this.resolveFileModule(specifier);
    }
    return null; // Bare specifiers — Deno resolves via npm resolver
  }

  private resolveFileModule(specifier: string): string | null {
    const fs = this.fs as any;
    if (!fs) return null;

    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
    for (const ext of extensions) {
      try {
        if (fs.existsSync(specifier + ext)) return String(fs.readFileSync(specifier + ext, 'utf-8'));
      } catch { continue; }
    }
    for (const idx of ['index.ts', 'index.tsx', 'index.js', 'index.mjs']) {
      try {
        if (fs.existsSync(specifier + '/' + idx)) return String(fs.readFileSync(specifier + '/' + idx, 'utf-8'));
      } catch { continue; }
    }
    return null;
  }
}

export function createDenoNativeLoader(config: ModuleLoaderConfig = {}): IModuleLoader {
  return new DenoNativeLoader(config);
}
