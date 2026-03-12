/**
 * ShellHistory — Unit tests
 * Validates command history navigation, search, and persistence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ShellHistory } from './ShellHistory.js';

let history: ShellHistory;

beforeEach(() => {
  history = new ShellHistory({ maxEntries: 10 });
});

describe('ShellHistory — Push', () => {
  it('adds entries', () => {
    history.push('ls');
    history.push('cd /home');
    expect(history.length).toBe(2);
    expect(history.getEntries()).toEqual(['ls', 'cd /home']);
  });

  it('ignores empty strings', () => {
    history.push('');
    history.push('  ');
    expect(history.length).toBe(0);
  });

  it('ignores consecutive duplicates', () => {
    history.push('ls');
    history.push('ls');
    expect(history.length).toBe(1);
  });

  it('allows non-consecutive duplicates', () => {
    history.push('ls');
    history.push('cd');
    history.push('ls');
    expect(history.length).toBe(3);
  });

  it('trims entries', () => {
    history.push('  ls  ');
    expect(history.getEntries()).toEqual(['ls']);
  });

  it('enforces max entries', () => {
    for (let i = 0; i < 15; i++) {
      history.push(`cmd${i}`);
    }
    expect(history.length).toBe(10);
    expect(history.getEntries()[0]).toBe('cmd5'); // oldest kept
    expect(history.getEntries()[9]).toBe('cmd14'); // newest
  });
});

describe('ShellHistory — Navigation', () => {
  it('up returns previous entry', () => {
    history.push('a');
    history.push('b');
    history.push('c');
    expect(history.up()).toBe('c');
    expect(history.up()).toBe('b');
    expect(history.up()).toBe('a');
  });

  it('up at beginning stays at first', () => {
    history.push('a');
    history.push('b');
    expect(history.up()).toBe('b');
    expect(history.up()).toBe('a');
    expect(history.up()).toBe('a'); // stays at beginning
  });

  it('down returns next entry', () => {
    history.push('a');
    history.push('b');
    history.push('c');
    history.up(); // c
    history.up(); // b
    history.up(); // a
    expect(history.down()).toBe('b');
    expect(history.down()).toBe('c');
  });

  it('down past end returns null', () => {
    history.push('a');
    history.up(); // a
    expect(history.down()).toBeNull();
  });

  it('up on empty returns null', () => {
    expect(history.up()).toBeNull();
  });

  it('down without up returns null', () => {
    history.push('a');
    expect(history.down()).toBeNull();
  });

  it('resetCursor resets navigation', () => {
    history.push('a');
    history.push('b');
    history.up(); // b
    history.resetCursor();
    expect(history.up()).toBe('b'); // starts from end again
  });
});

describe('ShellHistory — Search', () => {
  it('finds matching entries', () => {
    history.push('ls -la');
    history.push('cd /home');
    history.push('ls -R');
    history.push('cat file.txt');
    expect(history.search('ls')).toEqual(['ls -la', 'ls -R']);
  });

  it('returns empty for no matches', () => {
    history.push('ls');
    expect(history.search('xyz')).toEqual([]);
  });
});

describe('ShellHistory — Clear', () => {
  it('clear removes all entries', () => {
    history.push('a');
    history.push('b');
    history.clear();
    expect(history.length).toBe(0);
    expect(history.getEntries()).toEqual([]);
  });
});

describe('ShellHistory — Persistence', () => {
  it('save and load round-trip', async () => {
    const store: Record<string, string> = {};
    const mockFs = {
      writeFileSync: (path: string, data: string) => { store[path] = data; },
      readFileSync: (path: string) => { if (store[path]) return store[path]; throw new Error('Not found'); },
    };

    const h1 = new ShellHistory({ persistKey: '/.shell_history', fs: mockFs });
    h1.push('cmd1');
    h1.push('cmd2');
    await h1.save();

    const h2 = new ShellHistory({ persistKey: '/.shell_history', fs: mockFs });
    await h2.load();
    expect(h2.getEntries()).toEqual(['cmd1', 'cmd2']);
  });

  it('load with no file does not throw', async () => {
    const mockFs = {
      readFileSync: () => { throw new Error('Not found'); },
    };
    const h = new ShellHistory({ persistKey: '/.history', fs: mockFs });
    await h.load(); // should not throw
    expect(h.length).toBe(0);
  });

  it('save without fs is a no-op', async () => {
    history.push('x');
    await history.save(); // should not throw
  });
});
