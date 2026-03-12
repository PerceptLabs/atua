/**
 * AtuaWorkers — Runtime shell that loads Worker bundles, constructs env
 * with bindings, and routes fetch events.
 *
 * The orchestrator for Cloudflare Workers emulation in the browser.
 */
import { AtuaKV } from './bindings/kv.js';
import { AtuaR2 } from './bindings/r2.js';
import { AtuaExecutionContext } from './context.js';
import { injectWorkersGlobals } from './globals.js';
import type { BindingConfig } from './wrangler-config.js';

// =========================================================================
// Types
// =========================================================================

/** Handler signature matching Cloudflare Workers module format */
export type WorkerFetchHandler = (
  request: Request,
  env: Record<string, unknown>,
  ctx: AtuaExecutionContext,
) => Response | Promise<Response>;

/** An ES module with a default export containing a fetch handler */
export interface WorkerModule {
  default: {
    fetch: WorkerFetchHandler;
  };
}

/** Configuration for a single Worker */
export interface WorkerConfig {
  /** URL to worker script (loaded via dynamic import) */
  script?: string;
  /** Pre-loaded ES module (takes precedence over script) */
  module?: WorkerModule;
  /** Binding configurations keyed by env property name */
  bindings?: Record<string, BindingConfig>;
  /** URL path patterns this worker handles */
  routes?: string[];
}

/** Top-level configuration for AtuaWorkers */
export interface AtuaWorkersConfig {
  workers: Record<string, WorkerConfig>;
}

// =========================================================================
// Internal types
// =========================================================================

interface ResolvedWorker {
  name: string;
  module: WorkerModule;
  env: Record<string, unknown>;
  routes: string[];
  /** Binding instances that need cleanup on destroy */
  cleanupTargets: Array<{ destroy(): void | Promise<void> }>;
}

// =========================================================================
// Route matching
// =========================================================================

/**
 * Match a URL pathname against a route pattern.
 *
 * Supported patterns:
 * - Exact:    /api/health     → matches only /api/health
 * - Prefix:   /api/*          → matches /api/ and anything under it
 * - Wildcard: /**             → matches everything
 */
export function matchRoute(pattern: string, pathname: string): boolean {
  // Double-wildcard: matches everything
  if (pattern === '/**' || pattern === '/*') {
    return true;
  }

  // Prefix with double-wildcard suffix: /api/**
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return pathname === prefix || pathname.startsWith(prefix + '/');
  }

  // Prefix with single-wildcard suffix: /api/*
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(prefix + '/');
  }

  // Exact match
  return pattern === pathname;
}

// =========================================================================
// AtuaWorkers
// =========================================================================

export class AtuaWorkers {
  private workers: ResolvedWorker[] = [];
  private destroyed = false;

  private constructor() {}

  /**
   * Create an AtuaWorkers instance from configuration.
   * Loads all worker modules and constructs binding instances.
   */
  static async create(config: AtuaWorkersConfig): Promise<AtuaWorkers> {
    // Inject Workers-compatible globals
    injectWorkersGlobals();

    const instance = new AtuaWorkers();

    for (const [name, workerConfig] of Object.entries(config.workers)) {
      const resolved = await instance.resolveWorker(name, workerConfig);
      instance.workers.push(resolved);
    }

    return instance;
  }

  /**
   * Handle a fetch request by routing to the matching worker.
   *
   * Returns the worker's Response, or null if no route matches
   * (indicating the request should fall through to static serving).
   */
  async fetch(request: Request): Promise<Response | null> {
    if (this.destroyed) {
      throw new Error('AtuaWorkers has been destroyed');
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Find first matching worker
    for (const worker of this.workers) {
      const matches = worker.routes.some((pattern) =>
        matchRoute(pattern, pathname),
      );

      if (matches) {
        const ctx = new AtuaExecutionContext();

        try {
          const response = await worker.module.default.fetch(
            request,
            worker.env,
            ctx,
          );

          // Wait for any waitUntil promises to settle
          await ctx.flush();

          return response;
        } catch (err) {
          // Wait for any waitUntil promises even on error
          await ctx.flush();

          // If passThroughOnException was called, fall through
          if (ctx.shouldPassThrough) {
            return null;
          }

          // Return 500 error response
          const message =
            err instanceof Error ? err.message : 'Internal Worker Error';
          return new Response(message, {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      }
    }

    // No matching route — fall through
    return null;
  }

  /**
   * Destroy all workers and their binding instances.
   * Frees IndexedDB connections and other resources.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const worker of this.workers) {
      for (const target of worker.cleanupTargets) {
        try {
          await target.destroy();
        } catch {
          // Best-effort cleanup
        }
      }
    }

    this.workers = [];
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async resolveWorker(
    name: string,
    config: WorkerConfig,
  ): Promise<ResolvedWorker> {
    // Load the worker module
    let module: WorkerModule;
    if (config.module) {
      module = config.module;
    } else if (config.script) {
      module = (await import(/* @vite-ignore */ config.script)) as WorkerModule;
    } else {
      throw new Error(
        `Worker "${name}" must have either "module" or "script" configured`,
      );
    }

    // Validate the module has the expected shape
    if (!module.default?.fetch || typeof module.default.fetch !== 'function') {
      throw new Error(
        `Worker "${name}" module must export default { fetch(request, env, ctx) }`,
      );
    }

    // Build the env object from binding configs
    const env: Record<string, unknown> = {};
    const cleanupTargets: Array<{ destroy(): void | Promise<void> }> = [];

    if (config.bindings) {
      for (const [bindingName, bindingConfig] of Object.entries(
        config.bindings,
      )) {
        const { value, cleanup } = await this.createBinding(bindingConfig);
        env[bindingName] = value;
        if (cleanup) {
          cleanupTargets.push(cleanup);
        }
      }
    }

    return {
      name,
      module,
      env,
      routes: config.routes ?? [],
      cleanupTargets,
    };
  }

  private async createBinding(
    config: BindingConfig,
  ): Promise<{ value: unknown; cleanup?: { destroy(): void | Promise<void> } }> {
    // If a pre-constructed instance is provided, use it directly
    if (config.instance !== undefined) {
      return { value: config.instance };
    }

    switch (config.type) {
      case 'kv': {
        const kv = new AtuaKV(config.namespace ?? 'default');
        return { value: kv, cleanup: kv };
      }

      case 'r2': {
        const r2 = new AtuaR2(config.bucket ?? 'default');
        return { value: r2, cleanup: r2 };
      }

      case 'd1': {
        // D1 is in a separate package — dynamic import with string
        // concatenation to bypass static analysis by TypeScript and Vite
        try {
          const d1Pkg = '@aspect/atua-workers-' + 'd1';
          const d1Module = await import(/* @vite-ignore */ d1Pkg);
          const d1 = new d1Module.AtuaD1(config.database ?? 'default');
          return { value: d1, cleanup: d1 };
        } catch {
          throw new Error(
            'D1 binding requires @aspect/atua-workers-d1 package. ' +
              'Install it or pass a pre-constructed instance via binding.instance.',
          );
        }
      }

      case 'secret':
      case 'var':
        return { value: config.value ?? '' };

      default:
        throw new Error(`Unsupported binding type: ${config.type}`);
    }
  }
}
