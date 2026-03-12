/**
 * AtuaR2 — Cloudflare Workers R2 emulation backed by IndexedDB.
 *
 * API shape matches Cloudflare's published R2 bucket binding.
 * Object data stored in one IDB object store, metadata in a sidecar store.
 * Supports text, binary (ArrayBuffer), and stream content.
 */
import type {
  R2PutOptions,
  R2ListOptions,
  R2ObjectMetadata,
  R2ObjectBody,
  R2Objects,
  R2HttpMetadata,
} from './types.js';

/** Internal storage record in IndexedDB */
interface R2Record {
  /** Object body as ArrayBuffer */
  body: ArrayBuffer;
  /** HTTP metadata (contentType, etc.) */
  httpMetadata?: R2HttpMetadata;
  /** User-defined custom metadata */
  customMetadata?: Record<string, string>;
  /** Size in bytes */
  size: number;
  /** ETag (MD5 hex of content) */
  etag: string;
  /** Upload timestamp */
  uploaded: number;
}

const OBJECTS_STORE = 'r2-objects';

export class AtuaR2 {
  private readonly dbName: string;
  private db: IDBDatabase | null = null;

  constructor(bucketName: string) {
    this.dbName = `atua-r2-${bucketName}`;
  }

  // -----------------------------------------------------------------------
  // IDB helpers
  // -----------------------------------------------------------------------

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OBJECTS_STORE)) {
          db.createObjectStore(OBJECTS_STORE);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${this.dbName}`));
      };
    });
  }

  private async idbGet(key: string): Promise<R2Record | undefined> {
    const db = await this.getDB();
    return new Promise<R2Record | undefined>((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readonly');
      const store = tx.objectStore(OBJECTS_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as R2Record | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbPut(key: string, record: R2Record): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readwrite');
      const store = tx.objectStore(OBJECTS_STORE);
      const request = store.put(record, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readwrite');
      const store = tx.objectStore(OBJECTS_STORE);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async idbGetAllKeys(): Promise<string[]> {
    const db = await this.getDB();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, 'readonly');
      const store = tx.objectStore(OBJECTS_STORE);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Generate a simple ETag from content bytes */
  private generateEtag(data: ArrayBuffer): string {
    // Simple hash: use FNV-1a for speed (not crypto, just an identifier)
    const bytes = new Uint8Array(data);
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /** Convert input value to ArrayBuffer */
  private async toArrayBuffer(
    value: string | ArrayBuffer | ReadableStream | Blob,
  ): Promise<ArrayBuffer> {
    if (typeof value === 'string') {
      return new TextEncoder().encode(value).buffer;
    }
    if (value instanceof ArrayBuffer) {
      return value;
    }
    if (value instanceof Blob) {
      return value.arrayBuffer();
    }
    // ReadableStream
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        chunks.push(new Uint8Array(result.value));
      }
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined.buffer;
  }

  /** Build an R2ObjectBody from a stored record */
  private buildObjectBody(key: string, record: R2Record): R2ObjectBody {
    let bodyUsed = false;
    const bodyBuffer = record.body;

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bodyBuffer));
        controller.close();
      },
    });

    return {
      key,
      size: record.size,
      etag: record.etag,
      uploaded: new Date(record.uploaded),
      httpMetadata: record.httpMetadata,
      customMetadata: record.customMetadata,
      body,
      get bodyUsed() {
        return bodyUsed;
      },
      async text(): Promise<string> {
        bodyUsed = true;
        return new TextDecoder().decode(bodyBuffer);
      },
      async json<T = unknown>(): Promise<T> {
        bodyUsed = true;
        return JSON.parse(new TextDecoder().decode(bodyBuffer));
      },
      async arrayBuffer(): Promise<ArrayBuffer> {
        bodyUsed = true;
        return bodyBuffer.slice(0);
      },
      async blob(): Promise<Blob> {
        bodyUsed = true;
        const contentType = record.httpMetadata?.contentType ?? 'application/octet-stream';
        return new Blob([bodyBuffer], { type: contentType });
      },
    };
  }

  /** Build metadata-only object (for head, list) */
  private buildMetadata(key: string, record: R2Record): R2ObjectMetadata {
    return {
      key,
      size: record.size,
      etag: record.etag,
      uploaded: new Date(record.uploaded),
      httpMetadata: record.httpMetadata,
      customMetadata: record.customMetadata,
    };
  }

  // -----------------------------------------------------------------------
  // Public API — matches Cloudflare R2 binding
  // -----------------------------------------------------------------------

  /**
   * Get an object by key. Returns null if not found.
   */
  async get(key: string): Promise<R2ObjectBody | null> {
    const record = await this.idbGet(key);
    if (!record) return null;
    return this.buildObjectBody(key, record);
  }

  /**
   * Put an object into the bucket.
   */
  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream | Blob,
    options?: R2PutOptions,
  ): Promise<R2ObjectBody> {
    const body = await this.toArrayBuffer(value);
    const etag = this.generateEtag(body);

    const record: R2Record = {
      body,
      size: body.byteLength,
      etag,
      uploaded: Date.now(),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    };

    await this.idbPut(key, record);
    return this.buildObjectBody(key, record);
  }

  /**
   * Delete one or more objects by key.
   */
  async delete(keys: string | string[]): Promise<void> {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      await this.idbDelete(key);
    }
  }

  /**
   * List objects with optional prefix, delimiter, and pagination.
   */
  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const delimiter = options?.delimiter;
    const cursorOffset = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const allKeys = await this.idbGetAllKeys();

    // Filter by prefix
    const matchingKeys = allKeys.filter((key) => key.startsWith(prefix));
    matchingKeys.sort();

    // Handle delimiter — find common prefixes
    const delimitedPrefixes: string[] = [];
    const objectKeys: string[] = [];

    if (delimiter) {
      const seen = new Set<string>();
      for (const key of matchingKeys) {
        const rest = key.slice(prefix.length);
        const delimiterIdx = rest.indexOf(delimiter);
        if (delimiterIdx >= 0) {
          const commonPrefix = prefix + rest.slice(0, delimiterIdx + delimiter.length);
          if (!seen.has(commonPrefix)) {
            seen.add(commonPrefix);
            delimitedPrefixes.push(commonPrefix);
          }
        } else {
          objectKeys.push(key);
        }
      }
    } else {
      objectKeys.push(...matchingKeys);
    }

    // Build metadata for each matching object
    const objects: R2ObjectMetadata[] = [];
    for (const key of objectKeys) {
      const record = await this.idbGet(key);
      if (record) {
        objects.push(this.buildMetadata(key, record));
      }
    }

    // Apply cursor and limit
    const sliced = objects.slice(cursorOffset, cursorOffset + limit);
    const truncated = cursorOffset + limit < objects.length;

    const result: R2Objects = {
      objects: sliced,
      truncated,
      delimitedPrefixes,
    };

    if (truncated) {
      result.cursor = String(cursorOffset + limit);
    }

    return result;
  }

  /**
   * Get object metadata without the body. Returns null if not found.
   */
  async head(key: string): Promise<R2ObjectMetadata | null> {
    const record = await this.idbGet(key);
    if (!record) return null;
    return this.buildMetadata(key, record);
  }

  /**
   * Close the underlying IndexedDB connection.
   */
  destroy(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
