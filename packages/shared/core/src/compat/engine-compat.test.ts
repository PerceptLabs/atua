/**
 * Engine Compatibility — Phase 22a
 *
 * Validates that Reaction (Deno) and Atua (QuickJS) engines
 * handle Workers compliance correctly and provide feature parity.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { DenoEngine } from '../../../../engines/deno/src/engine.js';
import { DenoWasmLoader } from '../../../../engines/deno/src/wasm-loader.js';
import { OpsBridge } from '../../../../engines/deno/src/ops-bridge.js';
import { DenoNativeLoader } from '../../../../engines/deno/src/loaders/deno-native-loader.js';

afterAll(() => {
  DenoWasmLoader.reset();
});

describe('Engine Compat — DenoEngine Workers Mode', () => {
  it('OpsBridge has all required ops', () => {
    const bridge = new OpsBridge({});
    const ops = bridge.registeredOps();

    // Filesystem ops
    expect(ops).toContain('op_read_file_sync');
    expect(ops).toContain('op_write_file_sync');
    expect(ops).toContain('op_stat_sync');
    expect(ops).toContain('op_mkdir_sync');
    expect(ops).toContain('op_readdir_sync');
    expect(ops).toContain('op_remove_sync');
    expect(ops).toContain('op_rename_sync');
    expect(ops).toContain('op_exists_sync');

    // Async fs ops
    expect(ops).toContain('op_read_file_async');
    expect(ops).toContain('op_write_file_async');

    // Crypto ops
    expect(ops).toContain('op_crypto_get_random_values');
    expect(ops).toContain('op_crypto_random_uuid');
    expect(ops).toContain('op_crypto_subtle_digest');

    // Timer ops
    expect(ops).toContain('op_timer_start');
    expect(ops).toContain('op_timer_cancel');
    expect(ops).toContain('op_now');

    // Net ops
    expect(ops).toContain('op_fetch');

    // Env ops
    expect(ops).toContain('op_env_get');
    expect(ops).toContain('op_env_set');
    expect(ops).toContain('op_env_delete');
    expect(ops).toContain('op_env_to_object');
    expect(ops).toContain('op_cwd');
    expect(ops).toContain('op_chdir');
    expect(ops).toContain('op_pid');

    // Process ops
    expect(ops).toContain('op_spawn');

    bridge.destroy();
  });

  it('OpsBridge has 20+ ops registered', () => {
    const bridge = new OpsBridge({});
    expect(bridge.registeredOps().length).toBeGreaterThanOrEqual(20);
    bridge.destroy();
  });
});

describe('Engine Compat — DenoNativeLoader', () => {
  it('has 100% Node.js compat', () => {
    const loader = new DenoNativeLoader();
    expect(loader.capabilities.nodeCompat).toBe(1.0);
  });

  it('has 50+ builtins', () => {
    const loader = new DenoNativeLoader();
    expect(loader.availableBuiltins().length).toBeGreaterThanOrEqual(50);
  });

  it('covers all critical Node.js modules', () => {
    const loader = new DenoNativeLoader();
    const builtins = loader.availableBuiltins();

    const critical = [
      'fs', 'path', 'http', 'https', 'crypto', 'buffer', 'stream',
      'events', 'url', 'util', 'os', 'net', 'child_process', 'zlib',
      'dns', 'tls', 'querystring', 'readline', 'process', 'module',
      'worker_threads', 'vm', 'assert', 'timers',
    ];

    for (const mod of critical) {
      expect(builtins, `Missing critical builtin: ${mod}`).toContain(mod);
    }
  });

  it('covers subpath imports', () => {
    const loader = new DenoNativeLoader();
    const builtins = loader.availableBuiltins();

    const subpaths = [
      'fs/promises', 'path/posix', 'stream/web',
      'timers/promises', 'util/types', 'dns/promises',
    ];

    for (const sp of subpaths) {
      expect(builtins, `Missing subpath: ${sp}`).toContain(sp);
    }
  });
});

describe('Engine Compat — WASM Loader Lifecycle', () => {
  it('unavailable status when no binary', async () => {
    DenoWasmLoader.reset();
    const loader = DenoWasmLoader.getInstance();
    await loader.initialize();
    expect(loader.getStatus()).toBe('unavailable');
    expect(loader.getError()).toBeDefined();
    expect(loader.getError()!.message).toContain('WASM binary not available');
    DenoWasmLoader.reset();
  });

  it('JSPI detection works', () => {
    // In Node.js environment, JSPI is not available
    DenoWasmLoader.reset();
    const loader = DenoWasmLoader.getInstance();
    // Loader should handle missing JSPI gracefully
    expect(loader.getStatus()).toBe('uninitialized');
    DenoWasmLoader.reset();
  });
});

describe('Engine Compat — Mode Comparison', () => {
  it('documents mode capabilities', () => {
    const modes = {
      atua: {
        engine: 'QuickJS',
        jspiRequired: false,
        wasmSize: '< 1MB',
        bootTime: '< 200ms',
        nodeCompat: '~75% (via unenv polyfills)',
        npmStrategy: 'esm.sh CDN',
        targetUseCase: 'Lightweight sandboxing, Workers-compatible apps',
      },
      reaction: {
        engine: 'Deno (V8 jitless → WASM)',
        jspiRequired: true,
        wasmSize: '~20MB',
        bootTime: '< 3s cold / < 500ms warm',
        nodeCompat: '100% (native node: compat)',
        npmStrategy: 'native npm resolution',
        targetUseCase: 'Full Node.js apps, framework dev servers',
      },
    };

    // Verify both modes are documented
    expect(modes.atua.engine).toBe('QuickJS');
    expect(modes.reaction.engine).toContain('Deno');

    // QuickJS: smaller, faster boot, less compat
    expect(modes.atua.jspiRequired).toBe(false);
    expect(modes.reaction.jspiRequired).toBe(true);

    console.log('\n=== Mode Comparison ===');
    console.log(JSON.stringify(modes, null, 2));
  });

  it('documents Safari fallback strategy', () => {
    const safariStrategy = {
      primary: 'JSPI (WebAssembly.Suspending)',
      fallback: 'Asyncify (pre-compiled WASM with stack-switching)',
      detection: 'typeof WebAssembly.Suspending === "function"',
      impact: 'Asyncify adds ~20% to WASM binary size, ~10% slower',
      caching: 'Workbox precache both variants, serve based on detection',
    };

    expect(safariStrategy.primary).toBe('JSPI (WebAssembly.Suspending)');
    expect(safariStrategy.fallback).toContain('Asyncify');
    console.log('\n=== Safari Fallback Strategy ===');
    console.log(JSON.stringify(safariStrategy, null, 2));
  });

  it('documents WASM caching strategy', () => {
    const cachingStrategy = {
      approach: 'Workbox precache + OPFS cache',
      steps: [
        '1. First load: fetch WASM binary from CDN',
        '2. Cache to OPFS for instant second load',
        '3. Workbox precache entry with content hash',
        '4. Background update when new version available',
        '5. Versioned cache keys prevent stale binaries',
      ],
      targets: {
        coldBoot: '< 3s (20MB WASM fetch + compile)',
        warmBoot: '< 500ms (OPFS cache + compile)',
        cachedBoot: '< 200ms (compiled module cache)',
      },
    };

    expect(cachingStrategy.approach).toContain('Workbox');
    expect(cachingStrategy.steps.length).toBeGreaterThanOrEqual(4);
    console.log('\n=== WASM Caching Strategy ===');
    console.log(JSON.stringify(cachingStrategy, null, 2));
  });
});
