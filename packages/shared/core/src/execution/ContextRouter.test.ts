/**
 * ContextRouter tests — trust-based routing
 */
import { describe, it, expect } from 'vitest';
import { ContextRouter } from './ContextRouter.js';
import { InlineContext } from './InlineContext.js';
import { WorkerContext } from './WorkerContext.js';

describe('ContextRouter', () => {
  it('should route trusted expressions to InlineContext', () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    const ctx = router.route({
      code: '1 + 2',
      type: 'expression',
      trust: 'high',
      estimatedRisk: 'low',
    });

    expect(ctx).toBe(inline);
  });

  it('should route scripts to WorkerContext', () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    const ctx = router.route({
      code: 'const x = 1; console.log(x);',
      type: 'script',
      trust: 'high',
    });

    expect(ctx).toBe(worker);
  });

  it('should route medium trust to WorkerContext', () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    const ctx = router.route({
      code: '1 + 2',
      type: 'expression',
      trust: 'medium',
    });

    expect(ctx).toBe(worker);
  });

  it('should route high-risk expressions to WorkerContext', () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    const ctx = router.route({
      code: 'eval("bad")',
      type: 'expression',
      trust: 'high',
      estimatedRisk: 'high',
    });

    expect(ctx).toBe(worker);
  });

  it('should fall back to WorkerContext when no InlineContext', () => {
    const worker = new WorkerContext();
    const router = new ContextRouter({ workerContext: worker });

    const ctx = router.route({
      code: '1 + 2',
      type: 'expression',
      trust: 'high',
      estimatedRisk: 'low',
    });

    expect(ctx).toBe(worker);
  });

  it('should route untrusted code to WorkerContext', () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    const ctx = router.route({
      code: 'require("child_process").exec("rm -rf /")',
      type: 'script',
      trust: 'untrusted',
    });

    expect(ctx).toBe(worker);
  });

  it('should dispose all contexts', async () => {
    const worker = new WorkerContext();
    const inline = new InlineContext();
    const router = new ContextRouter({ workerContext: worker, inlineContext: inline });

    await router.dispose();

    expect(worker.status()).toEqual({ state: 'destroyed' });
    expect(inline.status()).toEqual({ state: 'destroyed' });
  });
});
