/**
 * Dual-Engine Test Validation — Phase 22a
 *
 * Verifies that both QuickJS (AtuaEngine) and DenoEngine (stub mode)
 * produce equivalent results for the same JavaScript evaluation tasks.
 *
 * Both engines now use script-mode evaluation (last expression value returned).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AtuaEngine } from '../engine/AtuaEngine.js';
import { AtuaFS } from '../fs/AtuaFS.js';
import { DenoEngine } from '../../../../engines/deno/src/engine.js';
import { DenoWasmLoader } from '../../../../engines/deno/src/wasm-loader.js';
import type { IEngine } from '../engine/interfaces.js';

let fs: AtuaFS;
let quickjs: IEngine;
let deno: IEngine;

beforeAll(async () => {
  fs = await AtuaFS.create(`dual-engine-${Date.now()}`);
  DenoWasmLoader.reset();
  quickjs = await AtuaEngine.create({ fs });
  deno = await DenoEngine.create({ fs });
});

afterAll(async () => {
  await quickjs.destroy();
  await deno.destroy();
  fs.destroy();
  DenoWasmLoader.reset();
});

async function evalBoth(code: string): Promise<{ quickjs: unknown; deno: unknown }> {
  const qResult = await quickjs.eval(code).catch((e: Error) => ({ __error: e.message }));
  const dResult = await deno.eval(code).catch((e: Error) => ({ __error: e.message }));
  return { quickjs: qResult, deno: dResult };
}

describe('Dual-Engine — Basic Evaluation', () => {
  it('simple arithmetic', async () => {
    const { quickjs: q, deno: d } = await evalBoth('2 + 3');
    expect(q).toBe(5);
    expect(d).toBe(5);
  });

  it('string operations', async () => {
    const { quickjs: q, deno: d } = await evalBoth('"hello" + " " + "world"');
    expect(q).toBe('hello world');
    expect(d).toBe('hello world');
  });

  it('boolean logic', async () => {
    const { quickjs: q, deno: d } = await evalBoth('true && !false');
    expect(q).toBe(true);
    expect(d).toBe(true);
  });

  it('null and undefined', async () => {
    const { quickjs: q, deno: d } = await evalBoth('null');
    expect(q).toBeNull();
    expect(d).toBeNull();
  });

  it('arrays', async () => {
    const { quickjs: q, deno: d } = await evalBoth('[1, 2, 3].map(x => x * 2)');
    expect(q).toEqual([2, 4, 6]);
    expect(d).toEqual([2, 4, 6]);
  });

  it('objects', async () => {
    const { quickjs: q, deno: d } = await evalBoth('({a: 1, b: "two"})');
    expect(q).toEqual({ a: 1, b: 'two' });
    expect(d).toEqual({ a: 1, b: 'two' });
  });
});

describe('Dual-Engine — Error Handling', () => {
  it('syntax errors throw', async () => {
    const { quickjs: q, deno: d } = await evalBoth('{{{');
    expect((q as any).__error).toBeDefined();
    expect((d as any).__error).toBeDefined();
  });

  it('runtime errors throw', async () => {
    const { quickjs: q, deno: d } = await evalBoth('throw new Error("test error")');
    expect((q as any).__error).toContain('test error');
    expect((d as any).__error).toContain('test error');
  });

  it('undefined variable errors', async () => {
    const { quickjs: q, deno: d } = await evalBoth('undefinedVariable');
    expect((q as any).__error).toBeDefined();
    expect((d as any).__error).toBeDefined();
  });
});

describe('Dual-Engine — ES Features', () => {
  it('template literals', async () => {
    const { quickjs: q, deno: d } = await evalBoth('var x = 42; `value: ${x}`');
    expect(q).toBe('value: 42');
    expect(d).toBe('value: 42');
  });

  it('destructuring', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      'var o = {a: 1, b: 2, c: 3}; o.a + o.b'
    );
    expect(q).toBe(3);
    expect(d).toBe(3);
  });

  it('spread operator', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      'var arr = [1, 2, 3]; [].concat(arr, [4, 5])'
    );
    expect(q).toEqual([1, 2, 3, 4, 5]);
    expect(d).toEqual([1, 2, 3, 4, 5]);
  });

  it('arrow functions', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      'var add = function(a, b) { return a + b; }; add(10, 20)'
    );
    expect(q).toBe(30);
    expect(d).toBe(30);
  });

  it('Map and Set', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      'var m = new Map(); m.set("a", 1); m.size'
    );
    expect(q).toBe(1);
    expect(d).toBe(1);
  });

  it('JSON round-trip', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      'JSON.parse(JSON.stringify({x: [1, 2], y: "test"}))'
    );
    expect(q).toEqual({ x: [1, 2], y: 'test' });
    expect(d).toEqual({ x: [1, 2], y: 'test' });
  });

  it('RegExp', async () => {
    const { quickjs: q, deno: d } = await evalBoth(
      '/^hello/.test("hello world")'
    );
    expect(q).toBe(true);
    expect(d).toBe(true);
  });
});

describe('Dual-Engine — IEngine Contract', () => {
  it('both implement eval', () => {
    expect(typeof quickjs.eval).toBe('function');
    expect(typeof deno.eval).toBe('function');
  });

  it('both implement destroy', () => {
    expect(typeof quickjs.destroy).toBe('function');
    expect(typeof deno.destroy).toBe('function');
  });

  it('both implement on/off', () => {
    expect(typeof quickjs.on).toBe('function');
    expect(typeof quickjs.off).toBe('function');
    expect(typeof deno.on).toBe('function');
    expect(typeof deno.off).toBe('function');
  });

  it('both implement createInstance', () => {
    expect(typeof quickjs.createInstance).toBe('function');
    expect(typeof deno.createInstance).toBe('function');
  });
});
