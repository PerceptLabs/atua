/**
 * atua.meta MCP Provider tests
 *
 * Tests hub introspection: capabilities (exact tool counts),
 * health, log filtering, and version info.
 *
 * Registers fs (10 tools) + meta (4 tools) = 2 providers, 14 tools total.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaMetaProvider } from './atua-meta-provider.js';
import { createAtuaFsProvider } from './atua-fs-provider.js';
import { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';

describe('atua.meta Provider', () => {
  let hub: MCPHub;
  let fs: AtuaFS;

  beforeEach(async () => {
    hub = new MCPHub();
    fs = await AtuaFS.create('test-fabric-meta');
    hub.registerProvider(createAtuaFsProvider(fs));
    hub.registerProvider(createAtuaMetaProvider(hub));
  });

  describe('tool registration', () => {
    it('should register all 4 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.meta' });
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.meta.capabilities');
      expect(names).toContain('atua.meta.health');
      expect(names).toContain('atua.meta.log');
      expect(names).toContain('atua.meta.version');
    });
  });

  describe('capabilities', () => {
    it('should list exactly 2 providers with correct tool counts', async () => {
      const result = await hub.callTool('atua.meta.capabilities', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.providerCount).toBe(2);
      expect(content.totalTools).toBe(14);
      expect(content.providers['atua.fs']).toBeDefined();
      expect(content.providers['atua.fs'].toolCount).toBe(10);
      expect(content.providers['atua.meta']).toBeDefined();
      expect(content.providers['atua.meta'].toolCount).toBe(4);
    });
  });

  describe('health', () => {
    it('should return per-provider health status', async () => {
      const result = await hub.callTool('atua.meta.health', {});
      expect(result.isError).toBeUndefined();
      const health = result.content as any;
      expect(health['atua.fs']).toBeDefined();
      expect(health['atua.meta']).toBeDefined();
    });
  });

  describe('log', () => {
    it('should return filtered transaction entries', async () => {
      // Generate some log entries
      await hub.callTool('atua.fs.write', { path: '/test.txt', content: 'hello' }, { caller: 'test' });
      await hub.callTool('atua.fs.read', { path: '/test.txt' }, { caller: 'test' });

      const result = await hub.callTool('atua.meta.log', {
        provider: 'atua.fs',
        limit: 10,
      });
      expect(result.isError).toBeUndefined();
      const entries = result.content as any[];
      // At least 2 fs entries (write + read)
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries[0].tool).toBe('atua.fs.write');
      expect(entries[1].tool).toBe('atua.fs.read');
    });

    it('should filter by tool name', async () => {
      await hub.callTool('atua.fs.write', { path: '/a.txt', content: 'a' }, { caller: 'test' });
      await hub.callTool('atua.fs.read', { path: '/a.txt' }, { caller: 'test' });

      const result = await hub.callTool('atua.meta.log', {
        tool: 'atua.fs.read',
      });
      expect(result.isError).toBeUndefined();
      const entries = result.content as any[];
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.every((e: any) => e.tool === 'atua.fs.read')).toBe(true);
    });
  });

  describe('version', () => {
    it('should return runtime info', async () => {
      const result = await hub.callTool('atua.meta.version', {});
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.runtime).toBe('atua');
      expect(content.platform).toBe('browser');
      expect(content.version).toBeDefined();
    });
  });

  describe('transaction logging', () => {
    it('should log meta calls with correct provider', async () => {
      await hub.callTool('atua.meta.version', {}, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.meta' });
      expect(log).toHaveLength(1);
      expect(log[0].tool).toBe('atua.meta.version');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
