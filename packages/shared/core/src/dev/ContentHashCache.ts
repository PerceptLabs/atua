/**
 * ContentHashCache — SHA-256 content-addressed build cache
 *
 * Computes a hash of sorted source file paths+contents.
 * If the hash matches a previous build, returns cached output.
 * Retains last N builds (default 10).
 */

export interface CachedBuild {
  code: string;
  outputPath: string;
}

export class ContentHashCache {
  private cache = new Map<string, CachedBuild>();
  private maxEntries: number;

  constructor(maxEntries = 10) {
    this.maxEntries = maxEntries;
  }

  /** Compute SHA-256 hash of sorted source files */
  async computeHash(files: Map<string, string>): Promise<string> {
    const sortedPaths = [...files.keys()].sort();
    const content = sortedPaths.map((p) => `${p}:${files.get(p)}`).join('\n');

    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Get cached build by hash */
  get(hash: string): CachedBuild | undefined {
    return this.cache.get(hash);
  }

  /** Store a build result */
  set(hash: string, build: CachedBuild): void {
    this.cache.set(hash, build);

    // Evict oldest entries if over limit
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  /** Check if a hash is cached */
  has(hash: string): boolean {
    return this.cache.has(hash);
  }

  /** Clear all cached builds */
  clear(): void {
    this.cache.clear();
  }

  /** Number of cached builds */
  get size(): number {
    return this.cache.size;
  }
}
