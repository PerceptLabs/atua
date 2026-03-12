/**
 * BinaryCache — Cache for compiled WASI binaries
 *
 * Stores WASI .wasm binaries in AtuaFS with metadata.
 * Content-addressable via URL + SHA-256 hash.
 * LRU eviction when cache size exceeds limit.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';

export interface BinaryCacheEntry {
  url: string;
  hash: string;
  size: number;
  storedAt: number;
  lastAccessed: number;
  path: string; // AtuaFS path where binary is stored
}

export interface BinaryCacheConfig {
  /** AtuaFS instance */
  fs: AtuaFS;
  /** Cache directory path (default: /.wasi-cache) */
  cacheDir?: string;
  /** Max cache size in bytes (default: 100MB) */
  maxSize?: number;
}

const METADATA_FILE = '.wasi-cache-meta.json';

export class BinaryCache {
  private readonly fs: AtuaFS;
  private readonly cacheDir: string;
  private readonly maxSize: number;
  private entries: Map<string, BinaryCacheEntry> = new Map();
  private initialized = false;

  constructor(config: BinaryCacheConfig) {
    this.fs = config.fs;
    this.cacheDir = config.cacheDir ?? '/.wasi-cache';
    this.maxSize = config.maxSize ?? 100 * 1024 * 1024;
  }

  /** Initialize the cache — load metadata from disk */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    try {
      const metaPath = `${this.cacheDir}/${METADATA_FILE}`;
      const raw = this.fs.readFileSync(metaPath, 'utf-8') as string;
      const data = JSON.parse(raw);
      if (Array.isArray(data.entries)) {
        for (const entry of data.entries) {
          this.entries.set(entry.hash, entry);
        }
      }
    } catch {
      // No cache metadata yet
    }

    this.initialized = true;
  }

  /** Compute SHA-256 hash of binary data */
  async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /** Check if a binary is cached (by hash) */
  has(hash: string): boolean {
    return this.entries.has(hash);
  }

  /** Check if a binary is cached (by URL) */
  hasByUrl(url: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.url === url) return true;
    }
    return false;
  }

  /** Get a cached binary (by hash) */
  get(hash: string): Uint8Array | null {
    const entry = this.entries.get(hash);
    if (!entry) return null;

    try {
      const content = this.fs.readFileSync(entry.path);
      // Update last accessed time
      entry.lastAccessed = Date.now();
      this.saveMetadata();

      if (content instanceof ArrayBuffer) {
        return new Uint8Array(content);
      }
      if (typeof content === 'string') {
        return new TextEncoder().encode(content);
      }
      return new Uint8Array(content as ArrayBuffer);
    } catch {
      // File was deleted — remove from cache
      this.entries.delete(hash);
      this.saveMetadata();
      return null;
    }
  }

  /** Get a cached binary by URL */
  getByUrl(url: string): Uint8Array | null {
    for (const entry of this.entries.values()) {
      if (entry.url === url) {
        return this.get(entry.hash);
      }
    }
    return null;
  }

  /** Store a binary in the cache */
  async store(
    url: string,
    data: Uint8Array,
  ): Promise<BinaryCacheEntry> {
    await this.init();

    const hash = await this.computeHash(data);

    // Already cached
    const existing = this.entries.get(hash);
    if (existing) {
      existing.lastAccessed = Date.now();
      this.saveMetadata();
      return existing;
    }

    // Evict if needed
    await this.evictIfNeeded(data.length);

    // Store binary
    const path = `${this.cacheDir}/${hash}.wasm`;
    // Write binary data as string (base64-like encoding for binary safety)
    // Use a simple approach: store binary data
    this.fs.writeFileSync(path, this.uint8ToStorageString(data));

    const entry: BinaryCacheEntry = {
      url,
      hash,
      size: data.length,
      storedAt: Date.now(),
      lastAccessed: Date.now(),
      path,
    };

    this.entries.set(hash, entry);
    this.saveMetadata();
    return entry;
  }

  /** Remove a cached binary */
  remove(hash: string): boolean {
    const entry = this.entries.get(hash);
    if (!entry) return false;

    try {
      this.fs.unlinkSync(entry.path);
    } catch {
      // File may already be gone
    }

    this.entries.delete(hash);
    this.saveMetadata();
    return true;
  }

  /** Clear the entire cache */
  clear(): void {
    for (const entry of this.entries.values()) {
      try {
        this.fs.unlinkSync(entry.path);
      } catch {
        // Ignore
      }
    }
    this.entries.clear();
    this.saveMetadata();
  }

  /** Get total cached size in bytes */
  get totalSize(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.size;
    }
    return total;
  }

  /** Get number of cached entries */
  get count(): number {
    return this.entries.size;
  }

  /** List all cached entries */
  list(): BinaryCacheEntry[] {
    return [...this.entries.values()];
  }

  // --- Private ---

  private async evictIfNeeded(newSize: number): Promise<void> {
    while (this.totalSize + newSize > this.maxSize && this.entries.size > 0) {
      // Find LRU entry
      let lruHash: string | null = null;
      let lruTime = Infinity;
      for (const [hash, entry] of this.entries) {
        if (entry.lastAccessed < lruTime) {
          lruTime = entry.lastAccessed;
          lruHash = hash;
        }
      }
      if (lruHash) {
        this.remove(lruHash);
      } else {
        break;
      }
    }
  }

  private saveMetadata(): void {
    try {
      const metaPath = `${this.cacheDir}/${METADATA_FILE}`;
      const data = {
        version: 1,
        entries: [...this.entries.values()],
      };
      this.fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
    } catch {
      // Metadata save failure is non-fatal
    }
  }

  /** Convert Uint8Array to a string safe for AtuaFS storage */
  private uint8ToStorageString(data: Uint8Array): string {
    // Use base64 encoding for binary-safe storage
    const chunks: string[] = [];
    const chunkSize = 8192;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode(...chunk));
    }
    return btoa(chunks.join(''));
  }

  /** Convert storage string back to Uint8Array */
  static storageStringToUint8(str: string): Uint8Array {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
