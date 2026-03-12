/**
 * Reaction Distribution — Unit tests
 * Validates the Reaction factory wires DenoEngine + DenoNativeLoader correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Reaction } from './index.js';
import { DenoWasmLoader } from '../../../engines/deno/src/wasm-loader.js';
import { Atua } from '../../../shared/core/src/atua.js';

let instance: Atua | null = null;

beforeEach(() => {
  DenoWasmLoader.reset();
});

afterEach(() => {
  if (instance) {
    instance.dispose();
    instance = null;
  }
  DenoWasmLoader.reset();
});

describe('Reaction — Factory', () => {
  it('creates an Atua instance', async () => {
    instance = await Reaction.create({ name: `reaction-test-${Date.now()}` });
    expect(instance).toBeDefined();
    expect(instance).toBeInstanceOf(Atua);
  });

  it('created instance has fs', async () => {
    instance = await Reaction.create({ name: `reaction-fs-${Date.now()}` });
    expect(instance.fs).toBeDefined();
  });

  it('created instance has processes', async () => {
    instance = await Reaction.create({ name: `reaction-proc-${Date.now()}` });
    expect(instance.processes).toBeDefined();
  });

  it('created instance has packages', async () => {
    instance = await Reaction.create({ name: `reaction-pkg-${Date.now()}` });
    expect(instance.packages).toBeDefined();
  });
});

describe('Reaction — Execution', () => {
  it('getWorkerContext returns ExecutionContext', async () => {
    instance = await Reaction.create({ name: `reaction-eng-${Date.now()}` });
    const ctx = instance.getWorkerContext();
    expect(ctx).toBeDefined();
    expect(typeof ctx.eval).toBe('function');
    expect(typeof ctx.destroy).toBe('function');
  });

  it('eval works through Reaction', async () => {
    instance = await Reaction.create({ name: `reaction-eval-${Date.now()}` });
    const result = await instance.eval('console.log("hello")');
    expect(result).toBeDefined();
    expect(result.stdout).toContain('hello');
  });
});

describe('Reaction — Exports', () => {
  it('re-exports engine components', async () => {
    const mod = await import('./index.js');
    expect(mod.DenoEngine).toBeDefined();
    expect(mod.createDenoEngine).toBeDefined();
    expect(mod.OpsBridge).toBeDefined();
    expect(mod.DenoWasmLoader).toBeDefined();
    expect(mod.DenoNativeLoader).toBeDefined();
    expect(mod.createDenoNativeLoader).toBeDefined();
    expect(mod.Atua).toBeDefined();
  });
});
