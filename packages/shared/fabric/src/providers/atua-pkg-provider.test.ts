/**
 * atua.pkg MCP Provider tests
 *
 * Tests tool registration and hub routing. No network calls —
 * tests use PackageManager with InMemory AtuaFS and only exercise
 * tools that don't hit npm/esm.sh (list, resolve, clear).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaPkgProvider } from './atua-pkg-provider.js';
import { PackageManager } from '../../../../shared/core/src/pkg/PackageManager.js';
import { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';

describe('atua.pkg Provider', () => {
  let hub: MCPHub;
  let pm: PackageManager;
  let fs: AtuaFS;

  beforeEach(async () => {
    hub = new MCPHub();
    fs = await AtuaFS.create('test-fabric-pkg');
    pm = new PackageManager({ fs });
    hub.registerProvider(createAtuaPkgProvider(pm));
  });

  describe('tool registration', () => {
    it('should register all 5 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.pkg' });
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.pkg.install');
      expect(names).toContain('atua.pkg.resolve');
      expect(names).toContain('atua.pkg.list');
      expect(names).toContain('atua.pkg.remove');
      expect(names).toContain('atua.pkg.clear');
    });
  });

  describe('list', () => {
    it('should return empty list initially', async () => {
      const result = await hub.callTool('atua.pkg.list', {});
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('should return null for non-installed package', async () => {
      const result = await hub.callTool('atua.pkg.resolve', { name: 'nonexistent' });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).resolved).toBeNull();
    });
  });

  describe('clear', () => {
    it('should succeed on empty package list', async () => {
      const result = await hub.callTool('atua.pkg.clear', {});
      expect(result.isError).toBeUndefined();
      expect((result.content as any).success).toBe(true);
    });
  });

  describe('remove', () => {
    it('should succeed even for non-installed package', async () => {
      const result = await hub.callTool('atua.pkg.remove', { name: 'nonexistent' });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).success).toBe(true);
    });
  });

  describe('transaction logging', () => {
    it('should log all pkg calls', async () => {
      await hub.callTool('atua.pkg.list', {}, { caller: 'test' });
      await hub.callTool('atua.pkg.resolve', { name: 'foo' }, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.pkg' });
      expect(log).toHaveLength(2);
      expect(log[0].tool).toBe('atua.pkg.list');
      expect(log[1].tool).toBe('atua.pkg.resolve');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
