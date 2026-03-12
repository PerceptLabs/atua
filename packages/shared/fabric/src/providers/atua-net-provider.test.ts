/**
 * atua.net MCP Provider tests
 *
 * Tests tool registration and hub routing.
 * Uses FetchProxy with a restrictive allowlist to test blocked/allowed paths.
 * fetch() tests that hit the network use a blocked URL to verify error handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaNetProvider } from './atua-net-provider.js';
import { FetchProxy } from '../../../../shared/core/src/net/FetchProxy.js';

describe('atua.net Provider', () => {
  let hub: MCPHub;
  let proxy: FetchProxy;

  beforeEach(() => {
    hub = new MCPHub();
    proxy = new FetchProxy({
      allowlist: ['example.com'],
      blocklist: ['blocked.com'],
      timeout: 5000,
    });
    hub.registerProvider(createAtuaNetProvider(proxy));
  });

  describe('tool registration', () => {
    it('should register all 3 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.net' });
      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.net.fetch');
      expect(names).toContain('atua.net.config');
      expect(names).toContain('atua.net.allowed');
    });
  });

  describe('allowed', () => {
    it('should return true for allowed domain', async () => {
      const result = await hub.callTool('atua.net.allowed', {
        url: 'https://example.com/api',
      });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).allowed).toBe(true);
    });

    it('should return false for blocked domain', async () => {
      const result = await hub.callTool('atua.net.allowed', {
        url: 'https://blocked.com/api',
      });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).allowed).toBe(false);
    });
  });

  describe('config', () => {
    it('should return proxy configuration', async () => {
      const result = await hub.callTool('atua.net.config', {});
      expect(result.isError).toBeUndefined();
      const config = result.content as any;
      expect(config.allowlist).toContain('example.com');
      expect(config.blocklist).toContain('blocked.com');
      expect(config.timeout).toBe(5000);
    });
  });

  describe('fetch error handling', () => {
    it('should return error for blocked URL', async () => {
      const result = await hub.callTool('atua.net.fetch', {
        url: 'https://blocked.com/test',
      });
      expect(result.isError).toBe(true);
      expect(typeof result.content).toBe('string');
    });
  });

  describe('transaction logging', () => {
    it('should log all net calls', async () => {
      await hub.callTool('atua.net.allowed', { url: 'https://example.com' }, { caller: 'test' });
      await hub.callTool('atua.net.config', {}, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.net' });
      expect(log).toHaveLength(2);
      expect(log[0].tool).toBe('atua.net.allowed');
      expect(log[1].tool).toBe('atua.net.config');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
