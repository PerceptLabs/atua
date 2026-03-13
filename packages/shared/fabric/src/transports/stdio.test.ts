import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioTransport } from './stdio.js';

// ---- Mock AtuaProcess ----
// Simulates an AtuaProcess without real Workers.
// Captures write() calls and allows pushing stdout data.

function createMockProcess() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const writes: string[] = [];

  return {
    pid: 1,
    state: 'running' as string,
    writes,

    write(data: string) {
      writes.push(data);
    },

    on(event: string, handler: (...args: any[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return this;
    },

    off(event: string, handler: (...args: any[]) => void) {
      const h = handlers[event];
      if (h) {
        const idx = h.indexOf(handler);
        if (idx >= 0) h.splice(idx, 1);
      }
      return this;
    },

    once(event: string, handler: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        this.off(event, wrapped);
        handler(...args);
      };
      return this.on(event, wrapped);
    },

    kill: vi.fn(),

    // Test helper: push stdout data (simulates Worker output)
    pushStdout(data: string) {
      for (const h of handlers['stdout'] ?? []) h(data);
    },

    // Test helper: simulate process exit
    triggerExit(code = 0) {
      this.state = 'exited';
      for (const h of [...(handlers['exit'] ?? [])]) h(code);
    },
  };
}

type MockProcess = ReturnType<typeof createMockProcess>;

// Helper: respond to the next JSON-RPC request
function respondTo(proc: MockProcess, result: any) {
  const lastWrite = proc.writes[proc.writes.length - 1];
  const req = JSON.parse(lastWrite.trim());
  const response = JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n';
  proc.pushStdout(response);
}

describe('StdioTransport', () => {
  let proc: MockProcess;
  let transport: StdioTransport;

  beforeEach(() => {
    proc = createMockProcess();
    transport = new StdioTransport({
      process: proc as any,
      timeout: 5000,
    });
  });

  describe('initialize', () => {
    it('performs MCP handshake and returns tool definitions', async () => {
      const initPromise = transport.initialize();

      // Wait for initialize request to be written
      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));

      // Respond to initialize
      respondTo(proc, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: '1.0.0' },
      });

      // Wait for tools/list request (after initialized notification)
      await vi.waitFor(() => {
        const toolsReq = proc.writes.find((w) =>
          w.includes('tools/list'),
        );
        expect(toolsReq).toBeDefined();
      });

      // Respond to tools/list
      const toolsReqStr = proc.writes.find((w) => w.includes('tools/list'))!;
      const toolsReq = JSON.parse(toolsReqStr.trim());
      proc.pushStdout(
        JSON.stringify({
          jsonrpc: '2.0',
          id: toolsReq.id,
          result: {
            tools: [
              {
                name: 'greet',
                description: 'Greet someone',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Name to greet' },
                  },
                  required: ['name'],
                },
              },
            ],
          },
        }) + '\n',
      );

      const tools = await initPromise;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('greet');
      expect(tools[0].parameters.name).toEqual({
        type: 'string',
        description: 'Name to greet',
        required: true,
      });
    });
  });

  describe('call', () => {
    it('sends tools/call and returns ToolResult', async () => {
      const callPromise = transport.call('test.greet', { name: 'world' });

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));

      // Verify the request strips namespace
      const req = JSON.parse(proc.writes[proc.writes.length - 1].trim());
      expect(req.method).toBe('tools/call');
      expect(req.params.name).toBe('greet');
      expect(req.params.arguments).toEqual({ name: 'world' });

      // Respond
      proc.pushStdout(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: 'Hello, world!' }],
          },
        }) + '\n',
      );

      const result = await callPromise;
      expect(result.content).toBe('Hello, world!');
      expect(result.isError).toBeUndefined();
    });

    it('returns error on JSON-RPC error response', async () => {
      const callPromise = transport.call('test.unknown', {});

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));
      const req = JSON.parse(proc.writes[proc.writes.length - 1].trim());

      proc.pushStdout(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: 'Unknown tool' },
        }) + '\n',
      );

      const result = await callPromise;
      expect(result.isError).toBe(true);
      expect(result.content).toBe('Unknown tool');
    });
  });

  describe('timeout', () => {
    it('rejects after timeout period', async () => {
      const shortTimeout = new StdioTransport({
        process: proc as any,
        timeout: 50,
      });

      const callPromise = shortTimeout.call('test.slow', {});
      // Don't respond — let it timeout

      await expect(callPromise).resolves.toEqual({
        content: expect.stringContaining('timed out'),
        isError: true,
      });
    });
  });

  describe('malformed JSON', () => {
    it('skips non-JSON stdout lines without crashing', async () => {
      const callPromise = transport.call('test.greet', { name: 'world' });

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));
      const req = JSON.parse(proc.writes[proc.writes.length - 1].trim());

      // Push garbage followed by valid response
      proc.pushStdout('DEBUG: server starting...\n');
      proc.pushStdout(
        JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: 'ok' }] },
        }) + '\n',
      );

      const result = await callPromise;
      expect(result.content).toBe('ok');
    });
  });

  describe('concurrent calls', () => {
    it('routes responses to correct callers by id', async () => {
      const call1 = transport.call('test.a', {});
      const call2 = transport.call('test.b', {});

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(2));

      const req1 = JSON.parse(proc.writes[proc.writes.length - 2].trim());
      const req2 = JSON.parse(proc.writes[proc.writes.length - 1].trim());

      // Respond to req2 first (out of order)
      proc.pushStdout(
        JSON.stringify({ jsonrpc: '2.0', id: req2.id, result: { content: [{ type: 'text', text: 'B' }] } }) + '\n',
      );
      proc.pushStdout(
        JSON.stringify({ jsonrpc: '2.0', id: req1.id, result: { content: [{ type: 'text', text: 'A' }] } }) + '\n',
      );

      const [r1, r2] = await Promise.all([call1, call2]);
      expect(r1.content).toBe('A');
      expect(r2.content).toBe('B');
    });
  });

  describe('process exit', () => {
    it('rejects all pending calls when process exits', async () => {
      const callPromise = transport.call('test.greet', {});

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));

      // Process crashes
      proc.triggerExit(1);

      const result = await callPromise;
      expect(result.isError).toBe(true);
      expect(result.content).toContain('exited');
    });
  });

  describe('dispose', () => {
    it('rejects pending calls and sends shutdown', () => {
      const callPromise = transport.call('test.greet', {});

      transport.dispose();

      return expect(callPromise).resolves.toEqual({
        content: 'Transport disposed',
        isError: true,
      });
    });

    it('returns error on calls after dispose', async () => {
      transport.dispose();
      const result = await transport.call('test.greet', {});
      expect(result.isError).toBe(true);
      expect(result.content).toBe('Transport disposed');
    });
  });

  describe('buffer handling', () => {
    it('handles partial lines across multiple stdout chunks', async () => {
      const callPromise = transport.call('test.greet', { name: 'world' });

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(1));
      const req = JSON.parse(proc.writes[proc.writes.length - 1].trim());

      const fullResponse = JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: 'Hello!' }] },
      }) + '\n';

      // Split the response across two chunks
      const mid = Math.floor(fullResponse.length / 2);
      proc.pushStdout(fullResponse.substring(0, mid));
      proc.pushStdout(fullResponse.substring(mid));

      const result = await callPromise;
      expect(result.content).toBe('Hello!');
    });

    it('handles multiple messages in one stdout chunk', async () => {
      const call1 = transport.call('test.a', {});
      const call2 = transport.call('test.b', {});

      await vi.waitFor(() => expect(proc.writes.length).toBeGreaterThanOrEqual(2));
      const req1 = JSON.parse(proc.writes[proc.writes.length - 2].trim());
      const req2 = JSON.parse(proc.writes[proc.writes.length - 1].trim());

      // Both responses in one chunk
      const combined =
        JSON.stringify({ jsonrpc: '2.0', id: req1.id, result: { content: [{ type: 'text', text: 'A' }] } }) + '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: req2.id, result: { content: [{ type: 'text', text: 'B' }] } }) + '\n';

      proc.pushStdout(combined);

      const [r1, r2] = await Promise.all([call1, call2]);
      expect(r1.content).toBe('A');
      expect(r2.content).toBe('B');
    });
  });
});
