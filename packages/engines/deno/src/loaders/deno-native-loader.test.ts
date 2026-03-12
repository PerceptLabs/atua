/**
 * DenoNativeLoader — Unit tests
 * Validates IModuleLoader contract, builtin resolution, and file resolution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DenoNativeLoader, createDenoNativeLoader } from './deno-native-loader.js';

let loader: DenoNativeLoader;

beforeEach(async () => {
  loader = new DenoNativeLoader();
  await loader.initialize();
});

describe('DenoNativeLoader — Capabilities', () => {
  it('reports 100% node compat', () => {
    expect(loader.capabilities.nodeCompat).toBe(1.0);
    expect(loader.capabilities.nativeModuleResolution).toBe(true);
    expect(loader.capabilities.npmStrategy).toBe('native');
  });
});

describe('DenoNativeLoader — Initialize', () => {
  it('initialize is idempotent', async () => {
    await loader.initialize(); // second call
    expect(loader.capabilities.nodeCompat).toBe(1.0);
  });
});

describe('DenoNativeLoader — Builtins', () => {
  it('lists core Node.js builtins', () => {
    const builtins = loader.availableBuiltins();
    expect(builtins).toContain('fs');
    expect(builtins).toContain('path');
    expect(builtins).toContain('crypto');
    expect(builtins).toContain('http');
    expect(builtins).toContain('events');
    expect(builtins).toContain('buffer');
    expect(builtins).toContain('stream');
    expect(builtins).toContain('url');
    expect(builtins).toContain('util');
    expect(builtins).toContain('os');
    expect(builtins).toContain('net');
    expect(builtins).toContain('child_process');
    expect(builtins).toContain('worker_threads');
    expect(builtins).toContain('zlib');
  });

  it('lists subpath builtins', () => {
    const builtins = loader.availableBuiltins();
    expect(builtins).toContain('fs/promises');
    expect(builtins).toContain('path/posix');
    expect(builtins).toContain('path/win32');
    expect(builtins).toContain('stream/web');
    expect(builtins).toContain('timers/promises');
    expect(builtins).toContain('dns/promises');
    expect(builtins).toContain('readline/promises');
    expect(builtins).toContain('util/types');
    expect(builtins).toContain('assert/strict');
    expect(builtins).toContain('stream/consumers');
    expect(builtins).toContain('stream/promises');
  });

  it('has 50+ builtins', () => {
    expect(loader.availableBuiltins().length).toBeGreaterThanOrEqual(50);
  });

  it('getBuiltinSource returns Deno bridge code', () => {
    const src = loader.getBuiltinSource('fs');
    expect(src).toBeDefined();
    expect(src).toContain('__deno_node_require');
    expect(src).toContain('node:fs');
  });

  it('getBuiltinSource returns undefined for unknown', () => {
    expect(loader.getBuiltinSource('not_a_module')).toBeUndefined();
  });

  it('getBuiltinSource handles subpath modules', () => {
    const src = loader.getBuiltinSource('fs/promises');
    expect(src).toBeDefined();
    expect(src).toContain('node:fs/promises');
  });
});

describe('DenoNativeLoader — Module Resolution', () => {
  it('resolves node: specifiers', () => {
    const result = loader.resolveModule('node:fs');
    expect(result).toBeDefined();
    expect(result).toContain('__deno_node_require');
  });

  it('resolves bare builtin names', () => {
    const result = loader.resolveModule('path');
    expect(result).toBeDefined();
    expect(result).toContain('node:path');
  });

  it('returns null for npm: specifiers (handled natively)', () => {
    expect(loader.resolveModule('npm:express')).toBeNull();
  });

  it('returns null for https: specifiers (handled natively)', () => {
    expect(loader.resolveModule('https://deno.land/std/path/mod.ts')).toBeNull();
  });

  it('returns null for relative paths without fs', () => {
    expect(loader.resolveModule('./utils.js')).toBeNull();
  });

  it('returns null for bare specifiers (npm resolver)', () => {
    expect(loader.resolveModule('express')).toBeNull();
  });
});

describe('DenoNativeLoader — File Resolution with FS', () => {
  it('resolves files when fs is provided', async () => {
    const mockFs = {
      existsSync: (p: string) => p === '/app/utils.ts',
      readFileSync: (p: string) => p === '/app/utils.ts' ? 'export const x = 1;' : null,
    };
    const fsLoader = new DenoNativeLoader({ fs: mockFs });
    await fsLoader.initialize();
    const result = fsLoader.resolveModule('/app/utils.ts');
    expect(result).toBe('export const x = 1;');
  });

  it('tries extensions when resolving files', async () => {
    const checked: string[] = [];
    const mockFs = {
      existsSync: (p: string) => { checked.push(p); return p === '/app/mod.ts'; },
      readFileSync: (p: string) => p === '/app/mod.ts' ? 'export default 1;' : null,
    };
    const fsLoader = new DenoNativeLoader({ fs: mockFs });
    await fsLoader.initialize();
    const result = fsLoader.resolveModule('/app/mod');
    expect(result).toBe('export default 1;');
    expect(checked).toContain('/app/mod');
    expect(checked).toContain('/app/mod.ts');
  });

  it('tries index files for directories', async () => {
    const mockFs = {
      existsSync: (p: string) => p === '/app/lib/index.ts',
      readFileSync: (p: string) => p === '/app/lib/index.ts' ? 'export const lib = true;' : null,
    };
    const fsLoader = new DenoNativeLoader({ fs: mockFs });
    await fsLoader.initialize();
    const result = fsLoader.resolveModule('/app/lib');
    expect(result).toBe('export const lib = true;');
  });
});

describe('DenoNativeLoader — Factory', () => {
  it('createDenoNativeLoader returns IModuleLoader', () => {
    const l = createDenoNativeLoader();
    expect(l.capabilities).toBeDefined();
    expect(l.availableBuiltins).toBeDefined();
    expect(l.resolveModule).toBeDefined();
    expect(l.getBuiltinSource).toBeDefined();
  });
});
