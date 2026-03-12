/**
 * AtuaTCP — TCP bridge via WebSocket relay
 *
 * Phase J: Implements Node.js net module using WebSocket transport.
 *
 * Architecture:
 * User code: net.createConnection({ host, port })
 *     → AtuaTCP intercepts
 *     → Creates WebSocket to relay endpoint
 *     → Relay service: WSS ↔ raw TCP to target host
 *     → Target server receives standard wire protocol
 *
 * Three layers of TCP coverage:
 * Layer A: HTTP-over-TCP (90% of usage) — already solved by fetch()
 * Layer B: WebSocket bridge (databases, SMTP, custom protocols)
 * Layer C: Direct Connection API (where available)
 */

export interface TCPConnectionOptions {
  host: string;
  port: number;
  /** WebSocket relay endpoint URL */
  relayUrl?: string;
  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
}

export interface TCPSocket {
  readonly connected: boolean;
  readonly remoteAddress: string;
  readonly remotePort: number;

  write(data: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): void;
  destroy(): void;

  on(event: 'data', handler: (data: Uint8Array) => void): void;
  on(event: 'connect', handler: () => void): void;
  on(event: 'close', handler: (hadError: boolean) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;

  off(event: string, handler: (...args: unknown[]) => void): void;

  setEncoding(encoding: string): void;
  setTimeout(timeout: number, handler?: () => void): void;
  setNoDelay(noDelay?: boolean): void;
  setKeepAlive(enable?: boolean, delay?: number): void;
}

type EventHandler = (...args: unknown[]) => void;

/**
 * Create a TCP-like connection backed by WebSocket relay.
 */
export class AtuaTCPSocket implements TCPSocket {
  private _connected = false;
  private _destroyed = false;
  private _ws: WebSocket | null = null;
  private _handlers = new Map<string, EventHandler[]>();
  private _encoding: string | null = null;
  private _options: TCPConnectionOptions;

  readonly remoteAddress: string;
  readonly remotePort: number;

  constructor(options: TCPConnectionOptions) {
    this._options = options;
    this.remoteAddress = options.host;
    this.remotePort = options.port;
  }

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Initiate the WebSocket connection to the relay.
   */
  connect(): void {
    if (this._connected || this._destroyed) return;

    const relayUrl = this._options.relayUrl;
    if (!relayUrl) {
      // No relay configured — emit error
      this._emit('error', new Error(
        `TCP connection to ${this.remoteAddress}:${this.remotePort} requires a WebSocket relay. ` +
        `Configure relayUrl in AtuaTCP options.`
      ));
      return;
    }

    try {
      const wsUrl = `${relayUrl}?host=${encodeURIComponent(this.remoteAddress)}&port=${this.remotePort}`;
      this._ws = new WebSocket(wsUrl);
      this._ws.binaryType = 'arraybuffer';

      const timeout = this._options.timeout ?? 10000;
      const timer = setTimeout(() => {
        if (!this._connected) {
          this._emit('error', new Error(`Connection timed out after ${timeout}ms`));
          this.destroy();
        }
      }, timeout);

      this._ws.onopen = () => {
        clearTimeout(timer);
        this._connected = true;
        this._emit('connect');
      };

      this._ws.onmessage = (event) => {
        const data = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new TextEncoder().encode(String(event.data));
        this._emit('data', data);
      };

      this._ws.onclose = () => {
        clearTimeout(timer);
        this._connected = false;
        this._emit('end');
        this._emit('close', false);
      };

      this._ws.onerror = () => {
        clearTimeout(timer);
        this._emit('error', new Error(`WebSocket connection to relay failed`));
        this._emit('close', true);
      };
    } catch (err: any) {
      this._emit('error', err);
    }
  }

  write(data: string | Uint8Array): boolean {
    if (!this._connected || !this._ws) return false;
    try {
      if (typeof data === 'string') {
        this._ws.send(new TextEncoder().encode(data));
      } else {
        this._ws.send(data);
      }
      return true;
    } catch {
      return false;
    }
  }

  end(data?: string | Uint8Array): void {
    if (data) this.write(data);
    if (this._ws) {
      this._ws.close();
    }
    this._connected = false;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._connected = false;
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
    this._handlers.clear();
  }

  on(event: 'data', handler: (data: Uint8Array) => void): void;
  on(event: 'connect', handler: () => void): void;
  on(event: 'close', handler: (hadError: boolean) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'end', handler: () => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  on(event: string, handler: (...args: any[]) => void): void {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      this._handlers.set(event, handlers.filter((h) => h !== handler));
    }
  }

  setEncoding(encoding: string): void { this._encoding = encoding; }
  setTimeout(_timeout: number, _handler?: () => void): void {}
  setNoDelay(_noDelay?: boolean): void {}
  setKeepAlive(_enable?: boolean, _delay?: number): void {}

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const handler of [...handlers]) {
        handler(...args);
      }
    }
  }
}

/**
 * Create a TCP connection — drop-in for net.createConnection().
 */
export function createConnection(options: TCPConnectionOptions): AtuaTCPSocket {
  const socket = new AtuaTCPSocket(options);
  // Auto-connect on next tick
  Promise.resolve().then(() => socket.connect());
  return socket;
}

/**
 * TCP server — minimal implementation for net.createServer().
 */
export class AtuaTCPServer {
  private _listening = false;
  private _port: number | null = null;
  private _handlers = new Map<string, EventHandler[]>();

  listen(port: number, hostname?: string | (() => void), callback?: () => void): this {
    this._port = port;
    this._listening = true;
    const cb = typeof hostname === 'function' ? hostname : callback;
    this._emit('listening');
    if (cb) Promise.resolve().then(cb);
    return this;
  }

  close(callback?: () => void): this {
    this._listening = false;
    this._port = null;
    this._emit('close');
    if (callback) Promise.resolve().then(callback);
    return this;
  }

  address(): { address: string; family: string; port: number } | null {
    if (!this._listening || this._port === null) return null;
    return { address: '0.0.0.0', family: 'IPv4', port: this._port };
  }

  get listening(): boolean { return this._listening; }

  on(event: string, handler: EventHandler): this {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    const handlers = this._handlers.get(event);
    if (handlers) this._handlers.set(event, handlers.filter((h) => h !== handler));
    return this;
  }

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(event);
    if (handlers) handlers.forEach((h) => h(...args));
  }
}

/**
 * Generate the net module source for the engine's require() system.
 */
export function getNetModuleSource(): string {
  return `
(function() {
  function Socket(options) {
    this.remoteAddress = options && options.host || '127.0.0.1';
    this.remotePort = options && options.port || 0;
    this.connecting = false;
    this.destroyed = false;
    this._events = {};
  }
  Socket.prototype.connect = function(port, host, callback) {
    this.connecting = true;
    this.remotePort = port;
    if (typeof host === 'string') this.remoteAddress = host;
    var cb = typeof host === 'function' ? host : callback;
    if (cb) Promise.resolve().then(cb);
    return this;
  };
  Socket.prototype.write = function(data) { return true; };
  Socket.prototype.end = function() { this.destroyed = true; };
  Socket.prototype.destroy = function() { this.destroyed = true; };
  Socket.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };
  Socket.prototype.once = Socket.prototype.on;
  Socket.prototype.removeListener = function(event, handler) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(function(h) { return h !== handler; });
    }
    return this;
  };
  Socket.prototype.setEncoding = function() { return this; };
  Socket.prototype.setTimeout = function() { return this; };
  Socket.prototype.setNoDelay = function() { return this; };
  Socket.prototype.setKeepAlive = function() { return this; };
  Socket.prototype.ref = function() { return this; };
  Socket.prototype.unref = function() { return this; };

  function Server(connectionListener) {
    this._connectionListener = connectionListener;
    this._listening = false;
    this._events = {};
  }
  Server.prototype.listen = function(port, hostname, callback) {
    this._listening = true;
    this._port = port;
    var cb = typeof hostname === 'function' ? hostname : callback;
    var self = this;
    if (self._events.listening) self._events.listening.forEach(function(h) { h(); });
    if (cb) Promise.resolve().then(cb);
    return this;
  };
  Server.prototype.close = function(callback) {
    this._listening = false;
    if (callback) Promise.resolve().then(callback);
    return this;
  };
  Server.prototype.address = function() {
    if (!this._listening) return null;
    return { address: '0.0.0.0', family: 'IPv4', port: this._port };
  };
  Server.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };

  module.exports.Socket = Socket;
  module.exports.Server = Server;
  module.exports.createServer = function(listener) { return new Server(listener); };
  module.exports.createConnection = function(options, connectListener) {
    var s = new Socket(options);
    s.connect(options.port, options.host, connectListener);
    return s;
  };
  module.exports.connect = module.exports.createConnection;
  module.exports.isIP = function(input) {
    if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(input)) return 4;
    if (input.indexOf(':') !== -1) return 6;
    return 0;
  };
  module.exports.isIPv4 = function(input) { return module.exports.isIP(input) === 4; };
  module.exports.isIPv6 = function(input) { return module.exports.isIP(input) === 6; };
})();
`;
}
