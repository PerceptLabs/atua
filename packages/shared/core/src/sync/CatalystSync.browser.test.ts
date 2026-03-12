/**
 * CatalystSync — Browser tests
 *
 * Tests sync protocol in real Chromium with CatalystFS integration.
 * Uses mock WebSocket for predictable testing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CatalystFS } from '../fs/CatalystFS.js';
import { SyncClient } from './SyncClient.js';
import { SyncServer } from './SyncServer.js';
import { OperationJournal } from './OperationJournal.js';
import { ConflictResolver } from './ConflictResolver.js';
import { PROTOCOL_VERSION, type FileOperation } from './protocol.js';

// Mock WebSocket that connects client<->server directly
class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  private serverHandler: ((msg: string) => void) | null = null;

  constructor(_url: string) {
    // Connect after a microtask
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    if (this.serverHandler) {
      // Simulate async message delivery
      queueMicrotask(() => this.serverHandler!(data));
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Wire up to a SyncServer for testing */
  wireToServer(server: SyncServer): void {
    this.serverHandler = server.handleConnection((response) => {
      // Server sends response back to client
      queueMicrotask(() => {
        this.onmessage?.({ data: response });
      });
    });
  }
}

describe('SyncClient — Browser Construction', () => {
  it('should create a SyncClient', async () => {
    const fs = await CatalystFS.create('sync-browser-1');
    const client = new SyncClient({
      fs,
      WebSocketClass: MockWebSocket as any,
    });
    expect(client.state).toBe('disconnected');
    expect(client.pendingCount).toBe(0);
    fs.destroy();
  });
});

describe('SyncClient — Connection (Browser)', () => {
  it('should connect via MockWebSocket', async () => {
    const fs = await CatalystFS.create('sync-browser-conn');
    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });

    await client.connect('ws://localhost:8080');
    expect(client.state).toBe('connected');

    client.disconnect();
    expect(client.state).toBe('disconnected');
    fs.destroy();
  });

  it('should track state changes', async () => {
    const fs = await CatalystFS.create('sync-browser-state');
    const states: string[] = [];
    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });

    client.on('state-change', (s: string) => states.push(s));
    await client.connect('ws://localhost:8080');

    expect(states).toContain('connecting');
    expect(states).toContain('connected');

    client.disconnect();
    expect(states).toContain('disconnected');
    fs.destroy();
  });
});

describe('SyncClient — Recording Changes (Browser)', () => {
  it('should buffer changes in journal', async () => {
    const fs = await CatalystFS.create('sync-browser-record');
    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });

    client.recordChange('write', '/src/app.ts', 'const x = 1;');
    client.recordChange('mkdir', '/src/components');
    client.recordChange('delete', '/old-file.ts');
    client.recordChange('rename', '/a.txt', undefined, '/b.txt');

    expect(client.pendingCount).toBe(4);
    fs.destroy();
  });

  it('should persist journal across instances', async () => {
    const fsName = 'sync-browser-persist-' + Date.now();
    const fs = await CatalystFS.create(fsName);

    const client1 = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });
    client1.recordChange('write', '/test.txt', 'hello');
    expect(client1.pendingCount).toBe(1);

    // New client with same FS should load journal
    const client2 = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });
    expect(client2.pendingCount).toBe(1);
    fs.destroy();
  });
});

describe('OperationJournal — Browser', () => {
  it('should compact writes to same path', async () => {
    const fs = await CatalystFS.create('sync-browser-compact');
    const journal = new OperationJournal({ fs });

    journal.recordWrite('/file.txt', 'v1');
    journal.recordWrite('/file.txt', 'v2');
    journal.recordWrite('/file.txt', 'v3');
    expect(journal.count).toBe(3);

    journal.compact();
    expect(journal.count).toBe(1);
    expect(journal.getPending()[0].content).toBe('v3');
    fs.destroy();
  });

  it('should compact write+delete to delete', async () => {
    const fs = await CatalystFS.create('sync-browser-compact2');
    const journal = new OperationJournal({ fs });

    journal.recordWrite('/file.txt', 'data');
    journal.recordDelete('/file.txt');

    journal.compact();
    expect(journal.count).toBe(1);
    expect(journal.getPending()[0].type).toBe('delete');
    fs.destroy();
  });
});

describe('ConflictResolver — Browser', () => {
  it('should resolve with local strategy', async () => {
    const resolver = new ConflictResolver({ strategy: 'local' });
    const result = await resolver.resolve({
      path: '/test.txt',
      localContent: 'my version',
      remoteContent: 'their version',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });
    expect(result.resolvedContent).toBe('my version');
    expect(result.method).toBe('local');
  });

  it('should resolve with remote strategy', async () => {
    const resolver = new ConflictResolver({ strategy: 'remote' });
    const result = await resolver.resolve({
      path: '/test.txt',
      localContent: 'my version',
      remoteContent: 'their version',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });
    expect(result.resolvedContent).toBe('their version');
    expect(result.method).toBe('remote');
  });

  it('should merge with conflict markers', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });
    const result = await resolver.resolve({
      path: '/test.txt',
      localContent: 'line1\nmy change',
      remoteContent: 'line1\ntheir change',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });
    expect(result.resolvedContent).toContain('<<<<<<< LOCAL');
    expect(result.resolvedContent).toContain('>>>>>>> REMOTE');
  });
});

describe('SyncServer — Browser', () => {
  it('should handle full push/ack cycle', () => {
    const server = new SyncServer();
    const responses: string[] = [];
    const handler = server.handleConnection((data) => responses.push(data));

    // Handshake
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'browser-client-1',
      }),
    );

    expect(server.clientCount).toBe(1);

    // Push
    handler(
      JSON.stringify({
        type: 'push',
        operations: [
          {
            id: 'op-1',
            type: 'write' as const,
            path: '/test.txt',
            content: 'hello',
            timestamp: Date.now(),
          },
        ],
      }),
    );

    // Should receive ack
    const ack = JSON.parse(responses[responses.length - 1]);
    expect(ack.type).toBe('ack');
    expect(ack.operationIds).toContain('op-1');
  });

  it('should handle pull cycle', () => {
    const server = new SyncServer();
    const responses: string[] = [];
    const handler = server.handleConnection((data) => responses.push(data));

    // Handshake
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'browser-client-2',
      }),
    );

    // Record server-side change
    server.recordServerChange('write', '/server-file.txt', 'server content');

    // Pull
    handler(JSON.stringify({ type: 'pull', since: 0 }));

    const changes = JSON.parse(responses[responses.length - 1]);
    expect(changes.type).toBe('changes');
    expect(changes.operations.length).toBeGreaterThanOrEqual(1);
  });

  it('should apply operations via callback', async () => {
    const applied: FileOperation[] = [];
    const server = new SyncServer({
      applyOperation: async (op) => {
        applied.push(op);
      },
    });

    const handler = server.handleConnection(() => {});
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'browser-client-3',
      }),
    );

    handler(
      JSON.stringify({
        type: 'push',
        operations: [
          {
            id: 'op-apply',
            type: 'write',
            path: '/applied.txt',
            content: 'data',
            timestamp: Date.now(),
          },
        ],
      }),
    );

    // Wait for async apply
    await new Promise((r) => setTimeout(r, 50));
    expect(applied.length).toBe(1);
    expect(applied[0].path).toBe('/applied.txt');
  });
});

describe('End-to-End Sync (Browser)', () => {
  it('should sync between client and server via mock WebSocket', async () => {
    const fs = await CatalystFS.create('sync-e2e-' + Date.now());
    const server = new SyncServer();

    // Create a mock WS class that auto-wires to the server
    class WiredMockWS extends MockWebSocket {
      constructor(url: string) {
        super(url);
        this.wireToServer(server);
      }
    }

    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: WiredMockWS as any,
    });

    // Connect
    await client.connect('ws://localhost:8080');
    expect(client.state).toBe('connected');

    // Wait for handshake processing
    await new Promise((r) => setTimeout(r, 50));
    expect(server.clientCount).toBe(1);

    // Record and push a change
    client.recordChange('write', '/synced.txt', 'hello from client');
    await client.push();

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));

    // Server should have the operation
    expect(server.operationCount).toBeGreaterThanOrEqual(1);

    client.disconnect();
    fs.destroy();
  });
});
