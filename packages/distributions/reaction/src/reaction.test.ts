/**
 * Reaction Distribution — Unit tests
 * Validates the Reaction factory wires DenoEngine + DenoNativeLoader correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Reaction } from './index.js';
import { DenoWasmLoader } from '../../../engines/deno/src/wasm-loader.js';
import { Catalyst } from '../../../shared/core/src/catalyst.js';

let instance: Catalyst | null = null;

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
  it('creates a Catalyst instance', async () => {
    instance = await Reaction.create({ name: `reaction-test-${Date.now()}` });
    expect(instance).toBeDefined();
    expect(instance).toBeInstanceOf(Catalyst);
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

describe('Reaction — Engine Integration', () => {
  it('getEngine returns IEngine', async () => {
    instance = await Reaction.create({ name: `reaction-eng-${Date.now()}` });
    const engine = await instance.getEngine();
    expect(engine).toBeDefined();
    expect(typeof engine.eval).toBe('function');
    expect(typeof engine.destroy).toBe('function');
  });

  it('eval works through Reaction', async () => {
    instance = await Reaction.create({ name: `reaction-eval-${Date.now()}` });
    const result = await instance.eval('42');
    expect(result).toBe(42);
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
    expect(mod.Catalyst).toBeDefined();
  });
});
