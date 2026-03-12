/**
 * WorkerBootstrap — The bootstrap script for NativeEngine Web Workers
 *
 * This generates the source code that runs inside each Web Worker.
 * It creates a Node.js-compatible environment using the browser's native
 * JS engine at full V8/SpiderMonkey/JSC speed.
 *
 * Bootstrap sequence:
 * 1. Shadow dangerous browser globals
 * 2. Set up Node.js globals (process, global, Buffer, etc.)
 * 3. Build require() backed by pre-loaded module sources
 * 4. Wire console output to parent via MessagePort
 * 5. Execute user code via new Function()
 */

import { getShadowGlobalsCode, getNodeGlobalsCode } from './GlobalScope.js';

export interface WorkerBootstrapConfig {
  env?: Record<string, string>;
  cwd?: string;
  pid?: number;
  timeout?: number;
  /** Pre-loaded builtin module sources (name → source code) */
  builtinSources?: Record<string, string>;
}

/**
 * Generate the full Worker bootstrap source code.
 * This is eval'd as the Worker's main script.
 */
export function getWorkerBootstrapSource(config: WorkerBootstrapConfig = {}): string {
  const builtinJson = JSON.stringify(config.builtinSources ?? {});

  return `
// ============================================================
// NativeEngine Worker Bootstrap
// Browser-native JS execution with Node.js compatibility layer
// ============================================================

${getShadowGlobalsCode()}
${getNodeGlobalsCode({ env: config.env, cwd: config.cwd, pid: config.pid })}

// ---- Module System ----

(function() {
  var __modules = {};
  var __builtinSources = ${builtinJson};

  // Pre-load builtin modules from source strings
  function loadBuiltin(name) {
    var source = __builtinSources[name];
    if (!source) return undefined;

    var mod = { exports: {} };
    var exports = mod.exports;
    try {
      var fn = new Function('module', 'exports', 'require', '__filename', '__dirname', source);
      fn(mod, exports, self.require, '/' + name + '.js', '/');
      return mod.exports;
    } catch(e) {
      // If builtin fails to load, return partial exports
      return mod.exports;
    }
  }

  // Build the require() function
  self.require = function require(name) {
    // Strip node: prefix
    var moduleName = name;
    if (moduleName.startsWith('node:')) {
      moduleName = moduleName.slice(5);
    }

    // Check module cache
    if (__modules[moduleName] !== undefined) {
      return __modules[moduleName];
    }

    // Try builtin
    if (__builtinSources[moduleName]) {
      // Pre-cache for circular dependency support
      __modules[moduleName] = {};
      var result = loadBuiltin(moduleName);
      __modules[moduleName] = result;
      return result;
    }

    // Try filesystem module resolution (if available)
    if (typeof self.__catalyst_resolve_module === 'function') {
      var source = self.__catalyst_resolve_module(moduleName);
      if (source) {
        var mod = { exports: {} };
        __modules[moduleName] = mod.exports;
        try {
          var fn = new Function('module', 'exports', 'require', '__filename', '__dirname', source);
          var __fn = moduleName;
          var __dn = moduleName.substring(0, moduleName.lastIndexOf('/')) || '/';
          fn(mod, mod.exports, self.require, __fn, __dn);
          __modules[moduleName] = mod.exports;
          return mod.exports;
        } catch(e) {
          delete __modules[moduleName];
          throw e;
        }
      }
    }

    var err = new Error("MODULE_NOT_FOUND: Cannot find module '" + name + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  // Make require available globally
  self.require.resolve = function(name) { return name; };
  self.require.cache = __modules;
})();

// ---- Console Wiring ----

(function() {
  var origConsole = self.console;

  function makeLogFn(level) {
    return function() {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        var arg = arguments[i];
        if (typeof arg === 'string') args.push(arg);
        else if (arg === null) args.push('null');
        else if (arg === undefined) args.push('undefined');
        else {
          try { args.push(JSON.stringify(arg)); }
          catch(e) { args.push(String(arg)); }
        }
      }
      var text = args.join(' ');
      if (typeof self.__catalyst_console === 'function') {
        self.__catalyst_console(level, text);
      }
    };
  }

  self.console = {
    log: makeLogFn('log'),
    info: makeLogFn('info'),
    debug: makeLogFn('debug'),
    warn: makeLogFn('warn'),
    error: makeLogFn('error'),
    dir: makeLogFn('log'),
    trace: makeLogFn('debug'),
    time: function() {},
    timeEnd: function() {},
    timeLog: function() {},
    clear: function() {},
    count: function() {},
    countReset: function() {},
    group: function() {},
    groupCollapsed: function() {},
    groupEnd: function() {},
    table: makeLogFn('log'),
    assert: function(condition) {
      if (!condition) {
        var args = ['Assertion failed:'];
        for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
        self.console.error.apply(null, args);
      }
    },
  };
})();

// Signal ready
if (typeof self.__catalyst_ready === 'function') {
  self.__catalyst_ready();
}
`;
}
