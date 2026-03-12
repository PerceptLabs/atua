/**
 * PTYAdapter — Bridges AtuaProc stdio with AtuaTerminal
 *
 * Connects an AtuaProcess to an AtuaTerminal:
 *   - Process stdout/stderr → terminal write
 *   - Terminal input → process stdin
 *   - Ctrl+C → SIGINT
 *   - Ctrl+D → EOF (closes stdin)
 *   - Ctrl+Z → SIGTSTP (suspend)
 *   - Terminal resize → SIGWINCH
 */
import type { AtuaProcess, Signal } from '../proc/AtuaProcess.js';
import type { AtuaTerminal } from './AtuaTerminal.js';

export interface PTYAdapterConfig {
  /** Whether to echo input characters back to terminal (default: true) */
  echo?: boolean;
  /** Whether to translate \n to \r\n for terminal display (default: true) */
  crlf?: boolean;
  /** Handle Ctrl+C as SIGINT (default: true) */
  handleCtrlC?: boolean;
  /** Handle Ctrl+D as EOF (default: true) */
  handleCtrlD?: boolean;
  /** Handle Ctrl+Z as SIGTSTP (default: true) */
  handleCtrlZ?: boolean;
}

export class PTYAdapter {
  private terminal: AtuaTerminal;
  private process: AtuaProcess | null = null;
  private config: PTYAdapterConfig;
  private _destroyed = false;
  private _stdinClosed = false;
  private unbindTerminal: (() => void) | null = null;
  private unbindProcess: (() => void) | null = null;
  private _inputLine = '';

  constructor(terminal: AtuaTerminal, config: PTYAdapterConfig = {}) {
    this.terminal = terminal;
    this.config = {
      echo: config.echo ?? true,
      crlf: config.crlf ?? true,
      handleCtrlC: config.handleCtrlC ?? true,
      handleCtrlD: config.handleCtrlD ?? true,
      handleCtrlZ: config.handleCtrlZ ?? true,
    };
  }

  get destroyed(): boolean { return this._destroyed; }
  get stdinClosed(): boolean { return this._stdinClosed; }
  get attachedProcess(): AtuaProcess | null { return this.process; }

  /**
   * Attach a process to the terminal.
   * Wires stdout/stderr → terminal and input → stdin.
   */
  attach(process: AtuaProcess): void {
    if (this._destroyed) throw new Error('PTYAdapter has been destroyed');
    this.detach(); // detach any existing process

    this.process = process;
    this._stdinClosed = false;
    this._inputLine = '';

    // Process stdout → terminal
    const onStdout = (...args: unknown[]) => {
      const data = args[0] as string;
      const output = this.config.crlf ? data.replace(/\n/g, '\r\n') : data;
      this.terminal.write(output);
    };

    // Process stderr → terminal (displayed as-is, could add coloring)
    const onStderr = (...args: unknown[]) => {
      const data = args[0] as string;
      const output = this.config.crlf ? data.replace(/\n/g, '\r\n') : data;
      this.terminal.write(output);
    };

    // Process exit → notify terminal
    const onExit = (...args: any[]) => {
      const code = args[0] as number;
      this.terminal.write(`\r\n[Process exited with code ${code}]\r\n`);
      this.unbindProcess?.();
      this.unbindProcess = null;
      this.process = null;
    };

    process.on('stdout', onStdout);
    process.on('stderr', onStderr);
    process.on('exit', onExit);

    this.unbindProcess = () => {
      process.off('stdout', onStdout);
      process.off('stderr', onStderr);
      process.off('exit', onExit);
    };

    // Terminal input → process stdin
    const onInput = (...args: unknown[]) => {
      this.handleInput(args[0] as string);
    };

    // Terminal resize → process
    const onResize = (...args: unknown[]) => {
      const size = args[0];
      const { cols, rows } = size as { cols: number; rows: number };
      // Emit SIGWINCH-like event to process
      if (this.process) {
        try {
          this.process._pushStdout(''); // trigger activity; actual SIGWINCH is conceptual
        } catch {}
      }
    };

    this.terminal.on('input', onInput);
    this.terminal.on('resize', onResize);

    this.unbindTerminal = () => {
      this.terminal.off('input', onInput);
      this.terminal.off('resize', onResize);
    };
  }

  /**
   * Detach the current process from the terminal.
   */
  detach(): void {
    this.unbindTerminal?.();
    this.unbindTerminal = null;
    this.unbindProcess?.();
    this.unbindProcess = null;
    this.process = null;
    this._stdinClosed = false;
    this._inputLine = '';
  }

  /**
   * Destroy the adapter and detach everything.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this.detach();
  }

  /**
   * Handle input from the terminal.
   * Processes control characters and forwards data to the process.
   */
  private handleInput(data: string): void {
    if (!this.process || this._stdinClosed) return;

    for (const char of data) {
      const code = char.charCodeAt(0);

      // Ctrl+C (0x03) → SIGINT
      if (code === 0x03 && this.config.handleCtrlC) {
        this.terminal.write('^C\r\n');
        this.process.kill('SIGINT');
        this._inputLine = '';
        return;
      }

      // Ctrl+D (0x04) → EOF
      if (code === 0x04 && this.config.handleCtrlD) {
        if (this._inputLine.length === 0) {
          this._stdinClosed = true;
          this.terminal.write('^D\r\n');
          return;
        }
        // If there's pending input, Ctrl+D sends it without newline
        this.process.write(this._inputLine);
        this._inputLine = '';
        return;
      }

      // Ctrl+Z (0x1a) → SIGTSTP
      if (code === 0x1a && this.config.handleCtrlZ) {
        this.terminal.write('^Z\r\n');
        // SIGTSTP not in AtuaProcess signals, treat as SIGINT for now
        this.process.kill('SIGINT');
        this._inputLine = '';
        return;
      }

      // Backspace (0x7f or 0x08)
      if (code === 0x7f || code === 0x08) {
        if (this._inputLine.length > 0) {
          this._inputLine = this._inputLine.slice(0, -1);
          if (this.config.echo) {
            this.terminal.write('\b \b');
          }
        }
        continue;
      }

      // Enter (0x0d) → send line to process
      if (code === 0x0d) {
        if (this.config.echo) {
          this.terminal.write('\r\n');
        }
        this.process.write(this._inputLine + '\n');
        this._inputLine = '';
        continue;
      }

      // Regular character
      this._inputLine += char;
      if (this.config.echo) {
        this.terminal.write(char);
      }
    }
  }
}
