/**
 * AtuaDNS Tests — DNS resolution via DoH
 */
import { describe, it, expect, vi } from 'vitest';
import { AtuaDNS, getDNSModuleSource } from './AtuaDNS.js';

describe('AtuaDNS', () => {
  it('creates with default config', () => {
    const dns = new AtuaDNS();
    expect(dns).toBeDefined();
  });

  it('creates with custom config', () => {
    const dns = new AtuaDNS({
      dohEndpoint: 'https://custom-dns.example.com/dns-query',
      cacheTtl: 30000,
      timeout: 3000,
    });
    expect(dns).toBeDefined();
  });

  it('caches DNS results', async () => {
    const dns = new AtuaDNS();

    // Mock fetch to return a valid DNS response
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        json: async () => ({
          Status: 0,
          Answer: [{ name: 'example.com', type: 1, TTL: 300, data: '93.184.216.34' }],
        }),
      };
    });

    try {
      const r1 = await dns.resolve4('example.com');
      expect(r1).toEqual(['93.184.216.34']);
      expect(fetchCount).toBe(1);

      // Second call should use cache
      const r2 = await dns.resolve4('example.com');
      expect(r2).toEqual(['93.184.216.34']);
      expect(fetchCount).toBe(1); // No additional fetch
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lookup returns address and family', async () => {
    const dns = new AtuaDNS();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ name: 'example.com', type: 1, TTL: 300, data: '93.184.216.34' }],
      }),
    }));

    try {
      const result = await dns.lookup('example.com');
      expect(result.address).toBe('93.184.216.34');
      expect(result.family).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws on DNS failure', async () => {
    const dns = new AtuaDNS({
      dohEndpoint: 'https://bad.invalid/dns-query',
      fallbackEndpoint: 'https://bad2.invalid/dns-query',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      throw new Error('Network error');
    });

    try {
      await expect(dns.lookup('nonexistent.example')).rejects.toThrow('DNS query failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clears cache', async () => {
    const dns = new AtuaDNS();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        Status: 0,
        Answer: [{ name: 'test.com', type: 1, TTL: 300, data: '1.2.3.4' }],
      }),
    }));

    try {
      await dns.resolve4('test.com');
      expect(dns.getCacheSize()).toBe(1);

      dns.clearCache();
      expect(dns.getCacheSize()).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('getDNSModuleSource', () => {
  it('returns valid JavaScript', () => {
    const source = getDNSModuleSource();
    expect(typeof source).toBe('string');
    expect(() => new Function('module', 'exports', source)).not.toThrow();
  });

  it('exports dns functions', () => {
    const source = getDNSModuleSource();
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', source)(mod, mod.exports);
    expect(typeof mod.exports.lookup).toBe('function');
    expect(typeof mod.exports.resolve).toBe('function');
    expect(typeof mod.exports.resolve4).toBe('function');
    expect(typeof mod.exports.resolve6).toBe('function');
    expect(mod.exports.promises).toBeDefined();
  });
});
