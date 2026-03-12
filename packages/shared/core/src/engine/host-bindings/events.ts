/**
 * EventEmitter implementation for QuickJS.
 * Complete Node.js-compatible EventEmitter.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getEventsSource(): string {
  return `
(function() {
  var defaultMaxListeners = 10;

  function EventEmitter() {
    this._events = Object.create(null);
    this._eventsCount = 0;
    this._maxListeners = undefined;
  }

  EventEmitter.defaultMaxListeners = defaultMaxListeners;

  EventEmitter.prototype.setMaxListeners = function(n) {
    if (typeof n !== 'number' || n < 0 || isNaN(n)) {
      throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n);
    }
    this._maxListeners = n;
    return this;
  };

  EventEmitter.prototype.getMaxListeners = function() {
    if (this._maxListeners === undefined) {
      return EventEmitter.defaultMaxListeners;
    }
    return this._maxListeners;
  };

  EventEmitter.prototype.emit = function(type) {
    var args = [];
    for (var i = 1; i < arguments.length; i++) {
      args.push(arguments[i]);
    }

    var events = this._events;
    var handler = events[type];

    if (handler === undefined) {
      if (type === 'error') {
        var err = args[0];
        if (err instanceof Error) {
          throw err;
        }
        var error = new Error('Unhandled error.' + (err ? ' (' + err + ')' : ''));
        error.context = err;
        throw error;
      }
      return false;
    }

    if (typeof handler === 'function') {
      handler.apply(this, args);
    } else {
      var listeners = handler.slice();
      for (var i = 0; i < listeners.length; i++) {
        listeners[i].apply(this, args);
      }
    }

    return true;
  };

  function _addListener(target, type, listener, prepend) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }

    var events = target._events;
    var existing = events[type];

    if (existing === undefined) {
      events[type] = listener;
      target._eventsCount++;
    } else if (typeof existing === 'function') {
      events[type] = prepend ? [listener, existing] : [existing, listener];
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    var max = target.getMaxListeners();
    if (max > 0) {
      var count = typeof events[type] === 'function' ? 1 : events[type].length;
      if (count > max && !events[type].warned) {
        if (typeof events[type] !== 'function') {
          events[type].warned = true;
        }
      }
    }

    // Emit newListener event (but not for newListener itself to avoid recursion)
    if (events.newListener !== undefined && type !== 'newListener') {
      target.emit('newListener', type, listener.listener ? listener.listener : listener);
    }

    return target;
  }

  EventEmitter.prototype.addListener = function(type, listener) {
    return _addListener(this, type, listener, false);
  };

  EventEmitter.prototype.on = EventEmitter.prototype.addListener;

  EventEmitter.prototype.prependListener = function(type, listener) {
    return _addListener(this, type, listener, true);
  };

  function onceWrapper() {
    if (!this.fired) {
      this.fired = true;
      this.target.removeListener(this.type, this.wrapFn);
      this.listener.apply(this.target, arguments);
    }
  }

  function _onceWrap(target, type, listener) {
    var state = { fired: false, target: target, type: type, listener: listener, wrapFn: undefined };
    var wrapped = onceWrapper.bind(state);
    wrapped.listener = listener;
    state.wrapFn = wrapped;
    return wrapped;
  }

  EventEmitter.prototype.once = function(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }
    this.on(type, _onceWrap(this, type, listener));
    return this;
  };

  EventEmitter.prototype.prependOnceListener = function(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }
    this.prependListener(type, _onceWrap(this, type, listener));
    return this;
  };

  EventEmitter.prototype.removeListener = function(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
    }

    var events = this._events;
    var list = events[type];

    if (list === undefined) return this;

    if (list === listener || list.listener === listener) {
      if (--this._eventsCount === 0) {
        this._events = Object.create(null);
      } else {
        delete events[type];
        if (events.removeListener) {
          this.emit('removeListener', type, list.listener || listener);
        }
      }
    } else if (typeof list !== 'function') {
      var position = -1;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i] === listener || list[i].listener === listener) {
          position = i;
          break;
        }
      }

      if (position < 0) return this;

      if (position === 0) {
        list.shift();
      } else {
        list.splice(position, 1);
      }

      if (list.length === 1) {
        events[type] = list[0];
      }

      if (events.removeListener !== undefined) {
        this.emit('removeListener', type, listener);
      }
    }

    return this;
  };

  EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

  EventEmitter.prototype.removeAllListeners = function(type) {
    var events = this._events;

    if (events.removeListener === undefined) {
      if (arguments.length === 0) {
        this._events = Object.create(null);
        this._eventsCount = 0;
      } else if (events[type] !== undefined) {
        if (--this._eventsCount === 0) {
          this._events = Object.create(null);
        } else {
          delete events[type];
        }
      }
      return this;
    }

    // Emit removeListener events for all listeners
    if (arguments.length === 0) {
      var keys = Object.keys(events);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === 'removeListener') continue;
        this.removeAllListeners(key);
      }
      this.removeAllListeners('removeListener');
      this._events = Object.create(null);
      this._eventsCount = 0;
      return this;
    }

    var listeners = events[type];
    if (typeof listeners === 'function') {
      this.removeListener(type, listeners);
    } else if (listeners !== undefined) {
      for (var i = listeners.length - 1; i >= 0; i--) {
        this.removeListener(type, listeners[i]);
      }
    }

    return this;
  };

  EventEmitter.prototype.listeners = function(type) {
    var events = this._events;
    var list = events[type];

    if (list === undefined) return [];
    if (typeof list === 'function') {
      return [list.listener || list];
    }
    var result = [];
    for (var i = 0; i < list.length; i++) {
      result.push(list[i].listener || list[i]);
    }
    return result;
  };

  EventEmitter.prototype.rawListeners = function(type) {
    var events = this._events;
    var list = events[type];

    if (list === undefined) return [];
    if (typeof list === 'function') return [list];
    return list.slice();
  };

  EventEmitter.prototype.listenerCount = function(type) {
    var events = this._events;
    var list = events[type];

    if (list === undefined) return 0;
    if (typeof list === 'function') return 1;
    return list.length;
  };

  EventEmitter.listenerCount = function(emitter, type) {
    if (typeof emitter.listenerCount === 'function') {
      return emitter.listenerCount(type);
    }
    return EventEmitter.prototype.listenerCount.call(emitter, type);
  };

  EventEmitter.prototype.eventNames = function() {
    if (this._eventsCount === 0) return [];
    return Object.keys(this._events);
  };

  // Static once method that returns a promise
  EventEmitter.once = function(emitter, name) {
    return new Promise(function(resolve, reject) {
      var errorListener;

      var resolver = function() {
        if (errorListener !== undefined) {
          emitter.removeListener('error', errorListener);
        }
        var args = Array.prototype.slice.call(arguments);
        resolve(args);
      };

      if (name !== 'error') {
        errorListener = function(err) {
          emitter.removeListener(name, resolver);
          reject(err);
        };
        emitter.once('error', errorListener);
      }

      emitter.once(name, resolver);
    });
  };

  // Static on method that returns an async iterator
  EventEmitter.on = function(emitter, event) {
    var unconsumedEvents = [];
    var unconsumedPromises = [];
    var done = false;

    var eventHandler = function() {
      var args = Array.prototype.slice.call(arguments);
      if (unconsumedPromises.length > 0) {
        var promise = unconsumedPromises.shift();
        promise.resolve({ value: args, done: false });
      } else {
        unconsumedEvents.push(args);
      }
    };

    var errorHandler = function(err) {
      done = true;
      if (unconsumedPromises.length > 0) {
        var promise = unconsumedPromises.shift();
        promise.reject(err);
      }
    };

    emitter.on(event, eventHandler);
    if (event !== 'error') {
      emitter.on('error', errorHandler);
    }

    var iterator = {
      next: function() {
        if (unconsumedEvents.length > 0) {
          return Promise.resolve({ value: unconsumedEvents.shift(), done: false });
        }
        if (done) {
          return Promise.resolve({ done: true });
        }
        return new Promise(function(resolve, reject) {
          unconsumedPromises.push({ resolve: resolve, reject: reject });
        });
      },
      return: function() {
        done = true;
        emitter.removeListener(event, eventHandler);
        emitter.removeListener('error', errorHandler);
        for (var i = 0; i < unconsumedPromises.length; i++) {
          unconsumedPromises[i].resolve({ done: true });
        }
        return Promise.resolve({ done: true });
      },
      throw: function(err) {
        done = true;
        emitter.removeListener(event, eventHandler);
        emitter.removeListener('error', errorHandler);
        return Promise.reject(err);
      }
    };

    if (typeof Symbol !== 'undefined' && Symbol.asyncIterator) {
      iterator[Symbol.asyncIterator] = function() { return this; };
    }

    return iterator;
  };

  EventEmitter.EventEmitter = EventEmitter;

  module.exports = EventEmitter;
})();
`;
}
