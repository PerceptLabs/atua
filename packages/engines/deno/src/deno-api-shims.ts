/**
 * Deno API Shims — Browser-compatible Deno namespace implementation
 *
 * Phase M: Provides the Deno.* API surface so code written for Deno
 * can run in Atua's browser runtime.
 *
 * Coverage:
 * - Deno.readTextFile / Deno.writeTextFile
 * - Deno.readFile / Deno.writeFile
 * - Deno.stat / Deno.lstat
 * - Deno.mkdir / Deno.remove
 * - Deno.readDir
 * - Deno.cwd / Deno.chdir
 * - Deno.env
 * - Deno.exit
 * - Deno.args / Deno.mainModule
 * - Deno.serve (HTTP server)
 * - Deno.Command (subprocess)
 * - Deno.version
 */

import type { OpsBridge } from './ops-bridge.js';

export interface DenoApiConfig {
  opsBridge: OpsBridge;
  env?: Record<string, string>;
  cwd?: string;
  args?: string[];
}

/**
 * Build the Deno global namespace object.
 * This is injected into the execution context.
 */
export function buildDenoNamespace(config: DenoApiConfig): Record<string, unknown> {
  const ops = config.opsBridge;
  let currentCwd = config.cwd ?? '/';
  const envMap = new Map(Object.entries(config.env ?? {}));

  return {
    // Version info
    version: {
      deno: '1.40.0',
      v8: '12.0.0',
      typescript: '5.3.3',
    },

    // File I/O
    readTextFile: async (path: string) => {
      const result = ops.dispatch('op_read_file_sync', path);
      if (!(result as any).ok) throw new Error(`ENOENT: ${path}`);
      return String((result as any).value);
    },

    writeTextFile: async (path: string, data: string) => {
      ops.dispatch('op_write_file_sync', path, data);
    },

    readFile: async (path: string) => {
      const result = ops.dispatch('op_read_file_sync', path);
      if (!(result as any).ok) throw new Error(`ENOENT: ${path}`);
      return new TextEncoder().encode(String((result as any).value));
    },

    writeFile: async (path: string, data: Uint8Array) => {
      ops.dispatch('op_write_file_sync', path, new TextDecoder().decode(data));
    },

    // File info
    stat: async (path: string) => {
      const result = ops.dispatch('op_stat_sync', path);
      if (!(result as any).ok) throw new Error(`ENOENT: ${path}`);
      const s = (result as any).value;
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymlink: false,
        size: s.size ?? 0,
        mtime: s.mtimeMs ? new Date(s.mtimeMs) : null,
        atime: null,
        birthtime: null,
      };
    },

    lstat: async (path: string) => {
      // Same as stat for our purposes (no symlinks in AtuaFS)
      const result = ops.dispatch('op_stat_sync', path);
      if (!(result as any).ok) throw new Error(`ENOENT: ${path}`);
      const s = (result as any).value;
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymlink: false,
        size: s.size ?? 0,
      };
    },

    // Directory operations
    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      ops.dispatch('op_mkdir_sync', path, JSON.stringify(options ?? {}));
    },

    remove: async (path: string, options?: { recursive?: boolean }) => {
      ops.dispatch('op_remove_sync', path);
    },

    readDir: async function* (path: string) {
      const result = ops.dispatch('op_read_dir_sync', path);
      if (!(result as any).ok) throw new Error(`ENOENT: ${path}`);
      const entries = (result as any).value;
      if (Array.isArray(entries)) {
        for (const name of entries) {
          yield { name, isFile: true, isDirectory: false, isSymlink: false };
        }
      }
    },

    // Environment
    cwd: () => currentCwd,
    chdir: (dir: string) => { currentCwd = dir; },

    env: {
      get: (key: string) => envMap.get(key),
      set: (key: string, value: string) => envMap.set(key, value),
      delete: (key: string) => envMap.delete(key),
      has: (key: string) => envMap.has(key),
      toObject: () => Object.fromEntries(envMap),
    },

    // Process
    exit: (code?: number) => {
      throw new Error(`Deno.exit(${code ?? 0}) called`);
    },

    args: config.args ?? [],
    mainModule: 'file:///main.ts',
    pid: 1,
    ppid: 0,

    // Subprocess (stub)
    Command: class DenoCommand {
      private _cmd: string;
      private _args: string[];

      constructor(cmd: string, options?: { args?: string[] }) {
        this._cmd = cmd;
        this._args = options?.args ?? [];
      }

      async output(): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
        return {
          code: 0,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        };
      }

      spawn(): { status: Promise<{ code: number }> } {
        return {
          status: Promise.resolve({ code: 0 }),
        };
      }
    },

    // HTTP server (stub — real impl would use AtuaHTTP)
    serve: (handler: (req: Request) => Response | Promise<Response>) => {
      return {
        finished: new Promise<void>(() => {}),
        addr: { hostname: '0.0.0.0', port: 8000, transport: 'tcp' },
        shutdown: async () => {},
      };
    },

    // Permissions (always granted in Atua)
    permissions: {
      query: async (_desc: { name: string }) => ({ state: 'granted' }),
      request: async (_desc: { name: string }) => ({ state: 'granted' }),
      revoke: async (_desc: { name: string }) => ({ state: 'prompt' }),
    },

    // Errors
    errors: {
      NotFound: class extends Error { constructor(msg?: string) { super(msg ?? 'Not found'); this.name = 'NotFound'; } },
      PermissionDenied: class extends Error { constructor(msg?: string) { super(msg ?? 'Permission denied'); this.name = 'PermissionDenied'; } },
      AlreadyExists: class extends Error { constructor(msg?: string) { super(msg ?? 'Already exists'); this.name = 'AlreadyExists'; } },
      InvalidData: class extends Error { constructor(msg?: string) { super(msg ?? 'Invalid data'); this.name = 'InvalidData'; } },
    },

    // Build info
    build: {
      target: 'wasm32-unknown-unknown',
      arch: 'wasm32',
      os: 'linux',
      vendor: 'unknown',
      env: undefined,
    },

    // Metrics
    memoryUsage: () => ({
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
    }),

    // Encoding
    inspect: (value: unknown, options?: Record<string, unknown>) => {
      try { return JSON.stringify(value, null, 2); }
      catch { return String(value); }
    },
  };
}

/**
 * Generate source code that sets up the Deno global namespace.
 * For injection into the engine's eval context.
 */
export function getDenoNamespaceSource(env?: Record<string, string>): string {
  const envJson = JSON.stringify(env ?? {});
  return `
(function() {
  if (typeof Deno !== 'undefined') return; // Already set up

  var _env = ${envJson};
  var _envMap = {};
  for (var k in _env) _envMap[k] = _env[k];
  var _cwd = '/';

  self.Deno = {
    version: { deno: '1.40.0', v8: '12.0.0', typescript: '5.3.3' },
    build: { target: 'wasm32-unknown-unknown', arch: 'wasm32', os: 'linux' },
    pid: 1,
    ppid: 0,
    args: [],
    mainModule: 'file:///main.ts',
    cwd: function() { return _cwd; },
    chdir: function(dir) { _cwd = dir; },
    env: {
      get: function(key) { return _envMap[key]; },
      set: function(key, val) { _envMap[key] = val; },
      delete: function(key) { delete _envMap[key]; },
      has: function(key) { return key in _envMap; },
      toObject: function() { return Object.assign({}, _envMap); },
    },
    exit: function(code) { throw new Error('Deno.exit(' + (code || 0) + ')'); },
    inspect: function(val) { try { return JSON.stringify(val, null, 2); } catch(e) { return String(val); } },
    permissions: {
      query: function() { return Promise.resolve({ state: 'granted' }); },
      request: function() { return Promise.resolve({ state: 'granted' }); },
    },
    errors: {
      NotFound: (function() { function E(m) { this.message = m || 'Not found'; this.name = 'NotFound'; } E.prototype = new Error(); return E; })(),
      PermissionDenied: (function() { function E(m) { this.message = m || 'Permission denied'; this.name = 'PermissionDenied'; } E.prototype = new Error(); return E; })(),
    },
  };
})();
`;
}
