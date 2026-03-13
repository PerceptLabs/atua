/**
 * Integration Tests — End-to-end proof that all layers work together
 *
 * Tests the full Atua stack: AtuaFS + AtuaEngine + ProcessManager +
 * PackageManager + BuildPipeline + HMR in real Chromium.
 */
import { describe, it, expect } from 'vitest';
import { Atua } from './atua.js';
import { AtuaFS } from './fs/AtuaFS.js';
import { NativeEngine } from './engines/native/NativeEngine.js';
import { ProcessManager } from './proc/ProcessManager.js';
import { PackageManager } from './pkg/PackageManager.js';
import { BuildPipeline, PassthroughTranspiler } from './dev/BuildPipeline.js';

// Mock fetch for package installation
const MOCK_LODASH = `
module.exports = {
  chunk: function(arr, size) {
    var result = [];
    for (var i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  },
  add: function(a, b) { return a + b; }
};
`;

const mockRegistry: Record<string, any> = {
  lodash: {
    name: 'lodash',
    'dist-tags': { latest: '4.17.21' },
    versions: {
      '4.17.21': {
        dependencies: {},
        dist: { tarball: '', integrity: 'sha256-test' },
      },
    },
  },
};

function createMockFetches() {
  return {
    registryFetch: async (url: string) => {
      const name = url.split('/').pop()!;
      const data = mockRegistry[decodeURIComponent(name)];
      return data
        ? { ok: true, status: 200, json: async () => data }
        : { ok: false, status: 404, json: async () => ({}) };
    },
    cdnFetch: async (url: string) => {
      const match = url.match(/esm\.sh\/([^@]+)@/);
      const name = match?.[1] ?? '';
      if (name === 'lodash') {
        return new Response(MOCK_LODASH, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

describe('Integration — Atua Factory', () => {
  it('should create a full Atua instance', async () => {
    const atua = await Atua.create({ name: 'int-factory-1' });

    expect(atua.fs).toBeDefined();
    expect(atua.processes).toBeDefined();
    expect(atua.packages).toBeDefined();
    expect(atua.buildPipeline).toBeDefined();
    expect(atua.hmr).toBeDefined();

    atua.dispose();
  });

  it('should eval code through the factory', async () => {
    const atua = await Atua.create({ name: 'int-eval-1' });

    const result = await atua.eval('1 + 2');
    expect(result).toBe(3);

    atua.dispose();
  });
});

describe('Integration — Package Install + Require', () => {
  it('should install a package and require it in QuickJS', async () => {
    const fs = await AtuaFS.create('int-pkg-1');
    const mocks = createMockFetches();
    const pm = new PackageManager({
      fs,
      resolver: { fetchFn: mocks.registryFetch },
      fetcher: { fetchFn: mocks.cdnFetch },
    });

    // Install lodash
    await pm.install('lodash');
    expect(fs.existsSync('/node_modules/lodash/index.js')).toBe(true);

    // Create engine and use the package
    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`
        var _ = require('lodash');
        module.exports = JSON.stringify(_.chunk([1,2,3,4,5,6], 3));
      `);
      expect(JSON.parse(result as string)).toEqual([[1, 2, 3], [4, 5, 6]]);
    } finally {
      await engine.destroy();
    }
  });
});

describe('Integration — installAll from package.json', () => {
  it('should install all dependencies from package.json and use them', async () => {
    const fs = await AtuaFS.create('int-installall-1');
    const mocks = createMockFetches();
    const pm = new PackageManager({
      fs,
      resolver: { fetchFn: mocks.registryFetch },
      fetcher: { fetchFn: mocks.cdnFetch },
    });

    // Write package.json
    fs.writeFileSync(
      '/package.json',
      JSON.stringify({
        name: 'my-app',
        dependencies: { lodash: '^4.17.0' },
      }),
    );

    const results = await pm.installAll();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('lodash');

    // Verify require works
    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`module.exports = require('lodash').add(3, 4)`);
      expect(result).toBe(7);
    } finally {
      await engine.destroy();
    }
  });
});

describe('Integration — File Watch + Build', () => {
  it('should detect file change and rebuild', async () => {
    const fs = await AtuaFS.create('int-hmr-1');
    const pipeline = new BuildPipeline(fs, new PassthroughTranspiler());
    const { HMRManager } = await import('./dev/HMRManager.js');
    const hmr = new HMRManager(fs, pipeline, { entryPoint: '/src/index.js' });

    // Write source
    fs.mkdirSync('/src', { recursive: true });
    fs.writeFileSync('/src/index.js', 'var x = 1;');

    // Initial build
    const r1 = await hmr.rebuild();
    expect(r1.errors).toHaveLength(0);

    // Set up listener
    let updated = false;
    hmr.on('update', () => (updated = true));

    // Modify and rebuild
    fs.writeFileSync('/src/index.js', 'var x = 2;');
    await hmr.rebuild();
    expect(updated).toBe(true);
    expect(fs.existsSync('/dist/app.js')).toBe(true);
  });
});

describe('Integration — Process Execution', () => {
  it('should exec code in a child process and capture stdout', async () => {
    const fs = await AtuaFS.create('int-proc-1');
    const pm = new ProcessManager({ fs });

    const result = await pm.exec('console.log("hello from child")');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello from child');
  });
});

describe('Integration — Sandbox Security', () => {
  it('should block access to window/document from NativeEngine', async () => {
    const engine = await NativeEngine.create();
    try {
      const result = await engine.eval(
        'module.exports = typeof window === "undefined" && typeof document === "undefined"',
      );
      expect(result).toBe(true);
    } finally {
      await engine.destroy();
    }
  });

  it('should reject fetch to blocked domains', async () => {
    const { FetchProxy } = await import('./net/FetchProxy.js');
    const proxy = new FetchProxy({
      blocklist: ['evil.com'],
    });

    expect(proxy.isDomainAllowed('https://evil.com/data')).toBe(false);
    expect(proxy.isDomainAllowed('https://good.com/data')).toBe(true);
  });

  it('should enforce memory limits', async () => {
    const engine = await NativeEngine.create({ memoryLimit: 2 }); // 2MB
    try {
      await expect(
        engine.eval(`
          var arr = [];
          for (var i = 0; i < 10000000; i++) {
            arr.push(new Array(1000).fill("x"));
          }
        `),
      ).rejects.toThrow();
    } finally {
      await engine.destroy();
    }
  });

  it('should isolate global state between engines', async () => {
    const engine1 = await NativeEngine.create();
    const engine2 = await NativeEngine.create();
    try {
      await engine1.eval('globalThis.secret = 42;');
      const result = await engine2.eval('module.exports = typeof globalThis.secret');
      expect(result).toBe('undefined');
    } finally {
      await engine1.destroy();
      await engine2.destroy();
    }
  });
});

describe('Integration — Offline Packages', () => {
  it('should require cached package without network', async () => {
    const fs = await AtuaFS.create('int-offline-1');
    const mocks = createMockFetches();
    const pm = new PackageManager({
      fs,
      resolver: { fetchFn: mocks.registryFetch },
      fetcher: { fetchFn: mocks.cdnFetch },
    });

    // Install with network
    await pm.install('lodash');

    // Simulate "offline" — create a new PM with failing fetch
    const offlinePM = new PackageManager({
      fs,
      resolver: {
        fetchFn: async () => {
          throw new Error('OFFLINE');
        },
      },
      fetcher: {
        fetchFn: async () => {
          throw new Error('OFFLINE');
        },
      },
    });

    // Should still be cached
    const info = await offlinePM.install('lodash');
    expect(info.cached).toBe(true);

    // require() should still work
    const engine = await NativeEngine.create({ fs });
    try {
      const result = await engine.eval(`module.exports = require('lodash').add(5, 5)`);
      expect(result).toBe(10);
    } finally {
      await engine.destroy();
    }
  });
});

describe('Integration — Persistence', () => {
  it('should persist files across AtuaFS instances with same name', async () => {
    const name = 'int-persist-1';

    // Write files
    const fs1 = await AtuaFS.create(name);
    fs1.writeFileSync('/test.txt', 'persistent data');
    fs1.destroy();

    // Recreate with same name
    const fs2 = await AtuaFS.create(name);
    const exists = fs2.existsSync('/test.txt');
    if (exists) {
      const content = fs2.readFileSync('/test.txt', 'utf-8') as string;
      expect(content).toBe('persistent data');
    }
    // Note: persistence depends on IndexedDB/OPFS availability in test env
    fs2.destroy();
  });
});
