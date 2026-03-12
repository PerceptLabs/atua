/**
 * AtuaKV — Browser tests
 *
 * All tests run in Chromium via Vitest browser mode.
 * Uses real IndexedDB (no mocks).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtuaKV } from './kv.js';

// Use a unique namespace per test run to avoid IDB collisions
let kv: AtuaKV;
let nsCounter = 0;

function createKV(): AtuaKV {
  return new AtuaKV(`test-${Date.now()}-${nsCounter++}`);
}

// Clean up after each test
afterEach(() => {
  if (kv) kv.destroy();
});

// =========================================================================
// Basic CRUD
// =========================================================================

describe('AtuaKV — Basic CRUD', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('get/put/delete basic cycle', async () => {
    await kv.put('key1', 'value1');
    const result = await kv.get('key1');
    expect(result).toBe('value1');

    await kv.delete('key1');
    const deleted = await kv.get('key1');
    expect(deleted).toBeNull();
  });

  it('get non-existent key returns null', async () => {
    const result = await kv.get('does-not-exist');
    expect(result).toBeNull();
  });

  it('put overwrites existing value', async () => {
    await kv.put('key1', 'v1');
    await kv.put('key1', 'v2');
    const result = await kv.get('key1');
    expect(result).toBe('v2');
  });

  it('handles empty string value', async () => {
    await kv.put('empty', '');
    const result = await kv.get('empty');
    expect(result).toBe('');
  });

  it('delete non-existent key is a no-op', async () => {
    // Should not throw
    await kv.delete('does-not-exist');
  });
});

// =========================================================================
// Type options
// =========================================================================

describe('AtuaKV — Type Options', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('get with type "text" returns string', async () => {
    await kv.put('key', 'hello');
    const result = await kv.get('key', 'text');
    expect(typeof result).toBe('string');
    expect(result).toBe('hello');
  });

  it('get with type "json" parses JSON', async () => {
    await kv.put('key', JSON.stringify({ foo: 'bar', num: 42 }));
    const result = await kv.get('key', 'json') as Record<string, unknown>;
    expect(result).toEqual({ foo: 'bar', num: 42 });
  });

  it('get with type "arrayBuffer" returns ArrayBuffer', async () => {
    await kv.put('key', 'hello');
    const result = await kv.get('key', 'arrayBuffer');
    expect(result).toBeInstanceOf(ArrayBuffer);
    const text = new TextDecoder().decode(result as ArrayBuffer);
    expect(text).toBe('hello');
  });

  it('get with type "stream" returns ReadableStream', async () => {
    await kv.put('key', 'hello');
    const stream = await kv.get('key', 'stream') as ReadableStream;
    expect(stream).toBeInstanceOf(ReadableStream);

    const reader = stream.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = new TextDecoder().decode(value);
    expect(text).toBe('hello');

    const final = await reader.read();
    expect(final.done).toBe(true);
  });

  it('get with options object { type: "json" }', async () => {
    await kv.put('key', JSON.stringify([1, 2, 3]));
    const result = await kv.get('key', { type: 'json' });
    expect(result).toEqual([1, 2, 3]);
  });

  it('put and get ArrayBuffer value', async () => {
    const data = new TextEncoder().encode('binary data').buffer;
    await kv.put('bin', data);
    const result = await kv.get('bin', 'arrayBuffer') as ArrayBuffer;
    expect(new TextDecoder().decode(result)).toBe('binary data');
  });

  it('put and get ReadableStream value', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed'));
        controller.close();
      },
    });
    await kv.put('streamed', stream);
    const result = await kv.get('streamed', 'text');
    expect(result).toBe('streamed');
  });
});

// =========================================================================
// Expiration (TTL)
// =========================================================================

describe('AtuaKV — Expiration', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('put with expirationTtl sets expiration', async () => {
    await kv.put('temp', 'value', { expirationTtl: 3600 });
    const result = await kv.get('temp');
    expect(result).toBe('value');
  });

  it('put with absolute expiration', async () => {
    const futureExpiration = Math.floor(Date.now() / 1000) + 3600;
    await kv.put('temp', 'value', { expiration: futureExpiration });
    const result = await kv.get('temp');
    expect(result).toBe('value');
  });

  it('get expired key returns null and auto-deletes', async () => {
    // Set expiration to 1 second ago
    const pastExpiration = Math.floor(Date.now() / 1000) - 1;
    await kv.put('expired', 'value', { expiration: pastExpiration });

    const result = await kv.get('expired');
    expect(result).toBeNull();

    // Verify it was deleted (second get should also return null)
    const result2 = await kv.get('expired');
    expect(result2).toBeNull();
  });

  it('expired key excluded from list', async () => {
    const pastExpiration = Math.floor(Date.now() / 1000) - 1;
    await kv.put('active', 'yes');
    await kv.put('expired', 'no', { expiration: pastExpiration });

    const result = await kv.list();
    expect(result.keys.map((k) => k.name)).toEqual(['active']);
  });

  it('list returns expiration info for non-expired keys', async () => {
    const futureExpiration = Math.floor(Date.now() / 1000) + 3600;
    await kv.put('temp', 'value', { expiration: futureExpiration });

    const result = await kv.list();
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].expiration).toBe(futureExpiration);
  });
});

// =========================================================================
// List with prefix and pagination
// =========================================================================

describe('AtuaKV — List', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('list with prefix filtering', async () => {
    await kv.put('users:alice', 'a');
    await kv.put('users:bob', 'b');
    await kv.put('posts:1', 'p');

    const result = await kv.list({ prefix: 'users:' });
    expect(result.keys).toHaveLength(2);
    expect(result.keys.map((k) => k.name)).toEqual(['users:alice', 'users:bob']);
    expect(result.list_complete).toBe(true);
  });

  it('list with cursor pagination', async () => {
    // Insert 5 keys
    for (let i = 0; i < 5; i++) {
      await kv.put(`key-${i}`, `val-${i}`);
    }

    // First page: limit 2
    const page1 = await kv.list({ limit: 2 });
    expect(page1.keys).toHaveLength(2);
    expect(page1.list_complete).toBe(false);
    expect(page1.cursor).toBeDefined();

    // Second page
    const page2 = await kv.list({ limit: 2, cursor: page1.cursor });
    expect(page2.keys).toHaveLength(2);
    expect(page2.list_complete).toBe(false);

    // Third page (final)
    const page3 = await kv.list({ limit: 2, cursor: page2.cursor });
    expect(page3.keys).toHaveLength(1);
    expect(page3.list_complete).toBe(true);
    expect(page3.cursor).toBeUndefined();

    // All keys collected
    const allKeys = [
      ...page1.keys.map((k) => k.name),
      ...page2.keys.map((k) => k.name),
      ...page3.keys.map((k) => k.name),
    ];
    expect(allKeys).toHaveLength(5);
  });

  it('list returns empty when no keys match', async () => {
    await kv.put('key1', 'v1');
    const result = await kv.list({ prefix: 'nonexistent:' });
    expect(result.keys).toHaveLength(0);
    expect(result.list_complete).toBe(true);
  });

  it('list returns keys in lexicographic order', async () => {
    await kv.put('c', '3');
    await kv.put('a', '1');
    await kv.put('b', '2');

    const result = await kv.list();
    expect(result.keys.map((k) => k.name)).toEqual(['a', 'b', 'c']);
  });
});

// =========================================================================
// getWithMetadata
// =========================================================================

describe('AtuaKV — getWithMetadata', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('returns value and metadata', async () => {
    await kv.put('key', 'value', {
      metadata: { role: 'admin', count: 42 },
    });

    const result = await kv.getWithMetadata('key');
    expect(result.value).toBe('value');
    expect(result.metadata).toEqual({ role: 'admin', count: 42 });
  });

  it('returns null metadata when none stored', async () => {
    await kv.put('key', 'value');
    const result = await kv.getWithMetadata('key');
    expect(result.value).toBe('value');
    expect(result.metadata).toBeNull();
  });

  it('returns null for non-existent key', async () => {
    const result = await kv.getWithMetadata('missing');
    expect(result.value).toBeNull();
    expect(result.metadata).toBeNull();
  });

  it('returns null for expired key', async () => {
    const pastExpiration = Math.floor(Date.now() / 1000) - 1;
    await kv.put('expired', 'value', {
      expiration: pastExpiration,
      metadata: { test: true },
    });

    const result = await kv.getWithMetadata('expired');
    expect(result.value).toBeNull();
    expect(result.metadata).toBeNull();
  });

  it('metadata in list results matches stored metadata', async () => {
    await kv.put('key', 'value', { metadata: { tag: 'important' } });
    const list = await kv.list();
    expect(list.keys[0].metadata).toEqual({ tag: 'important' });
  });
});

// =========================================================================
// Large values
// =========================================================================

describe('AtuaKV — Large Values', () => {
  beforeEach(() => {
    kv = createKV();
  });

  it('handles 1MB+ text value', async () => {
    const largeValue = 'x'.repeat(1024 * 1024); // 1MB
    await kv.put('large', largeValue);

    const result = await kv.get('large');
    expect(result).toBe(largeValue);
    expect((result as string).length).toBe(1024 * 1024);
  });

  it('handles 1MB+ ArrayBuffer value', async () => {
    const size = 1024 * 1024; // 1MB
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = i % 256;
    }

    await kv.put('large-bin', data.buffer);
    const result = await kv.get('large-bin', 'arrayBuffer') as ArrayBuffer;
    expect(result.byteLength).toBe(size);

    const resultView = new Uint8Array(result);
    expect(resultView[0]).toBe(0);
    expect(resultView[255]).toBe(255);
    expect(resultView[256]).toBe(0);
  });
});
