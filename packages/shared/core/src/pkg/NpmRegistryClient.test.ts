/**
 * NpmRegistryClient Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { NpmRegistryClient } from './NpmRegistryClient.js';
import { CatalystFS } from '../fs/CatalystFS.js';

function mockFetch(data: unknown) {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => data,
  }));
}

const MOCK_METADATA = {
  name: 'lodash',
  'dist-tags': { latest: '4.17.21' },
  versions: {
    '4.17.20': {
      name: 'lodash',
      version: '4.17.20',
      main: 'lodash.js',
      dependencies: {},
      dist: { tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz', shasum: 'abc' },
    },
    '4.17.21': {
      name: 'lodash',
      version: '4.17.21',
      main: 'lodash.js',
      dependencies: {},
      dist: { tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz', shasum: 'def' },
    },
  },
};

describe('NpmRegistryClient', () => {
  it('creates with default config', () => {
    const client = new NpmRegistryClient();
    expect(client).toBeDefined();
  });

  it('fetches package metadata', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const metadata = await client.getPackageMetadata('lodash');
      expect(metadata.name).toBe('lodash');
      expect(metadata['dist-tags'].latest).toBe('4.17.21');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('resolves latest version', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const version = await client.resolveVersion('lodash', 'latest');
      expect(version).toBe('4.17.21');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('resolves exact version', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const version = await client.resolveVersion('lodash', '4.17.20');
      expect(version).toBe('4.17.20');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('resolves caret range', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const version = await client.resolveVersion('lodash', '^4.17.0');
      expect(version).toBe('4.17.21');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws for unknown package', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    try {
      await expect(client.getPackageMetadata('nonexistent-pkg-xyz'))
        .rejects.toThrow('not found');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('installs package to CatalystFS', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const fs = await CatalystFS.create('npm-install-test');
      const result = await client.install('lodash', 'latest', fs);

      expect(result.name).toBe('lodash');
      expect(result.version).toBe('4.17.21');
      expect(fs.existsSync('/node_modules/lodash/package.json')).toBe(true);

      const pkgJson = JSON.parse(fs.readFileSync('/node_modules/lodash/package.json', 'utf-8') as string);
      expect(pkgJson.name).toBe('lodash');
      expect(pkgJson.version).toBe('4.17.21');

      fs.destroy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lists available versions', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch(MOCK_METADATA);

    try {
      const versions = await client.listVersions('lodash');
      expect(versions).toContain('4.17.20');
      expect(versions).toContain('4.17.21');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caches metadata between calls', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: true, json: async () => MOCK_METADATA };
    });

    try {
      await client.getPackageMetadata('lodash');
      await client.getPackageMetadata('lodash');
      expect(callCount).toBe(1); // Only one fetch call
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clears cache', async () => {
    const client = new NpmRegistryClient();
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: true, json: async () => MOCK_METADATA };
    });

    try {
      await client.getPackageMetadata('lodash');
      client.clearCache();
      await client.getPackageMetadata('lodash');
      expect(callCount).toBe(2); // Fetched twice after cache clear
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
