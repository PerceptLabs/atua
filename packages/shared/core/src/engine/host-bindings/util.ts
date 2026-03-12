/**
 * Util module for QuickJS.
 * Provides format, inspect, promisify, callbackify, deprecate, inherits,
 * types, isDeepStrictEqual, TextEncoder, TextDecoder, and legacy type checks.
 * Returns source code string to be eval'd inside QuickJS.
 */
export function getUtilSource(): string {
  return `
(function() {
  // ---- inspect ----

  var _inspectDefaults = {
    depth: 2,
    colors: false,
    showHidden: false,
    maxArrayLength: 100,
    maxStringLength: 10000,
    breakLength: 80,
    compact: 3,
    sorted: false
  };

  function inspect(obj, opts) {
    if (typeof opts === 'number') {
      opts = { depth: opts };
    } else if (typeof opts === 'boolean') {
      opts = { showHidden: opts };
    }
    opts = opts || {};
    var depth = opts.depth !== undefined ? opts.depth : _inspectDefaults.depth;
    var maxArrayLength = opts.maxArrayLength !== undefined ? opts.maxArrayLength : _inspectDefaults.maxArrayLength;
    var maxStringLength = opts.maxStringLength !== undefined ? opts.maxStringLength : _inspectDefaults.maxStringLength;
    var sorted = opts.sorted || _inspectDefaults.sorted;
    var seen = [];

    function _inspect(val, currentDepth) {
      if (val === null) return 'null';
      if (val === undefined) return 'undefined';
      if (typeof val === 'boolean') return val ? 'true' : 'false';
      if (typeof val === 'number') {
        if (Object.is && Object.is(val, -0)) return '-0';
        return String(val);
      }
      if (typeof val === 'bigint') return val.toString() + 'n';
      if (typeof val === 'string') {
        if (val.length > maxStringLength) {
          val = val.slice(0, maxStringLength) + '... ' + (val.length - maxStringLength) + ' more characters';
        }
        return "'" + val.replace(/\\\\/g, '\\\\\\\\')
          .replace(/'/g, "\\\\'")
          .replace(/\\n/g, '\\\\n')
          .replace(/\\r/g, '\\\\r')
          .replace(/\\t/g, '\\\\t') + "'";
      }
      if (typeof val === 'symbol') return val.toString();
      if (typeof val === 'function') {
        var name = val.name || '(anonymous)';
        return '[Function: ' + name + ']';
      }

      // Check for circular references
      if (seen.indexOf(val) !== -1) {
        return '[Circular]';
      }

      // Check depth
      if (depth !== null && currentDepth > depth) {
        if (Array.isArray(val)) return '[Array]';
        return '[Object]';
      }

      seen.push(val);
      var result;

      if (val instanceof Date) {
        result = val.toISOString();
      } else if (val instanceof RegExp) {
        result = val.toString();
      } else if (val instanceof Error) {
        result = val.stack || (val.name + ': ' + val.message);
      } else if (typeof Promise !== 'undefined' && val instanceof Promise) {
        result = 'Promise { <pending> }';
      } else if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) {
        result = 'ArrayBuffer { byteLength: ' + val.byteLength + ' }';
      } else if (typeof Uint8Array !== 'undefined' && val instanceof Uint8Array) {
        var items = [];
        var len = Math.min(val.length, maxArrayLength);
        for (var i = 0; i < len; i++) {
          items.push(val[i].toString());
        }
        if (val.length > maxArrayLength) {
          items.push('... ' + (val.length - maxArrayLength) + ' more items');
        }
        result = 'Uint8Array(' + val.length + ') [ ' + items.join(', ') + ' ]';
      } else if (Array.isArray(val)) {
        if (val.length === 0) {
          result = '[]';
        } else {
          var items = [];
          var len = Math.min(val.length, maxArrayLength);
          for (var i = 0; i < len; i++) {
            items.push(_inspect(val[i], currentDepth + 1));
          }
          if (val.length > maxArrayLength) {
            items.push('... ' + (val.length - maxArrayLength) + ' more items');
          }
          result = '[ ' + items.join(', ') + ' ]';
        }
      } else if (typeof Map !== 'undefined' && val instanceof Map) {
        var items = [];
        val.forEach(function(v, k) {
          items.push(_inspect(k, currentDepth + 1) + ' => ' + _inspect(v, currentDepth + 1));
        });
        result = 'Map(' + val.size + ') { ' + items.join(', ') + ' }';
      } else if (typeof Set !== 'undefined' && val instanceof Set) {
        var items = [];
        val.forEach(function(v) {
          items.push(_inspect(v, currentDepth + 1));
        });
        result = 'Set(' + val.size + ') { ' + items.join(', ') + ' }';
      } else {
        // Plain object
        var keys = Object.keys(val);
        if (sorted) keys.sort();
        if (keys.length === 0) {
          result = '{}';
        } else {
          var items = [];
          for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var desc = Object.getOwnPropertyDescriptor(val, key);
            var valueStr;
            if (desc && desc.get && !desc.set) {
              valueStr = '[Getter]';
            } else if (desc && desc.set && !desc.get) {
              valueStr = '[Setter]';
            } else if (desc && desc.get && desc.set) {
              valueStr = '[Getter/Setter]';
            } else {
              try {
                valueStr = _inspect(val[key], currentDepth + 1);
              } catch (e) {
                valueStr = '[Error]';
              }
            }
            items.push(key + ': ' + valueStr);
          }
          result = '{ ' + items.join(', ') + ' }';
        }
      }

      seen.pop();
      return result;
    }

    return _inspect(obj, 0);
  }

  inspect.defaultOptions = _inspectDefaults;
  inspect.custom = typeof Symbol !== 'undefined' ? Symbol.for('nodejs.util.inspect.custom') : '__custom_inspect__';

  // ---- format ----

  function format() {
    if (arguments.length === 0) return '';
    var first = arguments[0];

    if (typeof first !== 'string') {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        parts.push(inspect(arguments[i]));
      }
      return parts.join(' ');
    }

    var str = first;
    var argIdx = 1;
    var result = '';
    var i = 0;

    while (i < str.length) {
      if (str[i] === '%' && i + 1 < str.length && argIdx < arguments.length) {
        var next = str[i + 1];
        if (next === 's') {
          result += String(arguments[argIdx++]);
          i += 2;
          continue;
        } else if (next === 'd') {
          result += Number(arguments[argIdx++]);
          i += 2;
          continue;
        } else if (next === 'i') {
          result += parseInt(arguments[argIdx++], 10);
          i += 2;
          continue;
        } else if (next === 'f') {
          result += parseFloat(arguments[argIdx++]);
          i += 2;
          continue;
        } else if (next === 'j') {
          try {
            result += JSON.stringify(arguments[argIdx++]);
          } catch (e) {
            result += '[Circular]';
          }
          i += 2;
          continue;
        } else if (next === 'o' || next === 'O') {
          result += inspect(arguments[argIdx++]);
          i += 2;
          continue;
        } else if (next === '%') {
          result += '%';
          i += 2;
          continue;
        }
      }
      result += str[i];
      i++;
    }

    // Append remaining arguments
    for (; argIdx < arguments.length; argIdx++) {
      result += ' ' + inspect(arguments[argIdx]);
    }

    return result;
  }

  function formatWithOptions(inspectOptions) {
    var args = Array.prototype.slice.call(arguments, 1);
    return format.apply(null, args);
  }

  // ---- promisify ----

  var kCustomPromisifiedSymbol = typeof Symbol !== 'undefined'
    ? Symbol.for('nodejs.util.promisify.custom')
    : '__promisify__';

  function promisify(original) {
    if (typeof original !== 'function') {
      throw new TypeError('The "original" argument must be of type Function');
    }

    if (original[kCustomPromisifiedSymbol]) {
      var fn = original[kCustomPromisifiedSymbol];
      if (typeof fn !== 'function') {
        throw new TypeError('The "util.promisify.custom" property must be of type Function');
      }
      return fn;
    }

    function promisified() {
      var args = Array.prototype.slice.call(arguments);
      var self = this;
      return new Promise(function(resolve, reject) {
        args.push(function(err, value) {
          if (err) {
            reject(err);
          } else if (arguments.length > 2) {
            var values = [];
            for (var i = 1; i < arguments.length; i++) {
              values.push(arguments[i]);
            }
            resolve(values);
          } else {
            resolve(value);
          }
        });
        original.apply(self, args);
      });
    }

    promisified.__isPromisified__ = true;
    return promisified;
  }

  promisify.custom = kCustomPromisifiedSymbol;

  // ---- callbackify ----

  function callbackify(original) {
    if (typeof original !== 'function') {
      throw new TypeError('The "original" argument must be of type Function');
    }

    function callbackified() {
      var args = Array.prototype.slice.call(arguments);
      var callback = args.pop();
      if (typeof callback !== 'function') {
        throw new TypeError('The last argument must be of type Function');
      }
      var self = this;
      original.apply(self, args).then(
        function(result) { callback(null, result); },
        function(err) {
          if (!err) {
            var wrapped = new Error('Promise rejected with falsy value');
            wrapped.reason = err;
            err = wrapped;
          }
          callback(err);
        }
      );
    }

    return callbackified;
  }

  // ---- deprecate ----

  var _deprecatedWarnings = {};

  function deprecate(fn, msg, code) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type Function');
    }

    function deprecated() {
      var key = code || msg;
      if (!_deprecatedWarnings[key]) {
        _deprecatedWarnings[key] = true;
        // In QuickJS sandbox, we silently continue
      }
      return fn.apply(this, arguments);
    }

    return deprecated;
  }

  // ---- inherits ----

  function inherits(ctor, superCtor) {
    if (typeof ctor !== 'function') {
      throw new TypeError('The constructor to "inherits" must be a function');
    }
    if (superCtor === null || (typeof superCtor !== 'function' && typeof superCtor !== 'object')) {
      throw new TypeError('The super constructor to "inherits" must be non-null');
    }
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  }

  // ---- types ----

  var types = {
    isArray: function(val) { return Array.isArray(val); },
    isBoolean: function(val) { return typeof val === 'boolean'; },
    isNull: function(val) { return val === null; },
    isNullOrUndefined: function(val) { return val === null || val === undefined; },
    isNumber: function(val) { return typeof val === 'number'; },
    isString: function(val) { return typeof val === 'string'; },
    isSymbol: function(val) { return typeof val === 'symbol'; },
    isUndefined: function(val) { return val === undefined; },
    isRegExp: function(val) { return val instanceof RegExp; },
    isObject: function(val) { return val !== null && typeof val === 'object'; },
    isDate: function(val) { return val instanceof Date; },
    isError: function(val) { return val instanceof Error; },
    isFunction: function(val) { return typeof val === 'function'; },
    isPrimitive: function(val) {
      return val === null || (typeof val !== 'object' && typeof val !== 'function');
    },
    isBuffer: function(val) {
      return val && typeof val === 'object' && val.constructor && val.constructor.name === 'Buffer';
    },
    isPromise: function(val) { return typeof Promise !== 'undefined' && val instanceof Promise; },
    isGeneratorFunction: function(val) {
      if (typeof val !== 'function') return false;
      var str = Function.prototype.toString.call(val);
      return str.indexOf('function*') === 0 || str.indexOf('function *') === 0;
    },
    isGeneratorObject: function(val) {
      if (!val || typeof val !== 'object') return false;
      return typeof val.next === 'function' && typeof val.throw === 'function';
    },
    isAsyncFunction: function(val) {
      if (typeof val !== 'function') return false;
      var str = Function.prototype.toString.call(val);
      return str.indexOf('async') === 0;
    },
    isMap: function(val) { return typeof Map !== 'undefined' && val instanceof Map; },
    isSet: function(val) { return typeof Set !== 'undefined' && val instanceof Set; },
    isWeakMap: function(val) { return typeof WeakMap !== 'undefined' && val instanceof WeakMap; },
    isWeakSet: function(val) { return typeof WeakSet !== 'undefined' && val instanceof WeakSet; },
    isArrayBuffer: function(val) { return typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer; },
    isTypedArray: function(val) {
      return (typeof Uint8Array !== 'undefined' && val instanceof Uint8Array) ||
             (typeof Uint16Array !== 'undefined' && val instanceof Uint16Array) ||
             (typeof Uint32Array !== 'undefined' && val instanceof Uint32Array) ||
             (typeof Int8Array !== 'undefined' && val instanceof Int8Array) ||
             (typeof Int16Array !== 'undefined' && val instanceof Int16Array) ||
             (typeof Int32Array !== 'undefined' && val instanceof Int32Array) ||
             (typeof Float32Array !== 'undefined' && val instanceof Float32Array) ||
             (typeof Float64Array !== 'undefined' && val instanceof Float64Array);
    },
    isUint8Array: function(val) { return typeof Uint8Array !== 'undefined' && val instanceof Uint8Array; },
    isDataView: function(val) { return typeof DataView !== 'undefined' && val instanceof DataView; },
    isSharedArrayBuffer: function(val) { return typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer; },
    isProxy: function() { return false; },
    isExternal: function() { return false; },
    isAnyArrayBuffer: function(val) {
      return types.isArrayBuffer(val) || types.isSharedArrayBuffer(val);
    }
  };

  // ---- isDeepStrictEqual ----

  function _deepEqual(a, b, strict) {
    if (strict ? a === b : a == b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'number' && isNaN(a) && isNaN(b)) return true;
    if (typeof a !== 'object') return false;

    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!_deepEqual(a[i], b[i], strict)) return false;
      }
      return true;
    }

    if (Array.isArray(b)) return false;

    var keysA = Object.keys(a).sort();
    var keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (var i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
      if (!_deepEqual(a[keysA[i]], b[keysB[i]], strict)) return false;
    }
    return true;
  }

  function isDeepStrictEqual(a, b) {
    return _deepEqual(a, b, true);
  }

  // ---- TextEncoder / TextDecoder ----

  function TextEncoder() {}
  TextEncoder.prototype.encode = function(str) {
    str = str || '';
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code < 0xdc00) {
        var next = str.charCodeAt(++i);
        var cp = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        bytes.push(0xf0 | (cp >> 18));
        bytes.push(0x80 | ((cp >> 12) & 0x3f));
        bytes.push(0x80 | ((cp >> 6) & 0x3f));
        bytes.push(0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  };

  function TextDecoder(encoding) {
    this.encoding = (encoding || 'utf-8').toLowerCase();
  }
  TextDecoder.prototype.decode = function(bytes) {
    if (!bytes) return '';
    var result = '';
    var i = 0;
    while (i < bytes.length) {
      var byte1 = bytes[i++];
      if (byte1 < 0x80) {
        result += String.fromCharCode(byte1);
      } else if (byte1 < 0xe0) {
        var byte2 = bytes[i++];
        result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      } else if (byte1 < 0xf0) {
        var byte2 = bytes[i++];
        var byte3 = bytes[i++];
        result += String.fromCharCode(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      } else {
        var byte2 = bytes[i++];
        var byte3 = bytes[i++];
        var byte4 = bytes[i++];
        var cp = ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
        cp -= 0x10000;
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return result;
  };

  var util = {
    format: format,
    formatWithOptions: formatWithOptions,
    inspect: inspect,
    promisify: promisify,
    callbackify: callbackify,
    deprecate: deprecate,
    inherits: inherits,
    types: types,
    isDeepStrictEqual: isDeepStrictEqual,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,

    // Legacy type-checking (deprecated in Node but still used by packages)
    isArray: types.isArray,
    isBoolean: types.isBoolean,
    isNull: types.isNull,
    isNullOrUndefined: types.isNullOrUndefined,
    isNumber: types.isNumber,
    isString: types.isString,
    isSymbol: types.isSymbol,
    isUndefined: types.isUndefined,
    isRegExp: types.isRegExp,
    isObject: types.isObject,
    isDate: types.isDate,
    isError: types.isError,
    isFunction: types.isFunction,
    isPrimitive: types.isPrimitive,
    isBuffer: types.isBuffer
  };

  module.exports = util;
})();
`;
}
