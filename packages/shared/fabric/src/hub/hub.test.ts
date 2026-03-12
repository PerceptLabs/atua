/**
 * MCPHub tests — Phase 0 verification gates
 *
 * Two test providers:
 * - EchoProvider: echo.say({ message }) → { message }
 * - CounterProvider: counter.increment(), counter.read() → stateful
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MCPHub } from './hub.js';
import { MessageChannelTransport } from '../transports/message-channel.js';
import type { ProviderRegistration, ToolResult } from './types.js';

// ---------------------------------------------------------------------------
// Test provider factories
// ---------------------------------------------------------------------------

function createEchoProvider(): ProviderRegistration {
  const transport = new MessageChannelTransport(
    async (tool: string, args: unknown): Promise<ToolResult> => {
      if (tool === 'echo.say') {
        const { message } = args as { message: string };
        return { content: { message } };
      }
      return { content: `Unknown tool: ${tool}`, isError: true };
    },
  );

  return {
    namespace: 'echo',
    tools: [
      {
        name: 'echo.say',
        description: 'Echo back the message',
        parameters: {
          message: { type: 'string', description: 'Message to echo', required: true },
        },
        returns: 'object',
      },
    ],
    transport,
  };
}

function createCounterProvider(): ProviderRegistration {
  let count = 0;

  const transport = new MessageChannelTransport(
    async (tool: string, _args: unknown): Promise<ToolResult> => {
      if (tool === 'counter.increment') {
        count++;
        return { content: { count } };
      }
      if (tool === 'counter.read') {
        return { content: { count } };
      }
      return { content: `Unknown tool: ${tool}`, isError: true };
    },
  );

  return {
    namespace: 'counter',
    tools: [
      {
        name: 'counter.increment',
        description: 'Increment the counter',
        parameters: {},
        returns: 'object',
      },
      {
        name: 'counter.read',
        description: 'Read the current counter value',
        parameters: {},
        returns: 'object',
      },
    ],
    transport,
  };
}

function createErrorProvider(): ProviderRegistration {
  const transport = new MessageChannelTransport(
    async (_tool: string, _args: unknown): Promise<ToolResult> => {
      throw new Error('Provider internal failure');
    },
  );

  return {
    namespace: 'broken',
    tools: [
      {
        name: 'broken.fail',
        description: 'Always throws',
        parameters: {},
      },
    ],
    transport,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPHub — Phase 0', () => {
  let hub: MCPHub;

  beforeEach(() => {
    hub = new MCPHub();
  });

  describe('Provider Registration', () => {
    it('should register a provider and list its tools', () => {
      hub.registerProvider(createEchoProvider());
      const tools = hub.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('echo.say');
      expect(tools[0].description).toBe('Echo back the message');
    });

    it('should register multiple providers', () => {
      hub.registerProvider(createEchoProvider());
      hub.registerProvider(createCounterProvider());
      const tools = hub.listTools();
      expect(tools).toHaveLength(3); // echo.say + counter.increment + counter.read
    });

    it('should reject duplicate namespace registration', () => {
      hub.registerProvider(createEchoProvider());
      expect(() => hub.registerProvider(createEchoProvider())).toThrow(
        /already registered/,
      );
    });

    it('should unregister a provider and remove its tools', () => {
      hub.registerProvider(createEchoProvider());
      hub.registerProvider(createCounterProvider());

      hub.unregisterProvider('echo');

      const tools = hub.listTools();
      expect(tools).toHaveLength(2); // only counter tools
      expect(tools.every((t) => t.name.startsWith('counter.'))).toBe(true);
    });

    it('should handle unregistering non-existent namespace gracefully', () => {
      expect(() => hub.unregisterProvider('nonexistent')).not.toThrow();
    });
  });

  describe('Tool Listing & Filtering', () => {
    it('should filter tools by namespace', () => {
      hub.registerProvider(createEchoProvider());
      hub.registerProvider(createCounterProvider());

      const echoTools = hub.listTools({ namespace: 'echo' });
      expect(echoTools).toHaveLength(1);
      expect(echoTools[0].name).toBe('echo.say');

      const counterTools = hub.listTools({ namespace: 'counter' });
      expect(counterTools).toHaveLength(2);
    });

    it('should filter tools by name substring', () => {
      hub.registerProvider(createCounterProvider());

      const readTools = hub.listTools({ name: 'read' });
      expect(readTools).toHaveLength(1);
      expect(readTools[0].name).toBe('counter.read');
    });
  });

  describe('Tool Calling', () => {
    it('should call echo.say and return the message', async () => {
      hub.registerProvider(createEchoProvider());

      const result = await hub.callTool('echo.say', { message: 'hello' });
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual({ message: 'hello' });
    });

    it('should maintain state across calls (counter)', async () => {
      hub.registerProvider(createCounterProvider());

      await hub.callTool('counter.increment', {});
      await hub.callTool('counter.increment', {});
      await hub.callTool('counter.increment', {});

      const result = await hub.callTool('counter.read', {});
      expect(result.content).toEqual({ count: 3 });
    });

    it('should return error for tool without dot in name', async () => {
      const result = await hub.callTool('nodot', {});
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/Invalid tool name/);
      expect(result.content).toMatch(/must be/);
    });

    it('should return error for unregistered tool', async () => {
      const result = await hub.callTool('nonexistent.tool', {});
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/not found/);
    });

    it('should return error after provider is unregistered', async () => {
      hub.registerProvider(createEchoProvider());

      // Works before unregister
      const before = await hub.callTool('echo.say', { message: 'hi' });
      expect(before.isError).toBeUndefined();

      hub.unregisterProvider('echo');

      // Fails after unregister
      const after = await hub.callTool('echo.say', { message: 'hi' });
      expect(after.isError).toBe(true);
      expect(after.content).toMatch(/not found/);
    });

    it('should catch provider errors and return as ToolResult', async () => {
      hub.registerProvider(createErrorProvider());

      const result = await hub.callTool('broken.fail', {});
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/Provider internal failure/);
    });

    it('should pass call context to transaction log', async () => {
      hub.registerProvider(createEchoProvider());

      await hub.callTool('echo.say', { message: 'ctx' }, {
        caller: 'atua.build',
        requestId: 'req-123',
      });

      const log = hub.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].caller).toBe('atua.build');
    });
  });

  describe('Transaction Log', () => {
    it('should log every tool call with timing', async () => {
      hub.registerProvider(createEchoProvider());

      await hub.callTool('echo.say', { message: 'logged' }, { caller: 'test' });

      const log = hub.getLog();
      expect(log).toHaveLength(1);

      const entry = log[0];
      expect(entry.tool).toBe('echo.say');
      expect(entry.caller).toBe('test');
      expect(entry.provider).toBe('echo');
      expect(entry.args).toEqual({ message: 'logged' });
      expect(entry.result).toEqual({ message: 'logged' });
      expect(entry.error).toBeUndefined();
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry.timestamp).toBeGreaterThan(0);
      expect(entry.id).toMatch(/^tx_/);
      expect(entry.transport).toBe('message-channel');
    });

    it('should log errors in transaction log', async () => {
      hub.registerProvider(createErrorProvider());

      await hub.callTool('broken.fail', {}, { caller: 'test' });

      const log = hub.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].error).toMatch(/Provider internal failure/);
    });

    it('should log invalid tool name calls', async () => {
      await hub.callTool('nodot', {});

      const log = hub.getLog();
      expect(log).toHaveLength(1);
      expect(log[0].error).toMatch(/Invalid tool name/);
    });

    it('should filter log by provider', async () => {
      hub.registerProvider(createEchoProvider());
      hub.registerProvider(createCounterProvider());

      await hub.callTool('echo.say', { message: 'a' }, { caller: 'test' });
      await hub.callTool('counter.increment', {}, { caller: 'test' });
      await hub.callTool('counter.read', {}, { caller: 'test' });

      const echoLog = hub.getLog({ provider: 'echo' });
      expect(echoLog).toHaveLength(1);

      const counterLog = hub.getLog({ provider: 'counter' });
      expect(counterLog).toHaveLength(2);
    });

    it('should filter log by tool name', async () => {
      hub.registerProvider(createCounterProvider());

      await hub.callTool('counter.increment', {});
      await hub.callTool('counter.increment', {});
      await hub.callTool('counter.read', {});

      const readLog = hub.getLog({ tool: 'counter.read' });
      expect(readLog).toHaveLength(1);
    });

    it('should limit log results', async () => {
      hub.registerProvider(createCounterProvider());

      for (let i = 0; i < 10; i++) {
        await hub.callTool('counter.increment', {});
      }

      const limited = hub.getLog({ limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('Provider Health', () => {
    it('should report health for registered providers', () => {
      hub.registerProvider(createEchoProvider());
      hub.registerProvider(createCounterProvider());

      const health = hub.getProviderHealth();
      expect(health['echo']).toEqual({
        namespace: 'echo',
        status: 'active',
        toolCount: 1,
      });
      expect(health['counter']).toEqual({
        namespace: 'counter',
        status: 'active',
        toolCount: 2,
      });
    });

    it('should not include unregistered providers', () => {
      hub.registerProvider(createEchoProvider());
      hub.unregisterProvider('echo');

      const health = hub.getProviderHealth();
      expect(health['echo']).toBeUndefined();
    });
  });

  describe('Circular Buffer Behavior', () => {
    it('should evict oldest entries when capacity exceeded', async () => {
      const smallHub = new MCPHub({ logCapacity: 3 });
      smallHub.registerProvider(createCounterProvider());

      // Fill beyond capacity
      await smallHub.callTool('counter.increment', {}, { caller: 'call-1' });
      await smallHub.callTool('counter.increment', {}, { caller: 'call-2' });
      await smallHub.callTool('counter.increment', {}, { caller: 'call-3' });
      await smallHub.callTool('counter.increment', {}, { caller: 'call-4' });
      await smallHub.callTool('counter.increment', {}, { caller: 'call-5' });

      const log = smallHub.getLog();
      expect(log).toHaveLength(3);
      // Oldest (call-1, call-2) should be evicted
      expect(log[0].caller).toBe('call-3');
      expect(log[1].caller).toBe('call-4');
      expect(log[2].caller).toBe('call-5');
    });
  });
});
