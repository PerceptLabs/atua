/**
 * PackageManager — Orchestrates package installation, resolution, and caching
 *
 * Phase 17: Lockfile enforcement with dev/locked modes.
 *
 * API:
 * - install(name, version?) — resolve, fetch, cache
 * - installAll(packageJsonPath?) — read package.json, install all deps
 * - resolve(name) — check if package is in /node_modules/
 * - remove(name) — remove from cache + lockfile
 * - clear() — wipe entire cache
 * - list() — list installed packages
 *
 * Modes:
 * - 'dev' (default): resolve from esm.sh, auto-generate lockfile with SHA-256 integrity
 * - 'locked': require lockfile, unknown specifiers = hard error, integrity verification
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import { NpmResolver, type NpmResolverConfig } from './NpmResolver.js';
import { PackageFetcher, type PackageFetcherConfig } from './PackageFetcher.js';
import { PackageCache, type PackageCacheConfig } from './PackageCache.js';
import { PackageJson } from './PackageJson.js';
import { Lockfile } from './Lockfile.js';

export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  cached: boolean;
}

export type PackageMode = 'dev' | 'locked';

export interface PackageManagerConfig {
  fs: CatalystFS;
  resolver?: NpmResolverConfig;
  fetcher?: PackageFetcherConfig;
  cache?: PackageCacheConfig;
  lockfilePath?: string;
  /** Package resolution mode:
   *  - 'dev' (default): resolve from esm.sh, auto-generate lockfile with integrity hashes
   *  - 'locked': require lockfile, unknown specifiers = hard error, integrity verification
   */
  mode?: PackageMode;
}

/** Compute SHA-256 hex hash of a string */
async function sha256(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256-' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class PackageManager {
  private fs: CatalystFS;
  private resolver: NpmResolver;
  private fetcher: PackageFetcher;
  private cache: PackageCache;
  private lockfile: Lockfile;
  private lockfilePath: string;
  private mode: PackageMode;

  constructor(config: PackageManagerConfig) {
    this.fs = config.fs;
    this.resolver = new NpmResolver(config.resolver);
    this.fetcher = new PackageFetcher(config.fetcher);
    this.cache = new PackageCache(config.fs, config.cache);
    this.lockfilePath = config.lockfilePath ?? '/catalyst-lock.json';
    this.mode = config.mode ?? 'dev';

    if (this.mode === 'locked') {
      // In locked mode, lockfile must exist and be non-empty
      const lf = Lockfile.read(config.fs, this.lockfilePath);
      if (lf.size === 0) {
        // Check if file actually exists
        try {
          config.fs.readFileSync(this.lockfilePath, 'utf-8');
          // File exists but empty
          this.lockfile = lf;
        } catch {
          throw new Error(
            `LOCKFILE_MISSING: Cannot start in locked mode — ${this.lockfilePath} not found. ` +
            `Run in dev mode first to generate a lockfile.`,
          );
        }
      } else {
        this.lockfile = lf;
      }
    } else {
      this.lockfile = Lockfile.read(config.fs, this.lockfilePath);
    }
  }

  /**
   * Install a package: resolve version -> fetch code -> write to /node_modules/
   * Returns immediately if the package is already cached at the right version.
   *
   * In locked mode: package must be in lockfile, integrity is verified.
   */
  async install(name: string, versionRange?: string): Promise<PackageInfo> {
    if (this.mode === 'locked') {
      return this.installLocked(name);
    }
    return this.installDev(name, versionRange);
  }

  /** Dev mode install — resolve, fetch, cache, auto-generate lockfile with integrity */
  private async installDev(name: string, versionRange?: string): Promise<PackageInfo> {
    const range = versionRange ?? 'latest';

    // Check lockfile first for pinned version
    const locked = this.lockfile.get(name);
    if (locked && this.cache.isCached(name, locked.version)) {
      // Verify integrity if available
      if (locked.integrity) {
        const cachedCode = this.cache.getCode(name);
        if (cachedCode) {
          const hash = await sha256(cachedCode);
          if (hash !== locked.integrity) {
            // Cache corrupted — re-fetch
            this.cache.remove(name);
          } else {
            return {
              name,
              version: locked.version,
              path: `/node_modules/${name}`,
              cached: true,
            };
          }
        }
      } else {
        return {
          name,
          version: locked.version,
          path: `/node_modules/${name}`,
          cached: true,
        };
      }
    }

    // Use lockfile version if available (but not cached)
    if (locked) {
      const fetched = await this.fetcher.fetch(name, locked.version);
      const hash = await sha256(fetched.code);
      this.cache.store(name, locked.version, fetched.code, {
        source: fetched.source,
        integrity: hash,
      });
      // Update lockfile with integrity if it was missing
      if (!locked.integrity) {
        this.updateLockfile(name, locked.version, locked.resolved, hash, locked.dependencies);
      }
      return {
        name,
        version: locked.version,
        path: `/node_modules/${name}`,
        cached: false,
      };
    }

    // Resolve version from registry, fallback to CDN-only
    let version: string;
    let dependencies: Record<string, string> = {};
    let tarballUrl = '';
    let registryIntegrity = '';

    try {
      const resolved = await this.resolver.resolve(name, range);
      version = resolved.version;
      dependencies = resolved.dependencies;
      tarballUrl = resolved.tarballUrl;
      registryIntegrity = resolved.integrity ?? '';
    } catch {
      // Registry resolution failed — let the CDN handle version resolution
      version = range === 'latest' ? 'latest' : range;
    }

    // Check if resolved version is already cached
    if (version !== 'latest' && this.cache.isCached(name, version)) {
      // Compute integrity from cached code
      const cachedCode = this.cache.getCode(name);
      const hash = cachedCode ? await sha256(cachedCode) : registryIntegrity;
      this.updateLockfile(name, version, tarballUrl, hash, dependencies);
      return {
        name,
        version,
        path: `/node_modules/${name}`,
        cached: true,
      };
    }

    // Fetch and cache
    const fetched = await this.fetcher.fetch(name, version);
    const finalVersion = version === 'latest' ? fetched.version : version;

    // Compute SHA-256 integrity hash of the fetched code
    const hash = await sha256(fetched.code);

    this.cache.store(name, finalVersion, fetched.code, {
      source: fetched.source,
      integrity: hash,
    });

    this.updateLockfile(name, finalVersion, tarballUrl, hash, dependencies);

    return {
      name,
      version: finalVersion,
      path: `/node_modules/${name}`,
      cached: false,
    };
  }

  /** Locked mode install — package must be in lockfile, integrity verified */
  private async installLocked(name: string): Promise<PackageInfo> {
    const locked = this.lockfile.get(name);
    if (!locked) {
      throw new Error(
        `LOCKFILE_VIOLATION: Package "${name}" is not in ${this.lockfilePath}. ` +
        `In locked mode, all packages must be declared in the lockfile. ` +
        `Run in dev mode to add it.`,
      );
    }

    // Check cache first
    if (this.cache.isCached(name, locked.version)) {
      // Verify integrity
      if (locked.integrity) {
        const cachedCode = this.cache.getCode(name);
        if (cachedCode) {
          const hash = await sha256(cachedCode);
          if (hash !== locked.integrity) {
            throw new Error(
              `INTEGRITY_MISMATCH: Package "${name}@${locked.version}" failed integrity check. ` +
              `Expected: ${locked.integrity}, Got: ${hash}. ` +
              `Cache may be corrupted. Clear cache and re-install.`,
            );
          }
        }
      }
      return {
        name,
        version: locked.version,
        path: `/node_modules/${name}`,
        cached: true,
      };
    }

    // Not cached — fetch with pinned version
    const fetched = await this.fetcher.fetch(name, locked.version);

    // Verify integrity of fetched code
    if (locked.integrity) {
      const hash = await sha256(fetched.code);
      if (hash !== locked.integrity) {
        throw new Error(
          `INTEGRITY_MISMATCH: Package "${name}@${locked.version}" failed integrity check. ` +
          `Expected: ${locked.integrity}, Got: ${hash}. ` +
          `The package source may have been tampered with.`,
        );
      }
    }

    this.cache.store(name, locked.version, fetched.code, {
      source: fetched.source,
      integrity: locked.integrity,
    });

    return {
      name,
      version: locked.version,
      path: `/node_modules/${name}`,
      cached: false,
    };
  }

  /** Update lockfile and write to disk */
  private updateLockfile(
    name: string,
    version: string,
    resolved: string,
    integrity: string,
    dependencies: Record<string, string>,
  ): void {
    this.lockfile.set(name, {
      version,
      resolved: resolved || `esm.sh/${name}@${version}`,
      integrity,
      dependencies,
    });
    this.lockfile.write(this.fs, this.lockfilePath);
  }

  /**
   * Install all dependencies from package.json.
   */
  async installAll(packageJsonPath = '/package.json'): Promise<PackageInfo[]> {
    const pkgJson = PackageJson.read(this.fs, packageJsonPath);
    const deps = pkgJson.getDependencies();
    const results: PackageInfo[] = [];

    for (const [name, version] of Object.entries(deps)) {
      const info = await this.install(name, version);
      results.push(info);
    }

    return results;
  }

  /** Check if a package is installed, return its path or null */
  resolve(name: string): string | null {
    const pkgDir = `/node_modules/${name}`;
    try {
      if (
        this.fs.existsSync(`${pkgDir}/index.js`) ||
        this.fs.existsSync(`${pkgDir}/package.json`)
      ) {
        return pkgDir;
      }
    } catch {}
    return null;
  }

  /** Remove an installed package */
  async remove(name: string): Promise<void> {
    this.cache.remove(name);
    this.lockfile.remove(name);
    this.lockfile.write(this.fs, this.lockfilePath);
  }

  /** Clear all installed packages */
  async clear(): Promise<void> {
    this.cache.clear();
    this.lockfile.clear();
    this.lockfile.write(this.fs, this.lockfilePath);
  }

  /** List all installed packages */
  list(): PackageInfo[] {
    const entries = this.cache.list();
    return entries.map((e) => ({
      name: e.name,
      version: e.version,
      path: `/node_modules/${e.name}`,
      cached: true,
    }));
  }

  /** Get the lockfile */
  getLockfile(): Lockfile {
    return this.lockfile;
  }

  /** Get the cache */
  getCache(): PackageCache {
    return this.cache;
  }

  /** Get the current mode */
  getMode(): PackageMode {
    return this.mode;
  }
}
