/**
 * ContextRouter — Trust-based routing to execution contexts.
 *
 * Replaces TieredEngine's serial pipeline (validate → execute) with
 * a routing decision: pick the right execution boundary for the trust level.
 *
 * Trivial trusted expressions → InlineContext (zero overhead)
 * Everything else → WorkerContext (V8 Worker, killable)
 * Native binaries / untrusted code → AtuaBox (future, deferred)
 */
import type { ExecutionContext } from './types.js';
import type { WorkerContext } from './WorkerContext.js';
import type { InlineContext } from './InlineContext.js';

// ---------------------------------------------------------------------------
// Routing request
// ---------------------------------------------------------------------------

export interface ExecRequest {
  code: string;
  type: 'expression' | 'script' | 'module';
  trust: 'high' | 'medium' | 'low' | 'untrusted';
  estimatedRisk?: 'low' | 'medium' | 'high';
  requiresLinux?: boolean;
  requiresNativeBinary?: boolean;
  source?: string;
}

// ---------------------------------------------------------------------------
// Router config
// ---------------------------------------------------------------------------

export interface ContextRouterConfig {
  workerContext: WorkerContext;
  inlineContext?: InlineContext;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class ContextRouter {
  private workerContext: WorkerContext;
  private inlineContext?: InlineContext;

  constructor(config: ContextRouterConfig) {
    this.workerContext = config.workerContext;
    this.inlineContext = config.inlineContext;
  }

  /**
   * Route an execution request to the appropriate context.
   *
   * Routing rules:
   * 1. Trivial expressions + high trust + low risk → InlineContext (if available)
   * 2. Native binary or Docker requirements → WorkerContext (AtuaBox deferred)
   * 3. Everything else → WorkerContext
   */
  route(request: ExecRequest): ExecutionContext {
    // 1. Trivial expressions → InlineContext
    if (
      this.inlineContext &&
      request.type === 'expression' &&
      request.trust === 'high' &&
      (request.estimatedRisk ?? 'low') === 'low'
    ) {
      return this.inlineContext;
    }

    // 2. Native binary / Linux requirements → WorkerContext
    //    (AtuaBox integration deferred to a later step)
    // if (request.requiresLinux || request.requiresNativeBinary) {
    //   return this.atuaBoxPool.acquire(); // future
    // }

    // 3. Default → WorkerContext
    return this.workerContext;
  }

  async dispose(): Promise<void> {
    await this.workerContext.destroy();
    if (this.inlineContext) {
      await this.inlineContext.destroy();
    }
  }
}
