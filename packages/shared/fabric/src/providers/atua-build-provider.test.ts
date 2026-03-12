/**
 * atua.build MCP Provider tests
 *
 * Proves cross-provider routing: build.run reads entry point through hub,
 * transaction log shows atua.fs.read with caller === 'atua.build'.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaFsProvider } from './atua-fs-provider.js';
import { createAtuaBuildProvider } from './atua-build-provider.js';
import { AtuaFS } from '../../../../shared/core/src/fs/AtuaFS.js';
import { BuildPipeline } from '../../../../shared/core/src/dev/BuildPipeline.js';

describe('atua.build Provider', () => {
  let hub: MCPHub;
  let fs: AtuaFS;

  beforeEach(async () => {
    hub = new MCPHub();
    fs = await AtuaFS.create('test-fabric-build');

    // Register both providers — build depends on fs
    hub.registerProvider(createAtuaFsProvider(fs));
    const pipeline = new BuildPipeline(fs);
    hub.registerProvider(createAtuaBuildProvider(pipeline, hub));
  });

  describe('build.run', () => {
    it('should build and show cross-provider routing in transaction log', async () => {
      // Write a source file
      fs.mkdirSync('/src', { recursive: true });
      fs.writeFileSync('/src/index.tsx', 'export const x = 42;');

      const result = await hub.callTool(
        'atua.build.run',
        { entryPoint: '/src/index.tsx' },
        { caller: 'test' },
      );
      expect(result.isError).toBeUndefined();

      const content = result.content as any;
      expect(content.outputPath).toBeDefined();
      expect(content.hash).toBeDefined();
      expect(typeof content.duration).toBe('number');

      // CRITICAL: Verify cross-provider routing
      // The transaction log must show an atua.fs.read call from caller atua.build
      const fsReads = hub.getLog({ tool: 'atua.fs.read' });
      const crossProviderCall = fsReads.find((tx) => tx.caller === 'atua.build');
      expect(crossProviderCall).toBeDefined();
      expect(crossProviderCall!.provider).toBe('atua.fs');
      expect(crossProviderCall!.caller).toBe('atua.build');
    });

    it('should return error for missing entry point', async () => {
      const result = await hub.callTool('atua.build.run', {
        entryPoint: '/nonexistent.tsx',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not readable');
    });
  });

  describe('build.status', () => {
    it('should return not-built before any build', async () => {
      const result = await hub.callTool('atua.build.status', {});
      expect(result.isError).toBeUndefined();
      expect((result.content as any).built).toBe(false);
    });

    it('should return build info after a successful build', async () => {
      fs.mkdirSync('/src', { recursive: true });
      fs.writeFileSync('/src/index.tsx', 'export const y = 1;');

      await hub.callTool('atua.build.run', { entryPoint: '/src/index.tsx' });

      const result = await hub.callTool('atua.build.status', {});
      expect(result.isError).toBeUndefined();
      const status = result.content as any;
      expect(status.built).toBe(true);
      expect(status.hash).toBeDefined();
      expect(status.outputPath).toBeDefined();
    });
  });

  describe('build.resolve', () => {
    it('should resolve relative imports', async () => {
      const result = await hub.callTool('atua.build.resolve', {
        specifier: './utils',
        from: '/src/index.tsx',
      });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).resolved).toBe('/src/utils');
    });

    it('should mark bare specifiers as external', async () => {
      const result = await hub.callTool('atua.build.resolve', {
        specifier: 'react',
        from: '/src/index.tsx',
      });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).external).toBe(true);
    });
  });

  describe('transaction logging', () => {
    it('should log build calls with correct provider', async () => {
      fs.mkdirSync('/src', { recursive: true });
      fs.writeFileSync('/src/index.tsx', 'export const z = 0;');

      await hub.callTool('atua.build.run', { entryPoint: '/src/index.tsx' }, { caller: 'test' });

      const buildLog = hub.getLog({ provider: 'atua.build' });
      expect(buildLog.length).toBeGreaterThanOrEqual(1);
      expect(buildLog[0].tool).toBe('atua.build.run');
    });
  });
});
