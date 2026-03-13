/**
 * Assert module host binding.
 * Implements Node.js-compatible assertion functions.
 * Returns source code string for NativeModuleLoader.
 */
export function getAssertSource(): string {
  return `
(function() {
  function AssertionError(options) {
    if (!(this instanceof AssertionError)) {
      return new AssertionError(options);
    }
    options = options || {};
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator || '';
    this.message = options.message || _getMessage(this);
    this.generatedMessage = !options.message;
    this.code = 'ERR_ASSERTION';

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, options.stackStartFn || assert);
    } else {
      var err = new Error();
      this.stack = err.stack;
    }
  }

  AssertionError.prototype = Object.create(Error.prototype);
  AssertionError.prototype.constructor = AssertionError;

  function _getMessage(err) {
    var actual = _truncate(_inspect(err.actual), 128);
    var expected = _truncate(_inspect(err.expected), 128);
    return actual + ' ' + err.operator + ' ' + expected;
  }

  function _truncate(str, length) {
    if (str.length <= length) return str;
    return str.slice(0, length) + '...';
  }

  function _inspect(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return JSON.stringify(val);
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'function') return '[Function' + (val.name ? ': ' + val.name : '') + ']';
    if (typeof val === 'symbol') return String(val);
    if (Array.isArray(val)) {
      try { return JSON.stringify(val); } catch (e) { return '[Array]'; }
    }
    if (val instanceof Error) return val.toString();
    if (val instanceof RegExp) return val.toString();
    if (val instanceof Date) return val.toISOString();
    try { return JSON.stringify(val); } catch (e) { return '[Object]'; }
  }

  function _deepEqual(a, b, strict) {
    if (strict ? a === b : a == b) return true;

    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'number') {
      if (isNaN(a) && isNaN(b)) return true;
      return false;
    }

    if (typeof a !== 'object') return false;

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    // RegExp comparison
    if (a instanceof RegExp && b instanceof RegExp) {
      return a.source === b.source && a.flags === b.flags;
    }

    // Error comparison
    if (a instanceof Error && b instanceof Error) {
      return a.message === b.message && a.name === b.name;
    }

    // Array comparison
    if (Array.isArray(a)) {
      if (!Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (!_deepEqual(a[i], b[i], strict)) return false;
      }
      return true;
    }

    if (Array.isArray(b)) return false;

    // Object comparison
    var keysA = Object.keys(a);
    var keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    keysA.sort();
    keysB.sort();

    for (var i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) return false;
    }

    for (var i = 0; i < keysA.length; i++) {
      var key = keysA[i];
      if (!_deepEqual(a[key], b[key], strict)) return false;
    }

    return true;
  }

  function assert(value, message) {
    if (!value) {
      throw new AssertionError({
        message: message || 'The expression evaluated to a falsy value',
        actual: value,
        expected: true,
        operator: '==',
        stackStartFn: assert
      });
    }
  }

  assert.ok = assert;

  assert.fail = function(message) {
    if (arguments.length === 0) {
      message = 'Failed';
    } else if (arguments.length >= 2) {
      // Legacy signature: fail(actual, expected, message, operator)
      var actual = arguments[0];
      var expected = arguments[1];
      message = arguments[2];
      var operator = arguments[3] || '!=';
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: operator,
        stackStartFn: assert.fail
      });
    }
    throw new AssertionError({
      message: String(message),
      stackStartFn: assert.fail
    });
  };

  assert.equal = function(actual, expected, message) {
    if (actual != expected) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: '==',
        stackStartFn: assert.equal
      });
    }
  };

  assert.notEqual = function(actual, expected, message) {
    if (actual == expected) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: '!=',
        stackStartFn: assert.notEqual
      });
    }
  };

  assert.strictEqual = function(actual, expected, message) {
    if (actual !== expected) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: '===',
        stackStartFn: assert.strictEqual
      });
    }
  };

  assert.notStrictEqual = function(actual, expected, message) {
    if (actual === expected) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: '!==',
        stackStartFn: assert.notStrictEqual
      });
    }
  };

  assert.deepEqual = function(actual, expected, message) {
    if (!_deepEqual(actual, expected, false)) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: 'deepEqual',
        stackStartFn: assert.deepEqual
      });
    }
  };

  assert.notDeepEqual = function(actual, expected, message) {
    if (_deepEqual(actual, expected, false)) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: 'notDeepEqual',
        stackStartFn: assert.notDeepEqual
      });
    }
  };

  assert.deepStrictEqual = function(actual, expected, message) {
    if (!_deepEqual(actual, expected, true)) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: 'deepStrictEqual',
        stackStartFn: assert.deepStrictEqual
      });
    }
  };

  assert.notDeepStrictEqual = function(actual, expected, message) {
    if (_deepEqual(actual, expected, true)) {
      throw new AssertionError({
        message: message,
        actual: actual,
        expected: expected,
        operator: 'notDeepStrictEqual',
        stackStartFn: assert.notDeepStrictEqual
      });
    }
  };

  assert.throws = function(fn, expected, message) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type function');
    }

    var threw = false;
    var actual;

    try {
      fn();
    } catch (e) {
      threw = true;
      actual = e;
    }

    if (!threw) {
      throw new AssertionError({
        message: message || 'Missing expected exception',
        actual: undefined,
        expected: expected,
        operator: 'throws',
        stackStartFn: assert.throws
      });
    }

    if (expected) {
      if (typeof expected === 'function') {
        if (expected.prototype instanceof Error || expected === Error) {
          // Check if it's an instance of expected
          if (!(actual instanceof expected)) {
            throw actual;
          }
        } else {
          // Validator function
          if (!expected(actual)) {
            throw actual;
          }
        }
      } else if (expected instanceof RegExp) {
        if (!expected.test(actual.message || String(actual))) {
          throw actual;
        }
      } else if (typeof expected === 'object') {
        var keys = Object.keys(expected);
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (!_deepEqual(actual[key], expected[key], true)) {
            throw new AssertionError({
              message: message || 'Expected values to match',
              actual: actual,
              expected: expected,
              operator: 'throws',
              stackStartFn: assert.throws
            });
          }
        }
      }
    }
  };

  assert.doesNotThrow = function(fn, expected, message) {
    if (typeof fn !== 'function') {
      throw new TypeError('The "fn" argument must be of type function');
    }

    try {
      fn();
    } catch (e) {
      if (typeof expected === 'string') {
        message = expected;
        expected = undefined;
      }

      if (expected && !(e instanceof expected)) {
        // Different error type, re-throw
        throw e;
      }

      throw new AssertionError({
        message: message || 'Got unwanted exception: ' + (e.message || e),
        actual: e,
        expected: expected,
        operator: 'doesNotThrow',
        stackStartFn: assert.doesNotThrow
      });
    }
  };

  assert.rejects = function(asyncFn, expected, message) {
    var promise;
    if (typeof asyncFn === 'function') {
      promise = asyncFn();
    } else {
      promise = asyncFn;
    }

    return Promise.resolve(promise).then(
      function() {
        throw new AssertionError({
          message: message || 'Missing expected rejection',
          actual: undefined,
          expected: expected,
          operator: 'rejects',
          stackStartFn: assert.rejects
        });
      },
      function(actual) {
        if (expected) {
          if (typeof expected === 'function') {
            if (expected.prototype instanceof Error || expected === Error) {
              if (!(actual instanceof expected)) {
                throw actual;
              }
            } else {
              if (!expected(actual)) {
                throw actual;
              }
            }
          } else if (expected instanceof RegExp) {
            if (!expected.test(actual.message || String(actual))) {
              throw actual;
            }
          }
        }
      }
    );
  };

  assert.doesNotReject = function(asyncFn, expected, message) {
    var promise;
    if (typeof asyncFn === 'function') {
      promise = asyncFn();
    } else {
      promise = asyncFn;
    }

    return Promise.resolve(promise).then(null, function(actual) {
      throw new AssertionError({
        message: message || 'Got unwanted rejection: ' + (actual.message || actual),
        actual: actual,
        expected: expected,
        operator: 'doesNotReject',
        stackStartFn: assert.doesNotReject
      });
    });
  };

  assert.ifError = function(err) {
    if (err !== null && err !== undefined) {
      var message = 'ifError got unwanted exception: ';
      if (typeof err === 'object' && typeof err.message === 'string') {
        if (err.message.length === 0 && err.constructor) {
          message += err.constructor.name;
        } else {
          message += err.message;
        }
      } else {
        message += String(err);
      }
      throw new AssertionError({
        message: message,
        actual: err,
        expected: null,
        operator: 'ifError',
        stackStartFn: assert.ifError
      });
    }
  };

  assert.match = function(string, regexp, message) {
    if (typeof string !== 'string') {
      throw new TypeError('The "string" argument must be of type string');
    }
    if (!(regexp instanceof RegExp)) {
      throw new TypeError('The "regexp" argument must be an instance of RegExp');
    }
    if (!regexp.test(string)) {
      throw new AssertionError({
        message: message || 'The input did not match the regular expression ' + regexp,
        actual: string,
        expected: regexp,
        operator: 'match',
        stackStartFn: assert.match
      });
    }
  };

  assert.doesNotMatch = function(string, regexp, message) {
    if (typeof string !== 'string') {
      throw new TypeError('The "string" argument must be of type string');
    }
    if (!(regexp instanceof RegExp)) {
      throw new TypeError('The "regexp" argument must be an instance of RegExp');
    }
    if (regexp.test(string)) {
      throw new AssertionError({
        message: message || 'The input was expected to not match the regular expression ' + regexp,
        actual: string,
        expected: regexp,
        operator: 'doesNotMatch',
        stackStartFn: assert.doesNotMatch
      });
    }
  };

  assert.AssertionError = AssertionError;

  // Strict mode
  assert.strict = function(value, message) {
    if (!value) {
      throw new AssertionError({
        message: message || 'The expression evaluated to a falsy value',
        actual: value,
        expected: true,
        operator: '===',
        stackStartFn: assert.strict
      });
    }
  };
  assert.strict.ok = assert.strict;
  assert.strict.equal = assert.strictEqual;
  assert.strict.notEqual = assert.notStrictEqual;
  assert.strict.deepEqual = assert.deepStrictEqual;
  assert.strict.notDeepEqual = assert.notDeepStrictEqual;
  assert.strict.throws = assert.throws;
  assert.strict.doesNotThrow = assert.doesNotThrow;
  assert.strict.rejects = assert.rejects;
  assert.strict.doesNotReject = assert.doesNotReject;
  assert.strict.ifError = assert.ifError;
  assert.strict.match = assert.match;
  assert.strict.doesNotMatch = assert.doesNotMatch;
  assert.strict.fail = assert.fail;
  assert.strict.AssertionError = AssertionError;
  assert.strict.strict = assert.strict;

  module.exports = assert;
})();
`;
}
