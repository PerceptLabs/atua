/**
 * PackageCache — Manages installed packages in CatalystFS
 *
 * Stores packages at /node_modules/{name}/ with metadata tracking
 * for LRU eviction when cache size exceeds limits.
 */
import type { CatalystFS } from '../fs/CatalystFS.js';

export interface CacheEntry {
  name: string;
  version: string;
  installedAt: number;
  lastAccessed: number;
  size: number;
  source: string;
  integrity?: string;
}

export interface PackageCacheConfig {
  /** Max total cache size in bytes (default: 500MB) */
  maxSize?: number;
  /** Base path for node_modules (default: '/node_modules') */
  basePath?: string;
}

const METADATA_FILE = '.catalyst-cache.json';

export class PackageCache {
  private fs: CatalystFS;
  private maxSize: number;
  private basePath: string;
  private entries = new Map<string, CacheEntry>();
  private loaded = false;

  constructor(fs: CatalystFS, config: PackageCacheConfig = {}) {
    this.fs = fs;
    this.maxSize = config.maxSize ?? 500 * 1024 * 1024;
    this.basePath = config.basePath ?? '/node_modules';
  }

  /** Load metadata from filesystem */
  private loadMetadata(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const metaPath = `${this.basePath}/${METADATA_FILE}`;
      const content = this.fs.readFileSync(metaPath, 'utf-8') as string;
      const data = JSON.parse(content) as Record<string, CacheEntry>;
      for (const [name, entry] of Object.entries(data)) {
        this.entries.set(name, entry);
      }
    } catch {
      // No metadata file yet
    }
  }

  /** Save metadata to filesystem */
  private saveMetadata(): void {
    const data: Record<string, CacheEntry> = {};
    for (const [name, entry] of this.entries) {
      data[name] = entry;
    }

    this.ensureDir(this.basePath);
    const metaPath = `${this.basePath}/${METADATA_FILE}`;
    this.fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
  }

  /** Ensure a directory exists */
  private ensureDir(path: string): void {
    try {
      if (!this.fs.existsSync(path)) {
        this.fs.mkdirSync(path, { recursive: true });
      }
    } catch {}
  }

  /** Check if a package is cached */
  isCached(name: string, version?: string): boolean {
    this.loadMetadata();
    const entry = this.entries.get(name);
    if (!entry) return false;
    if (version && entry.version !== version) return false;

    // Update last accessed time
    entry.lastAccessed = Date.now();
    return true;
  }

  /** Get cache entry for a package */
  get(name: string): CacheEntry | undefined {
    this.loadMetadata();
    return this.entries.get(name);
  }

  /** Read the cached code for a package (from /node_modules/{name}/index.js) */
  getCode(name: string): string | null {
    this.loadMetadata();
    if (!this.entries.has(name)) return null;
    const codePath = `${this.basePath}/${name}/index.js`;
    try {
      return this.fs.readFileSync(codePath, 'utf-8') as string;
    } catch {
      return null;
    }
  }

  /** Store a package in the cache */
  store(
    name: string,
    version: string,
    code: string,
    opts: { source: string; integrity?: string } = { source: 'unknown' },
  ): void {
    this.loadMetadata();
    const pkgDir = `${this.basePath}/${name}`;

    this.ensureDir(this.basePath);
    this.ensureDir(pkgDir);

    // Write package files
    this.fs.writeFileSync(`${pkgDir}/index.js`, code);
    this.fs.writeFileSync(
      `${pkgDir}/package.json`,
      JSON.stringify({ name, version, main: 'index.js' }, null, 2),
    );

    const now = Date.now();
    this.entries.set(name, {
      name,
      version,
      installedAt: now,
      lastAccessed: now,
      size: code.length,
      source: opts.source,
      integrity: opts.integrity,
    });

    this.evictIfNeeded();
    this.saveMetadata();
  }

  /** Remove a package from the cache */
  remove(name: string): boolean {
    this.loadMetadata();

    if (!this.entries.has(name)) return false;

    const pkgDir = `${this.basePath}/${name}`;
    try {
      if (this.fs.existsSync(`${pkgDir}/index.js`)) {
        this.fs.unlinkSync(`${pkgDir}/index.js`);
      }
      if (this.fs.existsSync(`${pkgDir}/package.json`)) {
        this.fs.unlinkSync(`${pkgDir}/package.json`);
      }
      if (this.fs.existsSync(pkgDir)) {
        this.fs.rmdirSync(pkgDir);
      }
    } catch {
      // Best effort cleanup
    }

    this.entries.delete(name);
    this.saveMetadata();
    return true;
  }

  /** Invalidate a cached package (force re-fetch on next install) */
  invalidate(name: string): void {
    this.remove(name);
  }

  /** Get all cached package entries */
  list(): CacheEntry[] {
    this.loadMetadata();
    return [...this.entries.values()];
  }

  /** Get total cache size in bytes */
  get totalSize(): number {
    this.loadMetadata();
    let size = 0;
    for (const entry of this.entries.values()) {
      size += entry.size;
    }
    return size;
  }

  /** Evict least-recently-used packages until under maxSize */
  private evictIfNeeded(): void {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.size;
    }

    while (total > this.maxSize && this.entries.size > 0) {
      // Find LRU entry
      let lruName: string | null = null;
      let lruTime = Infinity;

      for (const [name, entry] of this.entries) {
        if (entry.lastAccessed < lruTime) {
          lruTime = entry.lastAccessed;
          lruName = name;
        }
      }

      if (lruName) {
        const entry = this.entries.get(lruName);
        if (entry) total -= entry.size;
        this.remove(lruName);
      } else {
        break;
      }
    }
  }

  /** Clear entire cache */
  clear(): void {
    this.loadMetadata();
    const names = [...this.entries.keys()];
    for (const name of names) {
      this.remove(name);
    }
  }

  /** Get the number of cached packages */
  get size(): number {
    this.loadMetadata();
    return this.entries.size;
  }
}
