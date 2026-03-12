/**
 * FetchProxy — Node tests
 * Tests domain filtering, request serialization, timeout logic, and error types.
 */
import { describe, it, expect } from 'vitest';
import {
  FetchProxy,
  FetchBlockedError,
  FetchTimeoutError,
  FetchSizeError,
  FetchNetworkError,
} from './FetchProxy.js';

describe('FetchProxy — Domain Filtering', () => {
  it('should allow all domains when no allowlist/blocklist', () => {
    const proxy = new FetchProxy();
    expect(proxy.isDomainAllowed('https://example.com/api')).toBe(true);
    expect(proxy.isDomainAllowed('https://api.github.com/repos')).toBe(true);
    expect(proxy.isDomainAllowed('https://evil.example.org')).toBe(true);
  });

  it('should enforce allowlist', () => {
    const proxy = new FetchProxy({
      allowlist: ['example.com', 'api.github.com'],
    });
    expect(proxy.isDomainAllowed('https://example.com/data')).toBe(true);
    expect(proxy.isDomainAllowed('https://sub.example.com/data')).toBe(true);
    expect(proxy.isDomainAllowed('https://api.github.com/repos')).toBe(true);
    expect(proxy.isDomainAllowed('https://evil.org/steal')).toBe(false);
    expect(proxy.isDomainAllowed('https://notexample.com')).toBe(false);
  });

  it('should enforce blocklist', () => {
    const proxy = new FetchProxy({
      blocklist: ['evil.com', 'malware.org'],
    });
    expect(proxy.isDomainAllowed('https://example.com')).toBe(true);
    expect(proxy.isDomainAllowed('https://evil.com')).toBe(false);
    expect(proxy.isDomainAllowed('https://sub.evil.com')).toBe(false);
    expect(proxy.isDomainAllowed('https://malware.org/payload')).toBe(false);
  });

  it('blocklist should take priority over allowlist', () => {
    const proxy = new FetchProxy({
      allowlist: ['example.com'],
      blocklist: ['blocked.example.com'],
    });
    expect(proxy.isDomainAllowed('https://example.com')).toBe(true);
    expect(proxy.isDomainAllowed('https://blocked.example.com')).toBe(false);
  });

  it('should reject invalid URLs', () => {
    const proxy = new FetchProxy();
    expect(proxy.isDomainAllowed('not-a-url')).toBe(false);
    expect(proxy.isDomainAllowed('')).toBe(false);
  });

  it('should match subdomains', () => {
    const proxy = new FetchProxy({
      allowlist: ['github.com'],
    });
    expect(proxy.isDomainAllowed('https://api.github.com/repos')).toBe(true);
    expect(proxy.isDomainAllowed('https://raw.github.com/file')).toBe(true);
    expect(proxy.isDomainAllowed('https://github.com')).toBe(true);
    expect(proxy.isDomainAllowed('https://notgithub.com')).toBe(false);
  });
});

describe('FetchProxy — Request Serialization', () => {
  it('should serialize GET request', () => {
    const proxy = new FetchProxy();
    const req = proxy.serializeRequest('https://example.com/api');
    expect(req.url).toBe('https://example.com/api');
    expect(req.method).toBe('GET');
    expect(req.headers).toEqual({});
    expect(req.body).toBeUndefined();
  });

  it('should serialize POST request with body', () => {
    const proxy = new FetchProxy();
    const req = proxy.serializeRequest('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    });
    expect(req.method).toBe('POST');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.body).toBe('{"key":"value"}');
  });

  it('should handle Headers object', () => {
    const proxy = new FetchProxy();
    const headers = new Headers();
    headers.set('Authorization', 'Bearer token');
    headers.set('Accept', 'application/json');
    const req = proxy.serializeRequest('https://example.com', { headers });
    expect(req.headers['authorization']).toBe('Bearer token');
    expect(req.headers['accept']).toBe('application/json');
  });
});

describe('FetchProxy — Error Types', () => {
  it('FetchBlockedError should have correct code', () => {
    const err = new FetchBlockedError('blocked');
    expect(err.code).toBe('FETCH_BLOCKED');
    expect(err.name).toBe('FetchBlockedError');
    expect(err.message).toBe('blocked');
    expect(err instanceof Error).toBe(true);
  });

  it('FetchTimeoutError should have correct code', () => {
    const err = new FetchTimeoutError('timeout');
    expect(err.code).toBe('FETCH_TIMEOUT');
    expect(err.name).toBe('FetchTimeoutError');
  });

  it('FetchSizeError should have correct code', () => {
    const err = new FetchSizeError('too big');
    expect(err.code).toBe('FETCH_SIZE_EXCEEDED');
    expect(err.name).toBe('FetchSizeError');
  });

  it('FetchNetworkError should have correct code', () => {
    const err = new FetchNetworkError('network fail');
    expect(err.code).toBe('FETCH_ERROR');
    expect(err.name).toBe('FetchNetworkError');
  });
});

describe('FetchProxy — Config', () => {
  it('should apply default config', () => {
    const proxy = new FetchProxy();
    const config = proxy.getConfig();
    expect(config.allowlist).toEqual([]);
    expect(config.blocklist).toEqual([]);
    expect(config.timeout).toBe(30000);
    expect(config.maxResponseSize).toBe(10 * 1024 * 1024);
  });

  it('should apply custom config', () => {
    const proxy = new FetchProxy({
      allowlist: ['example.com'],
      blocklist: ['evil.com'],
      timeout: 5000,
      maxResponseSize: 1024,
    });
    const config = proxy.getConfig();
    expect(config.allowlist).toEqual(['example.com']);
    expect(config.blocklist).toEqual(['evil.com']);
    expect(config.timeout).toBe(5000);
    expect(config.maxResponseSize).toBe(1024);
  });
});
