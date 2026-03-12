/**
 * Deno API Shims Tests — Browser-compatible Deno namespace
 */
import { describe, it, expect, vi } from 'vitest';
import { buildDenoNamespace, getDenoNamespaceSource } from './deno-api-shims.js';

function createMockOpsBridge() {
  const files = new Map<string, string>();
  const dirs = new Map<string, string[]>();

  files.set('/hello.txt', 'Hello World');
  dirs.set('/', ['hello.txt', 'src']);

  return {
    dispatch: vi.fn((op: string, ...args: any[]) => {
      switch (op) {
        case 'op_read_file_sync': {
          const path = args[0];
          if (files.has(path)) {
            return { ok: true, value: files.get(path) };
          }
          return { ok: false };
        }
        case 'op_write_file_sync': {
          files.set(args[0], args[1]);
          return { ok: true };
        }
        case 'op_stat_sync': {
          const path = args[0];
          if (files.has(path)) {
            return { ok: true, value: { isFile: true, isDirectory: false, size: files.get(path)!.length } };
          }
          if (dirs.has(path)) {
            return { ok: true, value: { isFile: false, isDirectory: true } };
          }
          return { ok: false };
        }
        case 'op_mkdir_sync':
          return { ok: true };
        case 'op_remove_sync':
          files.delete(args[0]);
          return { ok: true };
        case 'op_read_dir_sync': {
          const path = args[0];
          if (dirs.has(path)) {
            return { ok: true, value: dirs.get(path) };
          }
          return { ok: false };
        }
        default:
          return { ok: false };
      }
    }),
  };
}

describe('buildDenoNamespace', () => {
  function createDeno(overrides?: Partial<Parameters<typeof buildDenoNamespace>[0]>) {
    return buildDenoNamespace({
      opsBridge: createMockOpsBridge() as any,
      ...overrides,
    }) as any;
  }

  describe('version', () => {
    it('exposes Deno version info', () => {
      const deno = createDeno();
      expect(deno.version.deno).toBe('1.40.0');
      expect(deno.version.v8).toBeDefined();
      expect(deno.version.typescript).toBeDefined();
    });
  });

  describe('readTextFile / writeTextFile', () => {
    it('reads existing file', async () => {
      const deno = createDeno();
      const content = await deno.readTextFile('/hello.txt');
      expect(content).toBe('Hello World');
    });

    it('throws for missing file', async () => {
      const deno = createDeno();
      await expect(deno.readTextFile('/nonexistent')).rejects.toThrow('ENOENT');
    });

    it('writes and reads back', async () => {
      const ops = createMockOpsBridge();
      const deno = buildDenoNamespace({ opsBridge: ops as any }) as any;
      await deno.writeTextFile('/test.txt', 'test data');
      expect(ops.dispatch).toHaveBeenCalledWith('op_write_file_sync', '/test.txt', 'test data');
    });
  });

  describe('readFile / writeFile', () => {
    it('readFile returns Uint8Array', async () => {
      const deno = createDeno();
      const data = await deno.readFile('/hello.txt');
      expect(data).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(data)).toBe('Hello World');
    });
  });

  describe('stat / lstat', () => {
    it('stat returns file info', async () => {
      const deno = createDeno();
      const stat = await deno.stat('/hello.txt');
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.isSymlink).toBe(false);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('stat returns directory info', async () => {
      const deno = createDeno();
      const stat = await deno.stat('/');
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it('stat throws for missing path', async () => {
      const deno = createDeno();
      await expect(deno.stat('/nonexistent')).rejects.toThrow('ENOENT');
    });

    it('lstat works like stat', async () => {
      const deno = createDeno();
      const stat = await deno.lstat('/hello.txt');
      expect(stat.isFile).toBe(true);
    });
  });

  describe('mkdir / remove', () => {
    it('mkdir dispatches op', async () => {
      const ops = createMockOpsBridge();
      const deno = buildDenoNamespace({ opsBridge: ops as any }) as any;
      await deno.mkdir('/new-dir', { recursive: true });
      expect(ops.dispatch).toHaveBeenCalledWith('op_mkdir_sync', '/new-dir', '{"recursive":true}');
    });

    it('remove dispatches op', async () => {
      const ops = createMockOpsBridge();
      const deno = buildDenoNamespace({ opsBridge: ops as any }) as any;
      await deno.remove('/hello.txt');
      expect(ops.dispatch).toHaveBeenCalledWith('op_remove_sync', '/hello.txt');
    });
  });

  describe('readDir', () => {
    it('yields directory entries', async () => {
      const deno = createDeno();
      const entries: any[] = [];
      for await (const entry of deno.readDir('/')) {
        entries.push(entry);
      }
      expect(entries.length).toBe(2);
      expect(entries[0].name).toBe('hello.txt');
      expect(entries[1].name).toBe('src');
    });

    it('throws for missing directory', async () => {
      const deno = createDeno();
      const iter = deno.readDir('/nonexistent');
      await expect(iter.next()).rejects.toThrow('ENOENT');
    });
  });

  describe('cwd / chdir', () => {
    it('cwd returns initial directory', () => {
      const deno = createDeno({ cwd: '/home' });
      expect(deno.cwd()).toBe('/home');
    });

    it('defaults to /', () => {
      const deno = createDeno();
      expect(deno.cwd()).toBe('/');
    });

    it('chdir changes cwd', () => {
      const deno = createDeno();
      deno.chdir('/src');
      expect(deno.cwd()).toBe('/src');
    });
  });

  describe('env', () => {
    it('get/set/delete/has/toObject', () => {
      const deno = createDeno({ env: { NODE_ENV: 'test' } });
      expect(deno.env.get('NODE_ENV')).toBe('test');
      expect(deno.env.has('NODE_ENV')).toBe(true);

      deno.env.set('FOO', 'bar');
      expect(deno.env.get('FOO')).toBe('bar');

      deno.env.delete('FOO');
      expect(deno.env.has('FOO')).toBe(false);

      const obj = deno.env.toObject();
      expect(obj.NODE_ENV).toBe('test');
    });
  });

  describe('exit', () => {
    it('throws with exit code', () => {
      const deno = createDeno();
      expect(() => deno.exit(1)).toThrow('Deno.exit(1) called');
    });

    it('defaults to code 0', () => {
      const deno = createDeno();
      expect(() => deno.exit()).toThrow('Deno.exit(0) called');
    });
  });

  describe('args / mainModule / pid', () => {
    it('exposes args', () => {
      const deno = createDeno({ args: ['--help'] });
      expect(deno.args).toEqual(['--help']);
    });

    it('defaults to empty args', () => {
      const deno = createDeno();
      expect(deno.args).toEqual([]);
    });

    it('exposes mainModule', () => {
      const deno = createDeno();
      expect(deno.mainModule).toBe('file:///main.ts');
    });

    it('exposes pid', () => {
      const deno = createDeno();
      expect(deno.pid).toBe(1);
    });
  });

  describe('Command (subprocess stub)', () => {
    it('Command.output() returns empty result', async () => {
      const deno = createDeno();
      const cmd = new deno.Command('echo', { args: ['hello'] });
      const result = await cmd.output();
      expect(result.code).toBe(0);
      expect(result.stdout).toBeInstanceOf(Uint8Array);
    });

    it('Command.spawn() returns status', async () => {
      const deno = createDeno();
      const cmd = new deno.Command('echo');
      const child = cmd.spawn();
      const status = await child.status;
      expect(status.code).toBe(0);
    });
  });

  describe('serve (HTTP stub)', () => {
    it('returns server with addr and shutdown', async () => {
      const deno = createDeno();
      const server = deno.serve((_req: Request) => new Response('ok'));
      expect(server.addr.hostname).toBe('0.0.0.0');
      expect(server.addr.port).toBe(8000);
      expect(typeof server.shutdown).toBe('function');
    });
  });

  describe('permissions', () => {
    it('query always returns granted', async () => {
      const deno = createDeno();
      const perm = await deno.permissions.query({ name: 'read' });
      expect(perm.state).toBe('granted');
    });

    it('request always returns granted', async () => {
      const deno = createDeno();
      const perm = await deno.permissions.request({ name: 'write' });
      expect(perm.state).toBe('granted');
    });
  });

  describe('errors', () => {
    it('exposes error classes', () => {
      const deno = createDeno();
      const err = new deno.errors.NotFound('missing');
      expect(err.name).toBe('NotFound');
      expect(err.message).toBe('missing');
    });
  });

  describe('build', () => {
    it('reports wasm32 target', () => {
      const deno = createDeno();
      expect(deno.build.target).toBe('wasm32-unknown-unknown');
      expect(deno.build.arch).toBe('wasm32');
    });
  });

  describe('inspect', () => {
    it('stringifies values', () => {
      const deno = createDeno();
      expect(deno.inspect({ a: 1 })).toContain('"a"');
    });

    it('handles non-serializable values', () => {
      const deno = createDeno();
      const circular: any = {};
      circular.self = circular;
      const result = deno.inspect(circular);
      expect(typeof result).toBe('string');
    });
  });

  describe('memoryUsage', () => {
    it('returns memory metrics', () => {
      const deno = createDeno();
      const mem = deno.memoryUsage();
      expect(mem).toHaveProperty('rss');
      expect(mem).toHaveProperty('heapTotal');
    });
  });
});

describe('getDenoNamespaceSource', () => {
  it('returns valid JavaScript', () => {
    const source = getDenoNamespaceSource();
    expect(source).toContain('self.Deno');
    expect(source).toContain('version');
    expect(source).toContain('cwd');
    expect(source).toContain('env');
  });

  it('includes provided env vars', () => {
    const source = getDenoNamespaceSource({ NODE_ENV: 'test' });
    expect(source).toContain('NODE_ENV');
    expect(source).toContain('test');
  });

  it('is evaluable in a self context', () => {
    const source = getDenoNamespaceSource({ FOO: 'bar' });
    const self: any = {};
    const fn = new Function('self', source);
    fn(self);
    expect(self.Deno).toBeDefined();
    expect(self.Deno.version.deno).toBe('1.40.0');
    expect(self.Deno.cwd()).toBe('/');
    expect(self.Deno.env.get('FOO')).toBe('bar');
  });
});
