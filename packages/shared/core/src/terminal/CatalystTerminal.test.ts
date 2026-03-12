/**
 * CatalystTerminal — Unit tests
 * Validates terminal wrapper in headless (Node) mode.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalystTerminal } from './CatalystTerminal.js';

let terminal: CatalystTerminal;

beforeEach(async () => {
  terminal = new CatalystTerminal({ cols: 80, rows: 24 });
  await terminal.mount();
});

afterEach(() => {
  terminal.destroy();
});

describe('CatalystTerminal — Construction', () => {
  it('creates with default dimensions', () => {
    const t = new CatalystTerminal();
    expect(t.cols).toBe(80);
    expect(t.rows).toBe(24);
    expect(t.mounted).toBe(false);
    expect(t.destroyed).toBe(false);
    t.destroy();
  });

  it('creates with custom dimensions', () => {
    const t = new CatalystTerminal({ cols: 120, rows: 40 });
    expect(t.cols).toBe(120);
    expect(t.rows).toBe(40);
    t.destroy();
  });
});

describe('CatalystTerminal — Mount', () => {
  it('mounts in headless mode', () => {
    expect(terminal.mounted).toBe(true);
  });

  it('mount is idempotent', async () => {
    await terminal.mount(); // second mount
    expect(terminal.mounted).toBe(true);
  });

  it('mount after destroy throws', async () => {
    terminal.destroy();
    await expect(terminal.mount()).rejects.toThrow('destroyed');
  });

  it('emits mount event', async () => {
    const events: string[] = [];
    const t = new CatalystTerminal();
    t.on('mount', () => events.push('mounted'));
    await t.mount();
    expect(events).toEqual(['mounted']);
    t.destroy();
  });
});

describe('CatalystTerminal — Write/Output', () => {
  it('write buffers output', () => {
    terminal.write('hello');
    expect(terminal.getOutput()).toBe('hello');
  });

  it('writeln adds CRLF', () => {
    terminal.writeln('hello');
    expect(terminal.getOutput()).toBe('hello\r\n');
  });

  it('multiple writes concatenate', () => {
    terminal.write('a');
    terminal.write('b');
    terminal.write('c');
    expect(terminal.getOutput()).toBe('abc');
  });

  it('emits output event on write', () => {
    const chunks: string[] = [];
    terminal.on('output', (data: unknown) => chunks.push(data as string));
    terminal.write('test');
    expect(chunks).toEqual(['test']);
  });

  it('write after destroy is silent', () => {
    terminal.destroy();
    terminal.write('nope'); // should not throw
  });
});

describe('CatalystTerminal — Input', () => {
  it('simulateInput buffers input', () => {
    terminal.simulateInput('hello');
    expect(terminal.getInput()).toBe('hello');
  });

  it('emits input event on simulateInput', () => {
    const inputs: string[] = [];
    terminal.on('input', (data: unknown) => inputs.push(data as string));
    terminal.simulateInput('x');
    expect(inputs).toEqual(['x']);
  });
});

describe('CatalystTerminal — Clear', () => {
  it('clear empties output buffer', () => {
    terminal.write('data');
    terminal.clear();
    expect(terminal.getOutput()).toBe('');
  });

  it('emits clear event', () => {
    const events: string[] = [];
    terminal.on('clear', () => events.push('cleared'));
    terminal.clear();
    expect(events).toEqual(['cleared']);
  });
});

describe('CatalystTerminal — Resize', () => {
  it('resize updates dimensions', () => {
    terminal.resize(120, 40);
    expect(terminal.cols).toBe(120);
    expect(terminal.rows).toBe(40);
  });

  it('emits resize event', () => {
    const sizes: unknown[] = [];
    terminal.on('resize', (size: unknown) => sizes.push(size));
    terminal.resize(100, 30);
    expect(sizes).toEqual([{ cols: 100, rows: 30 }]);
  });
});

describe('CatalystTerminal — Destroy', () => {
  it('destroy marks as destroyed', () => {
    terminal.destroy();
    expect(terminal.destroyed).toBe(true);
    expect(terminal.mounted).toBe(false);
  });

  it('double destroy is safe', () => {
    terminal.destroy();
    terminal.destroy(); // should not throw
    expect(terminal.destroyed).toBe(true);
  });
});

describe('CatalystTerminal — Event System', () => {
  it('on/off subscribes and unsubscribes', () => {
    const events: string[] = [];
    const handler = () => events.push('x');
    terminal.on('output', handler);
    terminal.write('a');
    terminal.off('output', handler);
    terminal.write('b');
    expect(events).toEqual(['x']); // only first write fires handler
  });
});
