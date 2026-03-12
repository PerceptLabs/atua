/**
 * OpsBridge — Unit tests
 * Validates ops bridge dispatches correctly to browser API backends.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpsBridge } from './ops-bridge.js';
import { CatalystFS } from '../../../shared/core/src/fs/CatalystFS.js';

let fs: CatalystFS;
let bridge: OpsBridge;

beforeEach(async () => {
  fs = await CatalystFS.create(`ops-bridge-${Date.now()}`);
  bridge = new OpsBridge({ fs, env: { NODE_ENV: 'test', HOME: '/home/user' }, cwd: '/project' });
});

afterEach(() => {
  bridge.destroy();
  fs.destroy();
});

describe('OpsBridge — Filesystem Ops', () => {
  it('write + read round-trip', () => {
    const w = bridge.dispatch('op_write_file_sync', '/test.txt', 'hello');
    expect(w.ok).toBe(true);
    const r = bridge.dispatch('op_read_file_sync', '/test.txt');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('hello');
  });

  it('read missing file returns error', () => {
    const r = bridge.dispatch('op_read_file_sync', '/nope.txt');
    expect(r.ok).toBe(false);
  });

  it('stat returns file metadata', () => {
    bridge.dispatch('op_write_file_sync', '/s.txt', 'x');
    const r = bridge.dispatch('op_stat_sync', '/s.txt');
    expect(r.ok).toBe(true);
    expect((r.value as any).isFile).toBe(true);
  });

  it('mkdir + readdir', () => {
    bridge.dispatch('op_mkdir_sync', '/dir', { recursive: true });
    bridge.dispatch('op_write_file_sync', '/dir/a.txt', 'a');
    const r = bridge.dispatch('op_readdir_sync', '/dir');
    expect(r.ok).toBe(true);
    expect(r.value).toContain('a.txt');
  });

  it('exists returns true/false', () => {
    bridge.dispatch('op_write_file_sync', '/e.txt', 'x');
    expect(bridge.dispatch('op_exists_sync', '/e.txt').value).toBe(true);
    expect(bridge.dispatch('op_exists_sync', '/no.txt').value).toBe(false);
  });

  it('remove deletes file', () => {
    bridge.dispatch('op_write_file_sync', '/rm.txt', 'x');
    bridge.dispatch('op_remove_sync', '/rm.txt');
    expect(bridge.dispatch('op_exists_sync', '/rm.txt').value).toBe(false);
  });

  it('rename moves file', () => {
    bridge.dispatch('op_write_file_sync', '/old.txt', 'data');
    bridge.dispatch('op_rename_sync', '/old.txt', '/new.txt');
    expect(bridge.dispatch('op_exists_sync', '/old.txt').value).toBe(false);
    expect(bridge.dispatch('op_read_file_sync', '/new.txt').value).toBe('data');
  });

  it('async write + read', async () => {
    await bridge.dispatch('op_write_file_async', '/async.txt', 'async');
    const r = await bridge.dispatch('op_read_file_async', '/async.txt');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('async');
  });
});

describe('OpsBridge — Environment Ops', () => {
  it('get env var', () => {
    expect(bridge.dispatch('op_env_get', 'NODE_ENV').value).toBe('test');
  });

  it('get missing var returns null', () => {
    expect(bridge.dispatch('op_env_get', 'NOPE').value).toBeNull();
  });

  it('set + get round-trip', () => {
    bridge.dispatch('op_env_set', 'MY_VAR', 'val');
    expect(bridge.dispatch('op_env_get', 'MY_VAR').value).toBe('val');
  });

  it('delete removes var', () => {
    bridge.dispatch('op_env_set', 'TMP', 'x');
    bridge.dispatch('op_env_delete', 'TMP');
    expect(bridge.dispatch('op_env_get', 'TMP').value).toBeNull();
  });

  it('to_object returns all', () => {
    const env = bridge.dispatch('op_env_to_object').value as Record<string, string>;
    expect(env.NODE_ENV).toBe('test');
    expect(env.HOME).toBe('/home/user');
  });

  it('cwd + chdir', () => {
    expect(bridge.dispatch('op_cwd').value).toBe('/project');
    bridge.dispatch('op_chdir', '/new');
    expect(bridge.dispatch('op_cwd').value).toBe('/new');
  });

  it('pid returns 1', () => {
    expect(bridge.dispatch('op_pid').value).toBe(1);
  });
});

describe('OpsBridge — Timer Ops', () => {
  it('start + cancel timer', () => {
    const s = bridge.dispatch('op_timer_start', 1000, false);
    expect(s.ok).toBe(true);
    expect(bridge.dispatch('op_timer_cancel', s.value).ok).toBe(true);
  });

  it('op_now returns timestamp', () => {
    const r = bridge.dispatch('op_now');
    expect(typeof r.value).toBe('number');
    expect(r.value as number).toBeGreaterThan(0);
  });
});

describe('OpsBridge — Unknown Ops', () => {
  it('returns error for unknown op', () => {
    const r = bridge.dispatch('op_nonexistent');
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
  it('fs ops return error when no fs', () => {
    const noFs = new OpsBridge({});
    expect(noFs.dispatch('op_read_file_sync', '/x').ok).toBe(false);
    noFs.destroy();
  });
});
