/**
 * AtuaR2 — Browser tests
 *
 * All tests run in Chromium via Vitest browser mode.
 * Uses real IndexedDB (no mocks).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtuaR2 } from './r2.js';

let r2: AtuaR2;
let bucketCounter = 0;

function createR2(): AtuaR2 {
  return new AtuaR2(`test-${Date.now()}-${bucketCounter++}`);
}

afterEach(() => {
  if (r2) r2.destroy();
});

// =========================================================================
// Basic put/get — text content
// =========================================================================

describe('AtuaR2 — Text Content', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('put/get text content', async () => {
    await r2.put('hello.txt', 'Hello, World!');
    const obj = await r2.get('hello.txt');
    expect(obj).not.toBeNull();

    const text = await obj!.text();
    expect(text).toBe('Hello, World!');
  });

  it('get non-existent key returns null', async () => {
    const result = await r2.get('missing');
    expect(result).toBeNull();
  });

  it('put overwrites existing object', async () => {
    await r2.put('file.txt', 'v1');
    await r2.put('file.txt', 'v2');

    const obj = await r2.get('file.txt');
    const text = await obj!.text();
    expect(text).toBe('v2');
  });

  it('delete removes object', async () => {
    await r2.put('file.txt', 'data');
    await r2.delete('file.txt');

    const result = await r2.get('file.txt');
    expect(result).toBeNull();
  });

  it('delete multiple keys', async () => {
    await r2.put('a.txt', 'a');
    await r2.put('b.txt', 'b');
    await r2.delete(['a.txt', 'b.txt']);

    expect(await r2.get('a.txt')).toBeNull();
    expect(await r2.get('b.txt')).toBeNull();
  });
});

// =========================================================================
// Binary content (ArrayBuffer)
// =========================================================================

describe('AtuaR2 — Binary Content', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('put/get binary content (ArrayBuffer)', async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await r2.put('image.png', data.buffer);

    const obj = await r2.get('image.png');
    expect(obj).not.toBeNull();

    const result = await obj!.arrayBuffer();
    const resultView = new Uint8Array(result);
    expect(resultView).toEqual(data);
  });

  it('binary content size is correct', async () => {
    const data = new Uint8Array(1024);
    await r2.put('1kb.bin', data.buffer);

    const obj = await r2.get('1kb.bin');
    expect(obj!.size).toBe(1024);
  });
});

// =========================================================================
// Stream content (ReadableStream)
// =========================================================================

describe('AtuaR2 — Stream Content', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('put/get stream content (ReadableStream)', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk1'));
        controller.enqueue(new TextEncoder().encode('chunk2'));
        controller.close();
      },
    });

    await r2.put('streamed.txt', stream);

    const obj = await r2.get('streamed.txt');
    expect(obj).not.toBeNull();

    const text = await obj!.text();
    expect(text).toBe('chunk1chunk2');
  });

  it('get body is a ReadableStream', async () => {
    await r2.put('file.txt', 'stream test');

    const obj = await r2.get('file.txt');
    expect(obj!.body).toBeInstanceOf(ReadableStream);

    const reader = obj!.body.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe('stream test');
  });

  it('json() helper parses JSON content', async () => {
    await r2.put('data.json', JSON.stringify({ foo: 'bar' }));

    const obj = await r2.get('data.json');
    const data = await obj!.json();
    expect(data).toEqual({ foo: 'bar' });
  });

  it('blob() helper returns Blob with content type', async () => {
    await r2.put('doc.html', '<h1>Hello</h1>', {
      httpMetadata: { contentType: 'text/html' },
    });

    const obj = await r2.get('doc.html');
    const blob = await obj!.blob();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/html');
    expect(await blob.text()).toBe('<h1>Hello</h1>');
  });
});

// =========================================================================
// Metadata sidecar
// =========================================================================

describe('AtuaR2 — Metadata', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('httpMetadata round-trips', async () => {
    await r2.put('file.css', 'body {}', {
      httpMetadata: {
        contentType: 'text/css',
        contentEncoding: 'utf-8',
        cacheControl: 'max-age=3600',
      },
    });

    const obj = await r2.get('file.css');
    expect(obj!.httpMetadata?.contentType).toBe('text/css');
    expect(obj!.httpMetadata?.contentEncoding).toBe('utf-8');
    expect(obj!.httpMetadata?.cacheControl).toBe('max-age=3600');
  });

  it('customMetadata round-trips', async () => {
    await r2.put('file.txt', 'data', {
      customMetadata: {
        author: 'alice',
        version: '2.0',
      },
    });

    const obj = await r2.get('file.txt');
    expect(obj!.customMetadata).toEqual({
      author: 'alice',
      version: '2.0',
    });
  });

  it('metadata available on both get and head', async () => {
    await r2.put('file.txt', 'data', {
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { tag: 'test' },
    });

    const getObj = await r2.get('file.txt');
    const headObj = await r2.head('file.txt');

    expect(getObj!.httpMetadata?.contentType).toBe('text/plain');
    expect(headObj!.httpMetadata?.contentType).toBe('text/plain');
    expect(getObj!.customMetadata).toEqual({ tag: 'test' });
    expect(headObj!.customMetadata).toEqual({ tag: 'test' });
  });

  it('etag is generated on put', async () => {
    await r2.put('file.txt', 'hello');
    const obj = await r2.get('file.txt');
    expect(obj!.etag).toBeDefined();
    expect(typeof obj!.etag).toBe('string');
    expect(obj!.etag.length).toBeGreaterThan(0);
  });

  it('uploaded timestamp is set', async () => {
    const before = Date.now();
    await r2.put('file.txt', 'hello');
    const after = Date.now();

    const obj = await r2.get('file.txt');
    expect(obj!.uploaded).toBeInstanceOf(Date);
    expect(obj!.uploaded.getTime()).toBeGreaterThanOrEqual(before);
    expect(obj!.uploaded.getTime()).toBeLessThanOrEqual(after);
  });
});

// =========================================================================
// List operations
// =========================================================================

describe('AtuaR2 — List', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('list with prefix filtering', async () => {
    await r2.put('images/a.png', 'a');
    await r2.put('images/b.png', 'b');
    await r2.put('docs/c.pdf', 'c');

    const result = await r2.list({ prefix: 'images/' });
    expect(result.objects).toHaveLength(2);
    expect(result.objects.map((o) => o.key)).toEqual(['images/a.png', 'images/b.png']);
  });

  it('list with delimiter groups by prefix', async () => {
    await r2.put('photos/2024/jan.jpg', 'a');
    await r2.put('photos/2024/feb.jpg', 'b');
    await r2.put('photos/2025/jan.jpg', 'c');
    await r2.put('photos/cover.jpg', 'd');

    const result = await r2.list({ prefix: 'photos/', delimiter: '/' });

    // Objects without further delimiter after prefix
    const objectKeys = result.objects.map((o) => o.key);
    expect(objectKeys).toContain('photos/cover.jpg');

    // Delimited prefixes (common "directories")
    expect(result.delimitedPrefixes).toContain('photos/2024/');
    expect(result.delimitedPrefixes).toContain('photos/2025/');
  });

  it('list with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await r2.put(`file-${i}.txt`, `content-${i}`);
    }

    const page1 = await r2.list({ limit: 2 });
    expect(page1.objects).toHaveLength(2);
    expect(page1.truncated).toBe(true);
    expect(page1.cursor).toBeDefined();

    const page2 = await r2.list({ limit: 2, cursor: page1.cursor });
    expect(page2.objects).toHaveLength(2);
    expect(page2.truncated).toBe(true);

    const page3 = await r2.list({ limit: 2, cursor: page2.cursor });
    expect(page3.objects).toHaveLength(1);
    expect(page3.truncated).toBe(false);
    expect(page3.cursor).toBeUndefined();
  });

  it('list returns objects with metadata', async () => {
    await r2.put('file.txt', 'data', {
      httpMetadata: { contentType: 'text/plain' },
      customMetadata: { version: '1' },
    });

    const result = await r2.list();
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].key).toBe('file.txt');
    expect(result.objects[0].size).toBeGreaterThan(0);
    expect(result.objects[0].etag).toBeDefined();
    expect(result.objects[0].httpMetadata?.contentType).toBe('text/plain');
    expect(result.objects[0].customMetadata?.version).toBe('1');
  });

  it('list returns empty for no matches', async () => {
    const result = await r2.list({ prefix: 'nonexistent/' });
    expect(result.objects).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});

// =========================================================================
// Head operation
// =========================================================================

describe('AtuaR2 — Head', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('head returns metadata without body', async () => {
    await r2.put('file.txt', 'hello world', {
      httpMetadata: { contentType: 'text/plain' },
    });

    const meta = await r2.head('file.txt');
    expect(meta).not.toBeNull();
    expect(meta!.key).toBe('file.txt');
    expect(meta!.size).toBe(11); // "hello world" = 11 bytes
    expect(meta!.httpMetadata?.contentType).toBe('text/plain');

    // Head result should NOT have body property
    expect((meta as any).body).toBeUndefined();
    expect((meta as any).text).toBeUndefined();
  });

  it('head returns null for non-existent key', async () => {
    const result = await r2.head('missing');
    expect(result).toBeNull();
  });
});

// =========================================================================
// Nested key paths
// =========================================================================

describe('AtuaR2 — Nested Key Paths', () => {
  beforeEach(() => {
    r2 = createR2();
  });

  it('handles nested key paths (foo/bar/baz.txt)', async () => {
    await r2.put('foo/bar/baz.txt', 'deep content');

    const obj = await r2.get('foo/bar/baz.txt');
    expect(obj).not.toBeNull();

    const text = await obj!.text();
    expect(text).toBe('deep content');
    expect(obj!.key).toBe('foo/bar/baz.txt');
  });

  it('nested keys listed correctly with prefix', async () => {
    await r2.put('a/b/c.txt', '1');
    await r2.put('a/b/d.txt', '2');
    await r2.put('a/e.txt', '3');

    const result = await r2.list({ prefix: 'a/b/' });
    expect(result.objects).toHaveLength(2);
    expect(result.objects.map((o) => o.key)).toEqual(['a/b/c.txt', 'a/b/d.txt']);
  });

  it('deeply nested paths preserve full key', async () => {
    const deepKey = 'level1/level2/level3/level4/file.txt';
    await r2.put(deepKey, 'deep');

    const head = await r2.head(deepKey);
    expect(head!.key).toBe(deepKey);

    const list = await r2.list({ prefix: 'level1/level2/level3/' });
    expect(list.objects).toHaveLength(1);
    expect(list.objects[0].key).toBe(deepKey);
  });
});
