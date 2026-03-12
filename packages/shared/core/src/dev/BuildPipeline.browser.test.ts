/**
 * BuildPipeline — Browser tests
 *
 * Tests full build pipeline: write source to CatalystFS, build, verify
 * output in /dist/, content-hash cache hits, HMR file watching, and
 * build error reporting.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CatalystFS } from '../fs/CatalystFS.js';
import {
  BuildPipeline,
  EsbuildTranspiler,
  PassthroughTranspiler,
  type Transpiler,
  type BuildError,
} from './BuildPipeline.js';
import { HMRManager } from './HMRManager.js';

// Try to create an esbuild transpiler; fall back to passthrough
let transpiler: Transpiler;
let esbuildAvailable = false;

try {
  const t = new EsbuildTranspiler();
  const testResult = await t.transform('const x = 1;', { loader: 'js' });
  // Check both thrown errors and returned errors
  if (testResult.errors.length > 0) throw new Error('esbuild init failed');
  transpiler = t;
  esbuildAvailable = true;
} catch {
  transpiler = new PassthroughTranspiler();
}

describe('BuildPipeline — Single File Build', () => {
  it('should build a JS file and write to /dist/', async () => {
    const fs = await CatalystFS.create('bp-build-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    // Write source
    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync(
      '/src/index.js',
      'var greeting = "Hello from Catalyst!";\nconsole.log(greeting);',
    );

    const result = await pipeline.build({
      entryPoint: '/src/index.js',
      outFile: 'app.js',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.cached).toBe(false);
    expect(result.code).toContain('Hello from Catalyst');
    expect(fs.existsSync('/dist/app.js')).toBe(true);

    const output = fs.readFileSync('/dist/app.js', 'utf-8') as string;
    expect(output).toContain('Hello from Catalyst');
  });

  it('should build TSX source with esbuild', async () => {
    if (!esbuildAvailable) return; // Skip if esbuild not available

    const fs = await CatalystFS.create('bp-tsx-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync(
      '/src/index.tsx',
      'const el = <div className="test">Hello TSX</div>;\nconsole.log(el);',
    );

    const result = await pipeline.build({
      entryPoint: '/src/index.tsx',
      outFile: 'app.js',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('createElement');
    expect(fs.existsSync('/dist/app.js')).toBe(true);
  });
});

describe('BuildPipeline — Content Hash Cache', () => {
  it('should return cached=true for identical source', async () => {
    const fs = await CatalystFS.create('bp-cache-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    const result1 = await pipeline.build({ entryPoint: '/src/index.js' });
    expect(result1.cached).toBe(false);

    const result2 = await pipeline.build({ entryPoint: '/src/index.js' });
    expect(result2.cached).toBe(true);
    expect(result2.hash).toBe(result1.hash);
    expect(result2.duration).toBeLessThanOrEqual(result1.duration + 50);
  });

  it('should rebuild when source changes', async () => {
    const fs = await CatalystFS.create('bp-cache-2');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    const result1 = await pipeline.build({ entryPoint: '/src/index.js' });
    expect(result1.cached).toBe(false);

    // Modify source
    fs.writeFileSync('/src/index.js', 'var x = 2;');
    const result2 = await pipeline.build({ entryPoint: '/src/index.js' });
    expect(result2.cached).toBe(false);
    expect(result2.hash).not.toBe(result1.hash);
  });
});

describe('BuildPipeline — Multi-Module Bundle', () => {
  it('should bundle multiple files with imports', async () => {
    const fs = await CatalystFS.create('bp-multi-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync(
      '/src/index.js',
      "var helper = require('./helper');\nconsole.log(helper.greet('World'));",
    );
    fs.writeFileSync(
      '/src/helper.js',
      'module.exports = { greet: function(name) { return "Hello " + name; } };',
    );

    const result = await pipeline.build({ entryPoint: '/src/index.js' });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('greet');
    expect(result.code).toContain('Hello');
  });
});

describe('BuildPipeline — Error Handling', () => {
  it('should report error for missing entry point', async () => {
    const fs = await CatalystFS.create('bp-err-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    const result = await pipeline.build({ entryPoint: '/nonexistent.js' });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].text).toContain('Entry point not found');
  });

  it('should report build errors for invalid TSX', async () => {
    if (!esbuildAvailable) return;

    const fs = await CatalystFS.create('bp-err-2');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.tsx', 'const x: = invalid syntax {{{;');

    const result = await pipeline.build({ entryPoint: '/src/index.tsx' });
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('BuildPipeline — Backend Pass', () => {
  it('should build a backend/worker file', async () => {
    const fs = await CatalystFS.create('bp-backend-1');
    const pipeline = new BuildPipeline(fs, transpiler);

    fs.mkdirSync('/src/api', { recursive: true });
    fs.writeFileSync(
      '/src/api/index.js',
      'addEventListener("fetch", function(event) { event.respondWith(new Response("ok")); });',
    );

    const result = await pipeline.build({
      entryPoint: '/src/api/index.js',
      outFile: 'api-sw.js',
      platform: 'worker',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('addEventListener');
    expect(fs.existsSync('/dist/api-sw.js')).toBe(true);
  });
});

describe('HMRManager — File Watch + Rebuild', () => {
  it('should emit update event after file change triggers rebuild', async () => {
    const fs = await CatalystFS.create('hmr-1');
    const pipeline = new BuildPipeline(fs, transpiler);
    const hmr = new HMRManager(fs, pipeline, { entryPoint: '/src/index.js' });

    // Write initial source
    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    // Do initial build
    await hmr.rebuild();

    // Set up event listener
    let updateReceived = false;
    hmr.on('update', () => {
      updateReceived = true;
    });

    // Modify source and trigger rebuild
    fs.writeFileSync('/src/index.js', 'var x = 2;');
    await hmr.rebuild();

    expect(updateReceived).toBe(true);
  });

  it('should not emit update for cached (unchanged) builds', async () => {
    const fs = await CatalystFS.create('hmr-2');
    const pipeline = new BuildPipeline(fs, transpiler);
    const hmr = new HMRManager(fs, pipeline, { entryPoint: '/src/index.js' });

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    await hmr.rebuild();

    let updateCount = 0;
    hmr.on('update', () => {
      updateCount++;
    });

    // Rebuild without changes
    await hmr.rebuild();

    expect(updateCount).toBe(0);
  });

  it('should emit error event for build failures', async () => {
    if (!esbuildAvailable) return;

    const fs = await CatalystFS.create('hmr-3');
    const pipeline = new BuildPipeline(fs, transpiler);
    const hmr = new HMRManager(fs, pipeline, { entryPoint: '/src/index.tsx' });

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.tsx', 'const x: = ;; invalid');

    let errorReceived = false;
    hmr.on('error', () => {
      errorReceived = true;
    });

    await hmr.rebuild();
    expect(errorReceived).toBe(true);
  });

  it('should track watching state', async () => {
    const fs = await CatalystFS.create('hmr-4');
    const pipeline = new BuildPipeline(fs, transpiler);
    const hmr = new HMRManager(fs, pipeline);

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    expect(hmr.watching).toBe(false);
    hmr.start('/src');
    expect(hmr.watching).toBe(true);
    hmr.stop();
    expect(hmr.watching).toBe(false);
  });

  it('should emit build-start and build-complete events', async () => {
    const fs = await CatalystFS.create('hmr-5');
    const pipeline = new BuildPipeline(fs, transpiler);
    const hmr = new HMRManager(fs, pipeline, { entryPoint: '/src/index.js' });

    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    const events: string[] = [];
    hmr.on('build-start', () => events.push('start'));
    hmr.on('build-complete', () => events.push('complete'));

    await hmr.rebuild();
    expect(events).toEqual(['start', 'complete']);
  });
});
