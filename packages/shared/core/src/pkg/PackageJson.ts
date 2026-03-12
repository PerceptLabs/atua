/**
 * PackageJson — Parse and validate package.json files
 */
import type { AtuaFS } from '../fs/AtuaFS.js';

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

  serialize(): string {
    return JSON.stringify(this.data, null, 2);
  }
}
