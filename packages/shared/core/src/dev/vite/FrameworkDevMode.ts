/**
 * FrameworkDevMode — Manages framework-specific dev server configuration
 *
 * Detects and configures framework-specific settings for:
 *   - Nuxt: nuxt.config.ts, pages/, server/, composables/
 *   - Astro: astro.config.mjs, src/pages/, src/layouts/
 *   - SvelteKit: svelte.config.js, src/routes/, src/lib/
 *   - React (Vite): vite.config.ts, src/App.tsx
 *   - Vue (Vite): vite.config.ts, src/App.vue
 *   - Solid: vite.config.ts, src/App.tsx
 *
 * Generates appropriate vite.config for each framework and manages
 * the dev → build → preview lifecycle.
 */
import type { AtuaFS } from '../../fs/AtuaFS.js';
import { ViteRunner, type ViteRunnerConfig, type FrameworkMode, type ViteDevServer } from './ViteRunner.js';

export interface FrameworkDetectionResult {
  framework: FrameworkMode;
  configFile: string | null;
  entryPoint: string | null;
  confidence: number; // 0-1
}

export interface FrameworkDevConfig {
  /** Virtual filesystem */
  fs: AtuaFS;
  /** Project root (default: '/project') */
  root?: string;
  /** Override framework detection */
  framework?: FrameworkMode;
  /** Dev server port */
  port?: number;
  /** Engine for running the dev server */
  engine?: unknown;
}

type FrameworkEventHandler = (...args: unknown[]) => void;

export class FrameworkDevMode {
  private config: FrameworkDevConfig;
  private runner: ViteRunner | null = null;
  private _detected: FrameworkDetectionResult | null = null;
  private _destroyed = false;
  private handlers = new Map<string, FrameworkEventHandler[]>();

  constructor(config: FrameworkDevConfig) {
    this.config = config;
  }

  get detected(): FrameworkDetectionResult | null { return this._detected; }
  get destroyed(): boolean { return this._destroyed; }
  get running(): boolean { return this.runner?.status === 'running'; }

  /**
   * Detect the framework used in the project.
   */
  detect(): FrameworkDetectionResult {
    const root = this.config.root ?? '/project';
    const fs = this.config.fs;

    // Check for framework-specific config files
    const checks: Array<{ framework: FrameworkMode; files: string[]; config: string }> = [
      { framework: 'nuxt', files: ['nuxt.config.ts', 'nuxt.config.js'], config: 'nuxt.config' },
      { framework: 'astro', files: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'], config: 'astro.config' },
      { framework: 'sveltekit', files: ['svelte.config.js', 'svelte.config.ts'], config: 'svelte.config' },
      { framework: 'vue', files: ['src/App.vue', 'app.vue'], config: 'vite.config' },
      { framework: 'react', files: ['src/App.tsx', 'src/App.jsx'], config: 'vite.config' },
      { framework: 'svelte', files: ['src/App.svelte'], config: 'vite.config' },
      { framework: 'solid', files: ['src/App.tsx'], config: 'vite.config' },
    ];

    for (const check of checks) {
      for (const file of check.files) {
        try {
          if (fs.existsSync(root + '/' + file)) {
            const configFile = this.findConfigFile(root, check.config);
            this._detected = {
              framework: check.framework,
              configFile,
              entryPoint: file,
              confidence: configFile ? 0.9 : 0.6,
            };
            return this._detected;
          }
        } catch {}
      }
    }

    // Fallback: check for index.html (vanilla Vite)
    try {
      if (fs.existsSync(root + '/index.html')) {
        this._detected = {
          framework: 'vanilla',
          configFile: this.findConfigFile(root, 'vite.config'),
          entryPoint: 'index.html',
          confidence: 0.5,
        };
        return this._detected;
      }
    } catch {}

    this._detected = { framework: 'vanilla', configFile: null, entryPoint: null, confidence: 0.1 };
    return this._detected;
  }

  /**
   * Start the dev server for the detected framework.
   */
  async start(): Promise<ViteDevServer> {
    if (this._destroyed) throw new Error('FrameworkDevMode has been destroyed');
    if (this.runner?.status === 'running') return this.runner.getServerInfo();

    // Detect framework if not already done
    const detection = this._detected ?? this.detect();
    const framework = this.config.framework ?? detection.framework;

    // Create ViteRunner
    const runnerConfig: ViteRunnerConfig = {
      fs: this.config.fs,
      root: this.config.root ?? '/project',
      port: this.config.port ?? 5173,
      framework,
      viteConfig: this.getFrameworkViteConfig(framework),
    };

    this.runner = new ViteRunner(runnerConfig);

    // Forward events
    this.runner.on('status', (status: unknown) => this.emit('status', status));
    this.runner.on('hmr-update', (update: unknown) => this.emit('hmr-update', update));
    this.runner.on('error', (err: unknown) => this.emit('error', err));
    this.runner.on('ready', (info: unknown) => this.emit('ready', info));

    const info = await this.runner.start();
    this.emit('start', info);
    return info;
  }

  /**
   * Stop the dev server.
   */
  async stop(): Promise<void> {
    if (this.runner) {
      await this.runner.stop();
      this.runner.destroy();
      this.runner = null;
    }
    this.emit('stop');
  }

  /**
   * Restart the dev server.
   */
  async restart(): Promise<ViteDevServer> {
    await this.stop();
    return this.start();
  }

  /**
   * Get the current ViteRunner instance.
   */
  getRunner(): ViteRunner | null {
    return this.runner;
  }

  /**
   * Destroy the framework dev mode.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.runner) {
      this.runner.destroy();
      this.runner = null;
    }
    this.handlers.clear();
  }

  // ---- Event system ----

  on(event: string, handler: FrameworkEventHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: FrameworkEventHandler): this {
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

  private findConfigFile(root: string, baseName: string): string | null {
    const fs = this.config.fs;
    const extensions = ['.ts', '.js', '.mjs', '.mts'];
    for (const ext of extensions) {
      const path = root + '/' + baseName + ext;
      try {
        if (fs.existsSync(path)) return path;
      } catch {}
    }
    return null;
  }

  private getFrameworkViteConfig(framework: FrameworkMode): Record<string, unknown> {
    const base: Record<string, unknown> = {
      server: { port: this.config.port ?? 5173 },
    };

    switch (framework) {
      case 'nuxt':
        return { ...base, ssr: { noExternal: true } };
      case 'astro':
        return { ...base, integrations: [] };
      case 'sveltekit':
        return { ...base, kit: { adapter: 'auto' } };
      case 'react':
        return { ...base, plugins: ['@vitejs/plugin-react'] };
      case 'vue':
        return { ...base, plugins: ['@vitejs/plugin-vue'] };
      case 'svelte':
        return { ...base, plugins: ['@sveltejs/vite-plugin-svelte'] };
      case 'solid':
        return { ...base, plugins: ['vite-plugin-solid'] };
      default:
        return base;
    }
  }
}
