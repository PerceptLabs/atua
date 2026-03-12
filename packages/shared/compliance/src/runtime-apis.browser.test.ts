/**
 * Workers Compliance — Runtime APIs
 *
 * Validates that all standard Web APIs expected in a Cloudflare Workers
 * execution context are present and functional when running through CatalystWorkers.
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

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

function createWorker(handler: (request: Request, env: any) => Promise<Response> | Response): WorkerModule {
  return {
    default: {
      async fetch(request, env) {
        return handler(request, env);
      },
    },
  };
}

describe('Workers Compliance — Runtime APIs', () => {
  it('Request/Response/Headers/URL are available', async () => {
    const worker = createWorker((request) => {
      const url = new URL(request.url);
      const headers = new Headers({ 'X-Test': 'ok' });
      return new Response(JSON.stringify({
        hasRequest: typeof Request === 'function',
        hasResponse: typeof Response === 'function',
        hasHeaders: typeof Headers === 'function',
        hasURL: typeof URL === 'function',
        pathname: url.pathname,
      }), { headers });
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/test'));
    const data = await res!.json();
    expect(data.hasRequest).toBe(true);
    expect(data.hasResponse).toBe(true);
    expect(data.hasHeaders).toBe(true);
    expect(data.hasURL).toBe(true);
    expect(data.pathname).toBe('/test');
  });

  it('TextEncoder/TextDecoder are available', async () => {
    const worker = createWorker(() => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const encoded = encoder.encode('hello');
      const decoded = decoder.decode(encoded);
      return new Response(JSON.stringify({
        hasEncoder: typeof TextEncoder === 'function',
        hasDecoder: typeof TextDecoder === 'function',
        roundTrip: decoded,
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasEncoder).toBe(true);
    expect(data.hasDecoder).toBe(true);
    expect(data.roundTrip).toBe('hello');
  });

  it('crypto.subtle (Web Crypto) is available', async () => {
    const worker = createWorker(async () => {
      const hasCrypto = typeof crypto !== 'undefined';
      const hasSubtle = hasCrypto && typeof crypto.subtle !== 'undefined';
      const hasRandomUUID = hasCrypto && typeof crypto.randomUUID === 'function';

      let uuid = '';
      if (hasRandomUUID) {
        uuid = crypto.randomUUID();
      }

      return new Response(JSON.stringify({
        hasCrypto,
        hasSubtle,
        hasRandomUUID,
        uuidFormat: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid),
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasCrypto).toBe(true);
    expect(data.hasSubtle).toBe(true);
    expect(data.hasRandomUUID).toBe(true);
    expect(data.uuidFormat).toBe(true);
  });

  it('structuredClone is available', async () => {
    const worker = createWorker(() => {
      const original = { a: 1, b: [2, 3], c: { d: 4 } };
      const cloned = structuredClone(original);
      cloned.a = 999;
      return new Response(JSON.stringify({
        hasStructuredClone: typeof structuredClone === 'function',
        originalUnchanged: original.a === 1,
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasStructuredClone).toBe(true);
    expect(data.originalUnchanged).toBe(true);
  });

  it('AbortController/AbortSignal are available', async () => {
    const worker = createWorker(() => {
      return new Response(JSON.stringify({
        hasAbortController: typeof AbortController === 'function',
        hasAbortSignal: typeof AbortSignal === 'function',
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasAbortController).toBe(true);
    expect(data.hasAbortSignal).toBe(true);
  });

  it('setTimeout/setInterval are available', async () => {
    const worker = createWorker(() => {
      return new Response(JSON.stringify({
        hasSetTimeout: typeof setTimeout === 'function',
        hasSetInterval: typeof setInterval === 'function',
        hasClearTimeout: typeof clearTimeout === 'function',
        hasClearInterval: typeof clearInterval === 'function',
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasSetTimeout).toBe(true);
    expect(data.hasSetInterval).toBe(true);
    expect(data.hasClearTimeout).toBe(true);
    expect(data.hasClearInterval).toBe(true);
  });

  it('atob/btoa are available', async () => {
    const worker = createWorker(() => {
      const encoded = btoa('hello world');
      const decoded = atob(encoded);
      return new Response(JSON.stringify({
        hasAtob: typeof atob === 'function',
        hasBtoa: typeof btoa === 'function',
        roundTrip: decoded,
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasAtob).toBe(true);
    expect(data.hasBtoa).toBe(true);
    expect(data.roundTrip).toBe('hello world');
  });

  it('ReadableStream/WritableStream are available', async () => {
    const worker = createWorker(() => {
      return new Response(JSON.stringify({
        hasReadableStream: typeof ReadableStream === 'function',
        hasWritableStream: typeof WritableStream === 'function',
        hasTransformStream: typeof TransformStream === 'function',
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasReadableStream).toBe(true);
    expect(data.hasWritableStream).toBe(true);
    expect(data.hasTransformStream).toBe(true);
  });

  it('console.* methods are available', async () => {
    const worker = createWorker(() => {
      return new Response(JSON.stringify({
        hasLog: typeof console.log === 'function',
        hasWarn: typeof console.warn === 'function',
        hasError: typeof console.error === 'function',
        hasInfo: typeof console.info === 'function',
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasLog).toBe(true);
    expect(data.hasWarn).toBe(true);
    expect(data.hasError).toBe(true);
    expect(data.hasInfo).toBe(true);
  });

  it('Event/EventTarget are available', async () => {
    const worker = createWorker(() => {
      return new Response(JSON.stringify({
        hasEvent: typeof Event === 'function',
        hasEventTarget: typeof EventTarget === 'function',
      }));
    });

    runtime = await CatalystWorkers.create({
      workers: { api: { module: worker, routes: ['/**'] } },
    });

    const res = await runtime.fetch(req('/'));
    const data = await res!.json();
    expect(data.hasEvent).toBe(true);
    expect(data.hasEventTarget).toBe(true);
  });
});
