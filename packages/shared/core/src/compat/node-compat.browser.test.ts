/**
 * Node.js Compatibility Matrix — Browser test (Phase 13a: provider-tagged)
 *
 * Runs Node.js API calls through AtuaEngine in real Chromium.
 * Reports PASS / FAIL / NOT_IMPLEMENTED per method with provider attribution.
 * Generates a compatibility report with percentages and provider breakdown.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { AtuaFS } from '../fs/AtuaFS.js';
import { NativeEngine } from '../engines/native/NativeEngine.js';
import { PROVIDER_REGISTRY } from '../engine/host-bindings/unenv-bridge.js';

interface CompatResult {
  module: string;
  method: string;
  status: 'PASS' | 'FAIL' | 'NOT_IMPLEMENTED' | 'NOT_POSSIBLE';
  provider: 'atua' | 'unenv' | 'stub' | 'not_possible';
}

const results: CompatResult[] = [];

function getProvider(mod: string, method: string): CompatResult['provider'] {
  const modRegistry = PROVIDER_REGISTRY[mod];
  if (!modRegistry) return 'atua';
  return (modRegistry[method] as CompatResult['provider']) || 'atua';
}

function record(module: string, method: string, status: CompatResult['status']) {
  const provider = getProvider(module, method);
  results.push({ module, method, status, provider });
}

let engine: NativeEngine;
let fs: AtuaFS;

// Shared engine for all compat tests
const setup = (async () => {
  fs = await AtuaFS.create('compat-node-' + Date.now());
  fs.writeFileSync('/test.txt', 'hello world');
  fs.mkdirSync('/testdir', { recursive: true });
  fs.writeFileSync('/testdir/a.txt', 'aaa');
  fs.writeFileSync('/testdir/b.txt', 'bbb');
  engine = await NativeEngine.create({ fs });
})();

async function evalSafe(code: string): Promise<any> {
  await setup;
  try {
    return await engine.eval(`module.exports = eval(${JSON.stringify(code)})`);
  } catch {
    return undefined;
  }
}

async function testMethod(
  module: string,
  method: string,
  code: string,
  validator: (result: any) => boolean,
) {
  const result = await evalSafe(code);
  if (result === undefined) {
    record(module, method, 'NOT_IMPLEMENTED');
  } else if (validator(result)) {
    record(module, method, 'PASS');
  } else {
    record(module, method, 'FAIL');
  }
}

// ---- fs module ----

describe('Node.js Compat — fs', () => {
  it('fs.readFileSync', async () => {
    await testMethod('fs', 'readFileSync', `require('fs').readFileSync('/test.txt', 'utf-8')`, (r) => r === 'hello world');
  });
  it('fs.writeFileSync', async () => {
    await testMethod('fs', 'writeFileSync', `require('fs').writeFileSync('/compat-write.txt', 'test'); require('fs').readFileSync('/compat-write.txt', 'utf-8')`, (r) => r === 'test');
  });
  it('fs.existsSync', async () => {
    await testMethod('fs', 'existsSync', `require('fs').existsSync('/test.txt')`, (r) => r === true);
  });
  it('fs.mkdirSync', async () => {
    await testMethod('fs', 'mkdirSync', `require('fs').mkdirSync('/compat-dir', { recursive: true }); require('fs').existsSync('/compat-dir')`, (r) => r === true);
  });
  it('fs.readdirSync', async () => {
    await testMethod('fs', 'readdirSync', `JSON.stringify(require('fs').readdirSync('/testdir'))`, (r) => { try { const arr = JSON.parse(r); return Array.isArray(arr) && arr.length >= 2; } catch { return false; } });
  });
  it('fs.statSync', async () => {
    await testMethod('fs', 'statSync', `JSON.stringify(require('fs').statSync('/test.txt'))`, (r) => { try { const s = JSON.parse(r); return 'isFile' in s; } catch { return false; } });
  });
  it('fs.unlinkSync', async () => {
    await testMethod('fs', 'unlinkSync', `require('fs').writeFileSync('/compat-del.txt', 'x'); require('fs').unlinkSync('/compat-del.txt'); !require('fs').existsSync('/compat-del.txt')`, (r) => r === true);
  });
  it('fs.renameSync', async () => {
    await testMethod('fs', 'renameSync', `require('fs').writeFileSync('/compat-ren.txt', 'x'); require('fs').renameSync('/compat-ren.txt', '/compat-renamed.txt'); require('fs').existsSync('/compat-renamed.txt')`, (r) => r === true);
  });
  it('fs.copyFileSync', async () => {
    await testMethod('fs', 'copyFileSync', `require('fs').writeFileSync('/compat-cp.txt', 'copy'); require('fs').copyFileSync('/compat-cp.txt', '/compat-cp2.txt'); require('fs').readFileSync('/compat-cp2.txt', 'utf-8')`, (r) => r === 'copy');
  });
  it('fs.appendFileSync', async () => {
    await testMethod('fs', 'appendFileSync', `require('fs').writeFileSync('/compat-app.txt', 'a'); require('fs').appendFileSync('/compat-app.txt', 'b'); require('fs').readFileSync('/compat-app.txt', 'utf-8')`, (r) => r === 'ab');
  });
  it('fs.rmdirSync', async () => {
    await testMethod('fs', 'rmdirSync', `require('fs').mkdirSync('/compat-rmdir'); require('fs').rmdirSync('/compat-rmdir'); !require('fs').existsSync('/compat-rmdir')`, (r) => r === true);
  });
});

// ---- path module ----

describe('Node.js Compat — path', () => {
  it('path.join', async () => {
    await testMethod('path', 'join', `require('path').join('/foo', 'bar', 'baz')`, (r) => r === '/foo/bar/baz');
  });
  it('path.resolve', async () => {
    await testMethod('path', 'resolve', `require('path').resolve('/foo', './bar')`, (r) => r === '/foo/bar');
  });
  it('path.basename', async () => {
    await testMethod('path', 'basename', `require('path').basename('/foo/bar/baz.txt')`, (r) => r === 'baz.txt');
  });
  it('path.dirname', async () => {
    await testMethod('path', 'dirname', `require('path').dirname('/foo/bar/baz.txt')`, (r) => r === '/foo/bar');
  });
  it('path.extname', async () => {
    await testMethod('path', 'extname', `require('path').extname('file.ts')`, (r) => r === '.ts');
  });
  it('path.normalize', async () => {
    await testMethod('path', 'normalize', `require('path').normalize('/foo//bar/../baz')`, (r) => r === '/foo/baz');
  });
  it('path.isAbsolute', async () => {
    await testMethod('path', 'isAbsolute', `require('path').isAbsolute('/foo')`, (r) => r === true);
  });
  it('path.sep', async () => {
    await testMethod('path', 'sep', `require('path').sep`, (r) => r === '/');
  });
  it('path.parse', async () => {
    await testMethod('path', 'parse', `JSON.stringify(require('path').parse('/foo/bar.txt'))`, (r) => { try { const p = JSON.parse(r); return p.base === 'bar.txt'; } catch { return false; } });
  });
});

// ---- buffer module ----

describe('Node.js Compat — buffer', () => {
  it('Buffer.from string', async () => {
    await testMethod('buffer', 'Buffer.from(string)', `require('buffer').Buffer.from('hello').toString()`, (r) => r === 'hello');
  });
  it('Buffer.alloc', async () => {
    await testMethod('buffer', 'Buffer.alloc', `require('buffer').Buffer.alloc(4).length`, (r) => r === 4);
  });
  it('Buffer.isBuffer', async () => {
    await testMethod('buffer', 'Buffer.isBuffer', `var B = require('buffer').Buffer; B.isBuffer(B.from('x'))`, (r) => r === true);
  });
  it('Buffer.concat', async () => {
    await testMethod('buffer', 'Buffer.concat', `var B = require('buffer').Buffer; B.concat([B.from('a'), B.from('b')]).toString()`, (r) => r === 'ab');
  });
});

// ---- events module ----

describe('Node.js Compat — events', () => {
  it('EventEmitter on/emit', async () => {
    await testMethod('events', 'on/emit', `var EE = require('events'); var e = new EE(); var v = 0; e.on('x', function(n) { v = n; }); e.emit('x', 42); v`, (r) => r === 42);
  });
  it('EventEmitter once', async () => {
    await testMethod('events', 'once', `var EE = require('events'); var e = new EE(); var c = 0; e.once('x', function() { c++; }); e.emit('x'); e.emit('x'); c`, (r) => r === 1);
  });
  it('EventEmitter removeAllListeners', async () => {
    await testMethod('events', 'removeAllListeners', `var EE = require('events'); var e = new EE(); e.on('x', function(){}); e.removeAllListeners('x'); e.listenerCount('x')`, (r) => r === 0);
  });
  it('EventEmitter listenerCount', async () => {
    await testMethod('events', 'listenerCount', `var EE = require('events'); var e = new EE(); e.on('x', function(){}); e.on('x', function(){}); e.listenerCount('x')`, (r) => r === 2);
  });
});

// ---- process module ----

describe('Node.js Compat — process', () => {
  it('process.env', async () => {
    await testMethod('process', 'env', `typeof require('process').env`, (r) => r === 'object');
  });
  it('process.cwd', async () => {
    await testMethod('process', 'cwd()', `typeof require('process').cwd()`, (r) => r === 'string');
  });
  it('process.platform', async () => {
    await testMethod('process', 'platform', `require('process').platform`, (r) => r === 'browser');
  });
  it('process.version', async () => {
    await testMethod('process', 'version', `typeof require('process').version`, (r) => r === 'string');
  });
});

// ---- assert module ----

describe('Node.js Compat — assert', () => {
  it('assert.ok', async () => {
    await testMethod('assert', 'ok', `require('assert').ok(true); 'passed'`, (r) => r === 'passed');
  });
  it('assert.equal', async () => {
    await testMethod('assert', 'equal', `require('assert').equal(1, 1); 'passed'`, (r) => r === 'passed');
  });
  it('assert.strictEqual', async () => {
    await testMethod('assert', 'strictEqual', `require('assert').strictEqual(1, 1); 'passed'`, (r) => r === 'passed');
  });
  it('assert.deepEqual', async () => {
    await testMethod('assert', 'deepEqual', `require('assert').deepEqual({a:1}, {a:1}); 'passed'`, (r) => r === 'passed');
  });
});

// ---- crypto module (unenv — real hashes) ----

describe('Node.js Compat — crypto', () => {
  it('crypto.randomUUID', async () => {
    await testMethod('crypto', 'randomUUID', `require('crypto').randomUUID()`, (r) => typeof r === 'string' && r.length === 36);
  });
  it('crypto.randomBytes', async () => {
    await testMethod('crypto', 'randomBytes', `require('crypto').randomBytes(16).length`, (r) => r === 16);
  });
  it('crypto.createHash (SHA-256 litmus)', async () => {
    await testMethod('crypto', 'createHash', `require('crypto').createHash('sha256').update('hello').digest('hex')`, (r) => r === '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('crypto.createHmac', async () => {
    await testMethod('crypto', 'createHmac', `require('crypto').createHmac('sha256', 'key').update('data').digest('hex')`, (r) => typeof r === 'string' && r.length === 64);
  });
  it('crypto.randomInt', async () => {
    await testMethod('crypto', 'randomInt', `require('crypto').randomInt(0, 100)`, (r) => typeof r === 'number' && r >= 0 && r < 100);
  });
  it('crypto.getHashes', async () => {
    await testMethod('crypto', 'getHashes', `JSON.stringify(require('crypto').getHashes())`, (r) => { try { const h = JSON.parse(r); return h.includes('sha256'); } catch { return false; } });
  });
  it('crypto.timingSafeEqual', async () => {
    await testMethod('crypto', 'timingSafeEqual', `
      var c = require('crypto');
      var a = c.randomBytes(8);
      c.timingSafeEqual(a, a);
    `, (r) => r === true);
  });
});

// ---- util module ----

describe('Node.js Compat — util', () => {
  it('util.format', async () => {
    await testMethod('util', 'format', `require('util').format('hello %s', 'world')`, (r) => r === 'hello world');
  });
  it('util.inspect', async () => {
    await testMethod('util', 'inspect', `require('util').inspect({a: 1})`, (r) => typeof r === 'string' && r.includes('a'));
  });
});

// ---- url module ----

describe('Node.js Compat — url', () => {
  it('URL constructor', async () => {
    await testMethod('url', 'URL', `var u = new (require('url').URL)('https://example.com/path'); u.hostname`, (r) => r === 'example.com');
  });
  it('URLSearchParams', async () => {
    await testMethod('url', 'URLSearchParams', `var s = new (require('url').URLSearchParams)('a=1&b=2'); s.get('a')`, (r) => r === '1');
  });
});

// ---- console module ----

describe('Node.js Compat — console', () => {
  it('console.log', async () => {
    await testMethod('console', 'log', `console.log('test'); 'ok'`, (r) => r === 'ok');
  });
  it('console.error', async () => {
    await testMethod('console', 'error', `console.error('test'); 'ok'`, (r) => r === 'ok');
  });
  it('console.warn', async () => {
    await testMethod('console', 'warn', `console.warn('test'); 'ok'`, (r) => r === 'ok');
  });
});

// ---- NEW: os module (unenv) ----

describe('Node.js Compat — os', () => {
  it('os.platform', async () => {
    await testMethod('os', 'platform', `require('os').platform()`, (r) => typeof r === 'string');
  });
  it('os.arch', async () => {
    await testMethod('os', 'arch', `require('os').arch()`, (r) => typeof r === 'string');
  });
  it('os.tmpdir', async () => {
    await testMethod('os', 'tmpdir', `require('os').tmpdir()`, (r) => typeof r === 'string');
  });
  it('os.hostname', async () => {
    await testMethod('os', 'hostname', `require('os').hostname()`, (r) => typeof r === 'string');
  });
  it('os.cpus', async () => {
    await testMethod('os', 'cpus', `JSON.stringify(require('os').cpus())`, (r) => { try { return JSON.parse(r).length >= 1; } catch { return false; } });
  });
  it('os.EOL', async () => {
    await testMethod('os', 'EOL', `require('os').EOL`, (r) => r === '\n');
  });
  it('os.totalmem', async () => {
    await testMethod('os', 'totalmem', `require('os').totalmem()`, (r) => typeof r === 'number' && r > 0);
  });
  it('os.freemem', async () => {
    await testMethod('os', 'freemem', `require('os').freemem()`, (r) => typeof r === 'number' && r > 0);
  });
  it('os.uptime', async () => {
    await testMethod('os', 'uptime', `require('os').uptime()`, (r) => typeof r === 'number' && r >= 0);
  });
  it('os.type', async () => {
    await testMethod('os', 'type', `require('os').type()`, (r) => typeof r === 'string');
  });
  it('os.homedir', async () => {
    await testMethod('os', 'homedir', `require('os').homedir()`, (r) => typeof r === 'string');
  });
});

// ---- NEW: stream module (unenv) ----

describe('Node.js Compat — stream', () => {
  it('stream.Readable', async () => {
    await testMethod('stream', 'Readable', `typeof require('stream').Readable`, (r) => r === 'function');
  });
  it('stream.Writable', async () => {
    await testMethod('stream', 'Writable', `typeof require('stream').Writable`, (r) => r === 'function');
  });
  it('stream.Transform', async () => {
    await testMethod('stream', 'Transform', `typeof require('stream').Transform`, (r) => r === 'function');
  });
  it('stream.Duplex', async () => {
    await testMethod('stream', 'Duplex', `typeof require('stream').Duplex`, (r) => r === 'function');
  });
  it('stream.PassThrough', async () => {
    await testMethod('stream', 'PassThrough', `typeof require('stream').PassThrough`, (r) => r === 'function');
  });
  it('stream.Stream', async () => {
    await testMethod('stream', 'Stream', `typeof require('stream').Stream`, (r) => r === 'function');
  });
});

// ---- NEW: http module (unenv) ----

describe('Node.js Compat — http', () => {
  it('http.STATUS_CODES', async () => {
    await testMethod('http', 'STATUS_CODES', `require('http').STATUS_CODES[200]`, (r) => r === 'OK');
  });
  it('http.IncomingMessage', async () => {
    await testMethod('http', 'IncomingMessage', `typeof require('http').IncomingMessage`, (r) => r === 'function');
  });
  it('http.ServerResponse', async () => {
    await testMethod('http', 'ServerResponse', `typeof require('http').ServerResponse`, (r) => r === 'function');
  });
  it('http.createServer (throws helpful error)', async () => {
    await testMethod('http', 'createServer',
      `try { require('http').createServer(); 'no-throw' } catch(e) { e.message.indexOf('not available') >= 0 ? 'correct-error' : 'wrong-error' }`,
      (r) => r === 'correct-error');
  });
});

// ---- NEW: querystring module (unenv) ----

describe('Node.js Compat — querystring', () => {
  it('querystring.parse', async () => {
    await testMethod('querystring', 'parse', `JSON.stringify(require('querystring').parse('a=1&b=2'))`, (r) => { try { const p = JSON.parse(r); return p.a === '1' && p.b === '2'; } catch { return false; } });
  });
  it('querystring.stringify', async () => {
    await testMethod('querystring', 'stringify', `require('querystring').stringify({a:'1',b:'2'})`, (r) => typeof r === 'string' && r.includes('a=1'));
  });
  it('querystring.escape', async () => {
    await testMethod('querystring', 'escape', `typeof require('querystring').escape`, (r) => r === 'function');
  });
  it('querystring.unescape', async () => {
    await testMethod('querystring', 'unescape', `typeof require('querystring').unescape`, (r) => r === 'function');
  });
});

// ---- NEW: string_decoder module (unenv) ----

describe('Node.js Compat — string_decoder', () => {
  it('StringDecoder constructor', async () => {
    await testMethod('string_decoder', 'StringDecoder', `typeof require('string_decoder').StringDecoder`, (r) => r === 'function');
  });
});

// ---- NEW: net module (not_possible) ----

describe('Node.js Compat — net (stub)', () => {
  it('net.connect throws', async () => {
    await testMethod('net', 'connect',
      `try { require('net').connect(); 'no-throw' } catch(e) { e.message.indexOf('not available') >= 0 ? 'correct-error' : 'wrong-error' }`,
      (r) => r === 'correct-error');
  });
  it('net.createServer throws', async () => {
    await testMethod('net', 'createServer',
      `try { require('net').createServer(); 'no-throw' } catch(e) { e.message.indexOf('not available') >= 0 ? 'correct-error' : 'wrong-error' }`,
      (r) => r === 'correct-error');
  });
  it('net.Socket throws', async () => {
    await testMethod('net', 'Socket',
      `try { require('net').Socket(); 'no-throw' } catch(e) { e.message.indexOf('not available') >= 0 ? 'correct-error' : 'wrong-error' }`,
      (r) => r === 'correct-error');
  });
});

// ---- Report ----

afterAll(async () => {
  await setup;
  await engine.destroy();
  fs.destroy();

  // Generate provider-tagged compatibility report
  const modules = new Map<string, {
    pass: number;
    total: number;
    providers: Record<string, number>;
  }>();

  for (const r of results) {
    if (!modules.has(r.module)) {
      modules.set(r.module, { pass: 0, total: 0, providers: {} });
    }
    const m = modules.get(r.module)!;
    m.total++;
    if (r.status === 'PASS') m.pass++;
    m.providers[r.provider] = (m.providers[r.provider] || 0) + 1;
  }

  console.log('\n=== Atua Node.js Compatibility Report ===');
  let totalPass = 0;
  let totalCount = 0;
  const globalProviders: Record<string, number> = {};

  for (const [name, { pass, total, providers }] of modules) {
    const pct = ((pass / total) * 100).toFixed(1);
    const provStr = Object.entries(providers)
      .map(([p, c]) => `${p}: ${c}`)
      .join(', ');
    console.log(`${name.padEnd(18)} ${pass}/${total} (${pct}%)  [${provStr}]`);
    totalPass += pass;
    totalCount += total;
    for (const [p, c] of Object.entries(providers)) {
      globalProviders[p] = (globalProviders[p] || 0) + c;
    }
  }

  console.log('---');
  const totalPct = ((totalPass / totalCount) * 100).toFixed(1);
  console.log(`TOTAL:             ${totalPass}/${totalCount} methods (${totalPct}%)`);
  const provSummary = Object.entries(globalProviders)
    .map(([p, c]) => `${p} ${c}`)
    .join(', ');
  console.log(`Providers: ${provSummary}`);
  console.log('');
});
