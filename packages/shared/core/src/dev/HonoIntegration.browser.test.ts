/**
 * HonoIntegration — Browser tests
 *
 * Phase 13b: Tests real Hono API routing, middleware, and error handling in Chromium.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AtuaFS } from '../fs/AtuaFS.js';
import { BuildPipeline, PassthroughTranspiler } from './BuildPipeline.js';
import { HonoIntegration } from './HonoIntegration.js';

describe('HonoIntegration — API Detection (Browser)', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-detect-' + Date.now());
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should detect no API when directory missing', () => {
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.hasApiRoutes()).toBe(false);
    fs.destroy();
  });

  it('should detect API routes', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono'); var app = new Hono();`,
    );
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.hasApiRoutes()).toBe(true);
    fs.destroy();
  });

  it('should find entry point', () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync('/src/api/index.js', 'code');
    const hono = new HonoIntegration(fs, pipeline);
    expect(hono.findEntryPoint()).toBe('/src/api/index.js');
    fs.destroy();
  });
});

describe('HonoIntegration — Build (Browser)', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-build-' + Date.now());
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should build API routes to /dist/api-sw.js', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/hello', function(c) { return c.json({ message: 'Hello from Atua!' }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    const result = await hono.build();

    expect(result.hasApi).toBe(true);
    expect(result.outputPath).toBe('/dist/api-sw.js');
    expect(result.errors).toHaveLength(0);
    expect(fs.existsSync('/dist/api-sw.js')).toBe(true);
    fs.destroy();
  });

  it('should return hasApi=false when no API', async () => {
    const hono = new HonoIntegration(fs, pipeline);
    const result = await hono.build();
    expect(result.hasApi).toBe(false);
    fs.destroy();
  });
});

describe('HonoIntegration — API Handler Execution (Browser)', () => {
  let fs: AtuaFS;
  let pipeline: BuildPipeline;

  beforeEach(async () => {
    fs = await AtuaFS.create('hono-exec-' + Date.now());
    pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
  });

  it('should handle GET /api/hello', async () => {
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
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/hello'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Hello World');
    fs.destroy();
  });

  it('should handle POST requests', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.post('/api/items', function(c) { return c.json({ created: true }, 201); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/items', { method: 'POST' }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created).toBe(true);
    fs.destroy();
  });

  it('should handle route parameters', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/users/:id', function(c) {
  return c.json({ userId: c.req.param('id') });
});`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/users/123'),
    );
    const body = await response.json();
    expect(body.userId).toBe('123');
    fs.destroy();
  });

  it('should handle query parameters', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/search', function(c) {
  return c.json({ query: c.req.query('q') });
});`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/search?q=atua'),
    );
    const body = await response.json();
    expect(body.query).toBe('atua');
    fs.destroy();
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
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/missing'),
    );
    expect(response.status).toBe(404);
    fs.destroy();
  });

  it('should support CORS middleware', async () => {
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
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/data'),
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    fs.destroy();
  });

  it('should handle text responses', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.get('/api/health', function(c) { return c.text('ok'); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/health'),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('ok');
    fs.destroy();
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
    const scope: any = {};
    new Function('self', code)(scope);

    const r1 = await scope.atuaApiHandler(
      new Request('http://localhost/api/users'),
    );
    expect((await r1.json()).users).toEqual([]);

    const r2 = await scope.atuaApiHandler(
      new Request('http://localhost/api/users', { method: 'POST' }),
    );
    expect(r2.status).toBe(201);

    const r3 = await scope.atuaApiHandler(
      new Request('http://localhost/api/health'),
    );
    expect(await r3.text()).toBe('ok');
    fs.destroy();
  });

  it('should support middleware chaining with real next()', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.use('/api/*', async function(c, next) {
  c.header('X-Middleware', 'ran');
  await next();
});
app.get('/api/chain', function(c) { return c.json({ chained: true }); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/chain'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Middleware')).toBe('ran');
    const body = await response.json();
    expect(body.chained).toBe(true);
    fs.destroy();
  });

  it('should handle error boundary', async () => {
    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.ts',
      `var { Hono } = require('hono');
var app = new Hono();
app.onError(function(err, c) {
  return c.json({ error: err.message }, 500);
});
app.get('/api/fail', function(c) { throw new Error('boom'); });`,
    );

    const hono = new HonoIntegration(fs, pipeline);
    await hono.build();

    const code = fs.readFileSync('/dist/api-sw.js', 'utf-8') as string;
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/fail'),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('boom');
    fs.destroy();
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
    const scope: any = {};
    new Function('self', code)(scope);

    const response = await scope.atuaApiHandler(
      new Request('http://localhost/api/hello'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.basePath).toBe(true);
    fs.destroy();
  });
});
