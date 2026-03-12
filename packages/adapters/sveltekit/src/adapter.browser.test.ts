/**
 * SvelteKit Adapter — Browser tests
 *
 * Tests that a pre-built SvelteKit bundle loads in AtuaWorkers,
 * renders pages, serves API routes, and provides bindings via platform.atua.env.
 * Uses a hand-crafted fixture simulating SvelteKit's output.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AtuaWorkers } from '../../../workers/atua-workers/src/runtime.js';
import type { WorkerModule } from '../../../workers/atua-workers/src/runtime.js';

// Import the hand-crafted SvelteKit fixture
import * as sveltekitBundle from '../../../workers/atua-workers/test/fixtures/sveltekit-basic/.output/server/index.mjs';

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

describe('SvelteKit Adapter — Bundle Loading', () => {
  it('SvelteKit bundle has export default { fetch }', () => {
    const mod = sveltekitBundle as unknown as WorkerModule;
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe('function');
  });

  it('SvelteKit bundle loads in AtuaWorkers', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        sveltekit: {
          module: sveltekitBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });
    expect(runtime).toBeDefined();
  });
});

describe('SvelteKit Adapter — Page Rendering', () => {
  it('SvelteKit page renders correctly', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        sveltekit: {
          module: sveltekitBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toContain('text/html');

    const html = await response!.text();
    expect(html).toContain('<h1>Welcome to SvelteKit</h1>');
    expect(html).toContain('Running on Atua');
  });

  it('SvelteKit API route returns JSON', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        sveltekit: {
          module: sveltekitBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/hello'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toContain('application/json');

    const data = await response!.json();
    expect(data).toEqual({ hello: 'world', framework: 'sveltekit' });
  });
});

describe('SvelteKit Adapter — Bindings', () => {
  it('platform.atua.env provides bindings', async () => {
    runtime = await AtuaWorkers.create({
      workers: {
        sveltekit: {
          module: sveltekitBundle as unknown as WorkerModule,
          bindings: {
            MY_DB: { type: 'var', value: 'db-placeholder' },
            SESSION_SECRET: { type: 'secret', value: 'secret456' },
          },
          routes: ['/**'],
        },
      },
    });

    const response = await runtime.fetch(req('/api/env'));
    expect(response).not.toBeNull();
    const data = await response!.json();

    expect(data.hasBindings).toBe(true);
    expect(data.envKeys).toContain('MY_DB');
    expect(data.envKeys).toContain('SESSION_SECRET');
  });

  it('both frameworks coexist in separate AtuaWorkers instances', async () => {
    const astroRuntime = await AtuaWorkers.create({
      workers: {
        astro: {
          module: (await import('../../../workers/atua-workers/test/fixtures/astro-basic/.output/server/index.mjs')) as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    const skRuntime = await AtuaWorkers.create({
      workers: {
        sveltekit: {
          module: sveltekitBundle as unknown as WorkerModule,
          routes: ['/**'],
        },
      },
    });

    // Both serve their own content
    const astroResponse = await astroRuntime.fetch(req('/api/hello'));
    const astroData = await astroResponse!.json();
    expect(astroData.framework).toBe('astro');

    const skResponse = await skRuntime.fetch(req('/api/hello'));
    const skData = await skResponse!.json();
    expect(skData.framework).toBe('sveltekit');

    await astroRuntime.destroy();
    await skRuntime.destroy();
  });
});
