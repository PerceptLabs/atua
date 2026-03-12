/**
 * CatalystEngine — Node tests
 * Tests pure logic: require resolution, host binding source generation,
 * path module, Buffer polyfill, EventEmitter, assert, util
 */
import { describe, it, expect } from 'vitest';

describe('Host Binding Sources', () => {
  it('path module source should be valid JS', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const src = getPathSource();
    expect(typeof src).toBe('string');
    expect(src.length).toBeGreaterThan(100);
    // Should contain module.exports
    expect(src).toContain('module.exports');
  });

  it('events module source should define EventEmitter', async () => {
    const { getEventsSource } = await import('./host-bindings/events.js');
    const src = getEventsSource();
    expect(src).toContain('EventEmitter');
    expect(src).toContain('module.exports');
    expect(src).toContain('emit');
    expect(src).toContain('on');
    expect(src).toContain('removeListener');
  });

  it('buffer module source should define Buffer', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const src = getBufferSource();
    expect(src).toContain('Buffer');
    expect(src).toContain('from');
    expect(src).toContain('alloc');
    expect(src).toContain('concat');
    expect(src).toContain('toString');
  });

  it('process module source should include env', async () => {
    const { getProcessSource } = await import('./host-bindings/process.js');
    const src = getProcessSource({ NODE_ENV: 'test' });
    expect(src).toContain('NODE_ENV');
    expect(src).toContain('test');
    expect(src).toContain('module.exports');
  });

  it('assert module source should define assert functions', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const src = getAssertSource();
    expect(src).toContain('strictEqual');
    expect(src).toContain('deepEqual');
    expect(src).toContain('throws');
    expect(src).toContain('module.exports');
  });

  it('util module source should define format/inspect', async () => {
    const { getUtilSource } = await import('./host-bindings/util.js');
    const src = getUtilSource();
    expect(src).toContain('format');
    expect(src).toContain('inspect');
    expect(src).toContain('inherits');
    expect(src).toContain('promisify');
  });

  it('url module source should define URL', async () => {
    const { getUrlSource } = await import('./host-bindings/url.js');
    const src = getUrlSource();
    expect(src).toContain('URL');
    expect(src).toContain('URLSearchParams');
    expect(src).toContain('module.exports');
  });

  it('crypto module source should define randomBytes', async () => {
    const { getUnenvCryptoSource } = await import('./host-bindings/unenv-bridge.js');
    const src = getUnenvCryptoSource();
    expect(src).toContain('randomBytes');
    expect(src).toContain('randomUUID');
    expect(src).toContain('createHash');
    expect(src).toContain('createHmac');
  });

  it('timers module source should define setTimeout/setInterval', async () => {
    const { getTimersSource } = await import('./host-bindings/timers.js');
    const src = getTimersSource();
    expect(src).toContain('setTimeout');
    expect(src).toContain('clearTimeout');
    expect(src).toContain('setInterval');
    expect(src).toContain('clearInterval');
    expect(src).toContain('setImmediate');
  });

  it('console module source should define log/error/warn', async () => {
    const { getConsoleSource } = await import('./host-bindings/console.js');
    const src = getConsoleSource();
    expect(src).toContain('log');
    expect(src).toContain('error');
    expect(src).toContain('warn');
    expect(src).toContain('info');
    expect(src).toContain('debug');
  });
});

describe('Path Module Logic', () => {
  // Test path logic by evaluating the source directly
  it('path.join should concatenate paths', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    const fn = new Function('module', getPathSource());
    fn(module);
    const path = module.exports;
    expect(path.join('a', 'b')).toBe('a/b');
    expect(path.join('/a', 'b', 'c')).toBe('/a/b/c');
    expect(path.join('a', '../b')).toBe('b');
  });

  it('path.basename should return filename', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    expect(path.basename('/foo/bar/baz.txt')).toBe('baz.txt');
    expect(path.basename('/foo/bar/baz.txt', '.txt')).toBe('baz');
  });

  it('path.dirname should return directory', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    expect(path.dirname('/foo/bar/baz.txt')).toBe('/foo/bar');
    expect(path.dirname('foo/bar')).toBe('foo');
  });

  it('path.extname should return extension', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    expect(path.extname('file.txt')).toBe('.txt');
    expect(path.extname('file.tar.gz')).toBe('.gz');
    expect(path.extname('noext')).toBe('');
  });

  it('path.normalize should clean paths', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    expect(path.normalize('/a//b/../c')).toBe('/a/c');
    expect(path.normalize('a/./b')).toBe('a/b');
  });

  it('path.isAbsolute should detect absolute paths', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    expect(path.isAbsolute('/foo')).toBe(true);
    expect(path.isAbsolute('foo')).toBe(false);
  });

  it('path.parse should decompose paths', async () => {
    const { getPathSource } = await import('./host-bindings/path.js');
    const module = { exports: {} as any };
    new Function('module', getPathSource())(module);
    const path = module.exports;
    const parsed = path.parse('/home/user/file.txt');
    expect(parsed.root).toBe('/');
    expect(parsed.dir).toBe('/home/user');
    expect(parsed.base).toBe('file.txt');
    expect(parsed.ext).toBe('.txt');
    expect(parsed.name).toBe('file');
  });
});

describe('EventEmitter Logic', () => {
  it('should emit and receive events', async () => {
    const { getEventsSource } = await import('./host-bindings/events.js');
    const module = { exports: {} as any };
    new Function('module', getEventsSource())(module);
    const EventEmitter = module.exports;
    const ee = new EventEmitter();

    const received: string[] = [];
    ee.on('test', (data: string) => received.push(data));
    ee.emit('test', 'hello');
    ee.emit('test', 'world');

    expect(received).toEqual(['hello', 'world']);
  });

  it('should support once listeners', async () => {
    const { getEventsSource } = await import('./host-bindings/events.js');
    const module = { exports: {} as any };
    new Function('module', getEventsSource())(module);
    const EventEmitter = module.exports;
    const ee = new EventEmitter();

    let count = 0;
    ee.once('fire', () => count++);
    ee.emit('fire');
    ee.emit('fire');

    expect(count).toBe(1);
  });

  it('should remove listeners', async () => {
    const { getEventsSource } = await import('./host-bindings/events.js');
    const module = { exports: {} as any };
    new Function('module', getEventsSource())(module);
    const EventEmitter = module.exports;
    const ee = new EventEmitter();

    let count = 0;
    const handler = () => count++;
    ee.on('test', handler);
    ee.emit('test');
    ee.removeListener('test', handler);
    ee.emit('test');

    expect(count).toBe(1);
  });

  it('should track listener count', async () => {
    const { getEventsSource } = await import('./host-bindings/events.js');
    const module = { exports: {} as any };
    new Function('module', getEventsSource())(module);
    const EventEmitter = module.exports;
    const ee = new EventEmitter();

    ee.on('a', () => {});
    ee.on('a', () => {});
    ee.on('b', () => {});

    expect(ee.listenerCount('a')).toBe(2);
    expect(ee.listenerCount('b')).toBe(1);
    expect(ee.listenerCount('c')).toBe(0);
  });
});

describe('Assert Logic', () => {
  it('assert.ok should pass on truthy values', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const module = { exports: {} as any };
    new Function('module', getAssertSource())(module);
    const assert = module.exports;

    expect(() => assert.ok(true)).not.toThrow();
    expect(() => assert.ok(1)).not.toThrow();
    expect(() => assert.ok('hello')).not.toThrow();
  });

  it('assert.ok should fail on falsy values', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const module = { exports: {} as any };
    new Function('module', getAssertSource())(module);
    const assert = module.exports;

    expect(() => assert.ok(false)).toThrow();
    expect(() => assert.ok(0)).toThrow();
    expect(() => assert.ok('')).toThrow();
  });

  it('assert.strictEqual should use strict comparison', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const module = { exports: {} as any };
    new Function('module', getAssertSource())(module);
    const assert = module.exports;

    expect(() => assert.strictEqual(1, 1)).not.toThrow();
    expect(() => assert.strictEqual(1, '1')).toThrow();
  });

  it('assert.deepEqual should compare objects', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const module = { exports: {} as any };
    new Function('module', getAssertSource())(module);
    const assert = module.exports;

    expect(() => assert.deepEqual({ a: 1 }, { a: 1 })).not.toThrow();
    expect(() => assert.deepEqual([1, 2], [1, 2])).not.toThrow();
    expect(() => assert.deepEqual({ a: 1 }, { a: 2 })).toThrow();
  });

  it('assert.throws should catch expected exceptions', async () => {
    const { getAssertSource } = await import('./host-bindings/assert.js');
    const module = { exports: {} as any };
    new Function('module', getAssertSource())(module);
    const assert = module.exports;

    expect(() => assert.throws(() => { throw new Error('boom'); })).not.toThrow();
    expect(() => assert.throws(() => {})).toThrow();
  });
});

describe('Util Logic', () => {
  it('util.format should format strings', async () => {
    const { getUtilSource } = await import('./host-bindings/util.js');
    const module = { exports: {} as any };
    new Function('module', getUtilSource())(module);
    const util = module.exports;

    expect(util.format('hello %s', 'world')).toBe('hello world');
    expect(util.format('count: %d', 42)).toBe('count: 42');
  });

  it('util.inspect should stringify values', async () => {
    const { getUtilSource } = await import('./host-bindings/util.js');
    const module = { exports: {} as any };
    new Function('module', getUtilSource())(module);
    const util = module.exports;

    expect(util.inspect(null)).toBe('null');
    expect(util.inspect(undefined)).toBe('undefined');
    expect(util.inspect(42)).toBe('42');
    expect(util.inspect('hello')).toBe("'hello'");
    expect(util.inspect([])).toBe('[]');
  });

  it('util.inherits should set up prototype chain', async () => {
    const { getUtilSource } = await import('./host-bindings/util.js');
    const module = { exports: {} as any };
    new Function('module', getUtilSource())(module);
    const util = module.exports;

    function Parent(this: any) { this.x = 1; }
    Parent.prototype.hello = function() { return 'hi'; };
    function Child(this: any) { (Parent as any).call(this); }
    util.inherits(Child, Parent);

    const child = new (Child as any)();
    expect(child.hello()).toBe('hi');
    expect(child.x).toBe(1);
  });
});

describe('Buffer Logic', () => {
  it('Buffer.from should encode strings', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const module = { exports: {} as any };
    new Function('module', getBufferSource())(module);
    const { Buffer } = module.exports;

    const buf = Buffer.from('hello');
    expect(buf.length).toBe(5);
    expect(buf.toString()).toBe('hello');
  });

  it('Buffer.alloc should create zero-filled buffer', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const module = { exports: {} as any };
    new Function('module', getBufferSource())(module);
    const { Buffer } = module.exports;

    const buf = Buffer.alloc(10);
    expect(buf.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(buf._data[i]).toBe(0);
    }
  });

  it('Buffer hex encoding should work', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const module = { exports: {} as any };
    new Function('module', getBufferSource())(module);
    const { Buffer } = module.exports;

    const buf = Buffer.from('hello');
    const hex = buf.toString('hex');
    expect(hex).toBe('68656c6c6f');
    const buf2 = Buffer.from(hex, 'hex');
    expect(buf2.toString()).toBe('hello');
  });

  it('Buffer.concat should merge buffers', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const module = { exports: {} as any };
    new Function('module', getBufferSource())(module);
    const { Buffer } = module.exports;

    const a = Buffer.from('hello ');
    const b = Buffer.from('world');
    const c = Buffer.concat([a, b]);
    expect(c.toString()).toBe('hello world');
  });

  it('Buffer.isBuffer should identify buffers', async () => {
    const { getBufferSource } = await import('./host-bindings/buffer.js');
    const module = { exports: {} as any };
    new Function('module', getBufferSource())(module);
    const { Buffer } = module.exports;

    expect(Buffer.isBuffer(Buffer.from('x'))).toBe(true);
    expect(Buffer.isBuffer('x')).toBe(false);
    expect(Buffer.isBuffer(null)).toBe(false);
  });
});

describe('Process Module Logic', () => {
  it('should include provided env vars', async () => {
    const { getProcessSource } = await import('./host-bindings/process.js');
    const module = { exports: {} as any };
    new Function('module', getProcessSource({ NODE_ENV: 'production', FOO: 'bar' }))(module);
    const process = module.exports;

    expect(process.env.NODE_ENV).toBe('production');
    expect(process.env.FOO).toBe('bar');
    expect(process.platform).toBe('browser');
    expect(process.arch).toBe('wasm');
  });

  it('should have cwd() returning /', async () => {
    const { getProcessSource } = await import('./host-bindings/process.js');
    const module = { exports: {} as any };
    new Function('module', getProcessSource())(module);
    const process = module.exports;

    expect(process.cwd()).toBe('/');
  });

  it('should support hrtime', async () => {
    const { getProcessSource } = await import('./host-bindings/process.js');
    const module = { exports: {} as any };
    new Function('module', getProcessSource())(module);
    const process = module.exports;

    const t = process.hrtime();
    expect(Array.isArray(t)).toBe(true);
    expect(t.length).toBe(2);
    expect(typeof t[0]).toBe('number');
  });
});
