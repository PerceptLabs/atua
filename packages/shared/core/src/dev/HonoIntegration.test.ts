/**
 * HonoIntegration — Node.js unit tests
 *
 * Phase 13b: Tests real Hono integration — routing, middleware, error boundaries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AtuaFS } from '../fs/AtuaFS.js';
import { BuildPipeline, PassthroughTranspiler } from './BuildPipeline.js';
import { HonoIntegration } from './HonoIntegration.js';

describe('HonoIntegration — Detection', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-detect');
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should detect no API routes when directory missing', () => {
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.hasApiRoutes()).toBe(false);
  });

  it('should detect API routes with index.ts', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/index.ts', 'var { Hono } = require("hono"); var app = new Hono();');
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.hasApiRoutes()).toBe(true);
  });

  it('should detect API routes with index.js', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/index.js', 'var { Hono } = require("hono"); var app = new Hono();');
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.hasApiRoutes()).toBe(true);
  });

  it('should find entry point', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/index.ts', 'code');
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.findEntryPoint()).toBe('/src/api/index.ts');
  });

  it('should return null when no entry point', () => {
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.findEntryPoint()).toBeNull();
  });

  it('should support custom API directory', () => {
    fs.mkdirSync('/routes', { recursive: true });
    fs.writeFileSync('/routes/index.ts', 'code');
    const hono = new HonoIntegration(fs, pipeline, { apiDir: '/routes' });
    expect(hono.hasApiRoutes()).toBe(true);
    expect(hono.findEntryPoint()).toBe('/routes/index.ts');
  });

  it('should support custom entry point name', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/routes.ts', 'code');
    const hono = new HonoIntegration(fs, pipeline, { entryPoint: 'routes' });
    expect(hono.findEntryPoint()).toBe('/src/api/routes.ts');
  });
});

describe('HonoIntegration — Building', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-build');
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should return hasApi=false when no API', async () => {
    const hono = new HonoIntegration(fs, pipeline);
    const result = await hono.build();
    expect(result.hasApi).toBe(false);
    expect(result.outputPath).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('should build API routes to IIFE bundle', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/hello', function(c) { return c.json({ message: 'Hello!' }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    const result = await hono.build();

    expect(result.hasApi).toBe(true);
    expect(result.outputPath).toBe('/dist/api-sw.js');
    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync('/dist/api-sw.js')).toBe(true);

    const content = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    expect(content).toContain('atuaApiHandler');
    expect(content).toContain('/api/hello');
    expect(content).toContain('Hello!');
  });

  it('should support custom output path', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/test', function(c) { return c.text('ok'); });`,
    );

    const hono = new HonoIntegration(fs, pipeline, {
      outputPath: '/build/api.js',
    });
    const result = await hono.build();

    expect(result.outputPath).toBe('/build/api.js');
    expect(fs.existsSync('/build/api.js')).toBe(true);
  });

  it('should include IIFE wrapper with real Hono', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    const result = await hono.build();

    const content = fs.readFileSync(result.outputPath!, 'utf-8') as string;
    expect(content).toContain('(function()');
    expect(content).toContain('__honoModules');
    expect(content).toContain('atuaApiHandler');
  });

  it('should collect API files', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/index.ts', 'code1');
    fs.writeFileSync('/src/api/users.ts', 'code2');

    const hono = new HonoIntegration(fs, pipeline);
    const files = hono.collectApiFiles();
    expect(files.size).toBe(2);
    expect(files.has('/src/api/index.ts')).toBe(true);
    expect(files.has('/src/api/users.ts')).toBe(true);
  });
});

describe('HonoIntegration — Real Hono Handler', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-handler');
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should produce executable IIFE with real Hono routing', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/hello', function(c) { return c.json({ message: 'Hello World' }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const self: any = {};
    new Function('self', code)(self);

    expect(typeof self.atuaApiHandler).toBe('function');

    const request = new Request('http://localhost/api/hello', { method: 'GET' });
    const response = await self.atuaApiHandler(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Hello World');
  });

  it('should handle POST routes', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.post('/api/data', function(c) { return c.json({ received: true }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/data', { method: 'POST' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it('should return 404 for unmatched routes', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/hello', function(c) { return c.json({ ok: true }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/nonexistent', { method: 'GET' }),
    );
    expect(response.status).toBe(404);
  });

  it('should handle route parameters', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/users/:id', function(c) { return c.json({ id: c.req.param('id') }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/users/42', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('42');
  });

  it('should handle query parameters', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/search', function(c) { return c.json({ q: c.req.query('q') }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/search?q=test', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.q).toBe('test');
  });

  it('should support ESM import syntax (transformed to require)', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `import { Hono } from 'hono';
const app = new Hono();
app.get('/api/esm', (c) => c.json({ esm: true }));`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/esm', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.esm).toBe(true);
  });

  it('should support cors middleware', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var { cors } = require('hono/cors');
var app = new Hono();
app.use('*', cors());
app.get('/api/data', function(c) { return c.json({ data: 1 }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/data', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should support middleware chaining with real next()', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.use('/api/*', async function(c, next) {
  c.header('X-Custom', 'middleware-ran');
  await next();
});
app.get('/api/chain', function(c) { return c.json({ chained: true }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/chain', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Custom')).toBe('middleware-ran');
    const body = await response.json();
    expect(body.chained).toBe(true);
  });

  it('should support basePath', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono().basePath('/api');
app.get('/hello', function(c) { return c.json({ basePath: true }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/hello', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.basePath).toBe(true);
  });

  it('should handle error boundary (500 on thrown error)', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.onError(function(err, c) {
  return c.json({ error: err.message }, 500);
});
app.get('/api/fail', function(c) { throw new Error('test error'); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/fail', { method: 'GET' }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('test error');
  });

  it('should support c.set() / c.get() for request-scoped state', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.use('/api/*', async function(c, next) {
  c.set('user', 'alice');
  await next();
});
app.get('/api/user', function(c) { return c.json({ user: c.get('user') }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const response = await self.atuaApiHandler(
      new Request('http://localhost/api/user', { method: 'GET' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user).toBe('alice');
  });

  it('should support wildcard routes', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.all('/api/*', function(c) { return c.json({ wildcard: true, path: c.req.path }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const r1 = await self.atuaApiHandler(
      new Request('http://localhost/api/anything', { method: 'GET' }),
    );
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.wildcard).toBe(true);

    const r2 = await self.atuaApiHandler(
      new Request('http://localhost/api/deep/nested/path', { method: 'POST' }),
    );
    expect(r2.status).toBe(200);
  });

  it('should handle multiple routes', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/users', function(c) { return c.json({ users: [] }); });
app.post('/api/users', function(c) { return c.json({ created: true }, 201); });
app.get('/api/health', function(c) { return c.text('ok'); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();
    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;

    const self: any = {};
    new Function('self', code)(self);

    const r1 = await self.atuaApiHandler(
      new Request('http://localhost/api/users'),
    );
    expect((await r1.json()).users).toEqual([]);

    const r2 = await self.atuaApiHandler(
      new Request('http://localhost/api/users', { method: 'POST' }),
    );
    expect(r2.status).toBe(201);

    const r3 = await self.atuaApiHandler(
      new Request('http://localhost/api/health'),
    );
    expect(await r3.text()).toBe('ok');
  });
});

describe('HonoIntegration — ensureHono', () => {
  it('should write Hono to AtuaFS /node_modules/hono/', async () => {
    const fs = await AtuaFS.create('hono-ensure');
    const pipeline = new BuildPipeline(fs, new PassthroughTranspiler());

    const hono = new HonoIntegration(fs, pipeline);
    hono.ensureHono();

    expect(fs.existsSync('/node_modules/hono/package.json')).toBe(true);
    expect(fs.existsSync('/node_modules/hono/dist/cjs/index.js')).toBe(true);
    expect(fs.existsSync('/node_modules/hono/dist/cjs/middleware/cors/index.js')).toBe(true);

    const pkg = JSON.parse(fs.readFileSync('/node_modules/hono/package.json', 'utf-8') as string);
    expect(pkg.name).toBe('hono');
    expect(pkg.version).toBe('4.12.3');
  });

  it('should be idempotent', async () => {
    const fs = await AtuaFS.create('hono-ensure-idem');
    const pipeline = new BuildPipeline(fs, new PassthroughTranspiler());

    const hono = new HonoIntegration(fs, pipeline);
    hono.ensureHono();
    hono.ensureHono(); // Should not throw
    expect(fs.existsSync('/node_modules/hono/dist/cjs/index.js')).toBe(true);
  });
});
