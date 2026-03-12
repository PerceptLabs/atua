/**
 * Timer bindings for QuickJS.
 * Provides setTimeout, clearTimeout, setInterval, clearInterval,
 * setImmediate, clearImmediate using pure JS scheduling.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getTimersSource(): string {
  return `
(function() {
  var _nextId = 1;
  var _timers = {};
  var _immediates = {};
  var _immediateQueue = [];
  var _drainingImmediates = false;

  // Internal tick function — the host should call __timers_tick(now) periodically
  // to fire pending timers. If the host does not call it, timers will not fire
  // unless polled manually.
  var _now = Date.now();

  function _updateNow() {
    _now = Date.now();
  }

  function setTimeout(callback, delay) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    delay = Math.max(0, +delay || 0);
    var args = [];
    for (var i = 2; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    var id = _nextId++;
    var timer = {
      id: id,
      callback: callback,
      args: args,
      delay: delay,
      startTime: Date.now(),
      interval: false,
      cleared: false
    };
    _timers[id] = timer;

    // If QuickJS has native os.setTimeout, delegate to it
    if (typeof __hostSetTimeout === 'function') {
      timer._hostId = __hostSetTimeout(function() {
        if (!timer.cleared) {
          delete _timers[id];
          callback.apply(null, args);
        }
      }, delay);
    }

    return id;
  }

  function clearTimeout(id) {
    var timer = _timers[id];
    if (timer) {
      timer.cleared = true;
      if (typeof __hostClearTimeout === 'function' && timer._hostId !== undefined) {
        __hostClearTimeout(timer._hostId);
      }
      delete _timers[id];
    }
  }

  function setInterval(callback, delay) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    delay = Math.max(0, +delay || 0);
    var args = [];
    for (var i = 2; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    var id = _nextId++;
    var timer = {
      id: id,
      callback: callback,
      args: args,
      delay: delay,
      startTime: Date.now(),
      lastFired: Date.now(),
      interval: true,
      cleared: false
    };
    _timers[id] = timer;

    if (typeof __hostSetInterval === 'function') {
      timer._hostId = __hostSetInterval(function() {
        if (!timer.cleared) {
          timer.lastFired = Date.now();
          callback.apply(null, args);
        }
      }, delay);
    }

    return id;
  }

  function clearInterval(id) {
    var timer = _timers[id];
    if (timer) {
      timer.cleared = true;
      if (typeof __hostClearInterval === 'function' && timer._hostId !== undefined) {
        __hostClearInterval(timer._hostId);
      }
      delete _timers[id];
    }
  }

  function setImmediate(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    var args = [];
    for (var i = 1; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    var id = _nextId++;
    var immediate = {
      id: id,
      callback: callback,
      args: args,
      cleared: false
    };
    _immediates[id] = immediate;
    _immediateQueue.push(immediate);

    // Schedule draining via microtask
    if (!_drainingImmediates) {
      if (typeof Promise !== 'undefined') {
        Promise.resolve().then(_drainImmediates);
      } else {
        // Fallback: execute synchronously on next tick check
        _drainImmediates();
      }
    }

    return id;
  }

  function clearImmediate(id) {
    var immediate = _immediates[id];
    if (immediate) {
      immediate.cleared = true;
      delete _immediates[id];
    }
  }

  function _drainImmediates() {
    _drainingImmediates = true;
    while (_immediateQueue.length > 0) {
      var immediate = _immediateQueue.shift();
      if (!immediate.cleared) {
        delete _immediates[immediate.id];
        try {
          immediate.callback.apply(null, immediate.args);
        } catch (e) {
          // Propagate errors
          _drainingImmediates = false;
          throw e;
        }
      }
    }
    _drainingImmediates = false;
  }

  // Manual tick function for polling-based timer execution
  // The host can call this to check and fire expired timers
  function __timers_tick() {
    _updateNow();
    var ids = Object.keys(_timers);
    for (var i = 0; i < ids.length; i++) {
      var timer = _timers[ids[i]];
      if (!timer || timer.cleared) continue;

      // Only process timers that don't have a host-delegated ID
      if (timer._hostId !== undefined) continue;

      var elapsed = _now - timer.startTime;
      if (timer.interval) {
        var elapsedSinceLastFire = _now - timer.lastFired;
        if (elapsedSinceLastFire >= timer.delay) {
          timer.lastFired = _now;
          try {
            timer.callback.apply(null, timer.args);
          } catch (e) {
            // swallow
          }
        }
      } else {
        if (elapsed >= timer.delay) {
          delete _timers[timer.id];
          try {
            timer.callback.apply(null, timer.args);
          } catch (e) {
            // swallow
          }
        }
      }
    }
    // Also drain immediates
    if (_immediateQueue.length > 0) {
      _drainImmediates();
    }
  }

  // Check if there are pending timers
  function __timers_hasPending() {
    return Object.keys(_timers).length > 0 || _immediateQueue.length > 0;
  }

  var timers = {
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    setImmediate: setImmediate,
    clearImmediate: clearImmediate,
    __timers_tick: __timers_tick,
    __timers_hasPending: __timers_hasPending
  };

  module.exports = timers;
})();
`;
}
