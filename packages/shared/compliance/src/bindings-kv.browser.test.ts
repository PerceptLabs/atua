/**
 * Workers Compliance — KV Binding API Shape
 *
 * Validates that KVNamespace binding matches Cloudflare's API:
 * get, put, delete, list, getWithMetadata
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CatalystWorkers } from '../../../workers/catalyst-workers/src/runtime.js';
import { CatalystKV } from '../../../workers/catalyst-workers/src/bindings/kv.js';
import type { WorkerModule } from '../../../workers/catalyst-workers/src/runtime.js';

let runtime: CatalystWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

describe('Workers Compliance — KV Binding', () => {
  it('KV has get/put/delete/list methods', async () => {
    const kv = new CatalystKV();

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const kvNs = env.MY_KV;
          return new Response(JSON.stringify({
            hasGet: typeof kvNs.get === 'function',
            hasPut: typeof kvNs.put === 'function',
            hasDelete: typeof kvNs.delete === 'function',
            hasList: typeof kvNs.list === 'function',
            hasGetWithMetadata: typeof kvNs.getWithMetadata === 'function',
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_KV: { type: 'kv', instance: kv } },
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
    expect(data.hasGetWithMetadata).toBe(true);
  });

  it('KV put/get round-trip', async () => {
    const kv = new CatalystKV();

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);
          if (url.pathname === '/put') {
            await env.MY_KV.put('key1', 'value1');
            return new Response('stored');
          }
          if (url.pathname === '/get') {
            const val = await env.MY_KV.get('key1');
            return new Response(JSON.stringify({ value: val }));
          }
          return new Response('not found', { status: 404 });
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_KV: { type: 'kv', instance: kv } },
          routes: ['/**'],
        },
      },
    });

    await runtime.fetch(req('/put'));
    const res = await runtime.fetch(req('/get'));
    const data = await res!.json();
    expect(data.value).toBe('value1');
  });

  it('KV delete removes key', async () => {
    const kv = new CatalystKV();
    await kv.put('to-delete', 'exists');

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          await env.MY_KV.delete('to-delete');
          const val = await env.MY_KV.get('to-delete');
          return new Response(JSON.stringify({ value: val }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_KV: { type: 'kv', instance: kv } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.value).toBeNull();
  });

  it('KV list returns keys', async () => {
    const kv = new CatalystKV();
    await kv.put('list-a', 'val-a');
    await kv.put('list-b', 'val-b');

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const result = await env.MY_KV.list();
          return new Response(JSON.stringify({
            keys: result.keys.map((k: any) => k.name),
            list_complete: result.list_complete,
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_KV: { type: 'kv', instance: kv } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.keys).toContain('list-a');
    expect(data.keys).toContain('list-b');
    expect(data.list_complete).toBe(true);
  });

  it('KV getWithMetadata returns value and metadata', async () => {
    const kv = new CatalystKV();
    await kv.put('meta-key', 'meta-value', { metadata: { created: 'now' } });

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const result = await env.MY_KV.getWithMetadata('meta-key');
          return new Response(JSON.stringify({
            value: result.value,
            metadata: result.metadata,
          }));
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { MY_KV: { type: 'kv', instance: kv } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.value).toBe('meta-value');
    expect(data.metadata).toEqual({ created: 'now' });
  });
});
