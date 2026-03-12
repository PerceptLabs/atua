/**
 * Console capture binding for QuickJS.
 * Creates a console object that forwards calls to host-injected callbacks.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getConsoleSource(): string {
  return `
(function() {
  function formatArgs(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (arg === null) {
        parts.push('null');
      } else if (arg === undefined) {
        parts.push('undefined');
      } else if (typeof arg === 'string') {
        parts.push(arg);
      } else if (typeof arg === 'number' || typeof arg === 'boolean') {
        parts.push(String(arg));
      } else if (typeof arg === 'function') {
        parts.push('[Function' + (arg.name ? ': ' + arg.name : '') + ']');
      } else if (Array.isArray(arg)) {
        try {
          parts.push(JSON.stringify(arg));
        } catch (e) {
          parts.push('[Array]');
        }
      } else if (arg instanceof Error) {
        parts.push(arg.stack || arg.message || String(arg));
      } else {
        try {
          parts.push(JSON.stringify(arg, null, 2));
        } catch (e) {
          parts.push('[Object]');
        }
      }
    }
    return parts.join(' ');
  }

  var _callbacks = {
    log: null,
    error: null,
    warn: null,
    info: null,
    debug: null
  };

  var console = {
    log: function() {
      var msg = formatArgs(Array.prototype.slice.call(arguments));
      if (_callbacks.log) _callbacks.log('log', msg);
    },
    error: function() {
      var msg = formatArgs(Array.prototype.slice.call(arguments));
      if (_callbacks.error) _callbacks.error('error', msg);
    },
    warn: function() {
      var msg = formatArgs(Array.prototype.slice.call(arguments));
      if (_callbacks.warn) _callbacks.warn('warn', msg);
    },
    info: function() {
      var msg = formatArgs(Array.prototype.slice.call(arguments));
      if (_callbacks.info) _callbacks.info('info', msg);
    },
    debug: function() {
      var msg = formatArgs(Array.prototype.slice.call(arguments));
      if (_callbacks.debug) _callbacks.debug('debug', msg);
    },
    trace: function() {
      var err = new Error();
      var msg = 'Trace: ' + formatArgs(Array.prototype.slice.call(arguments));
      if (err.stack) {
        msg += '\\n' + err.stack.split('\\n').slice(1).join('\\n');
      }
      if (_callbacks.debug) _callbacks.debug('debug', msg);
    },
    assert: function(condition) {
      if (!condition) {
        var args = Array.prototype.slice.call(arguments, 1);
        var msg = 'Assertion failed';
        if (args.length > 0) {
          msg += ': ' + formatArgs(args);
        }
        if (_callbacks.error) _callbacks.error('error', msg);
      }
    },
    dir: function(obj) {
      var msg;
      try {
        msg = JSON.stringify(obj, null, 2);
      } catch (e) {
        msg = String(obj);
      }
      if (_callbacks.log) _callbacks.log('log', msg);
    },
    time: function(label) {
      label = label || 'default';
      console._timers = console._timers || {};
      console._timers[label] = Date.now();
    },
    timeEnd: function(label) {
      label = label || 'default';
      console._timers = console._timers || {};
      if (console._timers[label] !== undefined) {
        var elapsed = Date.now() - console._timers[label];
        var msg = label + ': ' + elapsed + 'ms';
        if (_callbacks.log) _callbacks.log('log', msg);
        delete console._timers[label];
      }
    },
    timeLog: function(label) {
      label = label || 'default';
      console._timers = console._timers || {};
      if (console._timers[label] !== undefined) {
        var elapsed = Date.now() - console._timers[label];
        var args = Array.prototype.slice.call(arguments, 1);
        var msg = label + ': ' + elapsed + 'ms';
        if (args.length > 0) {
          msg += ' ' + formatArgs(args);
        }
        if (_callbacks.log) _callbacks.log('log', msg);
      }
    },
    clear: function() {
      // no-op in QuickJS context
    },
    count: function(label) {
      label = label || 'default';
      console._counters = console._counters || {};
      console._counters[label] = (console._counters[label] || 0) + 1;
      var msg = label + ': ' + console._counters[label];
      if (_callbacks.log) _callbacks.log('log', msg);
    },
    countReset: function(label) {
      label = label || 'default';
      console._counters = console._counters || {};
      console._counters[label] = 0;
    },
    group: function() {
      // simplified: just log the label
      if (arguments.length > 0) {
        var msg = formatArgs(Array.prototype.slice.call(arguments));
        if (_callbacks.log) _callbacks.log('log', msg);
      }
    },
    groupEnd: function() {
      // no-op
    },
    table: function(data) {
      // simplified: just stringify
      try {
        var msg = JSON.stringify(data, null, 2);
        if (_callbacks.log) _callbacks.log('log', msg);
      } catch (e) {
        if (_callbacks.log) _callbacks.log('log', String(data));
      }
    },
    _timers: {},
    _counters: {},
    _setCallback: function(method, cb) {
      _callbacks[method] = cb;
    },
    _setCallbacks: function(cbs) {
      if (cbs.log) _callbacks.log = cbs.log;
      if (cbs.error) _callbacks.error = cbs.error;
      if (cbs.warn) _callbacks.warn = cbs.warn;
      if (cbs.info) _callbacks.info = cbs.info;
      if (cbs.debug) _callbacks.debug = cbs.debug;
    }
  };

  module.exports = console;
})();
`;
}
