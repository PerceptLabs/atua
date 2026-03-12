/**
 * PTYAdapter — Unit tests
 * Validates PTY bridge between terminal and process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalystTerminal } from './CatalystTerminal.js';
import { PTYAdapter } from './PTYAdapter.js';
import { CatalystProcess } from '../proc/CatalystProcess.js';

let terminal: CatalystTerminal;
let adapter: PTYAdapter;
let process: CatalystProcess;

beforeEach(async () => {
  terminal = new CatalystTerminal({ cols: 80, rows: 24 });
  await terminal.mount();
  adapter = new PTYAdapter(terminal);
  process = new CatalystProcess(1);
});

afterEach(() => {
  adapter.destroy();
  terminal.destroy();
});

describe('PTYAdapter — Construction', () => {
  it('starts with no attached process', () => {
    expect(adapter.attachedProcess).toBeNull();
    expect(adapter.destroyed).toBe(false);
    expect(adapter.stdinClosed).toBe(false);
  });
});

describe('PTYAdapter — Attach/Detach', () => {
  it('attach connects process', () => {
    // Set running state so write doesn't throw
    process._setState('running');
    adapter.attach(process);
    expect(adapter.attachedProcess).toBe(process);
  });

  it('detach disconnects process', () => {
    process._setState('running');
    adapter.attach(process);
    adapter.detach();
    expect(adapter.attachedProcess).toBeNull();
  });

  it('attach replaces previous process', () => {
    const p2 = new CatalystProcess(2);
    process._setState('running');
    p2._setState('running');
    adapter.attach(process);
    adapter.attach(p2);
    expect(adapter.attachedProcess).toBe(p2);
  });

  it('attach after destroy throws', () => {
    adapter.destroy();
    expect(() => adapter.attach(process)).toThrow('destroyed');
  });
});

describe('PTYAdapter — Process Output → Terminal', () => {
  it('process stdout appears in terminal', () => {
    process._setState('running');
    adapter.attach(process);
    process._pushStdout('hello world\n');
    // Output should be written to terminal with CRLF translation
    expect(terminal.getOutput()).toContain('hello world');
  });

  it('process stderr appears in terminal', () => {
    process._setState('running');
    adapter.attach(process);
    process._pushStderr('error msg\n');
    expect(terminal.getOutput()).toContain('error msg');
  });

  it('CRLF translation converts newlines', () => {
    process._setState('running');
    adapter.attach(process);
    process._pushStdout('line1\nline2\n');
    const output = terminal.getOutput();
    expect(output).toContain('\r\n');
  });

  it('CRLF can be disabled', async () => {
    const noCrlf = new PTYAdapter(terminal, { crlf: false });
    process._setState('running');
    noCrlf.attach(process);
    process._pushStdout('line1\nline2\n');
    const output = terminal.getOutput();
    expect(output).toBe('line1\nline2\n');
    noCrlf.destroy();
  });
});

describe('PTYAdapter — Terminal Input → Process', () => {
  it('Enter sends line to process stdin', () => {
    const stdinData: string[] = [];
    process._setState('running');
    process.on('stdin', (data) => stdinData.push(data as string));
    adapter.attach(process);
    // Type "hello" then Enter (0x0d)
    terminal.simulateInput('h');
    terminal.simulateInput('e');
    terminal.simulateInput('l');
    terminal.simulateInput('l');
    terminal.simulateInput('o');
    terminal.simulateInput('\r');
    expect(stdinData).toEqual(['hello\n']);
  });

  it('backspace removes last character', () => {
    const stdinData: string[] = [];
    process._setState('running');
    process.on('stdin', (data) => stdinData.push(data as string));
    adapter.attach(process);
    terminal.simulateInput('a');
    terminal.simulateInput('b');
    terminal.simulateInput('\x7f'); // backspace
    terminal.simulateInput('c');
    terminal.simulateInput('\r');
    expect(stdinData).toEqual(['ac\n']);
  });

  it('echo writes input back to terminal', () => {
    process._setState('running');
    adapter.attach(process);
    terminal.simulateInput('x');
    const output = terminal.getOutput();
    expect(output).toContain('x');
  });

  it('echo can be disabled', async () => {
    const noEcho = new PTYAdapter(terminal, { echo: false });
    process._setState('running');
    noEcho.attach(process);
    terminal.simulateInput('x');
    // Output should only have process output, not echo
    expect(terminal.getOutput()).toBe('');
    noEcho.destroy();
  });
});

describe('PTYAdapter — Control Characters', () => {
  it('Ctrl+C sends SIGINT', () => {
    process._setState('running');
    adapter.attach(process);
    terminal.simulateInput('\x03'); // Ctrl+C
    expect(process.state).toBe('killed');
    expect(terminal.getOutput()).toContain('^C');
  });

  it('Ctrl+D on empty line closes stdin', () => {
    process._setState('running');
    adapter.attach(process);
    terminal.simulateInput('\x04'); // Ctrl+D
    expect(adapter.stdinClosed).toBe(true);
    expect(terminal.getOutput()).toContain('^D');
  });

  it('Ctrl+D with pending input sends buffer', () => {
    const stdinData: string[] = [];
    process._setState('running');
    process.on('stdin', (data) => stdinData.push(data as string));
    adapter.attach(process);
    terminal.simulateInput('h');
    terminal.simulateInput('i');
    terminal.simulateInput('\x04'); // Ctrl+D with "hi" pending
    expect(stdinData).toEqual(['hi']);
    expect(adapter.stdinClosed).toBe(false);
  });

  it('Ctrl+Z sends suspend signal', () => {
    process._setState('running');
    adapter.attach(process);
    terminal.simulateInput('\x1a'); // Ctrl+Z
    expect(process.state).toBe('killed'); // treated as SIGINT for now
    expect(terminal.getOutput()).toContain('^Z');
  });

  it('Ctrl+C can be disabled', () => {
    const noCtrlC = new PTYAdapter(terminal, { handleCtrlC: false });
    process._setState('running');
    noCtrlC.attach(process);
    terminal.simulateInput('\x03');
    expect(process.state).toBe('running'); // not killed
    noCtrlC.destroy();
  });
});

describe('PTYAdapter — Process Exit', () => {
  it('shows exit message when process exits', () => {
    process._setState('running');
    adapter.attach(process);
    process._exit(0);
    expect(terminal.getOutput()).toContain('Process exited with code 0');
    expect(adapter.attachedProcess).toBeNull();
  });

  it('shows non-zero exit code', () => {
    process._setState('running');
    adapter.attach(process);
    process._exit(1);
    expect(terminal.getOutput()).toContain('Process exited with code 1');
  });
});

describe('PTYAdapter — Destroy', () => {
  it('destroy detaches process', () => {
    process._setState('running');
    adapter.attach(process);
    adapter.destroy();
    expect(adapter.attachedProcess).toBeNull();
    expect(adapter.destroyed).toBe(true);
  });

  it('double destroy is safe', () => {
    adapter.destroy();
    adapter.destroy(); // should not throw
  });
});
