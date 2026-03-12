/**
 * Workers Compliance — Error Isolation
 *
 * Validates that:
 * - Worker throw → 500 response, Service Worker continues
 * - Worker errors don't crash the runtime
 * - Subsequent requests succeed after a Worker error
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

describe('Workers Compliance — Error Isolation', () => {
  it('Worker throw → 500 response', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/error') {
            throw new Error('Worker crashed intentionally');
          }
          return new Response('ok');
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    const errorRes = await runtime.fetch(req('/error'));
    expect(errorRes).not.toBeNull();
    expect(errorRes!.status).toBe(500);
  });

  it('runtime continues after Worker error', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/crash') {
            throw new Error('boom');
          }
          return new Response('alive');
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    // First: crash
    const crashRes = await runtime.fetch(req('/crash'));
    expect(crashRes!.status).toBe(500);

    // Second: should still work
    const okRes = await runtime.fetch(req('/ok'));
    expect(okRes).not.toBeNull();
    expect(okRes!.status).toBe(200);
    const text = await okRes!.text();
    expect(text).toBe('alive');
  });

  it('error in one worker does not affect other workers', async () => {
    const crashWorker: WorkerModule = {
      default: {
        async fetch() {
          throw new Error('always crashes');
        },
      },
    };

    const healthyWorker: WorkerModule = {
      default: {
        async fetch() {
          return new Response('healthy');
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: {
        crash: { module: crashWorker, routes: ['/crash/*'] },
        healthy: { module: healthyWorker, routes: ['/**'] },
      },
    });

    // Crash worker fails
    const crashRes = await runtime.fetch(req('/crash/test'));
    expect(crashRes!.status).toBe(500);

    // Healthy worker unaffected
    const healthyRes = await runtime.fetch(req('/healthy'));
    expect(healthyRes).not.toBeNull();
    expect(healthyRes!.status).toBe(200);
    const text = await healthyRes!.text();
    expect(text).toBe('healthy');
  });

  it('async rejection → 500 response', async () => {
    const worker: WorkerModule = {
      default: {
        async fetch() {
          await Promise.reject(new Error('async failure'));
          return new Response('unreachable');
        },
      },
    };

    runtime = await CatalystWorkers.create({
      workers: { w: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });
});
