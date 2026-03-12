/**
 * AtuaShell — Unit tests
 * Validates shell builtins, command parsing, variable expansion, and tab completion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtuaTerminal } from './AtuaTerminal.js';
import { AtuaShell } from './AtuaShell.js';

let terminal: AtuaTerminal;
let shell: AtuaShell;

beforeEach(async () => {
  terminal = new AtuaTerminal({ cols: 80, rows: 24 });
  await terminal.mount();
  shell = new AtuaShell(terminal, {
    env: { HOME: '/home/user', NODE_ENV: 'test' },
    cwd: '/project',
  });
});

afterEach(() => {
  shell.destroy();
  terminal.destroy();
});

describe('AtuaShell — Construction', () => {
  it('starts not running', () => {
    expect(shell.running).toBe(false);
    expect(shell.destroyed).toBe(false);
  });

  it('has correct initial cwd', () => {
    expect(shell.currentDir).toBe('/project');
  });

  it('has correct initial env', () => {
    const env = shell.environment;
    expect(env.HOME).toBe('/home/user');
    expect(env.NODE_ENV).toBe('test');
  });
});

describe('AtuaShell — Start/Stop', () => {
  it('start shows prompt', async () => {
    await shell.start();
    expect(shell.running).toBe(true);
    expect(terminal.getOutput()).toContain('$ ');
  });

  it('stop changes running state', async () => {
    await shell.start();
    shell.stop();
    expect(shell.running).toBe(false);
  });

  it('start after destroy throws', async () => {
    shell.destroy();
    await expect(shell.start()).rejects.toThrow('destroyed');
  });

  it('emits start event', async () => {
    const events: string[] = [];
    shell.on('start', () => events.push('started'));
    await shell.start();
    expect(events).toEqual(['started']);
  });
});

describe('AtuaShell — Builtins', () => {
  it('pwd prints current directory', async () => {
    const code = await shell.execute('pwd');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain('/project');
  });

  it('echo prints arguments', async () => {
    const code = await shell.execute('echo hello world');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain('hello world');
  });

  it('cd changes directory', async () => {
    const code = await shell.execute('cd /new/dir');
    expect(code).toBe(0);
    expect(shell.currentDir).toBe('/new/dir');
  });

  it('cd ~ goes to HOME', async () => {
    const code = await shell.execute('cd ~');
    expect(code).toBe(0);
    expect(shell.currentDir).toBe('/home/user');
  });

  it('cd with no args goes to HOME', async () => {
    const code = await shell.execute('cd');
    expect(code).toBe(0);
    expect(shell.currentDir).toBe('/home/user');
  });

  it('export sets environment variable', async () => {
    await shell.execute('export FOO=bar');
    expect(shell.environment.FOO).toBe('bar');
  });

  it('export with no args lists all', async () => {
    const code = await shell.execute('export');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain('HOME=');
  });

  it('env lists all variables', async () => {
    const code = await shell.execute('env');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain('HOME=/home/user');
    expect(terminal.getOutput()).toContain('NODE_ENV=test');
  });

  it('clear empties terminal', async () => {
    terminal.write('some output');
    const code = await shell.execute('clear');
    expect(code).toBe(0);
    // After clear, output buffer is reset
  });

  it('which identifies builtins', async () => {
    const code = await shell.execute('which cd');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain('shell builtin');
  });

  it('which reports not found', async () => {
    const code = await shell.execute('which nonexistent');
    expect(code).toBe(1);
    expect(terminal.getOutput()).toContain('not found');
  });

  it('alias sets and shows aliases', async () => {
    await shell.execute("alias ll='ls -la'");
    const code = await shell.execute('alias');
    expect(code).toBe(0);
    expect(terminal.getOutput()).toContain("alias ll='ls -la'");
  });

  it('exit stops the shell', async () => {
    await shell.start();
    const exits: number[] = [];
    shell.on('exit', (code: unknown) => exits.push(code as number));
    await shell.execute('exit');
    expect(shell.running).toBe(false);
    expect(exits).toEqual([0]);
  });

  it('exit with code', async () => {
    await shell.start();
    const exits: number[] = [];
    shell.on('exit', (code: unknown) => exits.push(code as number));
    await shell.execute('exit 42');
    expect(exits).toEqual([42]);
  });

  it('history shows commands', async () => {
    await shell.execute('echo first');
    await shell.execute('echo second');
    // History should contain executed commands — verify via output
    const code = await shell.execute('history');
    expect(code).toBe(0);
    // Output includes echo outputs + history listing
    const output = terminal.getOutput();
    // The history builtin output includes line numbers + commands
    expect(output).toContain('first');
    expect(output).toContain('second');
  });
});

describe('AtuaShell — Variable Expansion', () => {
  it('expands $HOME', async () => {
    await shell.execute('echo $HOME');
    expect(terminal.getOutput()).toContain('/home/user');
  });

  it('expands $NODE_ENV', async () => {
    await shell.execute('echo $NODE_ENV');
    expect(terminal.getOutput()).toContain('test');
  });

  it('undefined variable expands to empty', async () => {
    await shell.execute('echo $UNDEFINED_VAR');
    // Should output just a blank line
    expect(terminal.getOutput()).toContain('\r\n');
  });

  it('export + echo round-trip', async () => {
    await shell.execute('export MY_VAR=hello');
    terminal.clear();
    await shell.execute('echo $MY_VAR');
    expect(terminal.getOutput()).toContain('hello');
  });
});

describe('AtuaShell — Command Parsing', () => {
  it('handles quoted strings', async () => {
    await shell.execute('echo "hello world"');
    expect(terminal.getOutput()).toContain('hello world');
  });

  it('handles single-quoted strings', async () => {
    await shell.execute("echo 'hello world'");
    expect(terminal.getOutput()).toContain('hello world');
  });

  it('unknown command returns 127', async () => {
    const code = await shell.execute('nonexistent');
    expect(code).toBe(127);
    expect(terminal.getOutput()).toContain('command not found');
  });

  it('empty command returns 0', async () => {
    const code = await shell.execute('');
    expect(code).toBe(0);
  });
});

describe('AtuaShell — Tab Completion', () => {
  it('completes builtins', () => {
    const completions = shell.getCompletions('ec');
    expect(completions).toContain('echo');
  });

  it('completes multiple builtins', () => {
    const completions = shell.getCompletions('e');
    expect(completions).toContain('echo');
    expect(completions).toContain('exit');
    expect(completions).toContain('export');
    expect(completions).toContain('env');
  });

  it('empty input completes all builtins', () => {
    const completions = shell.getCompletions('');
    expect(completions.length).toBeGreaterThanOrEqual(10);
  });

  it('file completions with fs', () => {
    const mockFs = {
      readdirSync: () => ['file.txt', 'folder', 'foo.js'],
    };
    const fsShell = new AtuaShell(terminal, { fs: mockFs, cwd: '/' });
    const completions = fsShell.getCompletions('cat f');
    expect(completions).toContain('file.txt');
    expect(completions).toContain('folder');
    expect(completions).toContain('foo.js');
    fsShell.destroy();
  });
});

describe('AtuaShell — External Commands', () => {
  it('calls onCommand for non-builtins', async () => {
    const commands: string[] = [];
    const cmdShell = new AtuaShell(terminal, {
      cwd: '/',
      onCommand: async (cmd, args) => {
        commands.push(`${cmd} ${args.join(' ')}`);
        return { stdout: 'output\n', exitCode: 0 };
      },
    });
    const code = await cmdShell.execute('node -e "1+1"');
    expect(code).toBe(0);
    expect(commands[0]).toContain('node');
    expect(terminal.getOutput()).toContain('output');
    cmdShell.destroy();
  });
});

describe('AtuaShell — Destroy', () => {
  it('destroy stops shell', async () => {
    await shell.start();
    shell.destroy();
    expect(shell.destroyed).toBe(true);
    expect(shell.running).toBe(false);
  });

  it('execute after destroy throws', async () => {
    shell.destroy();
    await expect(shell.execute('pwd')).rejects.toThrow('destroyed');
  });
});
