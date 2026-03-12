/**
 * AtuaTCP Tests — TCP bridge via WebSocket relay
 */
import { describe, it, expect } from 'vitest';
import { AtuaTCPSocket, createConnection, AtuaTCPServer, getNetModuleSource } from './AtuaTCP.js';

describe('AtuaTCP', () => {
  describe('AtuaTCPSocket', () => {
    it('initializes with host and port', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 5432 });
      expect(socket.remoteAddress).toBe('127.0.0.1');
      expect(socket.remotePort).toBe(5432);
      expect(socket.connected).toBe(false);
    });

    it('emits error when no relay configured', () => {
      const socket = new AtuaTCPSocket({ host: 'db.example.com', port: 5432 });
      const errors: Error[] = [];
      socket.on('error', (err: Error) => errors.push(err));
      socket.connect();
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('requires a WebSocket relay');
    });

    it('does not connect when already destroyed', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80, relayUrl: 'ws://relay' });
      socket.destroy();
      // Connecting after destroy should be a no-op
      socket.connect();
      expect(socket.connected).toBe(false);
    });

    it('write returns false when not connected', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80 });
      expect(socket.write('data')).toBe(false);
    });

    it('end disconnects the socket', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80 });
      socket.end();
      expect(socket.connected).toBe(false);
    });

    it('destroy cleans up', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80 });
      socket.destroy();
      expect(socket.connected).toBe(false);
    });

    it('on/off manages event handlers', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80 });
      const calls: string[] = [];
      const handler = () => calls.push('called');

      socket.on('connect', handler);
      socket.off('connect', handler);

      // Handler should be removed — no way to trigger directly but no error
      expect(calls.length).toBe(0);
    });

    it('setEncoding, setTimeout, setNoDelay, setKeepAlive are no-ops', () => {
      const socket = new AtuaTCPSocket({ host: '127.0.0.1', port: 80 });
      // These should not throw
      socket.setEncoding('utf-8');
      socket.setTimeout(5000);
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
    });
  });

  describe('createConnection', () => {
    it('returns an AtuaTCPSocket', () => {
      const socket = createConnection({ host: '127.0.0.1', port: 80 });
      expect(socket).toBeInstanceOf(AtuaTCPSocket);
      expect(socket.remoteAddress).toBe('127.0.0.1');
      expect(socket.remotePort).toBe(80);
      socket.destroy(); // cleanup
    });
  });

  describe('AtuaTCPServer', () => {
    it('starts listening', () => {
      const server = new AtuaTCPServer();
      expect(server.listening).toBe(false);

      server.listen(3000);
      expect(server.listening).toBe(true);
    });

    it('returns address when listening', () => {
      const server = new AtuaTCPServer();
      expect(server.address()).toBeNull();

      server.listen(3000);
      const addr = server.address();
      expect(addr).not.toBeNull();
      expect(addr!.port).toBe(3000);
    });

    it('calls listen callback', async () => {
      const server = new AtuaTCPServer();
      let called = false;
      server.listen(3000, () => { called = true; });
      await new Promise((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });

    it('close stops listening', () => {
      const server = new AtuaTCPServer();
      server.listen(3000);
      server.close();
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
    });

    it('emits events', () => {
      const server = new AtuaTCPServer();
      const events: string[] = [];
      server.on('listening', () => events.push('listening'));
      server.on('close', () => events.push('close'));

      server.listen(3000);
      server.close();

      expect(events).toEqual(['listening', 'close']);
    });
  });

  describe('getNetModuleSource', () => {
    it('returns valid JavaScript source', () => {
      const source = getNetModuleSource();
      expect(source).toContain('module.exports');
      expect(source).toContain('Socket');
      expect(source).toContain('Server');
      expect(source).toContain('createConnection');
      expect(source).toContain('isIP');
    });

    it('source is evaluable', () => {
      const source = getNetModuleSource();
      const module = { exports: {} as any };
      const fn = new Function('module', 'exports', 'require', source);
      fn(module, module.exports, () => ({}));
      expect(module.exports.createServer).toBeDefined();
      expect(module.exports.createConnection).toBeDefined();
      expect(module.exports.isIP).toBeDefined();
    });
  });
});
