/**
 * OpsBridge — Unit tests
 * Validates ops bridge dispatches correctly to browser API backends.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpsBridge } from './ops-bridge.js';
import { AtuaFS } from '../../../shared/core/src/fs/AtuaFS.js';

let fs: AtuaFS;
let bridge: OpsBridge;

beforeEach(async () => {
  fs = await AtuaFS.create(`ops-bridge-${Date.now()}`);
  bridge = new OpsBridge({ fs, env: { NODE_ENV: 'test', HOME: '/home/user' }, cwd: '/project' });
});

afterEach(() => {
  bridge.destroy();
  fs.destroy();
});

describe('OpsBridge — Filesystem Ops', () => {
  it('write + read round-trip', async () => {
    const w = await bridge.dispatch('op_write_file_sync', '/test.txt', 'hello');
    expect(w.ok).toBe(true);
    const r = await bridge.dispatch('op_read_file_sync', '/test.txt');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('hello');
  });

  it('read missing file returns error', async () => {
    const r = await bridge.dispatch('op_read_file_sync', '/nope.txt');
    expect(r.ok).toBe(false);
  });

  it('stat returns file metadata', async () => {
    await bridge.dispatch('op_write_file_sync', '/s.txt', 'x');
    const r = await bridge.dispatch('op_stat_sync', '/s.txt');
    expect(r.ok).toBe(true);
    expect((r.value as any).isFile).toBe(true);
  });

  it('mkdir + readdir', async () => {
    await bridge.dispatch('op_mkdir_sync', '/dir', { recursive: true });
    await bridge.dispatch('op_write_file_sync', '/dir/a.txt', 'a');
    const r = await bridge.dispatch('op_readdir_sync', '/dir');
    expect(r.ok).toBe(true);
    expect(r.value).toContain('a.txt');
  });

  it('exists returns true/false', async () => {
    await bridge.dispatch('op_write_file_sync', '/e.txt', 'x');
    expect((await bridge.dispatch('op_exists_sync', '/e.txt')).value).toBe(true);
    expect((await bridge.dispatch('op_exists_sync', '/no.txt')).value).toBe(false);
  });

  it('remove deletes file', async () => {
    await bridge.dispatch('op_write_file_sync', '/rm.txt', 'x');
    await bridge.dispatch('op_remove_sync', '/rm.txt');
    expect((await bridge.dispatch('op_exists_sync', '/rm.txt')).value).toBe(false);
  });

  it('rename moves file', async () => {
    await bridge.dispatch('op_write_file_sync', '/old.txt', 'data');
    await bridge.dispatch('op_rename_sync', '/old.txt', '/new.txt');
    expect((await bridge.dispatch('op_exists_sync', '/old.txt')).value).toBe(false);
    expect((await bridge.dispatch('op_read_file_sync', '/new.txt')).value).toBe('data');
  });

  it('async write + read', async () => {
    await bridge.dispatch('op_write_file_async', '/async.txt', 'async');
    const r = await bridge.dispatch('op_read_file_async', '/async.txt');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('async');
  });
});

describe('OpsBridge — Environment Ops', () => {
  it('get env var', async () => {
    expect((await bridge.dispatch('op_env_get', 'NODE_ENV')).value).toBe('test');
  });

  it('get missing var returns null', async () => {
    expect((await bridge.dispatch('op_env_get', 'NOPE')).value).toBeNull();
  });

  it('set + get round-trip', async () => {
    await bridge.dispatch('op_env_set', 'MY_VAR', 'val');
    expect((await bridge.dispatch('op_env_get', 'MY_VAR')).value).toBe('val');
  });

  it('delete removes var', async () => {
    await bridge.dispatch('op_env_set', 'TMP', 'x');
    await bridge.dispatch('op_env_delete', 'TMP');
    expect((await bridge.dispatch('op_env_get', 'TMP')).value).toBeNull();
  });

  it('to_object returns all', async () => {
    const env = (await bridge.dispatch('op_env_to_object')).value as Record<string, string>;
    expect(env.NODE_ENV).toBe('test');
    expect(env.HOME).toBe('/home/user');
  });

  it('cwd + chdir', async () => {
    expect((await bridge.dispatch('op_cwd')).value).toBe('/project');
    await bridge.dispatch('op_chdir', '/new');
    expect((await bridge.dispatch('op_cwd')).value).toBe('/new');
  });

  it('pid returns 1', async () => {
    expect((await bridge.dispatch('op_pid')).value).toBe(1);
  });
});

describe('OpsBridge — Timer Ops', () => {
  it('start + cancel timer', async () => {
    const s = await bridge.dispatch('op_timer_start', 1000, false);
    expect(s.ok).toBe(true);
    expect((await bridge.dispatch('op_timer_cancel', s.value)).ok).toBe(true);
  });

  it('op_now returns timestamp', async () => {
    const r = await bridge.dispatch('op_now');
    expect(typeof r.value).toBe('number');
    expect(r.value as number).toBeGreaterThan(0);
  });
});

describe('OpsBridge — Unknown Ops', () => {
  it('returns error for unknown op', async () => {
    const r = await bridge.dispatch('op_nonexistent');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown op');
  });
});

describe('OpsBridge — Ops Listing', () => {
  it('lists all registered ops', () => {
    const ops = bridge.registeredOps();
    expect(ops).toContain('op_read_file_sync');
    expect(ops).toContain('op_write_file_sync');
    expect(ops).toContain('op_env_get');
    expect(ops).toContain('op_cwd');
    expect(ops).toContain('op_now');
    expect(ops.length).toBeGreaterThan(15);
  });
});

describe('OpsBridge — No Filesystem', () => {
  it('fs ops return error when no fs', async () => {
    const noFs = new OpsBridge({});
    expect((await noFs.dispatch('op_read_file_sync', '/x')).ok).toBe(false);
    noFs.destroy();
  });
});
