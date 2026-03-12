/**
 * atua.proc MCP Provider tests
 *
 * Tests tool registration and hub routing. Uses ProcessManager with
 * forceInline: true to skip Worker creation. Since inline mode requires
 * AtuaEngine (QuickJS WASM), which needs browser APIs, we test the
 * provider wiring with error-path and list/info tools that don't need
 * a running process.
 *
 * Full exec/spawn tests require browser test runner.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from '../hub/hub.js';
import { createAtuaProcProvider } from './atua-proc-provider.js';
import { ProcessManager } from '../../../../shared/core/src/proc/ProcessManager.js';

describe('atua.proc Provider', () => {
  let hub: MCPHub;
  let pm: ProcessManager;

  beforeEach(() => {
    hub = new MCPHub();
    pm = new ProcessManager({ forceInline: true, maxProcesses: 4 });
    hub.registerProvider(createAtuaProcProvider(pm));
  });

  describe('tool registration', () => {
    it('should register all 6 tools', () => {
      const tools = hub.listTools({ namespace: 'atua.proc' });
      expect(tools).toHaveLength(6);
      const names = tools.map((t) => t.name);
      expect(names).toContain('atua.proc.exec');
      expect(names).toContain('atua.proc.spawn');
      expect(names).toContain('atua.proc.kill');
      expect(names).toContain('atua.proc.list');
      expect(names).toContain('atua.proc.wait');
      expect(names).toContain('atua.proc.info');
    });
  });

  describe('list', () => {
    it('should return empty list when no processes', async () => {
      const result = await hub.callTool('atua.proc.list', {});
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([]);
    });
  });

  describe('info', () => {
    it('should return error for non-existent pid', async () => {
      const result = await hub.callTool('atua.proc.info', { pid: 999 });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('999');
      expect(result.content).toContain('not found');
    });
  });

  describe('kill', () => {
    it('should return false for non-existent pid', async () => {
      const result = await hub.callTool('atua.proc.kill', { pid: 999 });
      expect(result.isError).toBeUndefined();
      expect((result.content as any).success).toBe(false);
    });
  });

  describe('wait', () => {
    it('should return error for non-existent pid', async () => {
      const result = await hub.callTool('atua.proc.wait', { pid: 999 });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('999');
      expect(result.content).toContain('not found');
    });
  });

  describe('transaction logging', () => {
    it('should log all proc calls', async () => {
      await hub.callTool('atua.proc.list', {}, { caller: 'test' });
      await hub.callTool('atua.proc.info', { pid: 1 }, { caller: 'test' });

      const log = hub.getLog({ provider: 'atua.proc' });
      expect(log).toHaveLength(2);
      expect(log[0].tool).toBe('atua.proc.list');
      expect(log[1].tool).toBe('atua.proc.info');
      expect(log[0].transport).toBe('message-channel');
    });
  });
});
