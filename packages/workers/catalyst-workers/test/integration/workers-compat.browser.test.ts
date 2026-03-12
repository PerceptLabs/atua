/**
 * Workers Compatibility Integration — Browser tests
 *
 * End-to-end validation of raw Workers bundles (no framework) running
 * in CatalystWorkers. Tests wrangler.toml auto-configuration, bindings,
 * and data persistence across destroy/recreate cycles.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CatalystWorkers } from '../../src/runtime.js';
import { CatalystKV } from '../../src/bindings/kv.js';
import { CatalystD1 } from '@aspect/catalyst-workers-d1';
import { parseWranglerConfig } from '../../src/wrangler-config.js';
import type { WorkerModule } from '../../src/runtime.js';

import * as rawWorkerBundle from '../fixtures/raw-worker/index.js';

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

let runtime: CatalystWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

describe('Workers Compat — Raw Worker Bundle', () => {
  it('raw Worker bundle processes requests correctly', async () => {
    const kv = new CatalystKV(`raw-compat-kv-${Date.now()}`);

    runtime = await CatalystWorkers.create({
      workers: {
        raw: {
          module: rawWorkerBundle as unknown as WorkerModule,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
            MY_DB: { type: 'd1', instance: { exec: async () => ({ count: 0, duration: 0 }) } },
            APP_NAME: { type: 'var', value: 'Raw Worker' },
          },
          routes: ['/**'],
        },
      },
    });

    // Root returns text
    const rootRes = await runtime.fetch(req('/'));
    expect(rootRes).not.toBeNull();
    expect(rootRes!.status).toBe(200);
    expect(await rootRes!.text()).toBe('Raw Worker on Catalyst');

    // Check env
    const envRes = await runtime.fetch(req('/env'));
    const envData = await envRes!.json();
    expect(envData.hasKV).toBe(true);
    expect(envData.hasDB).toBe(true);
    expect(envData.appName).toBe('Raw Worker');
  });

  it('raw Worker uses KV + D1 from env', async () => {
    const kv = new CatalystKV(`raw-bindings-kv-${Date.now()}`);
    const db = new CatalystD1(`raw-bindings-db-${Date.now()}`);

    runtime = await CatalystWorkers.create({
      workers: {
        raw: {
          module: rawWorkerBundle as unknown as WorkerModule,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
            MY_DB: { type: 'd1', instance: db },
            APP_NAME: { type: 'var', value: 'Raw Worker' },
          },
          routes: ['/**'],
        },
      },
    });

    // KV write/read
    const setRes = await runtime.fetch(req('/kv/set?key=hello&value=world'));
    expect(setRes!.status).toBe(200);

    const getRes = await runtime.fetch(req('/kv/get?key=hello'));
    const kvData = await getRes!.json();
    expect(kvData.value).toBe('world');

    // D1 init/insert/list
    const initRes = await runtime.fetch(req('/db/init'));
    expect((await initRes!.json()).initialized).toBe(true);

    const insertRes = await runtime.fetch(req('/db/insert?value=test-item'));
    expect((await insertRes!.json()).inserted).toBe(true);

    const listRes = await runtime.fetch(req('/db/list'));
    const rows = await listRes!.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('test-item');

    await db.destroy();
  });
});

describe('Workers Compat — wrangler.toml Auto-Config', () => {
  it('wrangler.toml auto-configures all bindings', async () => {
    // Parse the raw-worker wrangler.toml content
    const toml = `
name = "raw-worker"
main = "index.js"

[vars]
APP_NAME = "Raw Worker"

[[kv_namespaces]]
binding = "MY_KV"
id = "raw-kv-001"

[[d1_databases]]
binding = "MY_DB"
database_name = "raw-db"
database_id = "raw-db-001"
`;

    const config = parseWranglerConfig(toml, 'toml');

    // Verify parsed structure
    expect(config.name).toBe('raw-worker');
    expect(config.bindings).toBeDefined();
    expect(config.bindings.MY_KV).toBeDefined();
    expect(config.bindings.MY_KV.type).toBe('kv');
    expect(config.bindings.MY_DB).toBeDefined();
    expect(config.bindings.MY_DB.type).toBe('d1');
    expect(config.bindings.APP_NAME).toBeDefined();
    expect(config.bindings.APP_NAME.type).toBe('var');
    expect(config.bindings.APP_NAME.value).toBe('Raw Worker');

    // Use parsed config to create CatalystWorkers (with instance overrides for D1)
    const kv = new CatalystKV(`auto-config-kv-${Date.now()}`);
    const db = new CatalystD1(`auto-config-db-${Date.now()}`);

    // Override parsed bindings with pre-constructed instances for testing
    const bindings = { ...config.bindings };
    bindings.MY_KV = { ...bindings.MY_KV, instance: kv };
    bindings.MY_DB = { ...bindings.MY_DB, instance: db };

    runtime = await CatalystWorkers.create({
      workers: {
        raw: {
          module: rawWorkerBundle as unknown as WorkerModule,
          bindings,
          routes: ['/**'],
        },
      },
    });

    // Verify the worker has all bindings
    const envRes = await runtime.fetch(req('/env'));
    const envData = await envRes!.json();
    expect(envData.hasKV).toBe(true);
    expect(envData.hasDB).toBe(true);
    expect(envData.appName).toBe('Raw Worker');

    await db.destroy();
  });
});

describe('Workers Compat — Persistence', () => {
  it('data persists across CatalystWorkers destroy/recreate (OPFS)', async () => {
    const persistNs = `persist-test-${Date.now()}`;
    const kv = new CatalystKV(persistNs);

    // First runtime: write data
    runtime = await CatalystWorkers.create({
      workers: {
        raw: {
          module: rawWorkerBundle as unknown as WorkerModule,
          bindings: {
            MY_KV: { type: 'kv', instance: kv },
            MY_DB: { type: 'd1', instance: { exec: async () => ({ count: 0, duration: 0 }) } },
            APP_NAME: { type: 'var', value: 'Raw Worker' },
          },
          routes: ['/**'],
        },
      },
    });

    await runtime.fetch(req('/kv/set?key=persist-key&value=persist-value'));

    // Destroy runtime
    await runtime.destroy();
    runtime = null;

    // Recreate with SAME KV namespace — data should persist
    const kv2 = new CatalystKV(persistNs);
    runtime = await CatalystWorkers.create({
      workers: {
        raw: {
          module: rawWorkerBundle as unknown as WorkerModule,
          bindings: {
            MY_KV: { type: 'kv', instance: kv2 },
            MY_DB: { type: 'd1', instance: { exec: async () => ({ count: 0, duration: 0 }) } },
            APP_NAME: { type: 'var', value: 'Raw Worker' },
          },
          routes: ['/**'],
        },
      },
    });

    const getRes = await runtime.fetch(req('/kv/get?key=persist-key'));
    const data = await getRes!.json();
    expect(data.value).toBe('persist-value');
  });
});
