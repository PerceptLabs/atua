/**
 * DenoEngine — Unit tests
 * Validates IEngine contract, stub mode fallback, and event system.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DenoEngine } from './engine.js';
import { DenoWasmLoader } from './wasm-loader.js';

let engine: DenoEngine;

beforeEach(async () => {
  DenoWasmLoader.reset();
  engine = await DenoEngine.create({ env: { NODE_ENV: 'test' }, cwd: '/project' });
});

afterEach(async () => {
  await engine.destroy();
  DenoWasmLoader.reset();
});

describe('DenoEngine — Capabilities', () => {
  it('returns engine capabilities', () => {
    const caps = DenoEngine.capabilities();
    expect(caps.name).toBe('deno');
    expect(caps.jspiRequired).toBe(true);
    expect(caps.wasmSize).toBeGreaterThan(0);
    expect(caps.bootTime).toBeGreaterThan(0);
  });
});

describe('DenoEngine — Stub Mode', () => {
  it('isWasmReady is false in stub mode', () => {
    expect(engine.isWasmReady).toBe(false);
  });

  it('eval executes JavaScript via stub', async () => {
    const result = await engine.eval('2 + 3');
    expect(result).toBe(5);
  });

  it('eval handles string expressions', async () => {
    const result = await engine.eval('"hello"');
    expect(result).toBe('hello');
  });

  it('eval handles objects', async () => {
    const result = await engine.eval('({a: 1, b: 2})');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('eval throws on syntax error', async () => {
    await expect(engine.eval('{{{'))
      .rejects.toThrow();
  });

  it('eval throws on runtime error', async () => {
    await expect(engine.eval('throw new Error("boom")'))
      .rejects.toThrow('boom');
  });
});

describe('DenoEngine — Event System', () => {
  it('on/off subscribes and unsubscribes', async () => {
    const errors: unknown[] = [];
    const handler = (err: unknown) => errors.push(err);

    engine.on('error', handler);
    try { await engine.eval('throw new Error("e1")'); } catch {}
    expect(errors.length).toBe(1);

    engine.off('error', handler);
    try { await engine.eval('throw new Error("e2")'); } catch {}
    expect(errors.length).toBe(1); // unchanged — unsubscribed
  });

  it('emits exit event on destroy', async () => {
    const exits: unknown[] = [];
    engine.on('exit', (code: unknown) => exits.push(code));
    await engine.destroy();
    expect(exits).toEqual([0]);
  });
});

describe('DenoEngine — Lifecycle', () => {
  it('throws after destroy', async () => {
    await engine.destroy();
    await expect(engine.eval('1'))
      .rejects.toThrow('destroyed');
  });

  it('double destroy is idempotent', async () => {
    await engine.destroy();
    await engine.destroy(); // should not throw
  });

  it('getOpsBridge returns the bridge', () => {
    const bridge = engine.getOpsBridge();
    expect(bridge).toBeDefined();
    expect(bridge.registeredOps().length).toBeGreaterThan(0);
  });
});

describe('DenoEngine — createInstance', () => {
  it('creates a new engine instance', async () => {
    const child = await engine.createInstance({
      env: { MODE: 'child' },
      cwd: '/child',
    });
    expect(child).toBeDefined();
    const result = await child.eval('42');
    expect(result).toBe(42);
    await child.destroy();
  });
});

describe('DenoEngine — createDenoEngine factory', () => {
  it('factory creates IEngine-compatible instance', async () => {
    const { createDenoEngine } = await import('./engine.js');
    DenoWasmLoader.reset();
    const eng = await createDenoEngine({ env: { X: '1' } });
    const result = await eng.eval('10');
    expect(result).toBe(10);
    await eng.destroy();
  });
});
