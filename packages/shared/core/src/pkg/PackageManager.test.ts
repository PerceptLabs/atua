/**
 * PackageManager — Node tests
 *
 * Tests semver resolution, lockfile serialization, package.json parsing,
 * NpmResolver dependency tree walking, and circular dep detection.
 */
import { describe, it, expect } from 'vitest';
import * as Semver from './Semver.js';
import { Lockfile } from './Lockfile.js';
import { PackageJson } from './PackageJson.js';
import { NpmResolver } from './NpmResolver.js';
import { PackageManager } from './PackageManager.js';
import { AtuaFS } from '../fs/AtuaFS.js';

// ---- Semver ----

describe('Semver — parse', () => {
  it('should parse a basic version', () => {
    const v = Semver.parse('1.2.3');
    expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('should parse version with v prefix', () => {
    const v = Semver.parse('v2.0.1');
    expect(v).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it('should parse version with prerelease', () => {
    const v = Semver.parse('1.0.0-beta.1');
    expect(v).toEqual({ major: 1, minor: 0, patch: 0, prerelease: 'beta.1' });
  });

  it('should return null for invalid version', () => {
    expect(Semver.parse('not-a-version')).toBeNull();
    expect(Semver.parse('')).toBeNull();
    expect(Semver.parse('1.2')).toBeNull();
  });
});

describe('Semver — compare', () => {
  it('should compare major versions', () => {
    expect(Semver.compare(Semver.parse('2.0.0')!, Semver.parse('1.0.0')!)).toBe(1);
    expect(Semver.compare(Semver.parse('1.0.0')!, Semver.parse('2.0.0')!)).toBe(-1);
  });

  it('should compare minor versions', () => {
    expect(Semver.compare(Semver.parse('1.2.0')!, Semver.parse('1.1.0')!)).toBe(1);
  });

  it('should compare patch versions', () => {
    expect(Semver.compare(Semver.parse('1.0.2')!, Semver.parse('1.0.1')!)).toBe(1);
  });

  it('should return 0 for equal versions', () => {
    expect(Semver.compare(Semver.parse('1.2.3')!, Semver.parse('1.2.3')!)).toBe(0);
  });

  it('should rank prerelease lower than release', () => {
    expect(Semver.compare(Semver.parse('1.0.0-alpha')!, Semver.parse('1.0.0')!)).toBe(-1);
    expect(Semver.compare(Semver.parse('1.0.0')!, Semver.parse('1.0.0-alpha')!)).toBe(1);
  });
});

describe('Semver — satisfies', () => {
  it('should match exact versions', () => {
    expect(Semver.satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(Semver.satisfies('1.2.4', '1.2.3')).toBe(false);
  });

  it('should match caret ranges', () => {
    expect(Semver.satisfies('1.3.0', '^1.2.3')).toBe(true);
    expect(Semver.satisfies('1.2.3', '^1.2.3')).toBe(true);
    expect(Semver.satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(Semver.satisfies('1.2.2', '^1.2.3')).toBe(false);
  });

  it('should match tilde ranges', () => {
    expect(Semver.satisfies('1.2.5', '~1.2.3')).toBe(true);
    expect(Semver.satisfies('1.3.0', '~1.2.3')).toBe(false);
  });

  it('should match comparison operators', () => {
    expect(Semver.satisfies('2.0.0', '>=1.0.0')).toBe(true);
    expect(Semver.satisfies('0.9.0', '>=1.0.0')).toBe(false);
    expect(Semver.satisfies('1.0.1', '>1.0.0')).toBe(true);
    expect(Semver.satisfies('1.0.0', '<2.0.0')).toBe(true);
    expect(Semver.satisfies('1.0.0', '<=1.0.0')).toBe(true);
  });

  it('should match wildcards', () => {
    expect(Semver.satisfies('5.0.0', '*')).toBe(true);
    expect(Semver.satisfies('1.0.0', 'latest')).toBe(true);
  });

  it('should match x-ranges', () => {
    expect(Semver.satisfies('1.5.0', '1.x')).toBe(true);
    expect(Semver.satisfies('2.0.0', '1.x')).toBe(false);
    expect(Semver.satisfies('1.2.5', '1.2.x')).toBe(true);
    expect(Semver.satisfies('1.3.0', '1.2.x')).toBe(false);
  });
});

describe('Semver — maxSatisfying', () => {
  it('should find the latest matching version', () => {
    const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0'];
    expect(Semver.maxSatisfying(versions, '^1.0.0')).toBe('1.2.0');
  });

  it('should return null when nothing matches', () => {
    const versions = ['1.0.0', '1.1.0'];
    expect(Semver.maxSatisfying(versions, '^2.0.0')).toBeNull();
  });

  it('should skip prereleases unless range targets them', () => {
    const versions = ['1.0.0', '1.1.0-beta.1', '1.1.0'];
    expect(Semver.maxSatisfying(versions, '^1.0.0')).toBe('1.1.0');
  });
});

describe('Semver — sort & valid', () => {
  it('should sort versions ascending', () => {
    const sorted = Semver.sort(['2.0.0', '1.0.0', '1.5.0', '0.1.0']);
    expect(sorted).toEqual(['0.1.0', '1.0.0', '1.5.0', '2.0.0']);
  });

  it('should validate version strings', () => {
    expect(Semver.valid('1.2.3')).toBe(true);
    expect(Semver.valid('abc')).toBe(false);
  });
});

// ---- Lockfile ----

describe('Lockfile', () => {
  it('should create empty lockfile', () => {
    const lf = new Lockfile();
    expect(lf.size).toBe(0);
    expect(lf.names()).toEqual([]);
  });

  it('should set and get entries', () => {
    const lf = new Lockfile();
    lf.set('lodash', {
      version: '4.17.21',
      resolved: 'https://esm.sh/lodash@4.17.21',
      integrity: 'sha256-abc',
      dependencies: {},
    });

    expect(lf.has('lodash')).toBe(true);
    expect(lf.get('lodash')?.version).toBe('4.17.21');
    expect(lf.size).toBe(1);
  });

  it('should remove entries', () => {
    const lf = new Lockfile();
    lf.set('lodash', {
      version: '4.17.21',
      resolved: '',
      integrity: '',
      dependencies: {},
    });
    expect(lf.remove('lodash')).toBe(true);
    expect(lf.has('lodash')).toBe(false);
    expect(lf.remove('nonexistent')).toBe(false);
  });

  it('should serialize and deserialize', () => {
    const lf = new Lockfile();
    lf.set('express', {
      version: '4.18.2',
      resolved: 'https://esm.sh/express@4.18.2',
      integrity: 'sha256-xyz',
      dependencies: { 'body-parser': '1.20.1' },
    });

    const json = lf.serialize();
    const restored = Lockfile.deserialize(json);
    expect(restored.get('express')?.version).toBe('4.18.2');
    expect(restored.get('express')?.dependencies).toEqual({ 'body-parser': '1.20.1' });
  });

  it('should clear all entries', () => {
    const lf = new Lockfile();
    lf.set('a', { version: '1.0.0', resolved: '', integrity: '', dependencies: {} });
    lf.set('b', { version: '2.0.0', resolved: '', integrity: '', dependencies: {} });
    expect(lf.size).toBe(2);
    lf.clear();
    expect(lf.size).toBe(0);
  });

  it('should return deep clone from toJSON', () => {
    const lf = new Lockfile();
    lf.set('pkg', { version: '1.0.0', resolved: '', integrity: '', dependencies: {} });
    const data = lf.toJSON();
    data.packages['pkg'].version = 'modified';
    expect(lf.get('pkg')?.version).toBe('1.0.0');
  });
});

// ---- PackageJson ----

describe('PackageJson', () => {
  it('should parse package.json string', () => {
    const pkg = PackageJson.parse(
      JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.0' },
      }),
    );
    expect(pkg.name).toBe('my-app');
    expect(pkg.version).toBe('1.0.0');
  });

  it('should get dependencies', () => {
    const pkg = PackageJson.parse(
      JSON.stringify({
        dependencies: { lodash: '^4.17.0', express: '^4.18.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );
    expect(pkg.getDependencies()).toEqual({ lodash: '^4.17.0', express: '^4.18.0' });
    expect(pkg.getDevDependencies()).toEqual({ vitest: '^1.0.0' });
  });

  it('should get all dependencies (deps + devDeps)', () => {
    const pkg = PackageJson.parse(
      JSON.stringify({
        dependencies: { lodash: '^4.17.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );
    const all = pkg.getAllDependencies();
    expect(all).toEqual({ lodash: '^4.17.0', vitest: '^1.0.0' });
  });

  it('should check if dependency exists', () => {
    const pkg = PackageJson.parse(
      JSON.stringify({
        dependencies: { lodash: '^4.17.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );
    expect(pkg.hasDependency('lodash')).toBe(true);
    expect(pkg.hasDependency('vitest')).toBe(true);
    expect(pkg.hasDependency('express')).toBe(false);
  });

  it('should get main entry point', () => {
    const pkg1 = PackageJson.parse(JSON.stringify({ main: 'dist/index.js' }));
    expect(pkg1.main).toBe('dist/index.js');

    const pkg2 = PackageJson.parse(JSON.stringify({}));
    expect(pkg2.main).toBe('index.js');
  });

  it('should serialize back to JSON', () => {
    const pkg = PackageJson.parse(
      JSON.stringify({ name: 'test', version: '1.0.0' }),
    );
    const serialized = JSON.parse(pkg.serialize());
    expect(serialized.name).toBe('test');
  });
});

// ---- NpmResolver ----

describe('NpmResolver — with mock registry', () => {
  const mockRegistry: Record<string, any> = {
    lodash: {
      name: 'lodash',
      'dist-tags': { latest: '4.17.21' },
      versions: {
        '4.17.20': {
          name: 'lodash',
          version: '4.17.20',
          dependencies: {},
          dist: {
            tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz',
            integrity: 'sha256-abc',
          },
        },
        '4.17.21': {
          name: 'lodash',
          version: '4.17.21',
          dependencies: {},
          dist: {
            tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
            integrity: 'sha256-def',
          },
        },
      },
    },
    'pkg-a': {
      name: 'pkg-a',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'pkg-a',
          version: '1.0.0',
          dependencies: { 'pkg-b': '^1.0.0' },
          dist: { tarball: 'https://example.com/pkg-a-1.0.0.tgz' },
        },
      },
    },
    'pkg-b': {
      name: 'pkg-b',
      'dist-tags': { latest: '1.2.0' },
      versions: {
        '1.0.0': {
          name: 'pkg-b',
          version: '1.0.0',
          dependencies: {},
          dist: { tarball: 'https://example.com/pkg-b-1.0.0.tgz' },
        },
        '1.2.0': {
          name: 'pkg-b',
          version: '1.2.0',
          dependencies: {},
          dist: { tarball: 'https://example.com/pkg-b-1.2.0.tgz' },
        },
      },
    },
    'circ-a': {
      name: 'circ-a',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'circ-a',
          version: '1.0.0',
          dependencies: { 'circ-b': '^1.0.0' },
          dist: { tarball: 'https://example.com/circ-a-1.0.0.tgz' },
        },
      },
    },
    'circ-b': {
      name: 'circ-b',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'circ-b',
          version: '1.0.0',
          dependencies: { 'circ-a': '^1.0.0' },
          dist: { tarball: 'https://example.com/circ-b-1.0.0.tgz' },
        },
      },
    },
  };

  function createMockResolver(): NpmResolver {
    return new NpmResolver({
      fetchFn: async (url: string) => {
        const name = url.split('/').pop()!;
        const decodedName = decodeURIComponent(name);
        const data = mockRegistry[decodedName];
        if (!data) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => data };
      },
    });
  }

  it('should resolve latest version', async () => {
    const resolver = createMockResolver();
    const pkg = await resolver.resolve('lodash', 'latest');
    expect(pkg.name).toBe('lodash');
    expect(pkg.version).toBe('4.17.21');
    expect(pkg.dependencies).toEqual({});
  });

  it('should resolve version range', async () => {
    const resolver = createMockResolver();
    const pkg = await resolver.resolve('lodash', '^4.17.0');
    expect(pkg.version).toBe('4.17.21');
  });

  it('should throw for non-existent package', async () => {
    const resolver = createMockResolver();
    await expect(resolver.resolve('nonexistent')).rejects.toThrow('NPM_REGISTRY_ERROR');
  });

  it('should throw for unsatisfiable range', async () => {
    const resolver = createMockResolver();
    await expect(resolver.resolve('lodash', '^5.0.0')).rejects.toThrow('NPM_RESOLVE_ERROR');
  });

  it('should get all versions', async () => {
    const resolver = createMockResolver();
    const versions = await resolver.getVersions('lodash');
    expect(versions).toContain('4.17.20');
    expect(versions).toContain('4.17.21');
  });

  it('should resolve dependency tree', async () => {
    const resolver = createMockResolver();
    const tree = await resolver.resolveDependencyTree('pkg-a');
    expect(tree.has('pkg-a')).toBe(true);
    expect(tree.has('pkg-b')).toBe(true);
    expect(tree.get('pkg-a')?.version).toBe('1.0.0');
    expect(tree.get('pkg-b')?.version).toBe('1.2.0');
  });

  it('should handle circular dependencies without infinite loop', async () => {
    const resolver = createMockResolver();
    const tree = await resolver.resolveDependencyTree('circ-a');
    expect(tree.has('circ-a')).toBe(true);
    expect(tree.has('circ-b')).toBe(true);
    // Should complete without hanging
  });

  it('should cache registry responses', async () => {
    let fetchCount = 0;
    const resolver = new NpmResolver({
      fetchFn: async (url: string) => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => mockRegistry['lodash'],
        };
      },
    });

    await resolver.resolve('lodash');
    await resolver.resolve('lodash');
    expect(fetchCount).toBe(1); // Only one fetch due to caching
  });
});

// ---- Lockfile Enforcement (Phase 17) ----

/** Helper: compute SHA-256 hash matching PackageManager's format */
async function sha256(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256-' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function createMockFetcher(packages: Record<string, string>) {
  return {
    cdnUrl: 'https://esm.sh',
    fetchFn: async (url: string) => {
      // Check for package name in URL
      for (const [name, code] of Object.entries(packages)) {
        if (url.includes(name)) {
          return {
            ok: true,
            status: 200,
            text: async () => code,
            headers: new Headers({ 'x-esm-id': `/${name}@1.0.0` }),
          } as unknown as Response;
        }
      }
      return { ok: false, status: 404, text: async () => 'Not found' } as unknown as Response;
    },
  };
}

function createMockResolver(packages: Record<string, { version: string; code: string }>) {
  return {
    registryUrl: 'https://registry.npmjs.org',
    fetchFn: async (url: string) => {
      const name = url.split('/').pop()!;
      const decodedName = decodeURIComponent(name);
      const pkg = packages[decodedName];
      if (!pkg) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: decodedName,
          'dist-tags': { latest: pkg.version },
          versions: {
            [pkg.version]: {
              name: decodedName,
              version: pkg.version,
              dependencies: {},
              dist: {
                tarball: `https://registry.npmjs.org/${decodedName}/-/${decodedName}-${pkg.version}.tgz`,
                integrity: 'sha256-registry-hash',
              },
            },
          },
        }),
      };
    },
  };
}

describe('PackageManager — Dev Mode (lockfile auto-generation)', () => {
  it('should install and auto-generate lockfile with SHA-256 integrity', async () => {
    const fs = await AtuaFS.create('pkg-dev-test-1');
    const code = 'module.exports = { hello: "world" };';

    const pm = new PackageManager({
      fs,
      mode: 'dev',
      resolver: createMockResolver({ 'test-pkg': { version: '1.0.0', code } }),
      fetcher: createMockFetcher({ 'test-pkg': code }),
    });

    const info = await pm.install('test-pkg');
    expect(info.name).toBe('test-pkg');
    expect(info.version).toBe('1.0.0');
    expect(info.cached).toBe(false);

    // Lockfile should have been auto-generated
    const lf = pm.getLockfile();
    const entry = lf.get('test-pkg');
    expect(entry).toBeDefined();
    expect(entry!.version).toBe('1.0.0');
    expect(entry!.integrity).toMatch(/^sha256-/);

    // Verify integrity matches the actual code
    const expectedHash = await sha256(code);
    expect(entry!.integrity).toBe(expectedHash);

    fs.destroy();
  });

  it('should serve subsequent requests from cache', async () => {
    const fs = await AtuaFS.create('pkg-dev-test-2');
    const code = 'module.exports = 42;';

    const pm = new PackageManager({
      fs,
      mode: 'dev',
      resolver: createMockResolver({ cached: { version: '2.0.0', code } }),
      fetcher: createMockFetcher({ cached: code }),
    });

    const first = await pm.install('cached');
    expect(first.cached).toBe(false);

    const second = await pm.install('cached');
    expect(second.cached).toBe(true);
    expect(second.version).toBe('2.0.0');

    fs.destroy();
  });

  it('dev mode is backward-compatible (default mode)', async () => {
    const fs = await AtuaFS.create('pkg-dev-test-3');
    const code = 'module.exports = {};';

    // No mode specified — defaults to dev
    const pm = new PackageManager({
      fs,
      resolver: createMockResolver({ compat: { version: '1.0.0', code } }),
      fetcher: createMockFetcher({ compat: code }),
    });

    expect(pm.getMode()).toBe('dev');
    const info = await pm.install('compat');
    expect(info.name).toBe('compat');

    fs.destroy();
  });
});

describe('PackageManager — Locked Mode', () => {
  it('should throw on missing lockfile', async () => {
    const fs = await AtuaFS.create('pkg-locked-test-1');

    expect(() => new PackageManager({
      fs,
      mode: 'locked',
    })).toThrow('LOCKFILE_MISSING');

    fs.destroy();
  });

  it('should resolve from lockfile in locked mode', async () => {
    const fs = await AtuaFS.create('pkg-locked-test-2');
    const code = 'module.exports = "locked";';
    const hash = await sha256(code);

    // Write a lockfile first
    const lf = new Lockfile();
    lf.set('locked-pkg', {
      version: '3.0.0',
      resolved: 'https://esm.sh/locked-pkg@3.0.0',
      integrity: hash,
      dependencies: {},
    });
    lf.write(fs, '/atua-lock.json');

    const pm = new PackageManager({
      fs,
      mode: 'locked',
      fetcher: createMockFetcher({ 'locked-pkg': code }),
    });

    const info = await pm.install('locked-pkg');
    expect(info.name).toBe('locked-pkg');
    expect(info.version).toBe('3.0.0');

    fs.destroy();
  });

  it('should reject unknown package in locked mode', async () => {
    const fs = await AtuaFS.create('pkg-locked-test-3');

    // Write a lockfile with one package
    const lf = new Lockfile();
    lf.set('known-pkg', {
      version: '1.0.0',
      resolved: '',
      integrity: '',
      dependencies: {},
    });
    lf.write(fs, '/atua-lock.json');

    const pm = new PackageManager({
      fs,
      mode: 'locked',
    });

    await expect(pm.install('unknown-pkg')).rejects.toThrow('LOCKFILE_VIOLATION');

    fs.destroy();
  });

  it('should throw on integrity hash mismatch', async () => {
    const fs = await AtuaFS.create('pkg-locked-test-4');
    const originalCode = 'module.exports = "original";';
    const tamperedCode = 'module.exports = "tampered";';
    const originalHash = await sha256(originalCode);

    // Lockfile has hash for original code
    const lf = new Lockfile();
    lf.set('tampered-pkg', {
      version: '1.0.0',
      resolved: 'https://esm.sh/tampered-pkg@1.0.0',
      integrity: originalHash,
      dependencies: {},
    });
    lf.write(fs, '/atua-lock.json');

    // But fetcher returns tampered code
    const pm = new PackageManager({
      fs,
      mode: 'locked',
      fetcher: createMockFetcher({ 'tampered-pkg': tamperedCode }),
    });

    await expect(pm.install('tampered-pkg')).rejects.toThrow('INTEGRITY_MISMATCH');

    fs.destroy();
  });
});

describe('Lockfile — Round-trip integrity', () => {
  it('lockfile survives generate → read → resolve → all hashes match', async () => {
    const fs = await AtuaFS.create('pkg-roundtrip-test');
    const codeA = 'module.exports = "a";';
    const codeB = 'module.exports = "b";';
    const hashA = await sha256(codeA);
    const hashB = await sha256(codeB);

    // Step 1: Generate lockfile in dev mode
    const devPm = new PackageManager({
      fs,
      mode: 'dev',
      resolver: createMockResolver({
        'pkg-a': { version: '1.0.0', code: codeA },
        'pkg-b': { version: '2.0.0', code: codeB },
      }),
      fetcher: createMockFetcher({ 'pkg-a': codeA, 'pkg-b': codeB }),
    });

    await devPm.install('pkg-a');
    await devPm.install('pkg-b');

    // Step 2: Read lockfile back
    const lockfileContent = fs.readFileSync('/atua-lock.json', 'utf-8') as string;
    const parsed = JSON.parse(lockfileContent);
    expect(parsed.packages['pkg-a'].integrity).toBe(hashA);
    expect(parsed.packages['pkg-b'].integrity).toBe(hashB);

    // Step 3: Use in locked mode
    const lockedPm = new PackageManager({
      fs,
      mode: 'locked',
      fetcher: createMockFetcher({ 'pkg-a': codeA, 'pkg-b': codeB }),
    });

    // Should succeed — packages are cached with correct integrity
    const infoA = await lockedPm.install('pkg-a');
    expect(infoA.cached).toBe(true);
    expect(infoA.version).toBe('1.0.0');

    const infoB = await lockedPm.install('pkg-b');
    expect(infoB.cached).toBe(true);
    expect(infoB.version).toBe('2.0.0');

    fs.destroy();
  });
});
