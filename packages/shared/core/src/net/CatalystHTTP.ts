/**
 * CatalystHTTP — Node.js http module backed by MessagePort routing
 *
 * User code calls http.createServer(handler) → Catalyst intercepts →
 * Routes served via MessagePort to Service Worker → Service Worker
 * intercepts fetch and returns real HTTP responses.
 *
 * This makes Express, Fastify, Koa, and Hono work in the browser.
 *
 * Architecture:
 * 1. User code creates a server: http.createServer(handler)
 * 2. Handler is registered with CatalystHTTP
 * 3. When .listen(port) is called, server begins accepting requests
 * 4. Requests come in via MessagePort from Service Worker
 * 5. CatalystHTTP creates IncomingMessage/ServerResponse objects
 * 6. Handler processes the request
 * 7. Response is serialized and sent back via MessagePort
 */

import type { FetchProxy } from './FetchProxy.js';

/** Minimal IncomingMessage compatible with Express/Koa/etc */
export interface CatalystIncomingMessage {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion: string;
  socket: { remoteAddress: string; remotePort: number };
  body?: string;
  on(event: string, handler: (...args: unknown[]) => void): void;
  once(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

/** Minimal ServerResponse compatible with Express/Koa/etc */
export interface CatalystServerResponse {
  statusCode: number;
  statusMessage: string;
  headersSent: boolean;
  setHeader(name: string, value: string | string[]): void;
  getHeader(name: string): string | string[] | undefined;
  removeHeader(name: string): void;
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  write(chunk: string | Uint8Array): boolean;
  end(data?: string | Uint8Array): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/** Request handler compatible with Node.js http.createServer() */
export type RequestHandler = (
  req: CatalystIncomingMessage,
  res: CatalystServerResponse,
) => void;

/** Serialized HTTP request from Service Worker */
export interface SerializedHTTPRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Serialized HTTP response back to Service Worker */
export interface SerializedHTTPResponse {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

type EventHandler = (...args: unknown[]) => void;

/**
 * CatalystHTTPServer — handles incoming requests via MessagePort
 */
export class CatalystHTTPServer {
  private _handler: RequestHandler;
  private _port: number | null = null;
  private _listening = false;
  private _handlers = new Map<string, EventHandler[]>();
  private _messagePort: MessagePort | null = null;

  constructor(handler: RequestHandler) {
    this._handler = handler;
  }

  /**
   * Start listening on the given port.
   * In browser mode, this registers with the Service Worker.
   * The callback is invoked once the server is "ready".
   */
  listen(port: number, hostname?: string | (() => void), callback?: () => void): this {
    this._port = port;
    this._listening = true;

    const cb = typeof hostname === 'function' ? hostname : callback;

    // Set up MessagePort if available (browser mode)
    if (typeof MessageChannel !== 'undefined') {
      this._setupMessageChannel();
    }

    this._emit('listening');

    if (cb) {
      // Node.js convention: callback on next tick
      Promise.resolve().then(cb);
    }

    return this;
  }

  /** Process a request that came from the MessagePort or direct call */
  async handleRequest(serialized: SerializedHTTPRequest): Promise<SerializedHTTPResponse> {
    return new Promise<SerializedHTTPResponse>((resolve) => {
      const req = this._createIncomingMessage(serialized);
      const res = this._createServerResponse(serialized.id, resolve);
      this._handler(req, res);
    });
  }

  /** Close the server */
  close(callback?: () => void): this {
    this._listening = false;
    this._port = null;
    if (this._messagePort) {
      this._messagePort.close();
      this._messagePort = null;
    }
    this._emit('close');
    if (callback) Promise.resolve().then(callback);
    return this;
  }

  /** Get the server address */
  address(): { address: string; family: string; port: number } | null {
    if (!this._listening || this._port === null) return null;
    return { address: '127.0.0.1', family: 'IPv4', port: this._port };
  }

  get listening(): boolean {
    return this._listening;
  }

  on(event: string, handler: EventHandler): this {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    const handlers = this._handlers.get(event);
    if (handlers) {
      this._handlers.set(event, handlers.filter((h) => h !== handler));
    }
    return this;
  }

  private _emit(event: string, ...args: unknown[]): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  private _setupMessageChannel(): void {
    // In a real browser environment, we'd create a MessageChannel
    // and send one port to the Service Worker. For now, we create
    // the channel infrastructure and handle requests locally.
    const channel = new MessageChannel();
    this._messagePort = channel.port1;

    channel.port1.onmessage = async (event: MessageEvent) => {
      const request = event.data as SerializedHTTPRequest;
      const response = await this.handleRequest(request);
      channel.port1.postMessage(response);
    };
  }

  private _createIncomingMessage(req: SerializedHTTPRequest): CatalystIncomingMessage {
    const eventHandlers: Record<string, EventHandler[]> = {};
    let bodyConsumed = false;

    const msg: CatalystIncomingMessage = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      httpVersion: '1.1',
      socket: { remoteAddress: '127.0.0.1', remotePort: 0 },
      body: req.body,

      on(event: string, handler: EventHandler) {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);

        // Auto-emit body data and end events
        if (event === 'data' && !bodyConsumed && req.body) {
          bodyConsumed = true;
          Promise.resolve().then(() => {
            handler(req.body);
            const endHandlers = eventHandlers['end'];
            if (endHandlers) endHandlers.forEach((h) => h());
          });
        }
        if (event === 'end' && bodyConsumed) {
          Promise.resolve().then(() => handler());
        }
      },

      once(event: string, handler: EventHandler) {
        const wrapped: EventHandler = (...args) => {
          msg.removeListener(event, wrapped);
          handler(...args);
        };
        msg.on(event, wrapped);
      },

      removeListener(event: string, handler: EventHandler) {
        if (eventHandlers[event]) {
          eventHandlers[event] = eventHandlers[event].filter((h) => h !== handler);
        }
      },
    };

    return msg;
  }

  private _createServerResponse(
    requestId: string,
    resolve: (res: SerializedHTTPResponse) => void,
  ): CatalystServerResponse {
    let statusCode = 200;
    let statusMessage = 'OK';
    let headersSent = false;
    const headers: Record<string, string> = {};
    const bodyChunks: string[] = [];
    const eventHandlers: Record<string, EventHandler[]> = {};

    return {
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      get statusMessage() { return statusMessage; },
      set statusMessage(v) { statusMessage = v; },
      get headersSent() { return headersSent; },

      setHeader(name: string, value: string | string[]) {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      },

      getHeader(name: string) {
        return headers[name.toLowerCase()];
      },

      removeHeader(name: string) {
        delete headers[name.toLowerCase()];
      },

      writeHead(code: number, hdrs?: Record<string, string>) {
        statusCode = code;
        headersSent = true;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            headers[k.toLowerCase()] = v;
          }
        }
      },

      write(chunk: string | Uint8Array): boolean {
        headersSent = true;
        if (typeof chunk === 'string') {
          bodyChunks.push(chunk);
        } else {
          bodyChunks.push(new TextDecoder().decode(chunk));
        }
        return true;
      },

      end(data?: string | Uint8Array) {
        if (data) {
          if (typeof data === 'string') {
            bodyChunks.push(data);
          } else {
            bodyChunks.push(new TextDecoder().decode(data));
          }
        }
        headersSent = true;

        resolve({
          id: requestId,
          status: statusCode,
          statusText: statusMessage,
          headers,
          body: bodyChunks.join(''),
        });

        const finishHandlers = eventHandlers['finish'];
        if (finishHandlers) finishHandlers.forEach((h) => h());
      },

      on(event: string, handler: EventHandler) {
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
      },
    };
  }
}

/**
 * Create an HTTP server — drop-in replacement for http.createServer()
 */
export function createHTTPServer(handler: RequestHandler): CatalystHTTPServer {
  return new CatalystHTTPServer(handler);
}

/**
 * Generate the http module source code for the engine's require() system.
 * This replaces the stub http module with a working implementation.
 */
export function getHTTPModuleSource(): string {
  return `
(function() {
  // CatalystHTTP — Node.js http compatibility layer
  var servers = [];
  var nextServerId = 1;

  function IncomingMessage(opts) {
    this.method = opts.method || 'GET';
    this.url = opts.url || '/';
    this.headers = opts.headers || {};
    this.httpVersion = '1.1';
    this.socket = { remoteAddress: '127.0.0.1', remotePort: 0 };
    this._events = {};
  }
  IncomingMessage.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };
  IncomingMessage.prototype.once = IncomingMessage.prototype.on;
  IncomingMessage.prototype.removeListener = function(event, handler) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(function(h) { return h !== handler; });
    }
    return this;
  };

  function ServerResponse() {
    this.statusCode = 200;
    this.statusMessage = 'OK';
    this.headersSent = false;
    this._headers = {};
    this._body = [];
    this._events = {};
    this._ended = false;
  }
  ServerResponse.prototype.setHeader = function(name, value) {
    this._headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  };
  ServerResponse.prototype.getHeader = function(name) {
    return this._headers[name.toLowerCase()];
  };
  ServerResponse.prototype.removeHeader = function(name) {
    delete this._headers[name.toLowerCase()];
  };
  ServerResponse.prototype.writeHead = function(code, headers) {
    this.statusCode = code;
    this.headersSent = true;
    if (headers) {
      for (var k in headers) {
        this._headers[k.toLowerCase()] = headers[k];
      }
    }
    return this;
  };
  ServerResponse.prototype.write = function(chunk) {
    this.headersSent = true;
    this._body.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  ServerResponse.prototype.end = function(data) {
    if (this._ended) return;
    this._ended = true;
    if (data) this._body.push(typeof data === 'string' ? data : String(data));
    this.headersSent = true;
    var handlers = this._events['finish'];
    if (handlers) handlers.forEach(function(h) { h(); });
  };
  ServerResponse.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };

  function Server(handler) {
    this._id = nextServerId++;
    this._handler = handler;
    this._listening = false;
    this._port = null;
    this._events = {};
    servers.push(this);
  }
  Server.prototype.listen = function(port, hostname, callback) {
    this._port = port;
    this._listening = true;
    var cb = typeof hostname === 'function' ? hostname : callback;
    var self = this;
    var handlers = self._events['listening'];
    if (handlers) handlers.forEach(function(h) { h(); });
    if (cb) Promise.resolve().then(cb);
    return this;
  };
  Server.prototype.close = function(callback) {
    this._listening = false;
    var handlers = this._events['close'];
    if (handlers) handlers.forEach(function(h) { h(); });
    if (callback) Promise.resolve().then(callback);
    return this;
  };
  Server.prototype.address = function() {
    if (!this._listening) return null;
    return { address: '127.0.0.1', family: 'IPv4', port: this._port };
  };
  Server.prototype.on = function(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
    return this;
  };

  module.exports.createServer = function(handler) {
    return new Server(handler);
  };
  module.exports.IncomingMessage = IncomingMessage;
  module.exports.ServerResponse = ServerResponse;
  module.exports.Server = Server;
  module.exports.STATUS_CODES = {
    200: 'OK', 201: 'Created', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  };
  module.exports.METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
  module.exports.request = function() { throw new Error('http.request() not available — use fetch() instead'); };
  module.exports.get = function() { throw new Error('http.get() not available — use fetch() instead'); };
})();
`;
}
