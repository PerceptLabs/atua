/**
 * AtuaFS — Core filesystem layer
 *
 * Wraps ZenFS to provide a Node.js-like fs API backed by
 * IndexedDB, OPFS (WebAccess), or InMemory.
 *
 * Phase 1: Basic single-mount
 * Phase 2: Multi-mount + file watching
 */
import type { AtuaFSConfig, MountConfig, WatchCallback, BackendType } from './types.js';
import { watch as watchFs, hasNativeObserver } from './FileWatcher.js';

// ZenFS types — we use dynamic imports for configure/fs
type ZenFSModule = typeof import('@zenfs/core');

export class AtuaFS {
  private _fs: any;
  private _name: string;
  private _watchers: Array<() => void> = [];

  private constructor(fs: any, name: string) {
    this._fs = fs;
    this._name = name;
  }

  /**
   * Resolve a BackendType string to a ZenFS backend config object.
   */
  private static async resolveBackend(
    type: BackendType,
    name: string
  ): Promise<any> {
    const zenfs = await import('@zenfs/core');

    switch (type) {
      case 'memory':
        return zenfs.InMemory;
      case 'opfs': {
        // Feature-detect OPFS
        if (typeof navigator?.storage?.getDirectory === 'function') {
          try {
            const { WebAccess } = await import('@zenfs/dom');
            const handle = await navigator.storage.getDirectory();
            return { backend: WebAccess, handle };
          } catch {
            // Fall through to IndexedDB
          }
        }
        // Fallback to IndexedDB
        const { IndexedDB } = await import('@zenfs/dom');
        return { backend: IndexedDB, storeName: name };
      }
      case 'indexeddb': {
        const { IndexedDB } = await import('@zenfs/dom');
        return { backend: IndexedDB, storeName: name };
      }
      default:
        return zenfs.InMemory;
    }
  }

  /**
   * Create a new AtuaFS instance with optional mount configuration.
   */
  static async create(nameOrConfig?: string | AtuaFSConfig): Promise<AtuaFS> {
    const config: AtuaFSConfig =
      typeof nameOrConfig === 'string'
        ? { name: nameOrConfig }
        : nameOrConfig ?? {};

    const name = config.name ?? 'atua-default';

    const zenfs: ZenFSModule = await import('@zenfs/core');
    const { InMemory } = zenfs;

    // Unmount all existing mounts to avoid conflicts (ZenFS global state)
    try {
      const { mounts, umount } = zenfs as any;
      for (const mountPoint of [...mounts.keys()]) {
        try {
          umount(mountPoint);
        } catch {
          // Ignore unmount errors
        }
      }
    } catch {
      // mounts may not be initialized yet
    }

    const isNode =
      typeof globalThis.window === 'undefined' &&
      typeof globalThis.document === 'undefined';

    if (config.mounts && Object.keys(config.mounts).length > 0) {
      // Multi-mount configuration
      const mounts: Record<string, any> = {};

      for (const [mountPath, mountConfig] of Object.entries(config.mounts)) {
        const backendType: BackendType =
          typeof mountConfig === 'string'
            ? mountConfig
            : mountConfig.backend;

        if (isNode) {
          // Node: always use InMemory regardless of config
          mounts[mountPath] = InMemory;
        } else {
          mounts[mountPath] = await AtuaFS.resolveBackend(backendType, `${name}-${mountPath}`);
        }
      }

      await zenfs.configure({ mounts });
    } else {
      // Default single-mount (backward compat with Phase 1)
      if (isNode) {
        await zenfs.configure({ mounts: { '/': InMemory } });
      } else {
        try {
          const { IndexedDB } = await import('@zenfs/dom');
          await zenfs.configure({
            mounts: {
              '/': { backend: IndexedDB, storeName: name },
            },
          });
        } catch {
          await zenfs.configure({ mounts: { '/': InMemory } });
        }
      }
    }

    return new AtuaFS(zenfs.fs, name);
  }

  /** Get the underlying ZenFS fs object for raw access */
  get rawFs(): any {
    return this._fs;
  }

  /** Instance name */
  get name(): string {
    return this._name;
  }

  // ---- Synchronous methods ----

  readFileSync(path: string, encoding?: BufferEncoding): string | Uint8Array {
    if (encoding) {
      return this._fs.readFileSync(path, encoding) as string;
    }
    return this._fs.readFileSync(path) as Uint8Array;
  }

  writeFileSync(path: string, data: string | Uint8Array | ArrayBufferView, options?: { encoding?: BufferEncoding }): void {
    this._fs.writeFileSync(path, data, options);
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    this._fs.mkdirSync(path, options);
  }

  readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] | any[] {
    return this._fs.readdirSync(path, options);
  }

  statSync(path: string): any {
    return this._fs.statSync(path);
  }

  unlinkSync(path: string): void {
    this._fs.unlinkSync(path);
  }

  rmdirSync(path: string, options?: { recursive?: boolean }): void {
    this._fs.rmdirSync(path, options);
  }

  renameSync(oldPath: string, newPath: string): void {
    this._fs.renameSync(oldPath, newPath);
  }

  existsSync(path: string): boolean {
    return this._fs.existsSync(path);
  }

  copyFileSync(src: string, dest: string): void {
    this._fs.copyFileSync(src, dest);
  }

  appendFileSync(path: string, data: string | Uint8Array): void {
    this._fs.appendFileSync(path, data);
  }

  // ---- Async methods ----

  async readFile(path: string, encoding?: BufferEncoding): Promise<string | Uint8Array> {
    return this._fs.promises.readFile(path, encoding ? { encoding } : undefined);
  }

  async writeFile(path: string, data: string | Uint8Array, options?: { encoding?: BufferEncoding }): Promise<void> {
    return this._fs.promises.writeFile(path, data, options);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this._fs.promises.mkdir(path, options);
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | any[]> {
    return this._fs.promises.readdir(path, options);
  }

  async stat(path: string): Promise<any> {
    return this._fs.promises.stat(path);
  }

  async unlink(path: string): Promise<void> {
    return this._fs.promises.unlink(path);
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return this._fs.promises.rmdir(path, options);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return this._fs.promises.rename(oldPath, newPath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    return this._fs.promises.copyFile(src, dest);
  }

  // ---- File Watching ----

  /**
   * Watch a path for changes.
   * Uses FileSystemObserver (native) when available, falls back to polling.
   * Returns an unsubscribe function.
   */
  watch(
    path: string,
    options: { recursive?: boolean } = {},
    callback: WatchCallback
  ): () => void {
    const unsub = watchFs(this._fs, path, options, callback);
    this._watchers.push(unsub);
    return () => {
      unsub();
      this._watchers = this._watchers.filter((w) => w !== unsub);
    };
  }

  /**
   * Whether native FileSystemObserver is available in this browser
   */
  get hasNativeWatcher(): boolean {
    return hasNativeObserver();
  }

  /**
   * Stop all watchers and release resources.
   */
  destroy(): void {
    for (const unsub of this._watchers) {
      unsub();
    }
    this._watchers = [];
  }
}
