/**
 * PackageJson — Parse and validate package.json files
 *
 * Uses resolve.exports for proper package.json "exports" field resolution.
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import { resolve as resolveExports } from 'resolve.exports';

export interface PackageJsonData {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export class PackageJson {
  readonly data: PackageJsonData;

  constructor(data: PackageJsonData) {
    this.data = data;
  }

  static parse(json: string): PackageJson {
    const data = JSON.parse(json) as PackageJsonData;
    return new PackageJson(data);
  }

  static read(fs: AtuaFS, path = '/package.json'): PackageJson {
    const content = fs.readFileSync(path, 'utf-8') as string;
    return PackageJson.parse(content);
  }

  get name(): string | undefined {
    return this.data.name;
  }

  get version(): string | undefined {
    return this.data.version;
  }

  get main(): string {
    return this.data.main || 'index.js';
  }

  getDependencies(): Record<string, string> {
    return { ...this.data.dependencies };
  }

  getDevDependencies(): Record<string, string> {
    return { ...this.data.devDependencies };
  }

  getAllDependencies(): Record<string, string> {
    return {
      ...this.data.dependencies,
      ...this.data.devDependencies,
    };
  }

  hasDependency(name: string): boolean {
    return (
      name in (this.data.dependencies ?? {}) ||
      name in (this.data.devDependencies ?? {})
    );
  }

  /**
   * Resolve a subpath through the package.json "exports" field.
   * Falls back to "main" if no exports field is present.
   *
   * @param subpath - The subpath to resolve (e.g., ".", "./utils", "./package.json")
   * @param conditions - Export conditions to match (default: ["import", "default"])
   * @returns The resolved file path relative to the package root, or null if unresolvable
   */
  resolveExport(subpath = '.', conditions?: string[]): string | null {
    if (this.data.exports) {
      const resolved = resolveExports(this.data as Record<string, unknown>, subpath, {
        conditions: conditions ?? ['import', 'default'],
      });
      if (resolved && resolved.length > 0) return resolved[0];
    }
    // Fallback to main/module for "." subpath
    if (subpath === '.') {
      return this.data.module || this.data.main || 'index.js';
    }
    return null;
  }

  serialize(): string {
    return JSON.stringify(this.data, null, 2);
  }
}
