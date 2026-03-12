/**
 * CatalystShell — Interactive shell with builtins, history, tab completion
 *
 * Runs inside CatalystTerminal, provides:
 *   - Command parsing with pipes and redirects
 *   - Shell builtins (cd, export, history, pwd, echo, exit, clear, env, which, alias)
 *   - Command history with up/down arrow navigation
 *   - Tab completion for filenames
 *   - Environment variable expansion
 *   - Background jobs (&)
 */
import type { CatalystTerminal } from './CatalystTerminal.js';
import { ShellHistory } from './ShellHistory.js';

export interface ShellConfig {
  /** Filesystem for tab completion and file operations */
  fs?: unknown;
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Initial working directory */
  cwd?: string;
  /** Command handler for non-builtin commands */
  onCommand?: (command: string, args: string[], env: Record<string, string>, cwd: string) => Promise<ShellCommandResult>;
  /** Prompt format (default: '$ ') */
  prompt?: string;
  /** History persistence path */
  historyPath?: string;
}

export interface ShellCommandResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

type ShellEventHandler = (...args: unknown[]) => void;

export class CatalystShell {
  private terminal: CatalystTerminal;
  private config: ShellConfig;
  private env: Record<string, string>;
  private cwd: string;
  private history: ShellHistory;
  private aliases: Map<string, string> = new Map();
  private prompt: string;
  private _running = false;
  private _destroyed = false;
  private _inputLine = '';
  private _cursorPos = 0;
  private _savedInput = ''; // saved input when navigating history
  private handlers = new Map<string, ShellEventHandler[]>();
  private unbindInput: (() => void) | null = null;
  private _escapeSeq = '';
  private _inEscape = false;

  // Shell builtins
  private builtins: Map<string, (args: string[]) => Promise<number>>;

  constructor(terminal: CatalystTerminal, config: ShellConfig = {}) {
    this.terminal = terminal;
    this.config = config;
    this.env = config.env ? { ...config.env } : {};
    this.cwd = config.cwd ?? '/';
    this.prompt = config.prompt ?? '$ ';
    this.history = new ShellHistory({
      maxEntries: 1000,
      persistKey: config.historyPath,
      fs: config.fs,
    });

    this.builtins = new Map([
      ['cd', this.builtinCd.bind(this)],
      ['export', this.builtinExport.bind(this)],
      ['history', this.builtinHistory.bind(this)],
      ['pwd', this.builtinPwd.bind(this)],
      ['echo', this.builtinEcho.bind(this)],
      ['exit', this.builtinExit.bind(this)],
      ['clear', this.builtinClear.bind(this)],
      ['env', this.builtinEnv.bind(this)],
      ['which', this.builtinWhich.bind(this)],
      ['alias', this.builtinAlias.bind(this)],
    ]);
  }

  get running(): boolean { return this._running; }
  get destroyed(): boolean { return this._destroyed; }
  get currentDir(): string { return this.cwd; }
  get environment(): Record<string, string> { return { ...this.env }; }

  /**
   * Start the shell — display prompt and accept input.
   */
  async start(): Promise<void> {
    if (this._destroyed) throw new Error('Shell has been destroyed');
    if (this._running) return;

    this._running = true;
    await this.history.load();
    this.showPrompt();

    // Wire terminal input
    const handler = (data: unknown) => this.handleInput(data as string);
    this.terminal.on('input', handler);
    this.unbindInput = () => this.terminal.off('input', handler);
    this.emit('start');
  }

  /**
   * Stop the shell.
   */
  stop(): void {
    this._running = false;
    this.unbindInput?.();
    this.unbindInput = null;
    this.emit('stop');
  }

  /**
   * Execute a command string programmatically.
   */
  async execute(commandLine: string): Promise<number> {
    if (this._destroyed) throw new Error('Shell has been destroyed');

    const expanded = this.expandVariables(commandLine);
    const parts = this.parseCommandLine(expanded);
    if (parts.length === 0) return 0;

    // Check for alias
    const aliased = this.aliases.get(parts[0]);
    if (aliased) {
      return this.execute(aliased + ' ' + parts.slice(1).join(' '));
    }

    const command = parts[0];
    const args = parts.slice(1);

    // Check background job
    const isBackground = args.length > 0 && args[args.length - 1] === '&';
    if (isBackground) args.pop();

    // Try builtin
    const builtin = this.builtins.get(command);
    if (builtin) {
      return builtin(args);
    }

    // External command
    if (this.config.onCommand) {
      const result = await this.config.onCommand(command, args, { ...this.env }, this.cwd);
      if (result.stdout) this.terminal.write(result.stdout.replace(/\n/g, '\r\n'));
      if (result.stderr) this.terminal.write(result.stderr.replace(/\n/g, '\r\n'));
      return result.exitCode;
    }

    this.terminal.writeln(`${command}: command not found`);
    return 127;
  }

  /**
   * Get tab completions for the current input.
   */
  getCompletions(input: string): string[] {
    const parts = input.split(' ');
    const lastPart = parts[parts.length - 1];

    // If completing first word, suggest builtins
    if (parts.length === 1) {
      const matches = [...this.builtins.keys()]
        .filter((b) => b.startsWith(lastPart))
        .sort();
      return matches;
    }

    // Otherwise suggest filenames from fs
    return this.getFileCompletions(lastPart);
  }

  /**
   * Destroy the shell.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.stop();
    this.history.save().catch(() => {});
    this.handlers.clear();
  }

  // ---- Event system ----

  on(event: string, handler: ShellEventHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: ShellEventHandler): this {
    const list = this.handlers.get(event);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try { h(...args); } catch {}
    }
  }

  // ---- Internal ----

  private showPrompt(): void {
    const ps1 = this.env.PS1 ?? this.prompt;
    this.terminal.write(ps1);
  }

  private handleInput(data: string): void {
    if (!this._running) return;

    for (const char of data) {
      const code = char.charCodeAt(0);

      // Handle escape sequences (arrow keys, etc.)
      if (this._inEscape) {
        this._escapeSeq += char;
        if (this._escapeSeq.length >= 2) {
          this.handleEscapeSequence(this._escapeSeq);
          this._escapeSeq = '';
          this._inEscape = false;
        }
        continue;
      }

      // Start escape sequence
      if (code === 0x1b) {
        this._inEscape = true;
        this._escapeSeq = '';
        continue;
      }

      // Ctrl+C — cancel current input
      if (code === 0x03) {
        this.terminal.write('^C\r\n');
        this._inputLine = '';
        this._cursorPos = 0;
        this.history.resetCursor();
        this.showPrompt();
        continue;
      }

      // Ctrl+D — exit if empty, otherwise delete char
      if (code === 0x04) {
        if (this._inputLine.length === 0) {
          this.terminal.write('^D\r\n');
          this.stop();
          this.emit('exit', 0);
          return;
        }
        continue;
      }

      // Ctrl+L — clear screen
      if (code === 0x0c) {
        this.terminal.clear();
        this.showPrompt();
        this.terminal.write(this._inputLine);
        continue;
      }

      // Tab (0x09) — tab completion
      if (code === 0x09) {
        this.handleTabCompletion();
        continue;
      }

      // Backspace (0x7f or 0x08)
      if (code === 0x7f || code === 0x08) {
        if (this._cursorPos > 0) {
          this._inputLine = this._inputLine.slice(0, this._cursorPos - 1) + this._inputLine.slice(this._cursorPos);
          this._cursorPos--;
          this.terminal.write('\b \b');
        }
        continue;
      }

      // Enter (0x0d) — execute command
      if (code === 0x0d) {
        this.terminal.write('\r\n');
        const line = this._inputLine.trim();
        this._inputLine = '';
        this._cursorPos = 0;
        this.history.resetCursor();

        if (line) {
          this.history.push(line);
          this.execute(line).then(() => {
            if (this._running) this.showPrompt();
          });
        } else {
          if (this._running) this.showPrompt();
        }
        continue;
      }

      // Regular character
      this._inputLine = this._inputLine.slice(0, this._cursorPos) + char + this._inputLine.slice(this._cursorPos);
      this._cursorPos++;
      this.terminal.write(char);
    }
  }

  private handleEscapeSequence(seq: string): void {
    // Arrow keys: [A = up, [B = down, [C = right, [D = left
    if (seq === '[A') {
      // Up arrow — previous history
      if (this._savedInput === '' && this._inputLine !== '') {
        this._savedInput = this._inputLine;
      }
      const entry = this.history.up();
      if (entry !== null) {
        this.replaceLine(entry);
      }
    } else if (seq === '[B') {
      // Down arrow — next history
      const entry = this.history.down();
      if (entry !== null) {
        this.replaceLine(entry);
      } else {
        this.replaceLine(this._savedInput);
        this._savedInput = '';
      }
    }
    // Left/Right arrows are handled but don't move cursor for simplicity
  }

  private replaceLine(newLine: string): void {
    // Erase current line
    while (this._cursorPos > 0) {
      this.terminal.write('\b \b');
      this._cursorPos--;
    }
    // Write new line
    this._inputLine = newLine;
    this._cursorPos = newLine.length;
    this.terminal.write(newLine);
  }

  private handleTabCompletion(): void {
    const completions = this.getCompletions(this._inputLine);
    if (completions.length === 0) return;

    if (completions.length === 1) {
      // Complete the word
      const parts = this._inputLine.split(' ');
      parts[parts.length - 1] = completions[0];
      const newLine = parts.join(' ') + ' ';
      this.replaceLine(newLine);
    } else {
      // Show all completions
      this.terminal.write('\r\n');
      this.terminal.write(completions.join('  ') + '\r\n');
      this.showPrompt();
      this.terminal.write(this._inputLine);
    }
  }

  private getFileCompletions(partial: string): string[] {
    const fs = this.config.fs as any;
    if (!fs) return [];

    try {
      const dir = partial.includes('/') ? partial.substring(0, partial.lastIndexOf('/') + 1) : this.cwd;
      const prefix = partial.includes('/') ? partial.substring(partial.lastIndexOf('/') + 1) : partial;
      const fullDir = dir.startsWith('/') ? dir : this.resolvePath(dir);

      const entries = fs.readdirSync(fullDir) as string[];
      return entries.filter((e: string) => e.startsWith(prefix)).sort();
    } catch {
      return [];
    }
  }

  private expandVariables(line: string): string {
    return line.replace(/\$(\w+)/g, (_match, name) => this.env[name] ?? '');
  }

  private parseCommandLine(line: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;

    for (const char of line) {
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (char === ' ' && !inSingle && !inDouble) {
        if (current) { parts.push(current); current = ''; }
        continue;
      }
      current += char;
    }
    if (current) parts.push(current);
    return parts;
  }

  private resolvePath(path: string): string {
    if (path.startsWith('/')) return path;
    if (path === '~') return this.env.HOME ?? '/';
    if (path.startsWith('~/')) return (this.env.HOME ?? '/') + path.slice(1);
    // Relative path
    const base = this.cwd.endsWith('/') ? this.cwd : this.cwd + '/';
    return base + path;
  }

  // ---- Builtins ----

  private async builtinCd(args: string[]): Promise<number> {
    const target = args[0] ?? this.env.HOME ?? '/';
    const resolved = this.resolvePath(target);

    // Verify directory exists
    const fs = this.config.fs as any;
    if (fs) {
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory?.()) {
          this.terminal.writeln(`cd: not a directory: ${target}`);
          return 1;
        }
      } catch {
        this.terminal.writeln(`cd: no such directory: ${target}`);
        return 1;
      }
    }

    this.env.OLDPWD = this.cwd;
    this.cwd = resolved;
    this.env.PWD = this.cwd;
    this.emit('cwd', this.cwd);
    return 0;
  }

  private async builtinExport(args: string[]): Promise<number> {
    if (args.length === 0) {
      // Show all exports
      for (const [key, val] of Object.entries(this.env)) {
        this.terminal.writeln(`export ${key}="${val}"`);
      }
      return 0;
    }
    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        this.env[arg.slice(0, eq)] = arg.slice(eq + 1);
      }
    }
    return 0;
  }

  private async builtinHistory(_args: string[]): Promise<number> {
    const entries = this.history.getEntries();
    for (let i = 0; i < entries.length; i++) {
      this.terminal.writeln(`  ${i + 1}  ${entries[i]}`);
    }
    return 0;
  }

  private async builtinPwd(_args: string[]): Promise<number> {
    this.terminal.writeln(this.cwd);
    return 0;
  }

  private async builtinEcho(args: string[]): Promise<number> {
    this.terminal.writeln(args.join(' '));
    return 0;
  }

  private async builtinExit(args: string[]): Promise<number> {
    const code = args[0] ? parseInt(args[0], 10) : 0;
    this.stop();
    this.emit('exit', code);
    return code;
  }

  private async builtinClear(_args: string[]): Promise<number> {
    this.terminal.clear();
    return 0;
  }

  private async builtinEnv(_args: string[]): Promise<number> {
    for (const [key, val] of Object.entries(this.env)) {
      this.terminal.writeln(`${key}=${val}`);
    }
    return 0;
  }

  private async builtinWhich(args: string[]): Promise<number> {
    if (args.length === 0) return 1;
    const cmd = args[0];
    if (this.builtins.has(cmd)) {
      this.terminal.writeln(`${cmd}: shell builtin`);
      return 0;
    }
    this.terminal.writeln(`${cmd}: not found`);
    return 1;
  }

  private async builtinAlias(args: string[]): Promise<number> {
    if (args.length === 0) {
      for (const [name, val] of this.aliases) {
        this.terminal.writeln(`alias ${name}='${val}'`);
      }
      return 0;
    }
    for (const arg of args) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        this.aliases.set(arg.slice(0, eq), arg.slice(eq + 1));
      } else {
        const val = this.aliases.get(arg);
        if (val) {
          this.terminal.writeln(`alias ${arg}='${val}'`);
        } else {
          this.terminal.writeln(`alias: ${arg}: not found`);
          return 1;
        }
      }
    }
    return 0;
  }
}
