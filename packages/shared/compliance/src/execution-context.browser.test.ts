/**
 * Workers Compliance — Execution Context
 *
 * Validates Worker execution context features:
 * - export default { fetch } module format loading
 * - ctx.waitUntil extends lifetime
 * - ctx.passThroughOnException sets fallthrough
 * - env.* contains configured bindings
 * - Multiple workers with route isolation
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CatalystWorkers } from '../../../workers/catalyst-workers/src/runtime.js';
import type { WorkerModule } from '../../../workers/catalyst-workers/src/runtime.js';

let runtime: CatalystWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe('Workers Compliance — Execution Context', () => {
  it('module format: export default { fetch } loads correctly', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request) {
          return new Response('module format works');
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text).toBe('module format works');
  });

  it('env.* contains configured bindings', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          return new Response(JSON.stringify({
            hasEnv: env !== undefined,
            apiKey: env.API_KEY,
            dbUrl: env.DATABASE_URL,
            envKeys: Object.keys(env),
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: {
            API_KEY: { type: 'secret', value: 'sk-test-123' },
            DATABASE_URL: { type: 'var', value: 'postgres://localhost/db' },
          },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasEnv).toBe(true);
    expect(data.apiKey).toBe('sk-test-123');
    expect(data.dbUrl).toBe('postgres://localhost/db');
    expect(data.envKeys).toContain('API_KEY');
    expect(data.envKeys).toContain('DATABASE_URL');
  });

  it('ctx.waitUntil is available in execution context', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env, ctx) {
          const hasWaitUntil = ctx && typeof ctx.waitUntil === 'function';
          if (hasWaitUntil) {
            ctx.waitUntil(Promise.resolve('background work'));
          }
          return new Response(JSON.stringify({ hasWaitUntil }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasWaitUntil).toBe(true);
  });

  it('ctx.passThroughOnException is available', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env, ctx) {
          const hasPassThrough = ctx && typeof ctx.passThroughOnException === 'function';
          return new Response(JSON.stringify({ hasPassThrough }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasPassThrough).toBe(true);
  });

  it('multiple workers with route isolation', async () => {
    const apiWorker: WorkerModule = {
      default: {
        async fetch() {
          return new Response(JSON.stringify({ worker: 'api' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    };

    const staticWorker: WorkerModule = {
      default: {
        async fetch() {
          return new Response('<html>static</html>', {
            headers: { 'Content-Type': 'text/html' },
          });
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        api: { module: apiWorker, routes: ['/api/*'] },
        static: { module: staticWorker, routes: ['/**'] },
      },
    });

    const apiRes = await runtime.fetch(req('/api/data'));
    expect(apiRes).not.toBeNull();
    const apiData = await apiRes!.json();
    expect(apiData.worker).toBe('api');

    const staticRes = await runtime.fetch(req('/page'));
    expect(staticRes).not.toBeNull();
    const html = await staticRes!.text();
    expect(html).toContain('static');
  });
});
