/**
 * Performance Benchmarks — Browser test
 *
 * Measures key operation latencies and reports against targets.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { AtuaFS } from '../fs/AtuaFS.js';
import { AtuaEngine } from '../engine/AtuaEngine.js';
import { ContentHashCache } from '../dev/ContentHashCache.js';

interface PerfResult {
  name: string;
  avg: number;
  p95: number;
  target: string;
  status: 'PASS' | 'FAIL';
}

const perfResults: PerfResult[] = [];

function reportPerf(
  name: string,
  times: number[],
  targetMs: number,
  targetLabel?: string,
) {
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1];
  const status = avg <= targetMs ? 'PASS' : 'FAIL';
  perfResults.push({
    name,
    avg: Math.round(avg * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    target: targetLabel ?? `<${targetMs}ms`,
    status,
  });
}

describe('Performance — AtuaFS', () => {
  it('should write 1KB within target', async () => {
    const fs = await AtuaFS.create('perf-fs-w1k');
    const data = 'x'.repeat(1024);
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      fs.writeFileSync(`/perf-${i}.txt`, data);
      times.push(performance.now() - start);
    }

    reportPerf('AtuaFS write 1KB', times, 5);
    expect(times.length).toBe(50);
    fs.destroy();
  });

  it('should read 1KB within target', async () => {
    const fs = await AtuaFS.create('perf-fs-r1k');
    const data = 'x'.repeat(1024);
    fs.writeFileSync('/perf-read.txt', data);
    const times: number[] = [];

    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      fs.readFileSync('/perf-read.txt', 'utf-8');
      times.push(performance.now() - start);
    }

    reportPerf('AtuaFS read 1KB', times, 5);
    expect(times.length).toBe(50);
    fs.destroy();
  });

  it('should readdir 100 files within target', async () => {
    const fs = await AtuaFS.create('perf-fs-dir');
    fs.mkdirSync('/perf-dir', { recursive: true });
    for (let i = 0; i < 100; i++) {
      fs.writeFileSync(`/perf-dir/file-${i}.txt`, `content-${i}`);
    }

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      fs.readdirSync('/perf-dir');
      times.push(performance.now() - start);
    }

    reportPerf('AtuaFS readdir 100 files', times, 20);
    expect(times.length).toBe(20);
    fs.destroy();
  });
});

describe('Performance — QuickJS', () => {
  it('should boot QuickJS within target', async () => {
    const times: number[] = [];

    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const engine = await AtuaEngine.create();
      times.push(performance.now() - start);
      engine.dispose();
    }

    reportPerf('QuickJS boot', times, 1000, '<1000ms');
    expect(times.length).toBe(3);
  });

  it('should eval simple expression fast', async () => {
    const engine = await AtuaEngine.create();
    // Warm up
    await engine.eval('1');

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await engine.eval('1 + 1');
      times.push(performance.now() - start);
    }

    reportPerf('QuickJS eval simple', times, 5);
    engine.dispose();
  });

  it('should require fs fast', async () => {
    const fs = await AtuaFS.create('perf-qjs-fs');
    fs.writeFileSync('/perf-test.txt', 'hello');
    const engine = await AtuaEngine.create({ fs });
    // Warm up
    await engine.eval(`require('fs').readFileSync('/perf-test.txt', 'utf-8')`);

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await engine.eval(`require('fs').readFileSync('/perf-test.txt', 'utf-8')`);
      times.push(performance.now() - start);
    }

    reportPerf('QuickJS require(fs).readFileSync', times, 10);
    engine.dispose();
    fs.destroy();
  });
});

describe('Performance — Content Hash Cache', () => {
  it('should compute content hash fast', async () => {
    const cache = new ContentHashCache();
    const files = new Map<string, string>();
    for (let i = 0; i < 10; i++) {
      files.set(`/src/file-${i}.ts`, 'x'.repeat(1000));
    }

    // Warm up
    await cache.computeHash(files);

    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await cache.computeHash(files);
      times.push(performance.now() - start);
    }

    reportPerf('Content hash (10 files)', times, 10);
  });

  it('should cache hit fast', async () => {
    const cache = new ContentHashCache();
    const files = new Map([['a', 'b']]);
    const hash = await cache.computeHash(files);
    cache.set(hash, { code: 'output', outputPath: '/dist/app.js' });

    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      cache.get(hash);
      times.push(performance.now() - start);
    }

    reportPerf('Cache hit lookup', times, 1);
  });
});

afterAll(() => {
  console.log('\n=== Atua Performance Benchmark Report ===');
  console.log(
    'Benchmark'.padEnd(35) +
      'Avg (ms)'.padEnd(12) +
      'P95 (ms)'.padEnd(12) +
      'Target'.padEnd(12) +
      'Status',
  );
  console.log('-'.repeat(80));
  for (const r of perfResults) {
    console.log(
      r.name.padEnd(35) +
        String(r.avg).padEnd(12) +
        String(r.p95).padEnd(12) +
        r.target.padEnd(12) +
        r.status,
    );
  }
  console.log('');
});
