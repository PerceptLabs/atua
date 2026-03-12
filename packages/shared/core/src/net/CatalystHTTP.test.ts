/**
 * CatalystHTTP Tests — HTTP Server via MessagePort
 */
import { describe, it, expect } from 'vitest';
import { CatalystHTTPServer, createHTTPServer, getHTTPModuleSource } from './CatalystHTTP.js';
import type { SerializedHTTPRequest } from './CatalystHTTP.js';

describe('CatalystHTTPServer', () => {
  it('creates a server with handler', () => {
    const server = createHTTPServer((req, res) => {
      res.end('hello');
    });
    expect(server).toBeInstanceOf(CatalystHTTPServer);
  });

  it('starts listening on a port', async () => {
    const server = createHTTPServer((req, res) => {
      res.end('ok');
    });

    let listenCalled = false;
    server.listen(3000, () => {
      listenCalled = true;
    });

    expect(server.listening).toBe(true);
    const addr = server.address();
    expect(addr).toBeDefined();
    expect(addr!.port).toBe(3000);

    // Wait for callback
    await new Promise((r) => setTimeout(r, 10));
    expect(listenCalled).toBe(true);

    server.close();
  });

  it('handles a GET request', async () => {
    const server = createHTTPServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Hello World');
    });

    const request: SerializedHTTPRequest = {
      id: 'req-1',
      method: 'GET',
      url: '/',
      headers: {},
    };

    const response = await server.handleRequest(request);
    expect(response.status).toBe(200);
    expect(response.body).toBe('Hello World');
    expect(response.headers['content-type']).toBe('text/plain');
  });

  it('handles a POST request with body', async () => {
    const server = createHTTPServer((req, res) => {
      let body = '';
      req.on('data', (chunk: unknown) => {
        body += String(chunk);
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: body }));
      });
    });

    const request: SerializedHTTPRequest = {
      id: 'req-2',
      method: 'POST',
      url: '/api/data',
      headers: { 'content-type': 'application/json' },
      body: '{"name": "test"}',
    };

    const response = await server.handleRequest(request);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: '{"name": "test"}' });
  });

  it('handles routing with req.url', async () => {
    const server = createHTTPServer((req, res) => {
      if (req.url === '/hello') {
        res.end('world');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    const r1 = await server.handleRequest({
      id: '1', method: 'GET', url: '/hello', headers: {},
    });
    expect(r1.status).toBe(200);
    expect(r1.body).toBe('world');

    const r2 = await server.handleRequest({
      id: '2', method: 'GET', url: '/other', headers: {},
    });
    expect(r2.status).toBe(404);
    expect(r2.body).toBe('Not Found');
  });

  it('handles setHeader/getHeader/removeHeader', async () => {
    const server = createHTTPServer((req, res) => {
      res.setHeader('X-Custom', 'value');
      res.setHeader('X-Remove', 'temp');
      res.removeHeader('X-Remove');
      res.end('ok');
    });

    const response = await server.handleRequest({
      id: '1', method: 'GET', url: '/', headers: {},
    });
    expect(response.headers['x-custom']).toBe('value');
    expect(response.headers['x-remove']).toBeUndefined();
  });

  it('uses write() for chunked response', async () => {
    const server = createHTTPServer((req, res) => {
      res.write('chunk1');
      res.write('chunk2');
      res.end('chunk3');
    });

    const response = await server.handleRequest({
      id: '1', method: 'GET', url: '/', headers: {},
    });
    expect(response.body).toBe('chunk1chunk2chunk3');
  });

  it('closes server', () => {
    const server = createHTTPServer((req, res) => res.end());
    server.listen(4000);
    expect(server.listening).toBe(true);

    let closeCalled = false;
    server.close(() => { closeCalled = true; });
    expect(server.listening).toBe(false);
    expect(server.address()).toBeNull();
  });

  it('emits listening event', () => {
    const server = createHTTPServer((req, res) => res.end());
    let heard = false;
    server.on('listening', () => { heard = true; });
    server.listen(5000);
    expect(heard).toBe(true);
    server.close();
  });
});

describe('getHTTPModuleSource', () => {
  it('returns a string of JavaScript', () => {
    const source = getHTTPModuleSource();
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(100);
  });

  it('source code is valid JavaScript', () => {
    const source = getHTTPModuleSource();
    // Should not throw
    expect(() => new Function('module', 'exports', source)).not.toThrow();
  });

  it('exports createServer function', () => {
    const source = getHTTPModuleSource();
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    const fn = new Function('module', 'exports', source);
    fn(mod, mod.exports);
    expect(typeof mod.exports.createServer).toBe('function');
    expect(typeof mod.exports.IncomingMessage).toBe('function');
    expect(typeof mod.exports.ServerResponse).toBe('function');
  });
});
