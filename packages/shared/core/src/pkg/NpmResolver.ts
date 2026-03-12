/**
 * NpmResolver — Fetch package metadata and resolve dependency trees
 *
 * Fetches metadata from the npm registry.
 * Resolves semver ranges to specific versions.
 * Walks dependency trees with circular dependency detection.
 */
import * as Semver from './Semver.js';

export interface ResolvedPackage {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  tarballUrl: string;
  integrity?: string;
}

export interface NpmResolverConfig {
  registryUrl?: string;
  fetchFn?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  /** In-memory cache TTL in ms (default: 300000 = 5 minutes) */
  cacheTtl?: number;
}

interface CachedMetadata {
  data: any;
  fetchedAt: number;
}

export class NpmResolver {
  private registryUrl: string;
  private fetchFn: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  private cacheTtl: number;
  private metadataCache = new Map<string, CachedMetadata>();

  constructor(config: NpmResolverConfig = {}) {
    this.registryUrl = (config.registryUrl ?? 'https://registry.npmjs.org').replace(/\/$/, '');
    this.fetchFn =
      config.fetchFn ??
      ((url: string) => fetch(url, { headers: { Accept: 'application/json' } }));
    this.cacheTtl = config.cacheTtl ?? 300000;
  }

  /** Fetch package metadata from the registry */
  async getMetadata(name: string): Promise<any> {
    const cached = this.metadataCache.get(name);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtl) {
      return cached.data;
    }

    const url = `${this.registryUrl}/${encodeURIComponent(name)}`;
    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(`NPM_REGISTRY_ERROR: Failed to fetch ${name} (HTTP ${response.status})`);
    }

    const data = await response.json();
    this.metadataCache.set(name, { data, fetchedAt: Date.now() });
    return data;
  }

  /** Resolve a version range to a specific version */
  async resolve(name: string, versionRange = 'latest'): Promise<ResolvedPackage> {
    const metadata = await this.getMetadata(name);

    let version: string;
    if (versionRange === 'latest') {
      version = metadata['dist-tags']?.latest;
      if (!version) {
        throw new Error(`NPM_RESOLVE_ERROR: No latest version for ${name}`);
      }
    } else {
      const allVersions = Object.keys(metadata.versions || {});
      const resolved = Semver.maxSatisfying(allVersions, versionRange);
      if (!resolved) {
        throw new Error(`NPM_RESOLVE_ERROR: No version of ${name} satisfies ${versionRange}`);
      }
      version = resolved;
    }

    const versionData = metadata.versions?.[version];
    if (!versionData) {
      throw new Error(`NPM_RESOLVE_ERROR: Version ${version} not found for ${name}`);
    }

    return {
      name,
      version,
      dependencies: versionData.dependencies || {},
      tarballUrl: versionData.dist?.tarball || '',
      integrity: versionData.dist?.integrity,
    };
  }

  /** Get all available versions of a package */
  async getVersions(name: string): Promise<string[]> {
    const metadata = await this.getMetadata(name);
    return Object.keys(metadata.versions || {});
  }

  /**
   * Resolve a full dependency tree, flattening into a map.
   * Detects circular dependencies and avoids infinite loops.
   */
  async resolveDependencyTree(
    name: string,
    versionRange = 'latest',
    maxDepth = 10,
  ): Promise<Map<string, ResolvedPackage>> {
    const resolved = new Map<string, ResolvedPackage>();
    const visiting = new Set<string>();

    const walk = async (pkgName: string, range: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      if (resolved.has(pkgName)) return;
      if (visiting.has(pkgName)) return; // Circular dependency

      visiting.add(pkgName);
      try {
        const pkg = await this.resolve(pkgName, range);
        resolved.set(pkgName, pkg);

        for (const [depName, depRange] of Object.entries(pkg.dependencies)) {
          await walk(depName, depRange, depth + 1);
        }
      } finally {
        visiting.delete(pkgName);
      }
    };

    await walk(name, versionRange, 0);
    return resolved;
  }

  /** Clear the metadata cache */
  clearCache(): void {
    this.metadataCache.clear();
  }
}
