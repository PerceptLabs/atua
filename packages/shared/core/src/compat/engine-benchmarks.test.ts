/**
 * Engine Benchmarks — Phase 22b
 *
 * Performance comparison between QuickJS and Deno engines.
 * Measures boot time, eval speed, and reports against targets.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { CatalystEngine } from '../engine/CatalystEngine.js';
import { CatalystFS } from '../fs/CatalystFS.js';
import { DenoEngine } from '../../../../engines/deno/src/engine.js';
import { DenoWasmLoader } from '../../../../engines/deno/src/wasm-loader.js';

interface BenchResult {
  engine: string;
  operation: string;
  avg: number;
  min: number;
  max: number;
  iterations: number;
}

const results: BenchResult[] = [];

function bench(engine: string, operation: string, times: number[]): void {
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  results.push({ engine, operation, avg: Math.round(avg * 100) / 100, min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100, iterations: times.length });
}

afterAll(() => {
  console.log('\n=== Engine Benchmark Results ===');
  console.log('Engine'.padEnd(10), 'Operation'.padEnd(30), 'Avg (ms)'.padEnd(12), 'Min (ms)'.padEnd(12), 'Max (ms)'.padEnd(12), 'Iterations');
  console.log('-'.repeat(90));
  for (const r of results) {
    console.log(
      r.engine.padEnd(10),
      r.operation.padEnd(30),
      String(r.avg).padEnd(12),
      String(r.min).padEnd(12),
      String(r.max).padEnd(12),
      String(r.iterations),
    );
  }
  console.log('');
});

describe('Engine Benchmarks — QuickJS Boot', () => {
  it('measures QuickJS cold boot time', async () => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const fs = await CatalystFS.create(`bench-qjs-boot-${Date.now()}-${i}`);
      const start = performance.now();
      const engine = await CatalystEngine.create({ fs });
      times.push(performance.now() - start);
      await engine.destroy();
      fs.destroy();
    }
    bench('QuickJS', 'cold boot', times);
    expect(times.every((t) => t < 5000)).toBe(true); // <5s
  });
});

describe('Engine Benchmarks — Deno Boot', () => {
  it('measures Deno stub boot time', async () => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      DenoWasmLoader.reset();
      const start = performance.now();
      const engine = await DenoEngine.create({});
      times.push(performance.now() - start);
      await engine.destroy();
    }
    bench('Deno', 'stub boot', times);
    expect(times.every((t) => t < 1000)).toBe(true); // <1s stub mode
  });
});

describe('Engine Benchmarks — QuickJS Eval', () => {
  it('measures simple eval throughput', async () => {
    const fs = await CatalystFS.create(`bench-qjs-eval-${Date.now()}`);
    const engine = await CatalystEngine.create({ fs });
    const times: number[] = [];

    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await engine.eval('1 + 2 + 3');
      times.push(performance.now() - start);
    }

    bench('QuickJS', 'simple eval (1+2+3)', times);
    await engine.destroy();
    fs.destroy();

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(50); // <50ms per eval
  });

  it('measures complex eval throughput', async () => {
    const fs = await CatalystFS.create(`bench-qjs-complex-${Date.now()}`);
    const engine = await CatalystEngine.create({ fs });
    const times: number[] = [];

    const code = `(function() {
      var sum = 0;
      for (var i = 0; i < 1000; i++) { sum += i; }
      return sum;
    })()`;

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = await engine.eval(code);
      times.push(performance.now() - start);
      expect(result).toBe(499500);
    }

    bench('QuickJS', 'loop 1000 iterations', times);
    await engine.destroy();
    fs.destroy();
  });
});

describe('Engine Benchmarks — Deno Eval', () => {
  it('measures simple eval throughput', async () => {
    DenoWasmLoader.reset();
    const engine = await DenoEngine.create({});
    const times: number[] = [];

    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await engine.eval('1 + 2 + 3');
      times.push(performance.now() - start);
    }

    bench('Deno', 'simple eval (1+2+3)', times);
    await engine.destroy();

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(10); // stub mode is very fast
  });

  it('measures complex eval throughput', async () => {
    DenoWasmLoader.reset();
    const engine = await DenoEngine.create({});
    const times: number[] = [];

    const code = `(function() {
      var sum = 0;
      for (var i = 0; i < 1000; i++) { sum += i; }
      return sum;
    })()`;

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = await engine.eval(code);
      times.push(performance.now() - start);
      expect(result).toBe(499500);
    }

    bench('Deno', 'loop 1000 iterations', times);
    await engine.destroy();
  });
});

describe('Engine Benchmarks — CatalystFS Operations', () => {
  it('measures filesystem write throughput', async () => {
    const fs = await CatalystFS.create(`bench-fs-write-${Date.now()}`);
    const times: number[] = [];
    const data = 'x'.repeat(1024);

    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      fs.writeFileSync(`/bench-${i}.txt`, data);
      times.push(performance.now() - start);
    }

    bench('FS', 'write 1KB', times);
    fs.destroy();

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(50); // <50ms
  });

  it('measures filesystem read throughput', async () => {
    const fs = await CatalystFS.create(`bench-fs-read-${Date.now()}`);
    const data = 'x'.repeat(1024);
    fs.writeFileSync('/bench-read.txt', data);
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      fs.readFileSync('/bench-read.txt', 'utf-8');
      times.push(performance.now() - start);
    }

    bench('FS', 'read 1KB', times);
    fs.destroy();

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(50); // <50ms
  });
});

describe('Engine Benchmarks — Engine Capabilities', () => {
  it('reports QuickJS capabilities', async () => {
    const fs = await CatalystFS.create(`bench-qjs-caps-${Date.now()}`);
    const engine = await CatalystEngine.create({ fs });
    // QuickJS doesn't have a static capabilities() method, but it boots and runs
    expect(engine).toBeDefined();
    await engine.destroy();
    fs.destroy();
  });

  it('reports Deno capabilities', () => {
    const caps = DenoEngine.capabilities();
    expect(caps.name).toBe('deno');
    expect(caps.jspiRequired).toBe(true);
    expect(caps.wasmSize).toBeGreaterThan(0);
    expect(caps.bootTime).toBeGreaterThan(0);
    console.log('Deno capabilities:', JSON.stringify(caps));
  });
});
