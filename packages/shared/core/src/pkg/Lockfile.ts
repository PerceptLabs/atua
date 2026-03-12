/**
 * Lockfile — Read/write catalyst-lock.json
 *
 * Provides deterministic installs: if lockfile exists, use pinned versions.
 */
import type { CatalystFS } from '../fs/CatalystFS.js';

export interface LockfileEntry {
  version: string;
  resolved: string;
  integrity: string;
  dependencies: Record<string, string>;
}

export interface LockfileData {
  lockfileVersion: number;
  packages: Record<string, LockfileEntry>;
}

const LOCKFILE_PATH = '/catalyst-lock.json';

export class Lockfile {
  private data: LockfileData;

  constructor(data?: LockfileData) {
    this.data = data ?? { lockfileVersion: 1, packages: {} };
  }

  /** Read lockfile from CatalystFS */
  static read(fs: CatalystFS, path = LOCKFILE_PATH): Lockfile {
    try {
      const content = fs.readFileSync(path, 'utf-8') as string;
      const data = JSON.parse(content) as LockfileData;
      return new Lockfile(data);
    } catch {
      return new Lockfile();
    }
  }

  /** Write lockfile to CatalystFS */
  write(fs: CatalystFS, path = LOCKFILE_PATH): void {
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(path, json);
  }

  /** Get a locked package entry */
  get(name: string): LockfileEntry | undefined {
    return this.data.packages[name];
  }

  /** Set a package entry */
  set(name: string, entry: LockfileEntry): void {
    this.data.packages[name] = entry;
  }

  /** Remove a package entry */
  remove(name: string): boolean {
    if (this.data.packages[name]) {
      delete this.data.packages[name];
      return true;
    }
    return false;
  }

  /** Check if a package is locked */
  has(name: string): boolean {
    return name in this.data.packages;
  }

  /** Get all locked package names */
  names(): string[] {
    return Object.keys(this.data.packages);
  }

  /** Get the full lockfile data */
  toJSON(): LockfileData {
    return structuredClone(this.data);
  }

  /** Serialize to JSON string */
  serialize(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Deserialize from JSON string */
  static deserialize(json: string): Lockfile {
    const data = JSON.parse(json) as LockfileData;
    return new Lockfile(data);
  }

  /** Get package count */
  get size(): number {
    return Object.keys(this.data.packages).length;
  }

  /** Clear all entries */
  clear(): void {
    this.data.packages = {};
  }
}
