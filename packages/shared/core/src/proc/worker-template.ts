/**
 * Worker template for CatalystProc
 *
 * Generates the source code for a Worker that boots QuickJS-WASM
 * and executes commands in an isolated context.
 *
 * Phase 13c: Enhanced version added with:
 * - MessagePort-based AtuaFS proxy
 * - StdioBatcher (4KB/16ms flush thresholds)
 * - Console wiring through batcher (NOT direct postMessage)
 * - flushStdio() before every exit message
 * - Support for configurable batch thresholds
 *
 * Two variants:
 * - getWorkerSource(): Simple, direct postMessage per line (backward compat)
 * - getEnhancedWorkerSource(): MessagePort-based with StdioBatcher
 */

export interface WorkerMessage {
  type: 'exec' | 'kill' | 'stdin';
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
 * Get the simple Worker entry code as a string.
 * Uses direct postMessage per stdio line — no batching, no MessagePort.
 * Kept for backwards compatibility.
 */
export function getWorkerSource(): string {
  return `
// CatalystProc Worker Entry (simple mode)
// Boots QuickJS-WASM and executes commands in isolation

let ctx = null;
let runtime = null;

async function boot() {
  try {
    const { getQuickJS } = await import('quickjs-emscripten');
    const QuickJS = await getQuickJS();
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(256 * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
    ctx = runtime.newContext();

    // Wire console to postMessage
    var consoleObj = ctx.newObject();
    ['log', 'info', 'debug', 'warn'].forEach(function(level) {
      var fn = ctx.newFunction('console_' + level, function() {
        var args = [];
        for (var i = 0; i < arguments.length; i++) {
          try { args.push(ctx.dump(arguments[i])); }
          catch(e) { args.push(String(arguments[i])); }
        }
        self.postMessage({ type: 'stdout', data: args.join(' ') + '\\n' });
      });
      ctx.setProp(consoleObj, level, fn);
      fn.dispose();
    });

    var errorFn = ctx.newFunction('console_error', function() {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        try { args.push(ctx.dump(arguments[i])); }
        catch(e) { args.push(String(arguments[i])); }
      }
      self.postMessage({ type: 'stderr', data: args.join(' ') + '\\n' });
    });
    ctx.setProp(consoleObj, 'error', errorFn);
    errorFn.dispose();

    ctx.setProp(ctx.global, 'console', consoleObj);
    consoleObj.dispose();

    self.postMessage({ type: 'ready' });
  } catch (e) {
    self.postMessage({ type: 'error', data: 'Boot failed: ' + e.message });
    self.postMessage({ type: 'exit', code: 1 });
  }
}

self.addEventListener('message', function(event) {
  var msg = event.data;

  if (msg.type === 'exec' && ctx) {
    try {
      var result = ctx.evalCode(msg.code || '', '<process>');
      if (result.error) {
        var err = ctx.dump(result.error);
        result.error.dispose();
        self.postMessage({ type: 'stderr', data: String(err) + '\\n' });
        self.postMessage({ type: 'exit', code: 1 });
      } else {
        result.value.dispose();
        self.postMessage({ type: 'exit', code: 0 });
      }
    } catch (e) {
      self.postMessage({ type: 'stderr', data: (e.message || String(e)) + '\\n' });
      self.postMessage({ type: 'exit', code: 1 });
    }
  }

  if (msg.type === 'kill') {
    try {
      if (ctx) { ctx.dispose(); ctx = null; }
      if (runtime) { runtime.dispose(); runtime = null; }
    } catch(e) {}
    var exitCode = 128 + (msg.signal || 15);
    self.postMessage({ type: 'exit', code: exitCode });
    self.close();
  }
});

boot();
`;
}

/**
 * Get the enhanced Worker entry code with MessagePort-based FS proxy,
 * StdioBatcher, and configurable batch thresholds.
 *
 * This version receives MessagePorts via the 'init' message transfer list:
 *   event.ports[0] = controlPort (exec, kill, stdin)
 *   event.ports[1] = fsPort (AtuaFS proxy)
 *   event.ports[2] = stdioPort (stdout/stderr batches, exit)
 */
export function getEnhancedWorkerSource(): string {
  return `
// CatalystProc Worker — Enhanced with MessagePort FS and StdioBatcher
// This runs in its own thread with its own QuickJS-WASM instance

let ctx = null;
let runtime = null;
let controlPort = null;
let fsPort = null;
let stdioPort = null;
let fsRequestId = 0;
let fsPendingRequests = new Map();

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

// ---- QuickJS Boot ----

async function boot(config) {
  // Apply batch config if provided
  if (config.stdioBatchBytes) BATCH_BYTES = config.stdioBatchBytes;
  if (config.stdioBatchMs) BATCH_MS = config.stdioBatchMs;

  try {
    var QuickJSMod = await import('quickjs-emscripten');
    var QuickJS = await QuickJSMod.getQuickJS();
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(config.memoryLimit || 256 * 1024 * 1024);
    runtime.setMaxStackSize(config.stackSize || 1024 * 1024);
    ctx = runtime.newContext();

    // Wire console -> StdioBatcher
    var consoleObj = ctx.newObject();
    ['log', 'info', 'debug', 'warn'].forEach(function(level) {
      var fn = ctx.newFunction('console_' + level, function() {
        var args = [];
        for (var i = 0; i < arguments.length; i++) {
          try { args.push(ctx.dump(arguments[i])); }
          catch(e) { args.push(String(arguments[i])); }
        }
        pushStdout(args.join(' ') + '\\n');
      });
      ctx.setProp(consoleObj, level, fn);
      fn.dispose();
    });

    var errorFn = ctx.newFunction('console_error', function() {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        try { args.push(ctx.dump(arguments[i])); }
        catch(e) { args.push(String(arguments[i])); }
      }
      pushStderr(args.join(' ') + '\\n');
    });
    ctx.setProp(consoleObj, 'error', errorFn);
    errorFn.dispose();
    ctx.setProp(ctx.global, 'console', consoleObj);
    consoleObj.dispose();

    self.postMessage({ type: 'ready' });
  } catch (e) {
    self.postMessage({ type: 'error', data: 'Boot failed: ' + (e.message || e) });
  }
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

      if (cmd.type === 'exec' && ctx) {
        try {
          var result = ctx.evalCode(cmd.code || '', '<process>');
          if (result.error) {
            var err = ctx.dump(result.error);
            result.error.dispose();
            pushStderr(String(err) + '\\n');
            flushStdio();
            stdioPort.postMessage({ type: 'exit', code: 1 });
          } else {
            result.value.dispose();
            flushStdio();
            stdioPort.postMessage({ type: 'exit', code: 0 });
          }
        } catch (ex) {
          pushStderr((ex.message || String(ex)) + '\\n');
          flushStdio();
          stdioPort.postMessage({ type: 'exit', code: 1 });
        }
      }

      if (cmd.type === 'kill') {
        flushStdio();
        try {
          if (ctx) { ctx.dispose(); ctx = null; }
          if (runtime) { runtime.dispose(); runtime = null; }
        } catch(ex) {}
        var exitCode = 128 + (cmd.signal || 15);
        stdioPort.postMessage({ type: 'exit', code: exitCode });
        self.close();
      }
    };

    // Boot QuickJS
    boot(msg.config || {});
  }
});
`;
}

/**
 * Signal numbers for common signals.
 */
export const SIGNALS: Record<string, number> = {
  SIGTERM: 15,
  SIGKILL: 9,
  SIGINT: 2,
};
