/**
 * AtuaWorkers Runtime Shell — Browser tests
 *
 * Tests worker loading, env binding construction, route matching,
 * ExecutionContext, error handling, and cleanup.
 * Runs in Chromium via Vitest browser mode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AtuaWorkers, matchRoute } from './runtime.js';
import { AtuaExecutionContext } from './context.js';
import { AtuaKV } from './bindings/kv.js';
import { AtuaR2 } from './bindings/r2.js';
import type { WorkerModule } from './runtime.js';

// =========================================================================
// Inline Worker modules (avoids TypeScript import issues with .js fixtures)
// =========================================================================

/** Minimal Worker — returns a plain text greeting */
const minimalWorker: WorkerModule = {
  default: {
    async fetch() {
      return new Response('Hello from Atua Worker!', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    },
  },
};

/** KV Worker — reads/writes from env.MY_KV */
const kvWorker: WorkerModule = {
  default: {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/kv/get') {
        const key = url.searchParams.get('key')!;
        const value = await (env.MY_KV as AtuaKV).get(key);
        return new Response(value as string | null, {
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      if (url.pathname === '/kv/put') {
        const key = url.searchParams.get('key')!;
        const value = url.searchParams.get('value')!;
        await (env.MY_KV as AtuaKV).put(key, value);
        return new Response('OK', { status: 200 });
      }
      if (url.pathname === '/kv/list') {
        const result = await (env.MY_KV as AtuaKV).list();
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  },
};

/** Multi-route Worker — returns JSON with path and method */
const multiRouteWorker: WorkerModule = {
  default: {
    async fetch(request) {
      const url = new URL(request.url);
      return new Response(
        JSON.stringify({
          path: url.pathname,
          method: request.method,
          worker: 'multi-route',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    },
  },
};

// =========================================================================
// Helpers
// =========================================================================

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

let runtime: AtuaWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

// =========================================================================
// Basic Worker Loading
// =========================================================================

describe('AtuaWorkers — Loading', () => {
  it('loads module-format Worker and returns response via fetch', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: minimalWorker,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    const text = await response!.text();
    expect(text).toBe('Hello from Atua Worker!');
  });

  it('destroy() prevents further fetch calls', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: minimalWorker,
          routes: ['/**'],
        },
      },
    });

    await runtime.destroy();
    await expect(runtime.fetch(req('/'))).rejects.toThrow(
      'AtuaWorkers has been destroyed',
    );
    runtime = null; // Already destroyed
  });
});

// =========================================================================
// Bindings
// =========================================================================

describe('AtuaWorkers — Bindings', () => {
  it('env contains KV binding, Worker reads from it', async () => {
    const kv = new AtuaKV(`runtime-kv-test-${Date.now()}`);
    await kv.put('greeting', 'hello world');

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: kvWorker,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/kv/get?key=greeting'));
    expect(response).not.toBeNull();
    const text = await response!.text();
    expect(text).toBe('hello world');
  });

  it('env contains KV binding, Worker writes to it', async () => {
    const kv = new AtuaKV(`runtime-kv-write-${Date.now()}`);

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: kvWorker,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
          },
          routes: ['/**'],
        },
      },
    });

    const putResponse = await runtime.fetch(
      req('/kv/put?key=msg&value=saved'),
    );
    expect(putResponse!.status).toBe(200);

    // Verify via direct KV read
    const value = await kv.get('msg');
    expect(value).toBe('saved');
  });

  it('env contains R2 binding, Worker reads from it', async () => {
    const r2 = new AtuaR2(`runtime-r2-test-${Date.now()}`);
    await r2.put('doc.txt', 'R2 content here');

    const r2Worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);
          const key = url.searchParams.get('key')!;
          const obj = await (env.MY_BUCKET as AtuaR2).get(key);
          if (!obj) return new Response('Not Found', { status: 404 });
          const text = await obj.text();
          return new Response(text);
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: r2Worker,
          bindings: {
            MY_BUCKET: { type: 'r2', instance: r2 },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/?key=doc.txt'));
    expect(response).not.toBeNull();
    const text = await response!.text();
    expect(text).toBe('R2 content here');
  });

  it('env contains D1 binding via pre-constructed instance', async () => {
    // Simulate D1 with a mock that matches the D1 API shape
    const mockResults = [{ id: 1, name: 'Alice' }];
    const mockD1 = {
      exec: async () => ({ count: 1, duration: 0 }),
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => ({
            results: mockResults,
            success: true,
            meta: { duration: 0, changes: 0, last_row_id: 0 },
          }),
          run: async () => ({
            results: [],
            success: true,
            meta: { duration: 0, changes: 1, last_row_id: 1 },
          }),
        }),
      }),
    };

    const d1Worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const db = env.MY_DB as typeof mockD1;
          const result = await db.prepare('SELECT * FROM users').bind().all();
          return new Response(JSON.stringify(result.results), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: d1Worker,
          bindings: {
            MY_DB: { type: 'd1', instance: mockD1 },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    const data = await response!.json();
    expect(data).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('env contains secret/var bindings as plain strings', async () => {
    const envCheckWorker: WorkerModule = {
      default: {
        async fetch(_request, env) {
          return new Response(
            JSON.stringify({
              apiKey: env.API_KEY,
              environment: env.ENVIRONMENT,
              secret: env.DB_PASSWORD,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: envCheckWorker,
          bindings: {
            API_KEY: { type: 'var', value: 'pk_test_123' },
            ENVIRONMENT: { type: 'var', value: 'staging' },
            DB_PASSWORD: { type: 'secret', value: 's3cret!' },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    const data = await response!.json();
    expect(data).toEqual({
      apiKey: 'pk_test_123',
      environment: 'staging',
      secret: 's3cret!',
    });
  });

  it('auto-creates KV binding from namespace config', async () => {
    const ns = `auto-kv-${Date.now()}`;
    const kvPutWorker: WorkerModule = {
      default: {
        async fetch(_request, env) {
          await (env.MY_KV as AtuaKV).put('auto-key', 'auto-value');
          const value = await (env.MY_KV as AtuaKV).get('auto-key');
          return new Response(value as string);
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: kvPutWorker,
          bindings: {
            MY_KV: { type: 'kv', namespace: ns },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(await response!.text()).toBe('auto-value');
  });
});

// =========================================================================
// ExecutionContext
// =========================================================================

describe('AtuaWorkers — ExecutionContext', () => {
  it('waitUntil tracks background promises', async () => {
    let bgTaskCompleted = false;

    const ctxWorker: WorkerModule = {
      default: {
        async fetch(_request, _env, ctx) {
          ctx.waitUntil(
            new Promise<void>((resolve) => {
              bgTaskCompleted = true;
              resolve();
            }),
          );
          return new Response('OK');
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: ctxWorker,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response!.status).toBe(200);
    expect(bgTaskCompleted).toBe(true);
  });

  it('passThroughOnException causes fallthrough on error', async () => {
    const passThroughWorker: WorkerModule = {
      default: {
        async fetch(_request, _env, ctx) {
          ctx.passThroughOnException();
          throw new Error('Deliberate error');
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: passThroughWorker,
          routes: ['/**'],
        },
      },
    });

    // Should return null (fall through) instead of 500
    const response = await runtime.fetch(req('/'));
    expect(response).toBeNull();
  });

  it('AtuaExecutionContext: pendingPromises and flush', async () => {
    const ctx = new AtuaExecutionContext();
    let resolved = false;

    ctx.waitUntil(
      new Promise<void>((r) =>
        setTimeout(() => {
          resolved = true;
          r();
        }, 10),
      ),
    );

    expect(ctx.pendingPromises).toHaveLength(1);
    expect(ctx.shouldPassThrough).toBe(false);

    ctx.passThroughOnException();
    expect(ctx.shouldPassThrough).toBe(true);

    await ctx.flush();
    expect(resolved).toBe(true);
  });
});

// =========================================================================
// Route Matching
// =========================================================================

describe('AtuaWorkers — Route Matching', () => {
  it('exact match: /api/health', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: multiRouteWorker,
          routes: ['/api/health'],
        },
      },
    });

    const match = await runtime.fetch(req('/api/health'));
    expect(match).not.toBeNull();
    const data = await match!.json();
    expect(data.path).toBe('/api/health');

    const noMatch = await runtime.fetch(req('/api/health/extra'));
    expect(noMatch).toBeNull();

    const noMatch2 = await runtime.fetch(req('/api'));
    expect(noMatch2).toBeNull();
  });

  it('prefix match: /api/*', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: multiRouteWorker,
          routes: ['/api/*'],
        },
      },
    });

    const match1 = await runtime.fetch(req('/api/users'));
    expect(match1).not.toBeNull();

    const match2 = await runtime.fetch(req('/api/users/123'));
    expect(match2).not.toBeNull();

    const match3 = await runtime.fetch(req('/api'));
    expect(match3).not.toBeNull();

    const noMatch = await runtime.fetch(req('/other'));
    expect(noMatch).toBeNull();
  });

  it('wildcard match: /**', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: multiRouteWorker,
          routes: ['/**'],
        },
      },
    });

    const match1 = await runtime.fetch(req('/'));
    expect(match1).not.toBeNull();

    const match2 = await runtime.fetch(req('/any/deep/path'));
    expect(match2).not.toBeNull();
  });

  it('non-matching requests fall through (return null)', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: multiRouteWorker,
          routes: ['/api/*'],
        },
      },
    });

    const response = await runtime.fetch(req('/static/file.css'));
    expect(response).toBeNull();
  });

  it('matchRoute unit tests', () => {
    // Exact
    expect(matchRoute('/api/health', '/api/health')).toBe(true);
    expect(matchRoute('/api/health', '/api/health/extra')).toBe(false);
    expect(matchRoute('/api/health', '/api')).toBe(false);

    // Prefix /*
    expect(matchRoute('/api/*', '/api/users')).toBe(true);
    expect(matchRoute('/api/*', '/api/users/123')).toBe(true);
    expect(matchRoute('/api/*', '/api')).toBe(true);
    expect(matchRoute('/api/*', '/other')).toBe(false);

    // Double wildcard /**
    expect(matchRoute('/**', '/')).toBe(true);
    expect(matchRoute('/**', '/any/path')).toBe(true);

    // Single wildcard /*
    expect(matchRoute('/*', '/')).toBe(true);
    expect(matchRoute('/*', '/anything')).toBe(true);

    // Prefix with /**
    expect(matchRoute('/v1/**', '/v1/api')).toBe(true);
    expect(matchRoute('/v1/**', '/v1')).toBe(true);
    expect(matchRoute('/v1/**', '/v2/api')).toBe(false);
  });
});

// =========================================================================
// Error Handling
// =========================================================================

describe('AtuaWorkers — Error Handling', () => {
  it('Worker error returns 500 response (not crash)', async () => {
    const errorWorker: WorkerModule = {
      default: {
        async fetch() {
          throw new Error('Something broke');
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: errorWorker,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    const text = await response!.text();
    expect(text).toBe('Something broke');
  });
});

// =========================================================================
// Cleanup
// =========================================================================

describe('AtuaWorkers — Cleanup', () => {
  it('destroy() cleans up all bindings and resources', async () => {
    const kv = new AtuaKV(`cleanup-test-${Date.now()}`);

    runtime = await AtuaWorkers.create({
      workers: {
        main: {
          module: minimalWorker,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
            API_KEY: { type: 'var', value: 'test' },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response!.status).toBe(200);

    await runtime.destroy();

    await expect(runtime.fetch(req('/'))).rejects.toThrow('destroyed');
    runtime = null;
  });
});
