/**
 * GlobalScope — Scope shadowing utilities for NativeEngine Workers
 *
 * In the browser's native engine (Tier 1), user code runs in a Web Worker.
 * We need to shadow dangerous browser-specific globals to maintain the
 * Node.js illusion and prevent sandbox escape.
 *
 * This module provides utilities to:
 * 1. Delete/replace dangerous browser globals
 * 2. Set up Node.js-compatible globals (process, global, Buffer, etc.)
 */

/** Browser globals that must be removed or replaced in Worker scope */
export const DANGEROUS_GLOBALS = [
  'indexedDB',
  'caches',
  'importScripts',
  'registration',
  'serviceWorker',
  'cookieStore',
  'CacheStorage',
  'IDBFactory',
  'IDBDatabase',
  'IDBTransaction',
  'IDBObjectStore',
  'IDBIndex',
  'IDBCursor',
  'IDBRequest',
  'IDBKeyRange',
] as const;

/** Browser globals that should be wrapped/controlled */
export const CONTROLLED_GLOBALS = [
  'WebSocket',
  'fetch',
  'XMLHttpRequest',
  'EventSource',
  'BroadcastChannel',
] as const;

/**
 * Generate the code that shadows dangerous browser globals in a Worker.
 * Returns a string that should be eval'd at Worker bootstrap time.
 */
export function getShadowGlobalsCode(): string {
  const deletions = DANGEROUS_GLOBALS.map(
    (name) => `  try { self.${name} = undefined; } catch(e) {}`
  ).join('\n');

  return `(function() {
  // Shadow dangerous browser-specific globals
${deletions}
})();`;
}

/**
 * Generate the code that sets up Node.js-compatible globals.
 * These wrap real browser APIs in Node.js interfaces.
 */
export function getNodeGlobalsCode(options: {
  env?: Record<string, string>;
  cwd?: string;
  pid?: number;
}): string {
  const envJson = JSON.stringify(options.env ?? {});
  const cwd = JSON.stringify(options.cwd ?? '/');
  const pid = options.pid ?? 1;

  return `(function() {
  // Set up globalThis aliases
  if (typeof global === 'undefined') self.global = self;
  if (typeof globalThis === 'undefined') self.globalThis = self;

  // Set up process global
  if (typeof process === 'undefined') {
    self.process = {
      env: ${envJson},
      cwd: function() { return ${cwd}; },
      chdir: function() {},
      platform: 'browser',
      arch: 'wasm32',
      version: 'v20.0.0',
      versions: { node: '20.0.0', v8: '11.0', modules: '115' },
      pid: ${pid},
      ppid: 0,
      argv: ['node'],
      argv0: 'node',
      execArgv: [],
      execPath: '/usr/local/bin/node',
      title: 'catalyst',
      stdout: { write: function(d) { self.__catalyst_stdout(typeof d === 'string' ? d : String(d)); } },
      stderr: { write: function(d) { self.__catalyst_stderr(typeof d === 'string' ? d : String(d)); } },
      stdin: { readable: false, read: function() { return null; } },
      exit: function(code) { self.__catalyst_exit(code || 0); },
      nextTick: function(fn) {
        var args = [];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        Promise.resolve().then(function() { fn.apply(null, args); });
      },
      hrtime: {
        bigint: function() { return BigInt(Math.round(performance.now() * 1e6)); }
      },
      memoryUsage: function() {
        return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
      },
      on: function() { return self.process; },
      off: function() { return self.process; },
      once: function() { return self.process; },
      emit: function() { return false; },
      removeListener: function() { return self.process; },
      removeAllListeners: function() { return self.process; },
      listeners: function() { return []; },
      listenerCount: function() { return 0; },
    };
  }

  // Set up __dirname, __filename
  if (typeof __dirname === 'undefined') self.__dirname = '/';
  if (typeof __filename === 'undefined') self.__filename = '/index.js';

  // Set up setTimeout/setInterval (already native in Workers, but ensure consistency)
  if (typeof setImmediate === 'undefined') {
    self.setImmediate = function(fn) {
      var args = [];
      for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
      return setTimeout(function() { fn.apply(null, args); }, 0);
    };
    self.clearImmediate = clearTimeout;
  }
})();`;
}

/**
 * Generate the full Worker bootstrap preamble.
 * Combines global shadowing + Node.js globals setup.
 */
export function getBootstrapPreamble(options: {
  env?: Record<string, string>;
  cwd?: string;
  pid?: number;
}): string {
  return getShadowGlobalsCode() + '\n' + getNodeGlobalsCode(options);
}
