/**
 * atua.preview MCP Provider tests (browser-only)
 *
 * Uses a mock PreviewController to test tool registration and error paths.
 * Full DOM inspection tests require a real browser runner with iframe.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaPreviewProvider, type PreviewController } from './atua-preview-provider.js';

function createMockController(): PreviewController {
  let active = false;
  return {
    async start(entryPoint: string) {
      active = true;
      return { url: `http://localhost:3000${entryPoint}` };
    },
    stop() {
      active = false;
    },
    isActive() {
      return active;
    },
    getDocument() {
      return null; // No real DOM in test
    },
    getConsoleEntries(since?: number) {
      return [
        { level: 'log', args: ['hello'], timestamp: Date.now() },
      ];
    },
    getErrors(since?: number) {
      return [];
    },
  };
}

describe('atua.preview Provider', () => {
  let hub: MCPHub;
  let controller: PreviewController;

  beforeEach(() => {
    hub = new MCPHub();
    controller = createMockController();
    hub.registerProvider(createAtuaPreviewProvider(controller));
  });

  describe('tool registration', () => {
    it('should register all 6 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.preview' });
      expect(tools).toHaveLength(6);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.preview.start');
      expect(names).toContain('atua.preview.stop');
      expect(names).toContain('atua.preview.dom.query');
      expect(names).toContain('atua.preview.dom.queryAll');
      expect(names).toContain('atua.preview.console');
      expect(names).toContain('atua.preview.errors');
    });
  });

  describe('start', () => {
    it('should start preview and return url', async () => {
      const result = await hub.callTool('atua.preview.start', {
        entryPoint: '/index.html',
      });
      expect(result.isError).toBeUndefined();
      const content = result.content as any;
      expect(content.url).toBe('http://localhost:3000/index.html');
      expect(content.active).toBe(true);
    });
  });

  describe('stop', () => {
    it('should return error when no active preview', async () => {
      const result = await hub.callTool('atua.preview.stop', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('No active preview');
    });

    it('should stop after start', async () => {
      await hub.callTool('atua.preview.start', {});
      const result = await hub.callTool('atua.preview.stop', {});
      expect(result.isError).toBeUndefined();
      expect((result.content as any).active).toBe(false);
    });
  });

  describe('dom.query', () => {
    it('should return error when no active preview', async () => {
      const result = await hub.callTool('atua.preview.dom.query', {
        selector: 'body',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('No active preview');
    });
  });

  describe('console', () => {
    it('should return console entries', async () => {
      const result = await hub.callTool('atua.preview.console', {});
      expect(result.isError).toBeUndefined();
      const entries = result.content as any[];
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('log');
    });
  });

  describe('errors', () => {
    it('should return empty errors list', async () => {
      const result = await hub.callTool('atua.preview.errors', {});
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([]);
    });
  });

  describe('transaction logging', () => {
    it('should log preview calls', async () => {
      await hub.callTool('atua.preview.start', {}, { caller: 'test' });
      await hub.callTool('atua.preview.console', {}, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.preview' });
      expect(log).toHaveLength(2);
      expect(log[0].tool).toBe('atua.preview.start');
      expect(log[1].tool).toBe('atua.preview.console');
    });
  });
});
