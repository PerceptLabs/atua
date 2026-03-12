/**
 * BuildPipeline — Node tests
 *
 * Tests content hash computation, build config validation,
 * import parsing, module resolution, and esbuild transpilation.
 */
import { describe, it, expect } from 'vitest';
import { ContentHashCache } from './ContentHashCache.js';
import { getLoader, parseImports, resolveRelative } from './BuildPipeline.js';

// ---- ContentHashCache ----

describe('ContentHashCache', () => {
  it('should compute deterministic SHA-256 hash', async () => {
    const cache = new ContentHashCache();
    const files = new Map([
      ['/src/a.ts', 'const a = 1;'],
      ['/src/b.ts', 'const b = 2;'],
    ]);
    const hash1 = await cache.computeHash(files);
    const hash2 = await cache.computeHash(files);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should produce different hashes for different content', async () => {
    const cache = new ContentHashCache();
    const files1 = new Map([['/src/a.ts', 'const a = 1;']]);
    const files2 = new Map([['/src/a.ts', 'const a = 2;']]);

    const hash1 = await cache.computeHash(files1);
    const hash2 = await cache.computeHash(files2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce same hash regardless of insertion order', async () => {
    const cache = new ContentHashCache();
    const files1 = new Map([
      ['/src/a.ts', 'a'],
      ['/src/b.ts', 'b'],
    ]);
    const files2 = new Map([
      ['/src/b.ts', 'b'],
      ['/src/a.ts', 'a'],
    ]);

    const hash1 = await cache.computeHash(files1);
    const hash2 = await cache.computeHash(files2);
    expect(hash1).toBe(hash2);
  });

  it('should store and retrieve cached builds', async () => {
    const cache = new ContentHashCache();
    const hash = 'abc123';

    cache.set(hash, { code: 'output', outputPath: '/dist/app.js' });
    expect(cache.has(hash)).toBe(true);
    expect(cache.get(hash)?.code).toBe('output');
  });

  it('should evict oldest entry when over max', () => {
    const cache = new ContentHashCache(2);

    cache.set('hash1', { code: 'a', outputPath: '/a' });
    cache.set('hash2', { code: 'b', outputPath: '/b' });
    cache.set('hash3', { code: 'c', outputPath: '/c' });

    expect(cache.has('hash1')).toBe(false); // Evicted
    expect(cache.has('hash2')).toBe(true);
    expect(cache.has('hash3')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('should clear all entries', () => {
    const cache = new ContentHashCache();
    cache.set('a', { code: '1', outputPath: '/1' });
    cache.set('b', { code: '2', outputPath: '/2' });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

// ---- getLoader ----

describe('getLoader', () => {
  it('should detect TSX files', () => {
    expect(getLoader('/src/App.tsx')).toBe('tsx');
  });

  it('should detect TS files', () => {
    expect(getLoader('/src/utils.ts')).toBe('ts');
  });

  it('should detect JSX files', () => {
    expect(getLoader('/src/App.jsx')).toBe('jsx');
  });

  it('should detect JSON files', () => {
    expect(getLoader('/data/config.json')).toBe('json');
  });

  it('should detect CSS files', () => {
    expect(getLoader('/styles/main.css')).toBe('css');
  });

  it('should default to JS', () => {
    expect(getLoader('/src/main.js')).toBe('js');
    expect(getLoader('/src/unknown.mjs')).toBe('js');
  });
});

// ---- parseImports ----

describe('parseImports', () => {
  it('should parse ES import statements', () => {
    const source = `
import React from 'react';
import { useState } from 'react';
import './App.css';
import { helper } from './utils';
    `;
    const imports = parseImports(source);
    expect(imports).toContain('react');
    expect(imports).toContain('./App.css');
    expect(imports).toContain('./utils');
  });

  it('should parse require() calls', () => {
    const source = `
const fs = require('fs');
const path = require('path');
const utils = require('./utils');
    `;
    const imports = parseImports(source);
    expect(imports).toContain('fs');
    expect(imports).toContain('path');
    expect(imports).toContain('./utils');
  });

  it('should handle mixed imports', () => {
    const source = `
import React from 'react';
const lodash = require('lodash');
    `;
    const imports = parseImports(source);
    expect(imports).toContain('react');
    expect(imports).toContain('lodash');
  });

  it('should return empty array for no imports', () => {
    const imports = parseImports('const x = 1;');
    expect(imports).toEqual([]);
  });
});

// ---- resolveRelative ----

describe('resolveRelative', () => {
  it('should resolve relative imports', () => {
    expect(resolveRelative('./utils', '/src/App.tsx')).toBe('/src/utils');
    expect(resolveRelative('./components/Button', '/src/App.tsx')).toBe(
      '/src/components/Button',
    );
  });

  it('should resolve parent directory imports', () => {
    expect(resolveRelative('../utils', '/src/components/App.tsx')).toBe('/src/utils');
  });

  it('should handle absolute imports', () => {
    expect(resolveRelative('/lib/helper', '/src/App.tsx')).toBe('/lib/helper');
  });
});

// ---- EsbuildTranspiler (Node) ----

describe('EsbuildTranspiler — Node.js', () => {
  it('should transpile TypeScript to JavaScript', async () => {
    const { EsbuildTranspiler } = await import('./BuildPipeline.js');
    const transpiler = new EsbuildTranspiler();

    const result = await transpiler.transform('const x: number = 42;', {
      loader: 'ts',
    });
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('42');
    expect(result.code).not.toContain(': number');
  });

  it('should transpile TSX to JavaScript', async () => {
    const { EsbuildTranspiler } = await import('./BuildPipeline.js');
    const transpiler = new EsbuildTranspiler();

    const result = await transpiler.transform(
      'const el = <div className="test">Hello</div>;',
      { loader: 'tsx', jsx: 'transform' },
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('createElement');
  });

  it('should report errors for invalid syntax', async () => {
    const { EsbuildTranspiler } = await import('./BuildPipeline.js');
    const transpiler = new EsbuildTranspiler();

    const result = await transpiler.transform('const x: = ;', { loader: 'ts' });
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
