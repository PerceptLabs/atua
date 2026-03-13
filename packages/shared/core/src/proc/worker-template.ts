/**
 * Worker template for AtuaProc
 *
 * Generates the source code for a Worker that boots native V8
 * and executes commands with Node.js-compatible environment.
 *
 * Features:
 * - MessagePort-based AtuaFS proxy
 * - StdioBatcher (4KB/16ms flush thresholds)
 * - Console wiring through batcher (NOT direct postMessage)
 * - flushStdio() before every exit message
 * - Shadowed browser globals + injected Node.js globals
 * - require() backed by unenv polyfills
 * - Execution via new Function() (native V8 speed)
 *
 * Receives MessagePorts via the 'init' message transfer list:
 *   event.ports[0] = controlPort (exec, kill, stdin)
 *   event.ports[1] = fsPort (AtuaFS proxy)
 *   event.ports[2] = stdioPort (stdout/stderr batches, exit)
 */

export interface WorkerMessage {
  type: 'exec' | 'exec-server' | 'kill' | 'stdin';
  code?: string;
  signal?: number;
  data?: string;
}

export interface WorkerResponse {
  type:
    | 'ready'
    | 'stdout'
    | 'stderr'
    | 'stdout-batch'
    | 'stderr-batch'
    | 'exit'
    | 'error';
  data?: string;
  chunks?: string[];
  code?: number;
}

/**
 * Get the Worker entry code as a string.
 *
 * Boots native V8 with Node.js-compatible environment:
 * - StdioBatcher for efficient stdio batching
 * - AtuaFS proxy over MessagePort
 * - Shadowed browser globals
 * - Node.js globals (process, Buffer, global, require)
 * - Console wired through StdioBatcher
 * - Code execution via new Function()
 */
export function getWorkerSource(): string {
  return `
// AtuaProc Worker — Native V8 with Node.js compatibility
// Executes code at full browser engine speed with Worker isolation

let controlPort = null;
let fsPort = null;
let stdioPort = null;
let fsRequestId = 0;
let fsPendingRequests = new Map();
let ready = false;

// ---- FS Proxy: async fs calls over MessagePort ----

function fsProxy(method) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  return new Promise(function(resolve, reject) {
    var id = ++fsRequestId;
    fsPendingRequests.set(id, { resolve: resolve, reject: reject });
    fsPort.postMessage({ id: id, method: method, args: args });
  });
}

function initFsPort(port) {
  fsPort = port;
  port.onmessage = function(event) {
    var data = event.data;
    var pending = fsPendingRequests.get(data.id);
    if (pending) {
      fsPendingRequests.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.result);
    }
  };
}

// ---- StdioBatcher: amortize MessagePort overhead ----
// Accumulates chunks and flushes as a batch on time or byte threshold.

var stdoutBuffer = [];
var stderrBuffer = [];
var stdoutBytes = 0;
var stderrBytes = 0;
var flushTimer = null;
var BATCH_BYTES = 4096;  // flush after 4KB accumulated
var BATCH_MS = 16;       // flush after 16ms (~1 frame)

function flushStdio() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (stdoutBuffer.length > 0) {
    stdioPort.postMessage({ type: 'stdout-batch', chunks: stdoutBuffer.splice(0) });
    stdoutBytes = 0;
  }
  if (stderrBuffer.length > 0) {
    stdioPort.postMessage({ type: 'stderr-batch', chunks: stderrBuffer.splice(0) });
    stderrBytes = 0;
  }
}

function scheduleFlush() {
  if (!flushTimer) {
    flushTimer = setTimeout(flushStdio, BATCH_MS);
  }
}

function pushStdout(data) {
  stdoutBuffer.push(data);
  stdoutBytes += data.length;
  if (stdoutBytes >= BATCH_BYTES) flushStdio();
  else scheduleFlush();
}

function pushStderr(data) {
  stderrBuffer.push(data);
  stderrBytes += data.length;
  if (stderrBytes >= BATCH_BYTES) flushStdio();
  else scheduleFlush();
}

// ---- Console: scoped object wired to StdioBatcher ----

function makeConsole() {
  function formatArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') parts.push(a);
      else if (a === null) parts.push('null');
      else if (a === undefined) parts.push('undefined');
      else {
        try { parts.push(JSON.stringify(a)); }
        catch(e) { parts.push(String(a)); }
      }
    }
    return parts.join(' ');
  }

  return {
    log: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    info: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    debug: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    warn: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    error: function() { pushStderr(formatArgs(arguments) + '\\n'); },
    dir: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    trace: function() {},
    time: function() {},
    timeEnd: function() {},
    timeLog: function() {},
    clear: function() {},
    count: function() {},
    countReset: function() {},
    group: function() {},
    groupCollapsed: function() {},
    groupEnd: function() {},
    table: function() { pushStdout(formatArgs(arguments) + '\\n'); },
    assert: function(cond) {
      if (!cond) {
        var args = ['Assertion failed:'];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        pushStderr(formatArgs(args) + '\\n');
      }
    },
  };
}

// ---- Node.js globals ----

// Stdin handler registry — shared between makeProcess() and controlPort handler.
// controlPort forwards 'stdin' messages to these handlers.
var stdinHandlers = [];
var stdinOnceHandlers = [];

function makeProcess(config) {
  var env = config.env || {};
  var cwd = config.cwd || '/';

  // process.stdin — event-emitter-like readable for MCP server JSON-RPC
  var stdin = {
    readable: true,
    isTTY: false,
    _encoding: 'utf8',
    setEncoding: function(enc) { stdin._encoding = enc; return stdin; },
    resume: function() { return stdin; },
    pause: function() { return stdin; },
    read: function() { return null; },
    on: function(event, handler) {
      if (event === 'data') stdinHandlers.push(handler);
      return stdin;
    },
    once: function(event, handler) {
      if (event === 'data') stdinOnceHandlers.push(handler);
      return stdin;
    },
    removeListener: function(event, handler) {
      if (event === 'data') {
        for (var i = stdinHandlers.length - 1; i >= 0; i--) {
          if (stdinHandlers[i] === handler) { stdinHandlers.splice(i, 1); break; }
        }
        for (var j = stdinOnceHandlers.length - 1; j >= 0; j--) {
          if (stdinOnceHandlers[j] === handler) { stdinOnceHandlers.splice(j, 1); break; }
        }
      }
      return stdin;
    },
    off: function(event, handler) { return stdin.removeListener(event, handler); },
    removeAllListeners: function() { stdinHandlers = []; stdinOnceHandlers = []; return stdin; },
    pipe: function() { return stdin; },
    unpipe: function() { return stdin; },
  };

  // process.stdout — writable that routes to StdioBatcher
  var stdout = {
    writable: true,
    isTTY: false,
    write: function(data) {
      pushStdout(typeof data === 'string' ? data : String(data));
      return true;
    },
    end: function() {},
  };

  // process.stderr — writable that routes to StdioBatcher
  var stderr = {
    writable: true,
    isTTY: false,
    write: function(data) {
      pushStderr(typeof data === 'string' ? data : String(data));
      return true;
    },
    end: function() {},
  };

  return {
    env: env,
    cwd: function() { return cwd; },
    chdir: function(d) { cwd = d; },
    platform: 'browser',
    arch: 'wasm32',
    version: 'v22.0.0',
    versions: { node: '22.0.0' },
    pid: config.pid || 1,
    ppid: 0,
    argv: ['node'],
    argv0: 'node',
    execArgv: [],
    execPath: '/usr/local/bin/node',
    title: 'atua',
    stdin: stdin,
    stdout: stdout,
    stderr: stderr,
    exit: function(code) {
      flushStdio();
      stdioPort.postMessage({ type: 'exit', code: code || 0 });
    },
    nextTick: function(fn) {
      var args = [];
      for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
      Promise.resolve().then(function() { fn.apply(null, args); });
    },
    hrtime: {
      bigint: function() { return BigInt(Math.round(performance.now() * 1e6)); },
    },
    memoryUsage: function() {
      return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
    },
    on: function() { return this; },
    off: function() { return this; },
    once: function() { return this; },
    emit: function() { return false; },
    removeListener: function() { return this; },
    removeAllListeners: function() { return this; },
    listeners: function() { return []; },
    listenerCount: function() { return 0; },
  };
}

// ---- Minimal require() stub ----
// Full module resolution is provided by NativeModuleLoader in NativeEngine.
// This stub covers basic cases for Worker-based process execution.

function makeRequire() {
  var cache = {};
  return function require(name) {
    var moduleName = name;
    if (moduleName.startsWith('node:')) moduleName = moduleName.slice(5);
    if (cache[moduleName]) return cache[moduleName];

    // Stub common modules
    if (moduleName === 'path') {
      cache[moduleName] = {
        join: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/\\/+/g, '/'); },
        resolve: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/\\/+/g, '/'); },
        dirname: function(p) { return p.substring(0, p.lastIndexOf('/')) || '/'; },
        basename: function(p) { var parts = p.split('/'); return parts[parts.length - 1]; },
        extname: function(p) { var i = p.lastIndexOf('.'); return i > 0 ? p.substring(i) : ''; },
        sep: '/',
        delimiter: ':',
      };
      return cache[moduleName];
    }

    var err = new Error("MODULE_NOT_FOUND: Cannot find module '" + name + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };
}

// ---- Shadow browser globals ----

function shadowBrowserGlobals() {
  var globals = [
    'window', 'document', 'localStorage', 'sessionStorage',
    'indexedDB', 'XMLHttpRequest', 'WebSocket',
    'location', 'navigator', 'history',
    'alert', 'confirm', 'prompt', 'open',
  ];
  for (var i = 0; i < globals.length; i++) {
    try { self[globals[i]] = undefined; } catch(e) {}
  }
}

// ---- Boot ----

function boot(config) {
  // Apply batch config if provided
  if (config.stdioBatchBytes) BATCH_BYTES = config.stdioBatchBytes;
  if (config.stdioBatchMs) BATCH_MS = config.stdioBatchMs;

  shadowBrowserGlobals();

  // Set up global Node.js environment
  var processObj = makeProcess(config);
  var consoleObj = makeConsole();
  var requireFn = makeRequire();

  self.process = processObj;
  self.console = consoleObj;
  self.require = requireFn;
  self.global = self;
  self.globalThis = self;

  ready = true;
  self.postMessage({ type: 'ready' });
}

// ---- Message Handler ----

self.addEventListener('message', function(event) {
  var msg = event.data;

  if (msg.type === 'init') {
    // Receive MessagePorts via transfer
    controlPort = event.ports[0];
    initFsPort(event.ports[1]);
    stdioPort = event.ports[2];

    // Wire control port for exec/kill commands
    controlPort.onmessage = function(e) {
      var cmd = e.data;

      if (cmd.type === 'exec' && ready) {
        try {
          // Execute code via new Function() — native V8 speed
          var fn = new Function(
            'console', 'process', 'require',
            'module', 'exports',
            '__filename', '__dirname', 'global',
            cmd.code || ''
          );
          var mod = { exports: {} };
          fn(
            self.console,
            self.process,
            self.require,
            mod, mod.exports,
            '<process>', '/',
            self
          );
          flushStdio();
          stdioPort.postMessage({ type: 'exit', code: 0 });
        } catch (ex) {
          pushStderr((ex.message || String(ex)) + '\\n');
          flushStdio();
          stdioPort.postMessage({ type: 'exit', code: 1 });
        }
      }

      // Long-running server mode — does NOT auto-exit after code runs.
      // Server stays alive to receive stdin messages (MCP JSON-RPC).
      // Exit only via process.exit() or kill.
      if (cmd.type === 'exec-server' && ready) {
        try {
          var fn = new Function(
            'console', 'process', 'require',
            'module', 'exports',
            '__filename', '__dirname', 'global',
            cmd.code || ''
          );
          var mod = { exports: {} };
          fn(
            self.console,
            self.process,
            self.require,
            mod, mod.exports,
            '<process>', '/',
            self
          );
          // NO exit — server stays alive to receive stdin
        } catch (ex) {
          pushStderr((ex.message || String(ex)) + '\\n');
          flushStdio();
          stdioPort.postMessage({ type: 'exit', code: 1 });
        }
      }

      // Forward stdin data to process.stdin handlers
      if (cmd.type === 'stdin') {
        var i;
        for (i = 0; i < stdinHandlers.length; i++) {
          stdinHandlers[i](cmd.data);
        }
        // Fire once handlers and clear them
        var onces = stdinOnceHandlers.splice(0);
        for (i = 0; i < onces.length; i++) {
          onces[i](cmd.data);
        }
      }

      if (cmd.type === 'kill') {
        flushStdio();
        var exitCode = 128 + (cmd.signal || 15);
        stdioPort.postMessage({ type: 'exit', code: exitCode });
        self.close();
      }
    };

    // Boot native V8 environment
    boot(msg.config || {});
  }
});
`;
}

/**
 * Get the enhanced Worker source — same as getWorkerSource().
 * Kept for backward compatibility with WorkerPool which imports this.
 */
export function getEnhancedWorkerSource(): string {
  return getWorkerSource();
}

/**
 * Signal numbers for common signals.
 */
export const SIGNALS: Record<string, number> = {
  SIGTERM: 15,
  SIGKILL: 9,
  SIGINT: 2,
};
