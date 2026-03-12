/**
 * HMRManager — Hot Module Replacement via file watching
 *
 * Watches CatalystFS for source file changes, triggers rebuild
 * via BuildPipeline, emits update events. HMR signals "reload"
 * (no React Fast Refresh).
 */
import type { CatalystFS } from '../fs/CatalystFS.js';
import { BuildPipeline, type BuildConfig, type BuildResult } from './BuildPipeline.js';

export type HMREvent = 'update' | 'error' | 'build-start' | 'build-complete';
type HMRHandler = (data: any) => void;

export class HMRManager {
  private fs: CatalystFS;
  private pipeline: BuildPipeline;
  private buildConfig: BuildConfig;
  private handlers = new Map<string, HMRHandler[]>();
  private unwatch: (() => void) | null = null;
  private lastHash = '';
  private building = false;

  constructor(fs: CatalystFS, pipeline: BuildPipeline, buildConfig: BuildConfig = {}) {
    this.fs = fs;
    this.pipeline = pipeline;
    this.buildConfig = buildConfig;
  }

  /**
   * Start watching for file changes.
   * Watches the source directory (default: /src) recursively.
   */
  start(watchPath = '/src'): void {
    if (this.unwatch) return; // Already watching

    this.unwatch = this.fs.watch(watchPath, { recursive: true }, (event, filename) => {
      this.onFileChange(event, filename ?? '');
    });
  }

  /** Stop watching for changes */
  stop(): void {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
  }

  /** Trigger a rebuild manually */
  async rebuild(): Promise<BuildResult> {
    if (this.building) {
      // Skip if already building
      return {
        outputPath: '',
        code: '',
        errors: [{ text: 'Build already in progress' }],
        hash: '',
        cached: false,
        duration: 0,
      };
    }

    this.building = true;
    this.emit('build-start', {});

    try {
      const result = await this.pipeline.build(this.buildConfig);

      if (result.errors.length > 0) {
        this.emit('error', { errors: result.errors });
      } else if (!result.cached && result.hash !== this.lastHash) {
        this.lastHash = result.hash;
        this.emit('update', {
          outputPath: result.outputPath,
          hash: result.hash,
          duration: result.duration,
        });
      }

      this.emit('build-complete', result);
      return result;
    } finally {
      this.building = false;
    }
  }

  /** Handle a file change event */
  private onFileChange(_event: string, _filename: string): void {
    // Debounce: trigger rebuild
    this.rebuild().catch((err) => {
      this.emit('error', { errors: [{ text: err.message || String(err) }] });
    });
  }

  // ---- Event emitter ----

  on(event: HMREvent, handler: HMRHandler): this {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
    return this;
  }

  off(event: HMREvent, handler: HMRHandler): this {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(
        event,
        handlers.filter((h) => h !== handler),
      );
    }
    return this;
  }

  private emit(event: string, data: any): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  /** Whether the manager is actively watching */
  get watching(): boolean {
    return this.unwatch !== null;
  }
}
