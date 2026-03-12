/**
 * Nitro Preset Integration — Browser tests
 *
 * Tests loading a Nitro-like bundle into AtuaWorkers runtime.
 * Uses a hand-crafted fixture that simulates Nitro's output format.
 * Runs in Chromium via Vitest browser mode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AtuaWorkers } from '../../atua-workers/src/runtime.js';
import { AtuaKV } from '../../atua-workers/src/bindings/kv.js';
import type { WorkerModule } from '../../atua-workers/src/runtime.js';

// Import the hand-crafted Nitro-like fixture
// In a real deployment, this would be the pre-built Nitro output
import * as nitroBundle from '../../atua-workers/test/fixtures/nitro-basic/.output/server/index.mjs';

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

let runtime: AtuaWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

describe('Nitro Preset — Bundle Loading', () => {
  it('output has export default { fetch } entry', () => {
    const mod = nitroBundle as unknown as WorkerModule;
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe('function');
  });

  it('bundle loads in AtuaWorkers', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    expect(runtime).toBeDefined();
  });
});

describe('Nitro Preset — Route Handling', () => {
  it('GET / returns Nitro-rendered HTML', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const html = await response!.text();
    expect(html).toContain('<h1>Hello from Nitro on Atua</h1>');
    expect(response!.headers.get('Content-Type')).toContain('text/html');
  });

  it('GET /api/hello returns JSON { hello: "world" }', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/hello'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const data = await response!.json();
    expect(data).toEqual({ hello: 'world' });
    expect(response!.headers.get('Content-Type')).toContain('application/json');
  });

  it('static and dynamic routes coexist', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    // Dynamic route
    const apiResponse = await runtime.fetch(req('/api/hello'));
    expect(apiResponse!.status).toBe(200);

    // Static asset route
    const staticResponse = await runtime.fetch(req('/static/style.css'));
    expect(staticResponse!.status).toBe(200);
    expect(staticResponse!.headers.get('Content-Type')).toContain('text/css');
    expect(await staticResponse!.text()).toContain('body');
  });
});

describe('Nitro Preset — Bindings Integration', () => {
  it('event.context.atua.env accessible in route handlers', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          bindings: {
            API_KEY: { type: 'var', value: 'test-key' },
            DB_NAME: { type: 'var', value: 'test-db' },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/env'));
    expect(response).not.toBeNull();
    const data = await response!.json();

    expect(data.hasEnv).toBe(true);
    expect(data.envKeys).toContain('API_KEY');
    expect(data.envKeys).toContain('DB_NAME');
  });

  it('storage vian AtuaKV driver writes and reads', async () => {
    const storageKV = new AtuaKV(`nitro-storage-${Date.now()}`);

    runtime = await AtuaWorkers.create({
      workers: {
        nitro: {
          module: nitroBundle as unknown as WorkerModule,
          bindings: {
            STORAGE: { type: 'kv', instance: storageKV },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/storage'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const data = await response!.json();
    expect(data.written).toBe(true);
    expect(data.readBack).toBe('nitro-test-value');
  });
});
