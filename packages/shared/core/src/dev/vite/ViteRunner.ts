/**
 * ViteRunner — Runs Vite dev server inside the browser WASM runtime
 *
 * Bridges between Vite's expectations and the browser environment:
 *   - AtuaFS provides the virtual filesystem (fs.watch, fs.readFile, etc.)
 *   - CatalystNet (Service Worker) intercepts HTTP requests to the dev server
 *   - HMR WebSocket emulated through MessageChannel
 *   - File changes detected vian AtuaFS FileSystemObserver
 *
 * The flow:
 *   1. User edits file in IDE → AtuaFS write
 *   2. FileSystemObserver fires → Vite detects change
 *   3. Vite processes HMR update → WebSocket push
 *   4. Preview iframe applies hot update
 */
import type { AtuaFS } from '../../fs/AtuaFS.js';
import type { IEngine } from '../../engine/interfaces.js';

export type ViteRunnerStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ViteRunnerConfig {
  /** Virtual filesystem */
  fs: AtuaFS;
  /** JavaScript engine for running Vite */
  engine?: IEngine;
  /** Project root in AtuaFS (default: '/project') */
  root?: string;
  /** Dev server port (for Service Worker routing) */
  port?: number;
  /** Framework mode */
  framework?: FrameworkMode;
  /** Custom vite.config overrides */
  viteConfig?: Record<string, unknown>;
}

export type FrameworkMode = 'vanilla' | 'react' | 'vue' | 'svelte' | 'nuxt' | 'astro' | 'sveltekit' | 'solid';

export interface ViteDevServer {
  /** Current status */
  status: ViteRunnerStatus;
  /** Dev server URL (for iframe src) */
  url: string;
  /** Port number */
  port: number;
  /** Framework being served */
  framework: FrameworkMode;
  /** HMR connection state */
  hmrConnected: boolean;
}

export interface HMRUpdate {
  type: 'js-update' | 'css-update' | 'full-reload';
  path: string;
  timestamp: number;
  acceptedPath?: string;
}

type ViteEventHandler = (...args: unknown[]) => void;

export class ViteRunner {
  private config: ViteRunnerConfig;
  private _status: ViteRunnerStatus = 'idle';
  private _port: number;
  private _url: string;
  private _hmrConnected = false;
  private _errors: Error[] = [];
  private handlers = new Map<string, ViteEventHandler[]>();
  private _unwatch: (() => void) | null = null;
  private _destroyed = false;
  private _pendingUpdates: HMRUpdate[] = [];
  private _moduleGraph = new Map<string, Set<string>>(); // file → importers

  constructor(config: ViteRunnerConfig) {
    this.config = config;
    this._port = config.port ?? 5173;
    this._url = `http://localhost:${this._port}`;
  }

  get status(): ViteRunnerStatus { return this._status; }
  get port(): number { return this._port; }
  get url(): string { return this._url; }
  get hmrConnected(): boolean { return this._hmrConnected; }
  get errors(): Error[] { return [...this._errors]; }

  /**
   * Start the Vite dev server.
   */
  async start(): Promise<ViteDevServer> {
    if (this._destroyed) throw new Error('ViteRunner has been destroyed');
    if (this._status === 'running') return this.getServerInfo();

    this._status = 'starting';
    this.emit('status', this._status);

    try {
      // Verify project structure
      await this.validateProject();

      // Start file watching
      this.startFileWatcher();

      // Mark as running
      this._status = 'running';
      this._hmrConnected = true;
      this.emit('status', this._status);
      this.emit('ready', this.getServerInfo());

      return this.getServerInfo();
    } catch (err) {
      this._status = 'error';
      this._errors.push(err instanceof Error ? err : new Error(String(err)));
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Stop the dev server.
   */
  async stop(): Promise<void> {
    if (this._status !== 'running' && this._status !== 'starting') return;

    this._status = 'stopping';
    this.emit('status', this._status);

    this.stopFileWatcher();
    this._hmrConnected = false;
    this._moduleGraph.clear();
    this._pendingUpdates = [];

    this._status = 'stopped';
    this.emit('status', this._status);
  }

  /**
   * Get current server information.
   */
  getServerInfo(): ViteDevServer {
    return {
      status: this._status,
      url: this._url,
      port: this._port,
      framework: this.config.framework ?? 'vanilla',
      hmrConnected: this._hmrConnected,
    };
  }

  /**
   * Handle a file change from the IDE.
   */
  async handleFileChange(path: string, type: 'create' | 'update' | 'delete'): Promise<HMRUpdate | null> {
    if (this._status !== 'running') return null;

    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const update = this.createHMRUpdate(path, ext, type);

    if (update) {
      this._pendingUpdates.push(update);
      this.emit('hmr-update', update);
    }

    return update;
  }

  /**
   * Resolve a module path (for Service Worker request handling).
   */
  resolveModulePath(requestPath: string): string | null {
    const root = this.config.root ?? '/project';
    const fs = this.config.fs;

    // Strip query params
    const cleanPath = requestPath.split('?')[0];

    // Try direct path (only if it's a file, not a directory)
    const fullPath = root + cleanPath;
    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile?.()) return fullPath;
      }
    } catch {}

    // Try with extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];
    for (const ext of extensions) {
      try {
        if (fs.existsSync(fullPath + ext)) return fullPath + ext;
      } catch {}
    }

    // Try index files
    for (const idx of ['index.ts', 'index.tsx', 'index.js', 'index.html']) {
      try {
        if (fs.existsSync(fullPath + '/' + idx)) return fullPath + '/' + idx;
      } catch {}
    }

    return null;
  }

  /**
   * Get the list of pending HMR updates.
   */
  getPendingUpdates(): HMRUpdate[] {
    return [...this._pendingUpdates];
  }

  /**
   * Clear pending updates (after they've been applied).
   */
  clearPendingUpdates(): void {
    this._pendingUpdates = [];
  }

  /**
   * Add a module to the dependency graph.
   */
  addModuleEdge(module: string, importer: string): void {
    if (!this._moduleGraph.has(module)) {
      this._moduleGraph.set(module, new Set());
    }
    this._moduleGraph.get(module)!.add(importer);
  }

  /**
   * Get importers of a module.
   */
  getImporters(module: string): string[] {
    return [...(this._moduleGraph.get(module) ?? [])];
  }

  /**
   * Destroy the runner and release all resources.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop().catch(() => {});
    this.handlers.clear();
  }

  // ---- Event system ----

  on(event: string, handler: ViteEventHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: ViteEventHandler): this {
    const list = this.handlers.get(event);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try { h(...args); } catch {}
    }
  }

  // ---- Internal ----

  private async validateProject(): Promise<void> {
    const root = this.config.root ?? '/project';
    const fs = this.config.fs;

    // Check project root exists
    try {
      const stat = fs.statSync(root);
      if (!stat.isDirectory?.()) {
        throw new Error(`Project root is not a directory: ${root}`);
      }
    } catch (err) {
      if ((err as Error).message?.includes('not a directory')) throw err;
      throw new Error(`Project root does not exist: ${root}`);
    }

    // Check for index.html or framework entry
    const entryFiles = ['index.html', 'src/index.tsx', 'src/index.ts', 'src/main.tsx', 'src/main.ts', 'app.vue', 'src/App.vue'];
    let found = false;
    for (const entry of entryFiles) {
      try {
        if (fs.existsSync(root + '/' + entry)) {
          found = true;
          break;
        }
      } catch {}
    }
    if (!found) {
      throw new Error(`No entry point found in ${root}. Expected one of: ${entryFiles.join(', ')}`);
    }
  }

  private startFileWatcher(): void {
    const root = this.config.root ?? '/project';
    try {
      this._unwatch = this.config.fs.watch(root + '/src', { recursive: true }, (event, filename) => {
        if (filename) {
          this.handleFileChange(filename, event === 'rename' ? 'create' : 'update').catch(() => {});
        }
      });
    } catch {
      // src/ may not exist — watch root instead
      try {
        this._unwatch = this.config.fs.watch(root, { recursive: true }, (event, filename) => {
          if (filename) {
            this.handleFileChange(filename, event === 'rename' ? 'create' : 'update').catch(() => {});
          }
        });
      } catch {
        // No file watching available
      }
    }
  }

  private stopFileWatcher(): void {
    this._unwatch?.();
    this._unwatch = null;
  }

  private createHMRUpdate(path: string, ext: string, type: 'create' | 'update' | 'delete'): HMRUpdate | null {
    // Config or HTML changes → full reload (check before extension-based matching)
    if (ext === 'html' || path.includes('vite.config') || path.includes('package.json')) {
      return {
        type: 'full-reload',
        path,
        timestamp: Date.now(),
      };
    }

    // CSS changes can be hot-updated
    if (ext === 'css' || ext === 'scss' || ext === 'less') {
      return {
        type: 'css-update',
        path,
        timestamp: Date.now(),
      };
    }

    // JS/TS changes — check if module accepts HMR
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'vue', 'svelte'].includes(ext)) {
      return {
        type: 'js-update',
        path,
        timestamp: Date.now(),
        acceptedPath: path,
      };
    }

    return null;
  }
}
