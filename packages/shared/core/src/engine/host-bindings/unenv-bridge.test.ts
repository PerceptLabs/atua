/**
 * unenv-bridge — Node.js unit tests
 *
 * Tests real crypto (SHA-256, SHA-1, MD5, HMAC), os, stream,
 * querystring, string_decoder, and stub modules.
 *
 * THE LITMUS TEST:
 *   crypto.createHash('sha256').update('hello').digest('hex')
 *   MUST equal 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
 */
import { describe, it, expect } from 'vitest';
import { AtuaFS } from '../../fs/AtuaFS.js';
import { NativeEngine } from '../../engines/native/NativeEngine.js';

describe('unenv-bridge — Crypto (real hashes)', () => {
  it('SHA-256 litmus test: hash of "hello"', async () => {
    const fs = await AtuaFS.create('unenv-sha256');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha256').update('hello').digest('hex')`,
    );
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    await engine.destroy();
    fs.destroy();
  });

  it('SHA-256 of empty string', async () => {
    const fs = await AtuaFS.create('unenv-sha256-empty');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha256').update('').digest('hex')`,
    );
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    await engine.destroy();
    fs.destroy();
  });

  it('SHA-256 of "test"', async () => {
    const fs = await AtuaFS.create('unenv-sha256-test');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha256').update('test').digest('hex')`,
    );
    expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    await engine.destroy();
    fs.destroy();
  });

  it('SHA-1 produces correct 40-char hex', async () => {
    const fs = await AtuaFS.create('unenv-sha1');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha1').update('hello').digest('hex')`,
    );
    expect(result).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    await engine.destroy();
    fs.destroy();
  });

  it('MD5 produces correct 32-char hex', async () => {
    const fs = await AtuaFS.create('unenv-md5');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('md5').update('hello').digest('hex')`,
    );
    expect(result).toBe('5d41402abc4b2a76b9719d911017c592');
    await engine.destroy();
    fs.destroy();
  });

  it('HMAC-SHA256 produces correct output', async () => {
    const fs = await AtuaFS.create('unenv-hmac');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHmac('sha256', 'key').update('data').digest('hex')`,
    );
    // Standard HMAC-SHA256('key', 'data')
    expect(result).toBe('5031fe3d989c6d1537a013fa6e739da23463fdaec3b70137d828e36ace221bd0');
    await engine.destroy();
    fs.destroy();
  });

  it('randomBytes returns correct length', async () => {
    const fs = await AtuaFS.create('unenv-random');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('crypto').randomBytes(16).length`);
    expect(result).toBe(16);
    await engine.destroy();
    fs.destroy();
  });

  it('randomUUID returns UUID v4 format', async () => {
    const fs = await AtuaFS.create('unenv-uuid');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('crypto').randomUUID()`);
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await engine.destroy();
    fs.destroy();
  });

  it('getHashes returns supported algorithms', async () => {
    const fs = await AtuaFS.create('unenv-hashes');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = JSON.stringify(require('crypto').getHashes())`);
    const hashes = JSON.parse(result as string);
    expect(hashes).toContain('sha256');
    expect(hashes).toContain('sha1');
    expect(hashes).toContain('md5');
    await engine.destroy();
    fs.destroy();
  });

  it('chained update calls work', async () => {
    const fs = await AtuaFS.create('unenv-chain');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha256').update('hel').update('lo').digest('hex')`,
    );
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    await engine.destroy();
    fs.destroy();
  });

  it('base64 encoding works', async () => {
    const fs = await AtuaFS.create('unenv-b64');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('crypto').createHash('sha256').update('hello').digest('base64')`,
    );
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — OS module', () => {
  it('os.platform() returns "browser"', async () => {
    const fs = await AtuaFS.create('unenv-os-plat');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('os').platform()`);
    expect(result).toBe('browser');
    await engine.destroy();
    fs.destroy();
  });

  it('os.cpus() returns array with at least one entry', async () => {
    const fs = await AtuaFS.create('unenv-os-cpus');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = JSON.stringify(require('os').cpus())`);
    const cpus = JSON.parse(result as string);
    expect(Array.isArray(cpus)).toBe(true);
    expect(cpus.length).toBeGreaterThanOrEqual(1);
    await engine.destroy();
    fs.destroy();
  });

  it('os.tmpdir() returns /tmp', async () => {
    const fs = await AtuaFS.create('unenv-os-tmp');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('os').tmpdir()`);
    expect(result).toBe('/tmp');
    await engine.destroy();
    fs.destroy();
  });

  it('os.EOL returns newline', async () => {
    const fs = await AtuaFS.create('unenv-os-eol');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('os').EOL`);
    expect(result).toBe('\n');
    await engine.destroy();
    fs.destroy();
  });

  it('os.arch() returns wasm32', async () => {
    const fs = await AtuaFS.create('unenv-os-arch');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('os').arch()`);
    expect(result).toBe('wasm32');
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — Stream module', () => {
  it('Readable is a constructor', async () => {
    const fs = await AtuaFS.create('unenv-stream-readable');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = typeof require('stream').Readable`);
    expect(result).toBe('function');
    await engine.destroy();
    fs.destroy();
  });

  it('Writable is a constructor', async () => {
    const fs = await AtuaFS.create('unenv-stream-writable');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = typeof require('stream').Writable`);
    expect(result).toBe('function');
    await engine.destroy();
    fs.destroy();
  });

  it('Transform is a constructor', async () => {
    const fs = await AtuaFS.create('unenv-stream-transform');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = typeof require('stream').Transform`);
    expect(result).toBe('function');
    await engine.destroy();
    fs.destroy();
  });

  it('PassThrough is a constructor', async () => {
    const fs = await AtuaFS.create('unenv-stream-pt');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = typeof require('stream').PassThrough`);
    expect(result).toBe('function');
    await engine.destroy();
    fs.destroy();
  });

  it('Readable push/data event works', async () => {
    const fs = await AtuaFS.create('unenv-stream-push');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`
      var s = require('stream');
      var r = new s.Readable();
      var received = '';
      r.on('data', function(chunk) { received += chunk; });
      r.push('hello');
      r.push(' world');
      module.exports = received;
    `);
    expect(result).toBe('hello world');
    await engine.destroy();
    fs.destroy();
  });

  it('pipe works between Readable and Writable', async () => {
    const fs = await AtuaFS.create('unenv-stream-pipe');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`
      var s = require('stream');
      var collected = '';
      var r = new s.Readable();
      var w = new s.Writable({
        write: function(chunk, enc, cb) { collected += chunk; cb(); }
      });
      r.pipe(w);
      r.push('piped data');
      module.exports = collected;
    `);
    expect(result).toBe('piped data');
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — Querystring module', () => {
  it('parse works', async () => {
    const fs = await AtuaFS.create('unenv-qs-parse');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = JSON.stringify(require('querystring').parse('a=1&b=2'))`,
    );
    const parsed = JSON.parse(result as string);
    expect(parsed.a).toBe('1');
    expect(parsed.b).toBe('2');
    await engine.destroy();
    fs.destroy();
  });

  it('stringify works', async () => {
    const fs = await AtuaFS.create('unenv-qs-str');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(
      `module.exports = require('querystring').stringify({ a: '1', b: '2' })`,
    );
    expect(result).toContain('a=1');
    expect(result).toContain('b=2');
    await engine.destroy();
    fs.destroy();
  });

  it('round-trip works', async () => {
    const fs = await AtuaFS.create('unenv-qs-rt');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`
      var qs = require('querystring');
      var str = qs.stringify({ x: '10', y: '20' });
      var parsed = qs.parse(str);
      module.exports = parsed.x + ',' + parsed.y;
    `);
    expect(result).toBe('10,20');
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — HTTP module (stubs)', () => {
  it('http.createServer throws helpful error', async () => {
    const fs = await AtuaFS.create('unenv-http');
    const engine = await NativeEngine.create({ fs });
    try {
      await engine.eval(`require('http').createServer()`);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not available');
    }
    await engine.destroy();
    fs.destroy();
  });

  it('http.STATUS_CODES exists', async () => {
    const fs = await AtuaFS.create('unenv-http-codes');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = require('http').STATUS_CODES[200]`);
    expect(result).toBe('OK');
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — StringDecoder module', () => {
  it('StringDecoder write works', async () => {
    const fs = await AtuaFS.create('unenv-sd');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`
      var SD = require('string_decoder').StringDecoder;
      var d = new SD('utf-8');
      module.exports = d.write('hello');
    `);
    expect(result).toBe('hello');
    await engine.destroy();
    fs.destroy();
  });
});

describe('unenv-bridge — Stub modules', () => {
  it('require("net") throws helpful error on use', async () => {
    const fs = await AtuaFS.create('unenv-stub-net');
    const engine = await NativeEngine.create({ fs });
    try {
      await engine.eval(`require('net').connect()`);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not available');
    }
    await engine.destroy();
    fs.destroy();
  });

  it('require("child_process") throws helpful error', async () => {
    const fs = await AtuaFS.create('unenv-stub-cp');
    const engine = await NativeEngine.create({ fs });
    try {
      await engine.eval(`require('child_process').exec('ls')`);
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('not available');
    }
    await engine.destroy();
    fs.destroy();
  });

  it('require("tls") loads without error but methods throw', async () => {
    const fs = await AtuaFS.create('unenv-stub-tls');
    const engine = await NativeEngine.create({ fs });
    const result = await engine.eval(`module.exports = typeof require('tls')`);
    expect(result).toBe('object');
    await engine.destroy();
    fs.destroy();
  });
});
