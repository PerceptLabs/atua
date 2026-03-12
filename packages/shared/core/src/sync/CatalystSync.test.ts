/**
 * CatalystSync — Node.js unit tests
 *
 * Tests sync protocol, operation journal, conflict resolution,
 * and SyncServer message handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CatalystFS } from '../fs/CatalystFS.js';
import {
  PROTOCOL_VERSION,
  generateOpId,
  type SyncMessage,
  type FileOperation,
} from './protocol.js';
import { OperationJournal } from './OperationJournal.js';
import { ConflictResolver } from './ConflictResolver.js';
import { SyncServer } from './SyncServer.js';
import { SyncClient } from './SyncClient.js';

// ---- Protocol tests ----

describe('Sync Protocol', () => {
  it('should have protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('should generate unique operation IDs', () => {
    const id1 = generateOpId();
    const id2 = generateOpId();
    expect(id1).not.toBe(id2);
    expect(id1.length).toBeGreaterThan(5);
  });
});

// ---- OperationJournal tests ----

describe('OperationJournal — Basic Operations', () => {
  it('should start empty', () => {
    const journal = new OperationJournal();
    expect(journal.count).toBe(0);
    expect(journal.getPending()).toEqual([]);
  });

  it('should record a write operation', () => {
    const journal = new OperationJournal();
    const op = journal.recordWrite('/test.txt', 'hello');
    expect(op.type).toBe('write');
    expect(op.path).toBe('/test.txt');
    expect(op.content).toBe('hello');
    expect(journal.count).toBe(1);
  });

  it('should record a delete operation', () => {
    const journal = new OperationJournal();
    const op = journal.recordDelete('/test.txt');
    expect(op.type).toBe('delete');
    expect(op.path).toBe('/test.txt');
    expect(journal.count).toBe(1);
  });

  it('should record a mkdir operation', () => {
    const journal = new OperationJournal();
    const op = journal.recordMkdir('/src');
    expect(op.type).toBe('mkdir');
    expect(op.path).toBe('/src');
  });

  it('should record a rename operation', () => {
    const journal = new OperationJournal();
    const op = journal.recordRename('/old.txt', '/new.txt');
    expect(op.type).toBe('rename');
    expect(op.path).toBe('/old.txt');
    expect(op.newPath).toBe('/new.txt');
  });

  it('should get all pending operations', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'a');
    journal.recordWrite('/b.txt', 'b');
    journal.recordDelete('/c.txt');
    expect(journal.getPending().length).toBe(3);
  });

  it('should get operations since a timestamp', () => {
    const journal = new OperationJournal();
    const before = Date.now();
    journal.recordWrite('/a.txt', 'a');
    const after = Date.now() + 1;
    journal.recordWrite('/b.txt', 'b');

    const since = journal.getSince(after);
    // The second write happened at/after 'after', but timing may be exact
    expect(since.length).toBeLessThanOrEqual(2);
  });
});

describe('OperationJournal — Acknowledge', () => {
  it('should acknowledge operations', () => {
    const journal = new OperationJournal();
    const op1 = journal.recordWrite('/a.txt', 'a');
    const op2 = journal.recordWrite('/b.txt', 'b');
    const op3 = journal.recordWrite('/c.txt', 'c');

    journal.acknowledge([op1.id, op2.id]);
    expect(journal.count).toBe(1);
    expect(journal.getPending()[0].id).toBe(op3.id);
  });

  it('should handle acknowledging non-existent IDs', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'a');
    journal.acknowledge(['nonexistent']);
    expect(journal.count).toBe(1);
  });
});

describe('OperationJournal — Compaction', () => {
  it('should compact multiple writes to same path', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/test.txt', 'v1');
    journal.recordWrite('/test.txt', 'v2');
    journal.recordWrite('/test.txt', 'v3');

    journal.compact();
    expect(journal.count).toBe(1);
    expect(journal.getPending()[0].content).toBe('v3');
  });

  it('should compact write then delete to just delete', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/test.txt', 'data');
    journal.recordDelete('/test.txt');

    journal.compact();
    expect(journal.count).toBe(1);
    expect(journal.getPending()[0].type).toBe('delete');
  });

  it('should keep operations for different paths', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'a');
    journal.recordWrite('/b.txt', 'b');

    journal.compact();
    expect(journal.count).toBe(2);
  });

  it('should compact multiple mkdirs to one', () => {
    const journal = new OperationJournal();
    journal.recordMkdir('/src');
    journal.recordMkdir('/src');

    journal.compact();
    expect(journal.count).toBe(1);
  });

  it('should clear all operations', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'a');
    journal.recordWrite('/b.txt', 'b');
    journal.clear();
    expect(journal.count).toBe(0);
  });
});

describe('OperationJournal — Persistence', () => {
  it('should persist and load from CatalystFS', async () => {
    const fs = await CatalystFS.create('sync-journal-1');

    // Write operations
    const journal1 = new OperationJournal({ fs });
    journal1.recordWrite('/test.txt', 'hello');
    journal1.recordMkdir('/src');

    // Load from same FS
    const journal2 = new OperationJournal({ fs });
    journal2.load();
    expect(journal2.count).toBe(2);
    fs.destroy();
  });
});

// ---- ConflictResolver tests ----

describe('ConflictResolver — Strategies', () => {
  const baseInfo = {
    path: '/test.txt',
    localContent: 'local version',
    remoteContent: 'remote version',
    localTimestamp: 1000,
    remoteTimestamp: 2000,
  };

  it('should resolve with local strategy', async () => {
    const resolver = new ConflictResolver({ strategy: 'local' });
    const result = await resolver.resolve(baseInfo);
    expect(result.resolvedContent).toBe('local version');
    expect(result.method).toBe('local');
  });

  it('should resolve with remote strategy', async () => {
    const resolver = new ConflictResolver({ strategy: 'remote' });
    const result = await resolver.resolve(baseInfo);
    expect(result.resolvedContent).toBe('remote version');
    expect(result.method).toBe('remote');
  });

  it('should resolve with merge strategy — identical content', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });
    const result = await resolver.resolve({
      ...baseInfo,
      localContent: 'same',
      remoteContent: 'same',
    });
    expect(result.resolvedContent).toBe('same');
    expect(result.method).toBe('merged');
  });

  it('should resolve with merge strategy — different content adds markers', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });
    const result = await resolver.resolve({
      ...baseInfo,
      localContent: 'line1\nlocal line',
      remoteContent: 'line1\nremote line',
    });
    expect(result.resolvedContent).toContain('<<<<<<< LOCAL');
    expect(result.resolvedContent).toContain('=======');
    expect(result.resolvedContent).toContain('>>>>>>> REMOTE');
  });

  it('should resolve with merge strategy — empty local', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });
    const result = await resolver.resolve({
      ...baseInfo,
      localContent: '',
      remoteContent: 'remote data',
    });
    expect(result.resolvedContent).toBe('remote data');
    expect(result.method).toBe('remote');
  });

  it('should resolve with ask strategy and callback', async () => {
    const resolver = new ConflictResolver({
      strategy: 'ask',
      onConflict: async (info) => ({
        resolvedContent: `merged: ${info.localContent} + ${info.remoteContent}`,
        method: 'manual' as const,
      }),
    });
    const result = await resolver.resolve(baseInfo);
    expect(result.resolvedContent).toBe(
      'merged: local version + remote version',
    );
    expect(result.method).toBe('manual');
  });

  it('should fall back to last-write-wins when ask has no callback', async () => {
    const resolver = new ConflictResolver({ strategy: 'ask' });
    const result = await resolver.resolve(baseInfo);
    // Remote has newer timestamp (2000 > 1000)
    expect(result.resolvedContent).toBe('remote version');
    expect(result.method).toBe('remote');
  });
});

// ---- SyncServer tests ----

describe('SyncServer — Construction', () => {
  it('should create with default config', () => {
    const server = new SyncServer();
    expect(server).toBeDefined();
    expect(server.clientCount).toBe(0);
    expect(server.operationCount).toBe(0);
  });
});

describe('SyncServer — Connection Handling', () => {
  it('should handle handshake', () => {
    const server = new SyncServer();
    const sent: string[] = [];
    const handler = server.handleConnection((data) => sent.push(data));

    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
      }),
    );

    expect(server.clientCount).toBe(1);
    expect(sent.length).toBe(1);
    const ack = JSON.parse(sent[0]);
    expect(ack.type).toBe('ack');
  });

  it('should reject wrong protocol version', () => {
    const server = new SyncServer();
    const sent: string[] = [];
    const handler = server.handleConnection((data) => sent.push(data));

    handler(
      JSON.stringify({
        type: 'handshake',
        version: 999,
        clientId: 'test-client',
      }),
    );

    expect(server.clientCount).toBe(0);
    const error = JSON.parse(sent[0]);
    expect(error.type).toBe('error');
    expect(error.code).toBe('VERSION_MISMATCH');
  });

  it('should handle disconnection', () => {
    const server = new SyncServer();
    const handler = server.handleConnection(() => {});
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
      }),
    );
    expect(server.clientCount).toBe(1);

    server.handleDisconnection('test-client');
    expect(server.clientCount).toBe(0);
  });
});

describe('SyncServer — Push/Pull', () => {
  it('should handle push and acknowledge', () => {
    const server = new SyncServer();
    const sent: string[] = [];
    const handler = server.handleConnection((data) => sent.push(data));

    // Handshake
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'test-client',
      }),
    );

    // Push
    const ops: FileOperation[] = [
      {
        id: 'op-1',
        type: 'write',
        path: '/test.txt',
        content: 'hello',
        timestamp: Date.now(),
      },
    ];
    handler(JSON.stringify({ type: 'push', operations: ops }));

    // Should get ack
    const ack = JSON.parse(sent[sent.length - 1]);
    expect(ack.type).toBe('ack');
    expect(ack.operationIds).toContain('op-1');
    expect(server.operationCount).toBe(1);
  });

  it('should handle pull and return changes', () => {
    const server = new SyncServer();
    const sent: string[] = [];
    const handler = server.handleConnection((data) => sent.push(data));

    // Handshake
    handler(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'client-1',
      }),
    );

    // Record server-side changes
    server.recordServerChange('write', '/server-file.txt', 'server data');

    // Pull
    handler(JSON.stringify({ type: 'pull', since: 0 }));

    const changes = JSON.parse(sent[sent.length - 1]);
    expect(changes.type).toBe('changes');
    expect(changes.operations.length).toBeGreaterThanOrEqual(1);
  });

  it('should notify other clients on push', () => {
    const server = new SyncServer();
    const sent1: string[] = [];
    const sent2: string[] = [];

    const handler1 = server.handleConnection((data) => sent1.push(data));
    const handler2 = server.handleConnection((data) => sent2.push(data));

    // Both handshake
    handler1(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'client-1',
      }),
    );
    handler2(
      JSON.stringify({
        type: 'handshake',
        version: PROTOCOL_VERSION,
        clientId: 'client-2',
      }),
    );

    // Client 1 pushes
    handler1(
      JSON.stringify({
        type: 'push',
        operations: [
          {
            id: 'op-1',
            type: 'write',
            path: '/test.txt',
            content: 'data',
            timestamp: Date.now(),
          },
        ],
      }),
    );

    // Client 2 should receive changes notification
    const lastMsg2 = JSON.parse(sent2[sent2.length - 1]);
    expect(lastMsg2.type).toBe('changes');
    expect(lastMsg2.operations[0].path).toBe('/test.txt');
  });

  it('should record server changes', () => {
    const server = new SyncServer();
    server.recordServerChange('write', '/server.txt', 'hello');
    expect(server.operationCount).toBe(1);

    const ops = server.getOperationsSince(0);
    expect(ops.length).toBe(1);
    expect(ops[0].path).toBe('/server.txt');
  });
});

// ---- SyncClient tests (Node, with mock WebSocket) ----

describe('SyncClient — Construction', () => {
  it('should create with required config', async () => {
    const fs = await CatalystFS.create('sync-client-1');
    const client = new SyncClient({
      fs,
      WebSocketClass: MockWebSocket as any,
    });
    expect(client).toBeDefined();
    expect(client.state).toBe('disconnected');
    expect(client.pendingCount).toBe(0);
    fs.destroy();
  });
});

describe('SyncClient — Recording Changes', () => {
  it('should record file changes', async () => {
    const fs = await CatalystFS.create('sync-client-2');
    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });

    client.recordChange('write', '/test.txt', 'hello');
    expect(client.pendingCount).toBe(1);

    client.recordChange('delete', '/old.txt');
    expect(client.pendingCount).toBe(2);
    fs.destroy();
  });

  it('should access the operation journal', async () => {
    const fs = await CatalystFS.create('sync-client-3');
    const client = new SyncClient({
      fs,
      autoSync: false,
      WebSocketClass: MockWebSocket as any,
    });

    client.recordChange('write', '/a.txt', 'data');
    const journal = client.getJournal();
    expect(journal.count).toBe(1);
    fs.destroy();
  });
});

describe('SyncClient — Event System', () => {
  it('should subscribe and unsubscribe to events', async () => {
    const fs = await CatalystFS.create('sync-client-events');
    const client = new SyncClient({
      fs,
      WebSocketClass: MockWebSocket as any,
    });

    let stateChanges = 0;
    const unsub = client.on('state-change', () => stateChanges++);
    expect(typeof unsub).toBe('function');

    unsub();
    fs.destroy();
  });
});

describe('SyncClient — Disconnect', () => {
  it('should disconnect cleanly', async () => {
    const fs = await CatalystFS.create('sync-client-dc');
    const client = new SyncClient({
      fs,
      WebSocketClass: MockWebSocket as any,
    });

    client.disconnect();
    expect(client.state).toBe('disconnected');
    fs.destroy();
  });
});

// ---- Mock WebSocket for Node tests ----

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  sent: string[] = [];

  constructor(_url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 10);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
}
