/**
 * Workers Compliance — R2 Binding API Shape
 *
 * Validates that R2Bucket binding matches Cloudflare's API:
 * get, put, delete, list, head
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

describe('Workers Compliance — R2 Binding', () => {
  it('R2Bucket has get/put/delete/list/head methods', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const r2 = env.MY_BUCKET;
          return new Response(JSON.stringify({
            hasGet: typeof r2.get === 'function',
            hasPut: typeof r2.put === 'function',
            hasDelete: typeof r2.delete === 'function',
            hasList: typeof r2.list === 'function',
            hasHead: typeof r2.head === 'function',
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_BUCKET: { type: 'r2' } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasGet).toBe(true);
    expect(data.hasPut).toBe(true);
    expect(data.hasDelete).toBe(true);
    expect(data.hasList).toBe(true);
    expect(data.hasHead).toBe(true);
  });

  it('R2 put/get round-trip', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);

          if (url.pathname === '/put') {
            await env.MY_BUCKET.put('test-file.txt', 'hello R2');
            return new Response('stored');
          }

          if (url.pathname === '/get') {
            const obj = await env.MY_BUCKET.get('test-file.txt');
            if (!obj) return new Response('not found', { status: 404 });
            const text = await obj.text();
            return new Response(JSON.stringify({ text }));
          }

          return new Response('not found', { status: 404 });
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_BUCKET: { type: 'r2' } },
          routes: ['/**'],
        },
      },
    });

    await runtime.fetch(req('/put'));
    const res = await runtime.fetch(req('/get'));
    const data = await res!.json();
    expect(data.text).toBe('hello R2');
  });

  it('R2 delete removes object', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          await env.MY_BUCKET.put('to-delete', 'data');
          await env.MY_BUCKET.delete('to-delete');
          const obj = await env.MY_BUCKET.get('to-delete');
          return new Response(JSON.stringify({ exists: obj !== null }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_BUCKET: { type: 'r2' } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.exists).toBe(false);
  });

  it('R2 list returns objects', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          await env.MY_BUCKET.put('file-a', 'data-a');
          await env.MY_BUCKET.put('file-b', 'data-b');
          const result = await env.MY_BUCKET.list();
          return new Response(JSON.stringify({
            keys: result.objects.map((o: any) => o.key),
            truncated: result.truncated,
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_BUCKET: { type: 'r2' } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.keys).toContain('file-a');
    expect(data.keys).toContain('file-b');
    expect(data.truncated).toBe(false);
  });
});
