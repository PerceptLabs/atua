import { describe, it, expect } from 'vitest';
import { CapabilityGate, PermissionError } from './capability-gate.js';

describe('CapabilityGate', () => {
  // ---- Filesystem ----

  describe('fs capability', () => {
    it('fs: "none" blocks all fs calls', () => {
      const gate = new CapabilityGate({ fs: 'none' });
      expect(() => gate.checkToolCall('atua.fs.read', { path: '/project/a.txt' }))
        .toThrow(PermissionError);
    });

    it('scoped fs allows reads within scope', () => {
      const gate = new CapabilityGate({ fs: { scope: '/project', write: false } });
      expect(() => gate.checkToolCall('atua.fs.read', { path: '/project/src/index.ts' }))
        .not.toThrow();
    });

    it('scoped fs blocks reads outside scope', () => {
      const gate = new CapabilityGate({ fs: { scope: '/project', write: false } });
      expect(() => gate.checkToolCall('atua.fs.read', { path: '/secrets/key' }))
        .toThrow(PermissionError);
    });

    it('write: false blocks write operations', () => {
      const gate = new CapabilityGate({ fs: { scope: '/project', write: false } });
      expect(() => gate.checkToolCall('atua.fs.write', { path: '/project/out.txt' }))
        .toThrow(PermissionError);
    });

    it('write: true allows write operations within scope', () => {
      const gate = new CapabilityGate({ fs: { scope: '/project', write: true } });
      expect(() => gate.checkToolCall('atua.fs.write', { path: '/project/out.txt' }))
        .not.toThrow();
    });

    it('undefined fs capability denies access', () => {
      const gate = new CapabilityGate({});
      expect(() => gate.checkToolCall('atua.fs.read', { path: '/anything' }))
        .toThrow(PermissionError);
    });
  });

  // ---- Network ----

  describe('network capability', () => {
    it('network: "none" blocks all network calls', () => {
      const gate = new CapabilityGate({ network: 'none' });
      expect(() => gate.checkToolCall('atua.net.fetch', { url: 'https://example.com' }))
        .toThrow(PermissionError);
    });

    it('domain allow-list permits listed domain', () => {
      const gate = new CapabilityGate({ network: ['api.github.com'] });
      expect(() => gate.checkToolCall('atua.net.fetch', { url: 'https://api.github.com/repos' }))
        .not.toThrow();
    });

    it('domain allow-list blocks unlisted domain', () => {
      const gate = new CapabilityGate({ network: ['api.github.com'] });
      expect(() => gate.checkToolCall('atua.net.fetch', { url: 'https://evil.com/steal' }))
        .toThrow(PermissionError);
    });

    it('undefined network capability denies access', () => {
      const gate = new CapabilityGate({});
      expect(() => gate.checkToolCall('atua.net.fetch', { url: 'https://example.com' }))
        .toThrow(PermissionError);
    });
  });

  // ---- Database ----

  describe('db capability', () => {
    it('db: "none" blocks database calls', () => {
      const gate = new CapabilityGate({ db: 'none' });
      expect(() => gate.checkToolCall('atua.d1.query', {}))
        .toThrow(PermissionError);
    });

    it('db: "catalyst.d1" allows database calls', () => {
      const gate = new CapabilityGate({ db: 'catalyst.d1' });
      expect(() => gate.checkToolCall('atua.d1.query', {}))
        .not.toThrow();
    });

    it('undefined db capability denies access', () => {
      const gate = new CapabilityGate({});
      expect(() => gate.checkToolCall('atua.d1.query', {}))
        .toThrow(PermissionError);
    });
  });

  // ---- Process ----

  describe('proc capability', () => {
    it('proc: "none" blocks all proc calls', () => {
      const gate = new CapabilityGate({ proc: 'none' });
      expect(() => gate.checkToolCall('atua.proc.spawn', {}))
        .toThrow(PermissionError);
    });

    it('proc: "spawn" allows exec and spawn', () => {
      const gate = new CapabilityGate({ proc: 'spawn' });
      expect(() => gate.checkToolCall('atua.proc.exec', {})).not.toThrow();
      expect(() => gate.checkToolCall('atua.proc.spawn', {})).not.toThrow();
    });

    it('proc: "spawn" blocks kill', () => {
      const gate = new CapabilityGate({ proc: 'spawn' });
      expect(() => gate.checkToolCall('atua.proc.kill', {}))
        .toThrow(PermissionError);
    });

    it('proc: "full" allows everything', () => {
      const gate = new CapabilityGate({ proc: 'full' });
      expect(() => gate.checkToolCall('atua.proc.exec', {})).not.toThrow();
      expect(() => gate.checkToolCall('atua.proc.spawn', {})).not.toThrow();
      expect(() => gate.checkToolCall('atua.proc.kill', {})).not.toThrow();
    });
  });

  // ---- Preview ----

  describe('preview capability', () => {
    it('preview: false blocks preview calls', () => {
      const gate = new CapabilityGate({ preview: false });
      expect(() => gate.checkToolCall('atua.preview.dom.query', {}))
        .toThrow(PermissionError);
    });

    it('preview: true allows preview calls', () => {
      const gate = new CapabilityGate({ preview: true });
      expect(() => gate.checkToolCall('atua.preview.dom.query', {}))
        .not.toThrow();
    });
  });

  // ---- Non-gated tools ----

  describe('non-gated tools', () => {
    it('tools outside known namespaces are not gated', () => {
      const gate = new CapabilityGate({ fs: 'none', network: 'none' });
      expect(() => gate.checkToolCall('custom.greet', { name: 'world' }))
        .not.toThrow();
    });
  });

  // ---- PermissionError ----

  describe('PermissionError', () => {
    it('has correct name, capability, and tool properties', () => {
      const gate = new CapabilityGate({ fs: 'none' });
      try {
        gate.checkToolCall('atua.fs.read', {});
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PermissionError);
        const pe = err as PermissionError;
        expect(pe.name).toBe('PermissionError');
        expect(pe.capability).toBe('fs');
        expect(pe.tool).toBe('atua.fs.read');
      }
    });
  });
});
