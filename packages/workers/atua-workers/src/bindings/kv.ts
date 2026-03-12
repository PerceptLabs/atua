/**
 * AtuaKV — Cloudflare Workers KV emulation backed by IndexedDB.
 *
 * API shape matches Cloudflare's published KV namespace binding.
 * Values stored as strings/ArrayBuffer in IDB with optional metadata and TTL.
 * Lazy expiration on get (check, delete if expired, return null).
 */
import type {
  KVGetType,
  KVPutOptions,
  KVListOptions,
  KVListResult,
  KVListKey,
  KVValueWithMetadata,
} from './types.js';

/** Internal storage record in IndexedDB */
interface KVRecord {
  /** The stored value as a string or ArrayBuffer */
  value: string | ArrayBuffer;
  /** Whether the value is binary (ArrayBuffer) */
  binary: boolean;
  /** Optional JSON metadata */
  metadata?: Record<string, unknown>;
  /** Expiration as Unix timestamp in seconds, or undefined for no expiration */
  expiration?: number;
}

const STORE_NAME = 'kv-entries';

export class AtuaKV {
  private readonly dbName: string;
  private db: IDBDatabase | null = null;

  constructor(namespace: string) {
    this.dbName = `catalyst-kv-${namespace}`;
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
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
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

  private async idbGet(key: string): Promise<KVRecord | undefined> {
    const db = await this.getDB();
    return new Promise<KVRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as KVRecord | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  private async idbPut(key: string, record: KVRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(record, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async idbGetAllKeys(): Promise<string[]> {
    const db = await this.getDB();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }

  /** Check if a record is expired. Deletes it and returns true if so. */
  private isExpired(record: KVRecord): boolean {
    if (record.expiration === undefined) return false;
    return Math.floor(Date.now() / 1000) >= record.expiration;
  }

  // -----------------------------------------------------------------------
  // Public API — matches Cloudflare KV binding
  // -----------------------------------------------------------------------

  /**
   * Get a value by key.
   * Returns null if key doesn't exist or is expired.
   */
  async get(key: string, typeOrOptions?: KVGetType | { type?: KVGetType }): Promise<unknown> {
    const type: KVGetType = typeof typeOrOptions === 'string'
      ? typeOrOptions
      : typeOrOptions?.type ?? 'text';

    const record = await this.idbGet(key);
    if (!record) return null;

    // Lazy expiration
    if (this.isExpired(record)) {
      await this.idbDelete(key);
      return null;
    }

    return this.convertValue(record, type);
  }

  /**
   * Put a value by key with optional expiration and metadata.
   */
  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: KVPutOptions,
  ): Promise<void> {
    let storedValue: string | ArrayBuffer;
    let binary = false;

    if (value instanceof ReadableStream) {
      // Read the stream into an ArrayBuffer
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
      storedValue = combined.buffer;
      binary = true;
    } else if (value instanceof ArrayBuffer) {
      storedValue = value;
      binary = true;
    } else {
      storedValue = value;
    }

    let expiration: number | undefined;
    if (options?.expiration !== undefined) {
      expiration = options.expiration;
    } else if (options?.expirationTtl !== undefined) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }

    const record: KVRecord = {
      value: storedValue,
      binary,
      metadata: options?.metadata,
      expiration,
    };

    await this.idbPut(key, record);
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    await this.idbDelete(key);
  }

  /**
   * List keys with optional prefix filtering and pagination.
   */
  async list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const cursorOffset = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const allKeys = await this.idbGetAllKeys();

    // Filter by prefix and check expiration
    const matchingKeys: KVListKey[] = [];
    const expiredKeys: string[] = [];

    for (const key of allKeys) {
      if (prefix && !key.startsWith(prefix)) continue;

      const record = await this.idbGet(key);
      if (!record) continue;

      if (this.isExpired(record)) {
        expiredKeys.push(key);
        continue;
      }

      matchingKeys.push({
        name: key,
        expiration: record.expiration,
        metadata: record.metadata,
      });
    }

    // Clean up expired keys in the background
    for (const key of expiredKeys) {
      this.idbDelete(key).catch(() => {});
    }

    // Sort by key name (Cloudflare KV lists are lexicographically sorted)
    matchingKeys.sort((a, b) => a.name.localeCompare(b.name));

    // Apply cursor (offset-based pagination)
    const sliced = matchingKeys.slice(cursorOffset, cursorOffset + limit);
    const listComplete = cursorOffset + limit >= matchingKeys.length;

    const result: KVListResult = {
      keys: sliced,
      list_complete: listComplete,
    };

    if (!listComplete) {
      result.cursor = String(cursorOffset + limit);
    }

    return result;
  }

  /**
   * Get a value with its metadata.
   */
  async getWithMetadata(
    key: string,
    type?: KVGetType,
  ): Promise<KVValueWithMetadata> {
    const record = await this.idbGet(key);
    if (!record) {
      return { value: null, metadata: null };
    }

    // Lazy expiration
    if (this.isExpired(record)) {
      await this.idbDelete(key);
      return { value: null, metadata: null };
    }

    const value = await this.convertValue(record, type ?? 'text');
    return {
      value,
      metadata: record.metadata ?? null,
    };
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

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private convertValue(record: KVRecord, type: KVGetType): unknown {
    switch (type) {
      case 'text':
        if (record.binary) {
          return new TextDecoder().decode(record.value as ArrayBuffer);
        }
        return record.value;

      case 'json':
        if (record.binary) {
          const text = new TextDecoder().decode(record.value as ArrayBuffer);
          return JSON.parse(text);
        }
        return JSON.parse(record.value as string);

      case 'arrayBuffer':
        if (record.binary) {
          return record.value;
        }
        return new TextEncoder().encode(record.value as string).buffer;

      case 'stream': {
        let bytes: Uint8Array;
        if (record.binary) {
          bytes = new Uint8Array(record.value as ArrayBuffer);
        } else {
          bytes = new TextEncoder().encode(record.value as string);
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      }

      default:
        return record.value;
    }
  }
}
