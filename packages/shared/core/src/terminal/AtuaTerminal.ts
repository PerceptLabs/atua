/**
 * AtuaTerminal — xterm.js wrapper with PTY adapter
 *
 * Wraps xterm.js with:
 *   - Lazy loading (only imported when terminal UI opens)
 *   - WebGL renderer addon for performance
 *   - Fit addon for responsive sizing
 *   - Web-links addon for clickable URLs
 *   - PTY adapter that bridges CatalystProc stdio
 *   - Signal handling (Ctrl+C, Ctrl+D, Ctrl+Z)
 */

export interface TerminalConfig {
  /** Container element to mount the terminal in (browser only) */
  container?: HTMLElement;
  /** Number of columns */
  cols?: number;
  /** Number of rows */
  rows?: number;
  /** Font size in pixels */
  fontSize?: number;
  /** Font family */
  fontFamily?: string;
  /** Theme colors */
  theme?: TerminalTheme;
  /** Enable WebGL renderer (default: true) */
  webgl?: boolean;
  /** Enable clickable links (default: true) */
  linkify?: boolean;
  /** Scroll-back buffer size (default: 1000) */
  scrollback?: number;
}

export interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
}

export type TerminalEventHandler = (...args: unknown[]) => void;

/**
 * AtuaTerminal manages the xterm.js instance and its addons.
 * Works in both browser (with real xterm.js) and Node (headless mode for testing).
 */
export class AtuaTerminal {
  private config: TerminalConfig;
  private terminal: any = null;
  private fitAddon: any = null;
  private webglAddon: any = null;
  private webLinksAddon: any = null;
  private handlers = new Map<string, TerminalEventHandler[]>();
  private _mounted = false;
  private _destroyed = false;
  private _inputBuffer: string[] = [];
  private _outputBuffer: string[] = [];
  private _cols: number;
  private _rows: number;
  private _disposables: Array<{ dispose(): void }> = [];

  constructor(config: TerminalConfig = {}) {
    this.config = config;
    this._cols = config.cols ?? 80;
    this._rows = config.rows ?? 24;
  }

  get cols(): number { return this._cols; }
  get rows(): number { return this._rows; }
  get mounted(): boolean { return this._mounted; }
  get destroyed(): boolean { return this._destroyed; }

  /**
   * Mount terminal into a container element.
   * Lazily loads xterm.js and addons.
   */
  async mount(container?: HTMLElement): Promise<void> {
    if (this._destroyed) throw new Error('Terminal has been destroyed');
    if (this._mounted) return;

    const target = container ?? this.config.container;

    if (typeof window !== 'undefined' && target) {
      await this.mountBrowser(target);
    } else {
      // Headless mode for Node.js testing
      this.mountHeadless();
    }

    this._mounted = true;
    this.emit('mount');
  }

  /**
   * Write data to the terminal display.
   * Called by the PTY adapter when the process produces output.
   */
  write(data: string): void {
    if (this._destroyed) return;
    this._outputBuffer.push(data);
    if (this.terminal) {
      this.terminal.write(data);
    }
    this.emit('output', data);
  }

  /**
   * Write a line to the terminal display (with newline).
   */
  writeln(data: string): void {
    this.write(data + '\r\n');
  }

  /**
   * Clear the terminal screen.
   */
  clear(): void {
    if (this.terminal) {
      this.terminal.clear();
    }
    this._outputBuffer = [];
    this.emit('clear');
  }

  /**
   * Resize the terminal.
   */
  resize(cols: number, rows: number): void {
    this._cols = cols;
    this._rows = rows;
    if (this.terminal) {
      this.terminal.resize(cols, rows);
    }
    this.emit('resize', { cols, rows });
  }

  /**
   * Focus the terminal input.
   */
  focus(): void {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  /**
   * Fit terminal to container dimensions.
   */
  fit(): void {
    if (this.fitAddon) {
      this.fitAddon.fit();
      this._cols = this.terminal?.cols ?? this._cols;
      this._rows = this.terminal?.rows ?? this._rows;
    }
  }

  /**
   * Get all output written to this terminal.
   */
  getOutput(): string {
    return this._outputBuffer.join('');
  }

  /**
   * Get all input received from the user.
   */
  getInput(): string {
    return this._inputBuffer.join('');
  }

  /**
   * Simulate user input (for testing).
   */
  simulateInput(data: string): void {
    this._inputBuffer.push(data);
    this.emit('input', data);
  }

  /**
   * Destroy the terminal and clean up resources.
   */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    for (const d of this._disposables) {
      try { d.dispose(); } catch {}
    }
    this._disposables = [];

    if (this.webglAddon) {
      try { this.webglAddon.dispose(); } catch {}
      this.webglAddon = null;
    }
    if (this.webLinksAddon) {
      try { this.webLinksAddon.dispose(); } catch {}
      this.webLinksAddon = null;
    }
    if (this.fitAddon) {
      try { this.fitAddon.dispose(); } catch {}
      this.fitAddon = null;
    }
    if (this.terminal) {
      try { this.terminal.dispose(); } catch {}
      this.terminal = null;
    }

    this.handlers.clear();
    this._mounted = false;
  }

  // ---- Event system ----

  on(event: string, handler: TerminalEventHandler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  off(event: string, handler: TerminalEventHandler): this {
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

  // ---- Browser mounting ----

  private async mountBrowser(container: HTMLElement): Promise<void> {
    // Lazy-load xterm.js and addons
    const [xtermModule, fitModule] = await Promise.all([
      import('xterm'),
      import('@xterm/addon-fit'),
    ]);

    const Terminal = xtermModule.Terminal;
    const FitAddon = fitModule.FitAddon;

    this.terminal = new Terminal({
      cols: this._cols,
      rows: this._rows,
      fontSize: this.config.fontSize ?? 14,
      fontFamily: this.config.fontFamily ?? 'Menlo, Monaco, "Courier New", monospace',
      theme: this.config.theme ?? {},
      scrollback: this.config.scrollback ?? 1000,
      cursorBlink: true,
      allowProposedApi: true,
    });

    // Fit addon
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // WebGL addon (optional, fails gracefully)
    if (this.config.webgl !== false) {
      try {
        const webglModule = await import('@xterm/addon-webgl');
        this.webglAddon = new webglModule.WebglAddon();
        this.terminal.loadAddon(this.webglAddon);
      } catch {
        // WebGL not available, fallback to canvas
      }
    }

    // Web links addon
    if (this.config.linkify !== false) {
      try {
        const linksModule = await import('@xterm/addon-web-links');
        this.webLinksAddon = new linksModule.WebLinksAddon();
        this.terminal.loadAddon(this.webLinksAddon);
      } catch {
        // Links addon not available
      }
    }

    // Mount to container
    this.terminal.open(container);
    this.fitAddon.fit();
    this._cols = this.terminal.cols;
    this._rows = this.terminal.rows;

    // Wire input events
    const dataDisposable = this.terminal.onData((data: string) => {
      this._inputBuffer.push(data);
      this.emit('input', data);
    });
    this._disposables.push(dataDisposable);

    const resizeDisposable = this.terminal.onResize((size: { cols: number; rows: number }) => {
      this._cols = size.cols;
      this._rows = size.rows;
      this.emit('resize', size);
    });
    this._disposables.push(resizeDisposable);
  }

  // ---- Headless mounting (for Node tests) ----

  private mountHeadless(): void {
    // No real terminal — just buffer I/O for testing
    this.terminal = {
      write: () => {},
      writeln: (data: string) => this.write(data + '\r\n'),
      clear: () => {},
      resize: (cols: number, rows: number) => { this._cols = cols; this._rows = rows; },
      focus: () => {},
      dispose: () => {},
      cols: this._cols,
      rows: this._rows,
    };
  }
}
