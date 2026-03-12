/**
 * Astro Adapter — Browser tests
 *
 * Tests that a pre-built Astro bundle loads in CatalystWorkers,
 * renders pages, serves API routes, and provides bindings via Astro.locals.
 * Uses a hand-crafted fixture simulating Astro's SSR output.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { CatalystWorkers } from '../../../workers/catalyst-workers/src/runtime.js';
import type { WorkerModule } from '../../../workers/catalyst-workers/src/runtime.js';

// Import the hand-crafted Astro fixture
import * as astroBundle from '../../../workers/catalyst-workers/test/fixtures/astro-basic/.output/server/index.mjs';

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

let runtime: CatalystWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

describe('Astro Adapter — Bundle Loading', () => {
  it('Astro SSR bundle has export default { fetch }', () => {
    const mod = astroBundle as unknown as WorkerModule;
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe('function');
  });

  it('Astro SSR bundle loads in CatalystWorkers', async () => {
    runtime = await CatalystWorkers.create({
      workers: {
        astro: {
          module: astroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });
    expect(runtime).toBeDefined();
  });
});

describe('Astro Adapter — Page Rendering', () => {
  it('Astro page renders HTML correctly', async () => {
    runtime = await CatalystWorkers.create({
      workers: {
        astro: {
          module: astroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toContain('text/html');

    const html = await response!.text();
    expect(html).toContain('<h1>Welcome to Astro</h1>');
    expect(html).toContain('Running on Catalyst');
  });

  it('Astro API route returns JSON', async () => {
    runtime = await CatalystWorkers.create({
      workers: {
        astro: {
          module: astroBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/hello'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toContain('application/json');

    const data = await response!.json();
    expect(data).toEqual({ hello: 'world', framework: 'astro' });
  });
});

describe('Astro Adapter — Bindings', () => {
  it('Astro.locals.catalyst.env provides bindings', async () => {
    runtime = await CatalystWorkers.create({
      workers: {
        astro: {
          module: astroBundle as unknown as WorkerModule,
          bindings: {
            MY_KV: { type: 'var', value: 'kv-placeholder' },
            API_SECRET: { type: 'secret', value: 'secret123' },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/env'));
    expect(response).not.toBeNull();
    const data = await response!.json();

    expect(data.hasBindings).toBe(true);
    expect(data.envKeys).toContain('MY_KV');
    expect(data.envKeys).toContain('API_SECRET');
  });
});
