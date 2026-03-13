/**
 * PackageManager — Browser tests
 *
 * Tests full integration: install packages with mock fetcher,
 * verify /node_modules/ written to AtuaFS, require in QuickJS,
 * lockfile persistence, cache hits, LRU eviction, installAll.
 */
import { describe, it, expect } from 'vitest';
import { AtuaFS } from '../fs/AtuaFS.js';
import { NativeEngine } from '../engines/native/NativeEngine.js';
import { PackageManager } from './PackageManager.js';
import { PackageCache } from './PackageCache.js';
import { Lockfile } from './Lockfile.js';

// Mock package code — simple CommonJS modules
const MOCK_LODASH_CODE = `
module.exports = {
  chunk: function(arr, size) {
    var result = [];
    for (var i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  },
  add: function(a, b) { return a + b; },
  identity: function(v) { return v; }
};
`;

const MOCK_LEFTPAD_CODE = `
module.exports = function leftpad(str, len, ch) {
  str = String(str);
  ch = ch || ' ';
  while (str.length < len) str = ch + str;
  return str;
};
`;

const MOCK_MATHLIB_CODE = `
module.exports = {
  square: function(x) { return x * x; },
  cube: function(x) { return x * x * x; },
  PI: 3.14159
};
`;

// Mock registry data
const mockRegistry: Record<string, any> = {
  lodash: {
    name: 'lodash',
    'dist-tags': { latest: '4.17.21' },
    versions: {
      '4.17.21': {
        dependencies: {},
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha256-lodash-hash',
        },
      },
    },
  },
  leftpad: {
    name: 'leftpad',
    'dist-tags': { latest: '2.0.0' },
    versions: {
      '2.0.0': {
        dependencies: {},
        dist: {
          tarball: 'https://registry.npmjs.org/leftpad/-/leftpad-2.0.0.tgz',
          integrity: 'sha256-leftpad-hash',
        },
      },
    },
  },
  mathlib: {
    name: 'mathlib',
    'dist-tags': { latest: '1.0.0' },
    versions: {
      '1.0.0': {
        dependencies: {},
        dist: {
          tarball: 'https://registry.npmjs.org/mathlib/-/mathlib-1.0.0.tgz',
          integrity: 'sha256-mathlib-hash',
        },
      },
    },
  },
};

// Mock CDN code
const mockCdnCode: Record<string, string> = {
  lodash: MOCK_LODASH_CODE,
  leftpad: MOCK_LEFTPAD_CODE,
  mathlib: MOCK_MATHLIB_CODE,
};

/** Create a mock fetch function for both registry and CDN */
function createMockFetches() {
  let cdnFetchCount = 0;

  const mockRegistryFetch = async (url: string) => {
    const name = url.split('/').pop()!;
    const data = mockRegistry[decodeURIComponent(name)];
    if (!data) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => data };
  };

  const mockCdnFetch = async (url: string) => {
    cdnFetchCount++;
    // Extract package name from CDN URL like https://esm.sh/lodash@4.17.21?cjs&bundle-deps
    const match = url.match(/esm\.sh\/([^@]+)@/);
    const name = match?.[1] ?? '';
    const code = mockCdnCode[name];
    if (!code) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(code, { status: 200, statusText: 'OK' });
  };

  return { mockRegistryFetch, mockCdnFetch, getCdnFetchCount: () => cdnFetchCount };
}

/** Create PackageManager with mock fetches */
function createMockPM(fs: AtuaFS) {
  const mocks = createMockFetches();
  const pm = new PackageManager({
    fs,
    resolver: { fetchFn: mocks.mockRegistryFetch },
    fetcher: { fetchFn: mocks.mockCdnFetch },
  });
  return { pm, ...mocks };
}

describe('PackageManager — Install & Resolve', () => {
  it('should install a package to /node_modules/', async () => {
    const fs = await AtuaFS.create('pm-install-1');
    const { pm } = createMockPM(fs);

    const info = await pm.install('lodash');
    expect(info.name).toBe('lodash');
    expect(info.version).toBe('4.17.21');
    expect(info.path).toBe('/node_modules/lodash');
    expect(info.cached).toBe(false);

    // Verify files written
    expect(fs.existsSync('/node_modules/lodash/index.js')).toBe(true);
    expect(fs.existsSync('/node_modules/lodash/package.json')).toBe(true);

    const code = fs.readFileSync('/node_modules/lodash/index.js', 'utf-8') as string;
    expect(code).toContain('chunk');
  });

  it('should resolve installed package path', async () => {
    const fs = await AtuaFS.create('pm-resolve-1');
    const { pm } = createMockPM(fs);

    expect(pm.resolve('lodash')).toBeNull();
    await pm.install('lodash');
    expect(pm.resolve('lodash')).toBe('/node_modules/lodash');
  });

  it('should install and require in QuickJS', async () => {
    const fs = await AtuaFS.create('pm-require-1');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');

    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`
        var _ = require('lodash');
        module.exports = JSON.stringify(_.chunk([1, 2, 3, 4, 5, 6], 2));
      `);
      expect(JSON.parse(result as string)).toEqual([[1, 2], [3, 4], [5, 6]]);
    } finally {
      await engine.destroy();
    }
  });

  it('should install and use _.add in QuickJS', async () => {
    const fs = await AtuaFS.create('pm-require-2');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');

    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`
        var _ = require('lodash');
        module.exports = _.add(10, 20);
      `);
      expect(result).toBe(30);
    } finally {
      await engine.destroy();
    }
  });
});

describe('PackageManager — Lockfile', () => {
  it('should write lockfile after install', async () => {
    const fs = await AtuaFS.create('pm-lock-1');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');

    expect(fs.existsSync('/atua-lock.json')).toBe(true);
    const lockContent = fs.readFileSync('/atua-lock.json', 'utf-8') as string;
    const lockData = JSON.parse(lockContent);
    expect(lockData.packages.lodash.version).toBe('4.17.21');
  });

  it('should use lockfile version on second install', async () => {
    const fs = await AtuaFS.create('pm-lock-2');
    const { pm, getCdnFetchCount } = createMockPM(fs);

    await pm.install('lodash');
    const fetchCount1 = getCdnFetchCount();

    // Second install should hit cache
    const info2 = await pm.install('lodash');
    expect(info2.cached).toBe(true);
    expect(getCdnFetchCount()).toBe(fetchCount1); // No additional CDN fetch
  });
});

describe('PackageManager — Cache', () => {
  it('should return cached=true on second install', async () => {
    const fs = await AtuaFS.create('pm-cache-1');
    const { pm } = createMockPM(fs);

    const info1 = await pm.install('lodash');
    expect(info1.cached).toBe(false);

    const info2 = await pm.install('lodash');
    expect(info2.cached).toBe(true);
  });

  it('should list installed packages', async () => {
    const fs = await AtuaFS.create('pm-list-1');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');
    await pm.install('leftpad');

    const packages = pm.list();
    expect(packages.length).toBe(2);
    expect(packages.map((p) => p.name).sort()).toEqual(['leftpad', 'lodash']);
  });

  it('should remove a package', async () => {
    const fs = await AtuaFS.create('pm-remove-1');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');
    expect(pm.resolve('lodash')).toBe('/node_modules/lodash');

    await pm.remove('lodash');
    expect(pm.resolve('lodash')).toBeNull();
    expect(pm.list().length).toBe(0);
  });

  it('should clear all packages', async () => {
    const fs = await AtuaFS.create('pm-clear-1');
    const { pm } = createMockPM(fs);

    await pm.install('lodash');
    await pm.install('leftpad');
    expect(pm.list().length).toBe(2);

    await pm.clear();
    expect(pm.list().length).toBe(0);
  });
});

describe('PackageManager — installAll', () => {
  it('should install all dependencies from package.json', async () => {
    const fs = await AtuaFS.create('pm-all-1');
    const { pm } = createMockPM(fs);

    // Write package.json
    fs.writeFileSync(
      '/package.json',
      JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        dependencies: {
          lodash: '^4.17.0',
          leftpad: '^2.0.0',
        },
      }),
    );

    const results = await pm.installAll();
    expect(results.length).toBe(2);
    expect(results.map((r) => r.name).sort()).toEqual(['leftpad', 'lodash']);

    // Verify both packages are available
    expect(fs.existsSync('/node_modules/lodash/index.js')).toBe(true);
    expect(fs.existsSync('/node_modules/leftpad/index.js')).toBe(true);
  });

  it('should require all installed packages in QuickJS', async () => {
    const fs = await AtuaFS.create('pm-all-2');
    const { pm } = createMockPM(fs);

    fs.writeFileSync(
      '/package.json',
      JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.0', leftpad: '^2.0.0' },
      }),
    );

    await pm.installAll();

    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`
        var _ = require('lodash');
        var leftpad = require('leftpad');
        var chunked = _.chunk([1,2,3,4], 2);
        var padded = leftpad('42', 5, '0');
        module.exports = JSON.stringify({ chunked: chunked, padded: padded });
      `);
      const parsed = JSON.parse(result as string);
      expect(parsed.chunked).toEqual([[1, 2], [3, 4]]);
      expect(parsed.padded).toBe('00042');
    } finally {
      await engine.destroy();
    }
  });
});

describe('PackageCache — LRU Eviction', () => {
  it('should evict least-recently-used when cache exceeds max size', async () => {
    const fs = await AtuaFS.create('pm-lru-1');

    // Create cache with very small max size (200 bytes)
    const cache = new PackageCache(fs, { maxSize: 200 });

    // Install first package (~100 bytes each)
    const code100 = 'x'.repeat(100);
    cache.store('pkg-a', '1.0.0', code100, { source: 'test' });

    // Access pkg-a to set its lastAccessed time
    cache.isCached('pkg-a');

    // Wait a tick so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    // Install second package
    cache.store('pkg-b', '1.0.0', code100, { source: 'test' });

    // Both should be cached (200 bytes total, at limit)
    expect(cache.size).toBe(2);

    // Wait a tick
    await new Promise((r) => setTimeout(r, 10));

    // Install third package — should trigger eviction of pkg-a (least recently used)
    cache.store('pkg-c', '1.0.0', code100, { source: 'test' });

    // pkg-a should be evicted (it was accessed earliest)
    expect(cache.isCached('pkg-a')).toBe(false);
    // pkg-b and pkg-c should remain
    expect(cache.isCached('pkg-b')).toBe(true);
    expect(cache.isCached('pkg-c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('should track total cache size', async () => {
    const fs = await AtuaFS.create('pm-lru-2');
    const cache = new PackageCache(fs);

    cache.store('small', '1.0.0', 'abc', { source: 'test' });
    cache.store('medium', '1.0.0', 'a'.repeat(100), { source: 'test' });

    expect(cache.totalSize).toBe(103);
  });
});

describe('PackageManager — Multiple packages in QuickJS', () => {
  it('should install mathlib and use it in QuickJS', async () => {
    const fs = await AtuaFS.create('pm-math-1');
    const { pm } = createMockPM(fs);

    await pm.install('mathlib');

    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`
        var math = require('mathlib');
        module.exports = JSON.stringify({ sq: math.square(5), cu: math.cube(3), pi: math.PI });
      `);
      const parsed = JSON.parse(result as string);
      expect(parsed.sq).toBe(25);
      expect(parsed.cu).toBe(27);
      expect(parsed.pi).toBe(3.14159);
    } finally {
      await engine.destroy();
    }
  });
});
