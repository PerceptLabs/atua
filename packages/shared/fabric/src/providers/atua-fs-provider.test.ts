/**
 * atua.fs MCP Provider tests
 *
 * Uses real AtuaFS (InMemory) — all tools called through the hub.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaFsProvider } from './atua-fs-provider.js';
import { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';

describe('atua.fs Provider', () => {
  let hub: MCPHub;
  let fs: AtuaFS;

  beforeEach(async () => {
    hub = new MCPHub();
    fs = await AtuaFS.create('test-fabric-fs');
    hub.registerProvider(createAtuaFsProvider(fs));
  });

  describe('write + read round-trip', () => {
    it('should write and read a file through the hub', async () => {
      const writeResult = await hub.callTool('atua.fs.write', {
        path: '/test.txt',
        content: 'hello',
      });
      expect(writeResult.isError).toBeUndefined();
      expect((writeResult.content as any).success).toBe(true);

      const readResult = await hub.callTool('atua.fs.read', { path: '/test.txt' });
      expect(readResult.isError).toBeUndefined();
      expect(readResult.content).toBe('hello');
    });
  });

  describe('directory operations', () => {
    it('should create a directory and list entries', async () => {
      await hub.callTool('atua.fs.mkdir', { path: '/mydir', recursive: true });
      await hub.callTool('atua.fs.write', { path: '/mydir/a.txt', content: 'aaa' });
      await hub.callTool('atua.fs.write', { path: '/mydir/b.txt', content: 'bbb' });

      const result = await hub.callTool('atua.fs.readdir', { path: '/mydir' });
      expect(result.isError).toBeUndefined();
      const entries = result.content as string[];
      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');
    });

    it('should list root directory entries after write', async () => {
      await hub.callTool('atua.fs.write', { path: '/test.txt', content: 'hello' });

      const result = await hub.callTool('atua.fs.readdir', { path: '/' });
      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('test.txt');
    });
  });

  describe('stat', () => {
    it('should return file metadata', async () => {
      await hub.callTool('atua.fs.write', { path: '/test.txt', content: 'hello' });

      const result = await hub.callTool('atua.fs.stat', { path: '/test.txt' });
      expect(result.isError).toBeUndefined();
      const stat = result.content as any;
      expect(stat.size).toBe(5);
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.mtime).toBeGreaterThan(0);
    });

    it('should return directory metadata', async () => {
      await hub.callTool('atua.fs.mkdir', { path: '/mydir' });

      const result = await hub.callTool('atua.fs.stat', { path: '/mydir' });
      expect(result.isError).toBeUndefined();
      const stat = result.content as any;
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await hub.callTool('atua.fs.write', { path: '/exists.txt', content: 'yes' });

      const result = await hub.callTool('atua.fs.exists', { path: '/exists.txt' });
      expect(result.content).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const result = await hub.callTool('atua.fs.exists', { path: '/nope.txt' });
      expect(result.content).toBe(false);
    });
  });

  describe('rename', () => {
    it('should rename a file', async () => {
      await hub.callTool('atua.fs.write', { path: '/old.txt', content: 'data' });
      await hub.callTool('atua.fs.rename', { oldPath: '/old.txt', newPath: '/new.txt' });

      const exists = await hub.callTool('atua.fs.exists', { path: '/old.txt' });
      expect(exists.content).toBe(false);

      const read = await hub.callTool('atua.fs.read', { path: '/new.txt' });
      expect(read.content).toBe('data');
    });
  });

  describe('copy', () => {
    it('should copy a file', async () => {
      await hub.callTool('atua.fs.write', { path: '/src.txt', content: 'copy me' });
      await hub.callTool('atua.fs.copy', { src: '/src.txt', dest: '/dest.txt' });

      const read = await hub.callTool('atua.fs.read', { path: '/dest.txt' });
      expect(read.content).toBe('copy me');
    });
  });

  describe('unlink', () => {
    it('should delete a file', async () => {
      await hub.callTool('atua.fs.write', { path: '/del.txt', content: 'bye' });
      await hub.callTool('atua.fs.unlink', { path: '/del.txt' });

      const exists = await hub.callTool('atua.fs.exists', { path: '/del.txt' });
      expect(exists.content).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should return structured error for non-existent file read', async () => {
      const result = await hub.callTool('atua.fs.read', { path: '/nonexistent.txt' });
      expect(result.isError).toBe(true);
      expect(typeof result.content).toBe('string');
    });

    it('should return structured error for stat on non-existent path', async () => {
      const result = await hub.callTool('atua.fs.stat', { path: '/nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('transaction logging', () => {
    it('should log all tool calls', async () => {
      await hub.callTool('atua.fs.write', { path: '/log.txt', content: 'logged' }, { caller: 'test' });
      await hub.callTool('atua.fs.read', { path: '/log.txt' }, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.fs' });
      expect(log).toHaveLength(2);
      expect(log[0].tool).toBe('atua.fs.write');
      expect(log[1].tool).toBe('atua.fs.read');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
