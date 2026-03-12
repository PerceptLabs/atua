/**
 * PackageFetcher — Fetch package code from CDN or registry
 *
 * Primary: esm.sh CDN with ?cjs&bundle-deps for browser-ready CommonJS
 * Fallback: npm registry tarball
 */

export interface FetchedPackage {
  name: string;
  version: string;
  code: string;
  source: 'esm.sh' | 'registry';
}

export interface PackageFetcherConfig {
  cdnUrl?: string;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
}

export class PackageFetcher {
  private cdnUrl: string;
  private fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  private maxRetries: number;

  constructor(config: PackageFetcherConfig = {}) {
    this.cdnUrl = (config.cdnUrl ?? 'https://esm.sh').replace(/\/$/, '');
    this.fetchFn = config.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init));
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Fetch package code from esm.sh CDN.
   * Uses ?cjs&bundle-deps to get a single CommonJS-compatible file with
   * all dependencies bundled.
   */
  async fetch(name: string, version: string): Promise<FetchedPackage> {
    try {
      return await this.fetchFromCdn(name, version);
    } catch (cdnError: any) {
      try {
        return await this.fetchFromRegistry(name, version);
      } catch (registryError: any) {
        throw new Error(
          `FETCH_PACKAGE_ERROR: Failed to fetch ${name}@${version} ` +
            `(CDN: ${cdnError.message}, Registry: ${registryError.message})`,
        );
      }
    }
  }

  /** Fetch from esm.sh CDN */
  private async fetchFromCdn(name: string, version: string): Promise<FetchedPackage> {
    const url = `${this.cdnUrl}/${name}@${version}?cjs&bundle-deps`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const code = await response.text();

        if (!code || code.length === 0) {
          throw new Error('Empty response from CDN');
        }

        if (code.includes('<!DOCTYPE html>') || code.includes('<html>')) {
          throw new Error('CDN returned HTML error page');
        }

        return { name, version, code, source: 'esm.sh' };
      } catch (err: any) {
        lastError = err;
        if (attempt < this.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
        }
      }
    }

    throw lastError ?? new Error(`Failed to fetch from CDN after ${this.maxRetries} attempts`);
  }

  /** Fetch from npm registry (tarball) — simplified extraction */
  private async fetchFromRegistry(name: string, version: string): Promise<FetchedPackage> {
    const tarballName = name.startsWith('@')
      ? name.replace(/^@/, '').replace(/\//, '-')
      : name;
    const url = `https://registry.npmjs.org/${name}/-/${tarballName}-${version}.tgz`;

    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const code = await this.extractMainFromTarball(new Uint8Array(buffer), name);
    return { name, version, code, source: 'registry' };
  }

  /** Extract main entry from a .tgz tarball */
  private async extractMainFromTarball(data: Uint8Array, name: string): Promise<string> {
    // Decompress gzip using browser-native DecompressionStream
    let decompressed: Uint8Array;
    try {
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      const chunks: Uint8Array[] = [];
      await writer.write(data as any);
      await writer.close();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      decompressed = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }
    } catch {
      throw new Error('Failed to decompress tarball');
    }

    // Parse tar (simplified — TAR uses 512-byte blocks)
    const decoder = new TextDecoder();
    let packageJson: any = null;
    const files = new Map<string, string>();

    let pos = 0;
    while (pos + 512 <= decompressed.length) {
      const header = decompressed.slice(pos, pos + 512);
      const fileName = decoder.decode(header.slice(0, 100)).replace(/\0/g, '').trim();
      if (!fileName) break;

      const sizeStr = decoder.decode(header.slice(124, 136)).replace(/\0/g, '').trim();
      const fileSize = parseInt(sizeStr, 8) || 0;

      pos += 512;
      if (fileSize > 0) {
        const content = decoder.decode(decompressed.slice(pos, pos + fileSize));
        const cleanName = fileName.replace(/^package\//, '');
        files.set(cleanName, content);

        if (cleanName === 'package.json') {
          try {
            packageJson = JSON.parse(content);
          } catch {}
        }
      }

      pos += Math.ceil(fileSize / 512) * 512;
    }

    const mainFile = packageJson?.main || 'index.js';
    const code = files.get(mainFile) || files.get('index.js') || files.get('dist/index.js');

    if (!code) {
      throw new Error(`No main entry found in tarball for ${name}`);
    }

    return code;
  }
}
