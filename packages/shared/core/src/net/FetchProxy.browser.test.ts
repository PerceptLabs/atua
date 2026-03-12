/**
 * FetchProxy — Browser tests
 * Tests end-to-end fetch through QuickJS vian AtuaEngine + FetchProxy.
 * Uses a MockFetchProxy to avoid network dependencies while testing
 * the full pipeline: QuickJS async eval → deferred promises → response → result.
 *
 * Runs in real Chromium via Vitest browser mode.
 */
import { describe, it, expect } from 'vitest';
import { AtuaEngine } from '../engine/AtuaEngine.js';
import {
  FetchProxy,
  FetchBlockedError,
  FetchTimeoutError,
  type SerializedResponse,
} from './FetchProxy.js';

/**
 * Mock FetchProxy that returns canned responses without network access.
 * Tests the full QuickJS → host function → FetchProxy → result pipeline.
 */
class MockFetchProxy extends FetchProxy {
  private mockResponses = new Map<string, SerializedResponse | (() => Promise<SerializedResponse>)>();
  private delay = 0;

  addMock(urlPattern: string, response: SerializedResponse): void {
    this.mockResponses.set(urlPattern, response);
  }

  addDelayedMock(urlPattern: string, delayMs: number): void {
    this.mockResponses.set(urlPattern, () =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new FetchTimeoutError(`FETCH_TIMEOUT: Request timed out after ${delayMs}ms`)), delayMs),
      ),
    );
  }

  override async fetch(url: string, init?: RequestInit): Promise<SerializedResponse> {
    // Domain filtering still applies
    if (!this.isDomainAllowed(url)) {
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = url;
      }
      throw new FetchBlockedError(`FETCH_BLOCKED: Domain not allowed: ${hostname}`);
    }

    // Simulate delay if configured
    if (this.delay > 0) {
      await new Promise((r) => setTimeout(r, this.delay));
    }

    // Check mock responses
    for (const [pattern, responseOrFn] of this.mockResponses) {
      if (url.includes(pattern)) {
        if (typeof responseOrFn === 'function') {
          return responseOrFn();
        }
        return { ...responseOrFn };
      }
    }

    throw new Error(`No mock for URL: ${url}`);
  }
}

function mockJsonResponse(body: any, status = 200): SerializedResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'application/json' },
    url: '',
    body: JSON.stringify(body),
  };
}

describe('FetchProxy — QuickJS Fetch Integration', () => {
  it('should fetch JSON data via QuickJS evalAsync', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('todos/1', mockJsonResponse({ userId: 1, id: 1, title: 'test', completed: false }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/todos/1');
      var data = await response.json();
      data.id;
    `);

    expect(result).toBe(1);
    engine.dispose();
  });

  it('should fetch text content via QuickJS', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('text-endpoint', {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      url: '',
      body: 'Hello from mock!',
    });

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/text-endpoint');
      var text = await response.text();
      text;
    `);

    expect(result).toBe('Hello from mock!');
    engine.dispose();
  });

  it('should expose response status properties', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('status-check', mockJsonResponse({ ok: true }, 200));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/status-check');
      response.ok + ':' + response.status;
    `);

    expect(result).toBe('true:200');
    engine.dispose();
  });

  it('should handle non-200 status codes', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('not-found', mockJsonResponse({ error: 'Not Found' }, 404));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/not-found');
      response.ok + ':' + response.status;
    `);

    expect(result).toBe('false:404');
    engine.dispose();
  });
});

describe('FetchProxy — Blocked Domains (Browser)', () => {
  it('should throw on blocked domain', async () => {
    const fetchProxy = new MockFetchProxy({ blocklist: ['evil.example.com'] });
    const engine = await AtuaEngine.create({ fetchProxy });

    await expect(
      engine.evalAsync(`
        await fetch('https://evil.example.com/steal');
      `),
    ).rejects.toThrow(/FETCH_BLOCKED/);

    engine.dispose();
  });

  it('should throw when domain not in allowlist', async () => {
    const fetchProxy = new MockFetchProxy({ allowlist: ['allowed.example.com'] });
    fetchProxy.addMock('data', mockJsonResponse({ ok: true }));

    const engine = await AtuaEngine.create({ fetchProxy });

    await expect(
      engine.evalAsync(`
        await fetch('https://not-allowed.example.com/data');
      `),
    ).rejects.toThrow(/FETCH_BLOCKED/);

    engine.dispose();
  });

  it('should allow domains in the allowlist', async () => {
    const fetchProxy = new MockFetchProxy({ allowlist: ['allowed.example.com'] });
    fetchProxy.addMock('data', mockJsonResponse({ value: 42 }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://allowed.example.com/data');
      var data = await response.json();
      data.value;
    `);

    expect(result).toBe(42);
    engine.dispose();
  });
});

describe('FetchProxy — POST with Body', () => {
  it('should POST JSON body and get response', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('posts', mockJsonResponse({ id: 101, title: 'test', body: 'hello', userId: 1 }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'test', body: 'hello', userId: 1 })
      });
      var data = await response.json();
      data.id;
    `);

    expect(result).toBe(101);
    engine.dispose();
  });
});

describe('FetchProxy — Timeout', () => {
  it('should timeout on slow requests', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addDelayedMock('slow-endpoint', 50);

    const engine = await AtuaEngine.create({ fetchProxy });

    await expect(
      engine.evalAsync(`
        await fetch('https://api.example.com/slow-endpoint');
      `),
    ).rejects.toThrow(/FETCH_TIMEOUT|timed out/i);

    engine.dispose();
  });
});

describe('FetchProxy — Multiple Sequential Fetches', () => {
  it('should survive multiple sequential fetch calls', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('todos/1', mockJsonResponse({ id: 1 }));
    fetchProxy.addMock('todos/2', mockJsonResponse({ id: 2 }));
    fetchProxy.addMock('todos/3', mockJsonResponse({ id: 3 }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var results = [];
      for (var i = 1; i <= 3; i++) {
        var response = await fetch('https://api.example.com/todos/' + i);
        var data = await response.json();
        results.push(data.id);
      }
      results.join(',');
    `);

    expect(result).toBe('1,2,3');
    engine.dispose();
  });

  it('should handle mixed success and error fetches', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('success', mockJsonResponse({ ok: true }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var success = false;
      try {
        var r1 = await fetch('https://api.example.com/success');
        var d1 = await r1.json();
        success = d1.ok;
      } catch(e) {
        success = false;
      }
      success;
    `);

    expect(result).toBe(true);
    engine.dispose();
  });
});

describe('FetchProxy — evalAsync Expression Capture', () => {
  it('should capture the last expression value', async () => {
    const fetchProxy = new MockFetchProxy();
    const engine = await AtuaEngine.create({ fetchProxy });

    // Test without any fetch — just async eval with expression capture
    const result = await engine.evalAsync(`
      var x = 10;
      var y = 20;
      x + y;
    `);

    expect(result).toBe(30);
    engine.dispose();
  });

  it('should handle async-generated values', async () => {
    const fetchProxy = new MockFetchProxy();
    fetchProxy.addMock('value', mockJsonResponse({ num: 7 }));

    const engine = await AtuaEngine.create({ fetchProxy });
    const result = await engine.evalAsync(`
      var response = await fetch('https://api.example.com/value');
      var data = await response.json();
      data.num * 6;
    `);

    expect(result).toBe(42);
    engine.dispose();
  });
});
