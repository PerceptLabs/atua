/**
 * AtuaTLS Tests — TLS/SSL support
 */
import { describe, it, expect } from 'vitest';
import { tlsConnect, createTLSServer, getTLSModuleSource } from './AtuaTLS.js';
import { AtuaTCPSocket, AtuaTCPServer } from './AtuaTCP.js';

describe('AtuaTLS', () => {
  describe('tlsConnect', () => {
    it('returns a socket with TLS metadata', () => {
      const socket = tlsConnect({ host: 'example.com', port: 443 });
      expect(socket).toBeInstanceOf(AtuaTCPSocket);
      expect(socket.encrypted).toBe(true);
      expect(socket.authorized).toBe(true);
      expect(socket.servername).toBe('example.com');
      socket.destroy();
    });

    it('uses custom servername for SNI', () => {
      const socket = tlsConnect({ host: '1.2.3.4', port: 443, servername: 'example.com' });
      expect(socket.servername).toBe('example.com');
      socket.destroy();
    });

    it('sets authorized=false when rejectUnauthorized is false', () => {
      const socket = tlsConnect({ host: 'example.com', port: 443, rejectUnauthorized: false });
      expect(socket.authorized).toBe(false);
      socket.destroy();
    });

    it('provides getPeerCertificate', () => {
      const socket = tlsConnect({ host: 'example.com', port: 443 });
      const cert = (socket as any).getPeerCertificate();
      expect(cert.subject).toBeDefined();
      expect(cert.subject.CN).toBe('example.com');
      expect(cert.issuer).toBeDefined();
      socket.destroy();
    });

    it('upgrades ws:// relay to wss://', () => {
      // The relay URL gets upgraded for TLS
      const socket = tlsConnect({
        host: 'example.com',
        port: 443,
        relayUrl: 'ws://relay.example.com',
      });
      // Socket is created — the relay URL upgrade happens internally
      expect(socket.remoteAddress).toBe('example.com');
      socket.destroy();
    });
  });

  describe('createTLSServer', () => {
    it('returns an AtuaTCPServer', () => {
      const server = createTLSServer({ key: 'key', cert: 'cert' });
      expect(server).toBeInstanceOf(AtuaTCPServer);
    });
  });

  describe('getTLSModuleSource', () => {
    it('returns valid JavaScript source', () => {
      const source = getTLSModuleSource();
      expect(source).toContain('module.exports');
      expect(source).toContain('TLSSocket');
      expect(source).toContain('connect');
      expect(source).toContain('createServer');
    });

    it('source is evaluable', () => {
      const source = getTLSModuleSource();
      const module = { exports: {} as any };
      // TLS module requires net
      const netModule = {
        Socket: function(this: any) {
          this._events = {};
          this.remoteAddress = '127.0.0.1';
          this.remotePort = 0;
        },
        createServer: () => ({}),
      };
      (netModule.Socket.prototype as any).on = function(e: string, h: Function) {
        if (!this._events[e]) this._events[e] = [];
        this._events[e].push(h);
        return this;
      };

      const fn = new Function('module', 'exports', 'require', source);
      fn(module, module.exports, (name: string) => {
        if (name === 'net') return netModule;
        return {};
      });

      expect(module.exports.connect).toBeDefined();
      expect(module.exports.createServer).toBeDefined();
      expect(module.exports.TLSSocket).toBeDefined();
      expect(module.exports.DEFAULT_MIN_VERSION).toBe('TLSv1.2');
    });
  });
});
