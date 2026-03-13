import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerManager } from './server-manager.js';
import { MCPHub } from './hub.js';
import type { ServerConfig } from './types.js';

// ---- Mock AtuaFS ----

function createMockFS(files: Record<string, string> = {}) {
  return {
    existsSync: (path: string) => path in files,
    readFileSync: (path: string, _enc?: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
}

// ---- Mock AtuaProcess ----

function createMockProcess() {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};
  const writes: string[] = [];
  let autoRespond = true;

  const proc = {
    pid: 1,
    state: 'running' as string,
    writes,

    write(data: string) {
      writes.push(data);
      // Auto-respond to MCP requests for easy testing
      if (autoRespond) {
        try {
          const msg = JSON.parse(data.trim());
          if (msg.method === 'initialize') {
            proc.pushStdout(JSON.stringify({
              jsonrpc: '2.0', id: msg.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'test', version: '1.0.0' },
              },
            }) + '\n');
          } else if (msg.method === 'tools/list') {
            proc.pushStdout(JSON.stringify({
              jsonrpc: '2.0', id: msg.id,
              result: {
                tools: [{
                  name: 'greet',
                  description: 'Greet someone',
                  inputSchema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                  },
                }],
              },
            }) + '\n');
          } else if (msg.method === 'tools/call') {
            const name = msg.params?.arguments?.name ?? 'world';
            proc.pushStdout(JSON.stringify({
              jsonrpc: '2.0', id: msg.id,
              result: {
                content: [{ type: 'text', text: `Hello, ${name}!` }],
              },
            }) + '\n');
          }
        } catch {
          // Not JSON — ignore
        }
      }
    },

    on(event: string, handler: (...args: any[]) => void) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return proc;
    },

    off(event: string, handler: (...args: any[]) => void) {
      const h = handlers[event];
      if (h) {
        const idx = h.indexOf(handler);
        if (idx >= 0) h.splice(idx, 1);
      }
      return proc;
    },

    once(event: string, handler: (...args: any[]) => void) {
      const wrapped = (...args: any[]) => {
        proc.off(event, wrapped);
        handler(...args);
      };
      return proc.on(event, wrapped);
    },

    kill: vi.fn(() => {
      proc.state = 'killed';
      return true;
    }),

    pushStdout(data: string) {
      for (const h of handlers['stdout'] ?? []) h(data);
    },

    triggerExit(code = 0) {
      proc.state = 'exited';
      for (const h of [...(handlers['exit'] ?? [])]) h(code);
    },

    setAutoRespond(v: boolean) { autoRespond = v; },
  };

  return proc;
}

// ---- Mock ProcessManager ----

function createMockPM(proc?: ReturnType<typeof createMockProcess>) {
  const mockProc = proc ?? createMockProcess();
  return {
    spawnServer: vi.fn(async () => mockProc),
    _mockProcess: mockProc,
  };
}

// ---- Test server code ----

const SERVER_CODE = `
process.stdin.on('data', function() {});
process.stdin.resume();
`;

// ---- Tests ----

describe('ServerManager', () => {
  let hub: MCPHub;
  let mockPM: ReturnType<typeof createMockPM>;
  let mockFS: ReturnType<typeof createMockFS>;
  let manager: ServerManager;

  const testConfig: ServerConfig = {
    name: 'test-server',
    source: 'local:/servers/test.js',
    capabilities: { fs: 'none', network: 'none' },
  };

  beforeEach(() => {
    hub = new MCPHub();
    mockPM = createMockPM();
    mockFS = createMockFS({
      '/servers/test.js': SERVER_CODE,
    });
    manager = new ServerManager({
      hub,
      processManager: mockPM as any,
      fs: mockFS as any,
    });
  });

  describe('install', () => {
    it('installs a local server, discovers tools, and registers on hub', async () => {
      await manager.install(testConfig);

      // Tools should be visible on the hub
      const tools = hub.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-server.greet');

      // Server should be idle (stopped after discovery)
      const status = manager.getStatus('test-server');
      expect(status.state).toBe('idle');
    });

    it('rejects duplicate server names', async () => {
      await manager.install(testConfig);
      await expect(manager.install(testConfig)).rejects.toThrow('already installed');
    });

    it('rejects unsupported source formats', async () => {
      await expect(
        manager.install({ ...testConfig, source: 'git:github.com/foo/bar' }),
      ).rejects.toThrow('Unsupported source');
    });

    it('rejects when local source file not found', async () => {
      await expect(
        manager.install({ ...testConfig, source: 'local:/missing.js' }),
      ).rejects.toThrow('not found');
    });
  });

  describe('start + stop', () => {
    it('start brings server to ready state', async () => {
      await manager.install(testConfig);
      await manager.start('test-server');

      const status = manager.getStatus('test-server');
      expect(status.state).toBe('ready');
      expect(status.uptime).toBeGreaterThanOrEqual(0);
    });

    it('stop brings server to stopped state', async () => {
      await manager.install(testConfig);
      await manager.start('test-server');
      await manager.stop('test-server');

      const status = manager.getStatus('test-server');
      expect(status.state).toBe('stopped');
    });

    it('start on unknown server throws', async () => {
      await expect(manager.start('nope')).rejects.toThrow('not found');
    });
  });

  describe('restart', () => {
    it('restarts a running server', async () => {
      await manager.install(testConfig);
      await manager.start('test-server');
      await manager.restart('test-server');

      const status = manager.getStatus('test-server');
      expect(status.state).toBe('ready');
      // spawnServer called: install-discover + start + restart = 3 times
      expect(mockPM.spawnServer).toHaveBeenCalledTimes(3);
    });
  });

  describe('lazy start', () => {
    it('first tool call triggers server start', async () => {
      await manager.install(testConfig);

      // Server is idle after install
      expect(manager.getStatus('test-server').state).toBe('idle');

      // Call a tool through the hub
      const result = await hub.callTool('test-server.greet', { name: 'lazy' });
      expect(result.content).toBe('Hello, lazy!');

      // Server is now ready
      expect(manager.getStatus('test-server').state).toBe('ready');
    });

    it('concurrent calls coalesce to single start', async () => {
      await manager.install(testConfig);

      // Fire two calls simultaneously
      const [r1, r2] = await Promise.all([
        hub.callTool('test-server.greet', { name: 'one' }),
        hub.callTool('test-server.greet', { name: 'two' }),
      ]);

      expect(r1.isError).toBeUndefined();
      expect(r2.isError).toBeUndefined();

      // spawnServer called: install-discover + one lazy start = 2
      expect(mockPM.spawnServer).toHaveBeenCalledTimes(2);
    });
  });

  describe('server crash', () => {
    it('sets state to error when process exits unexpectedly', async () => {
      await manager.install(testConfig);
      await manager.start('test-server');

      // Simulate crash
      mockPM._mockProcess.triggerExit(1);

      const status = manager.getStatus('test-server');
      expect(status.state).toBe('error');
      expect(status.error).toContain('exited unexpectedly');
    });
  });

  describe('getAllStatus', () => {
    it('returns status for all servers', async () => {
      // Install two servers
      const mockFS2 = createMockFS({
        '/servers/test.js': SERVER_CODE,
        '/servers/other.js': SERVER_CODE,
      });
      const manager2 = new ServerManager({
        hub,
        processManager: mockPM as any,
        fs: mockFS2 as any,
      });

      await manager2.install(testConfig);
      await manager2.install({
        name: 'other-server',
        source: 'local:/servers/other.js',
        capabilities: {},
      });

      const allStatus = manager2.getAllStatus();
      expect(allStatus.size).toBe(2);
      expect(allStatus.get('test-server')?.state).toBe('idle');
      expect(allStatus.get('other-server')?.state).toBe('idle');
    });
  });

  describe('dispose', () => {
    it('stops all servers', async () => {
      await manager.install(testConfig);
      await manager.start('test-server');

      manager.dispose();
      // After dispose, server map is cleared
      expect(() => manager.getStatus('test-server')).toThrow('not found');
    });
  });

  describe('transaction log', () => {
    it('records stdio transport type in transaction log', async () => {
      await manager.install(testConfig);
      await hub.callTool('test-server.greet', { name: 'log' }, { caller: 'test' });

      const log = hub.getLog({ provider: 'test-server', limit: 1 });
      expect(log).toHaveLength(1);
      expect(log[0].transport).toBe('stdio');
    });
  });
});
