/**
 * Process shim for QuickJS.
 * Provides a minimal Node-like process object.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getProcessSource(env?: Record<string, string>): string {
  const envJson = JSON.stringify(env ?? {});
  return `
(function() {
  var _exitCallback = null;
  var _nextTickQueue = [];
  var _draining = false;

  function drainQueue() {
    if (_draining) return;
    _draining = true;
    var queue = _nextTickQueue;
    _nextTickQueue = [];
    for (var i = 0; i < queue.length; i++) {
      try {
        queue[i].fn.apply(null, queue[i].args);
      } catch (e) {
        // swallow or forward to uncaughtException
      }
    }
    _draining = false;
    if (_nextTickQueue.length > 0) {
      drainQueue();
    }
  }

  var process = {
    env: ${envJson},
    argv: ['quickjs', 'script.js'],
    argc: 2,
    platform: 'browser',
    arch: 'wasm',
    version: 'v18.0.0',
    versions: {
      node: '18.0.0',
      quickjs: '1.0.0'
    },
    pid: 1,
    ppid: 0,
    title: 'catalyst',
    execPath: '/usr/local/bin/node',
    execArgv: [],
    stdin: null,
    stdout: {
      write: function(data) {
        // no-op or can be overridden
        return true;
      },
      isTTY: false
    },
    stderr: {
      write: function(data) {
        return true;
      },
      isTTY: false
    },

    cwd: function() {
      return '/';
    },

    chdir: function(dir) {
      // no-op in QuickJS sandbox
    },

    exit: function(code) {
      code = code || 0;
      if (_exitCallback) {
        _exitCallback(code);
      }
    },

    hrtime: function(prev) {
      var now = Date.now();
      var sec = Math.floor(now / 1000);
      var nsec = (now % 1000) * 1e6;
      if (prev) {
        sec = sec - prev[0];
        nsec = nsec - prev[1];
        if (nsec < 0) {
          sec--;
          nsec += 1e9;
        }
      }
      return [sec, nsec];
    },

    nextTick: function(fn) {
      var args = [];
      for (var i = 1; i < arguments.length; i++) {
        args.push(arguments[i]);
      }
      _nextTickQueue.push({ fn: fn, args: args });
      // Schedule draining asynchronously if possible, otherwise synchronously
      if (typeof Promise !== 'undefined') {
        Promise.resolve().then(drainQueue);
      } else {
        drainQueue();
      }
    },

    memoryUsage: function() {
      return {
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0
      };
    },

    uptime: function() {
      return 0;
    },

    cpuUsage: function() {
      return { user: 0, system: 0 };
    },

    emitWarning: function(warning) {
      // no-op
    },

    on: function(event, fn) {
      // minimal event support
      if (event === 'exit') {
        _exitCallback = fn;
      }
      return process;
    },

    once: function(event, fn) {
      return process.on(event, fn);
    },

    off: function(event, fn) {
      if (event === 'exit' && _exitCallback === fn) {
        _exitCallback = null;
      }
      return process;
    },

    removeListener: function(event, fn) {
      return process.off(event, fn);
    },

    listeners: function(event) {
      if (event === 'exit' && _exitCallback) return [_exitCallback];
      return [];
    },

    emit: function(event) {
      if (event === 'exit' && _exitCallback) {
        var args = Array.prototype.slice.call(arguments, 1);
        _exitCallback.apply(null, args);
        return true;
      }
      return false;
    },

    _setExitCallback: function(cb) {
      _exitCallback = cb;
    },

    // Node.js process.binding - stub
    binding: function(name) {
      throw new Error('process.binding is not supported in QuickJS sandbox');
    },

    // Feature detection
    features: {
      inspector: false,
      debug: false,
      uv: false,
      ipv6: false,
      tls_alpn: false,
      tls_sni: false,
      tls_ocsp: false,
      tls: false
    },

    release: {
      name: 'catalyst'
    }
  };

  // hrtime.bigint polyfill
  process.hrtime.bigint = function() {
    var t = process.hrtime();
    // Return as number since BigInt may not be available
    return t[0] * 1e9 + t[1];
  };

  module.exports = process;
})();
`;
}
