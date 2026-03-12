/**
 * Journal Compaction Correctness — Node tests
 *
 * Phase 13e: Tests the OperationJournal's compaction algorithm.
 *
 * Compaction rules:
 * Rule 1: write → write → write ⟹ final write only
 * Rule 2: write → delete ⟹ delete only (file existed before)
 * Rule 2b: create → write → delete ⟹ nothing (file didn't exist before)
 * Rule 3: rename A→B → rename B→C ⟹ rename A→C
 * Rule 4: write A → rename A→B ⟹ delete A + write B
 * Rule 5: mkdir → rmdir ⟹ nothing (dir didn't exist before)
 *
 * Pure logic, no browser APIs, no WASM. Should run in <1s.
 */
import { describe, it, expect } from 'vitest';
import { OperationJournal } from './OperationJournal.js';
import { ConflictResolver } from './ConflictResolver.js';

// =========================================================================
// Rule 1: write → write → write ⟹ final write only
// =========================================================================

describe('Journal Compaction — Rule 1: write → write → write', () => {
  it('should compact multiple writes to final write only', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'v1');
    journal.recordWrite('/a.txt', 'v2');
    journal.recordWrite('/a.txt', 'v3');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('write');
    expect(ops[0].path).toBe('/a.txt');
    expect(ops[0].content).toBe('v3');
  });

  it('should preserve writes to different paths', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'a-content');
    journal.recordWrite('/b.txt', 'b-content');
    journal.recordWrite('/a.txt', 'a-v2');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(2);
    const aOp = ops.find((o) => o.path === '/a.txt');
    const bOp = ops.find((o) => o.path === '/b.txt');
    expect(aOp?.content).toBe('a-v2');
    expect(bOp?.content).toBe('b-content');
  });

  it('should handle 100 writes to the same path', () => {
    const journal = new OperationJournal();
    for (let i = 0; i < 100; i++) {
      journal.recordWrite('/counter.txt', String(i));
    }

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].content).toBe('99');
  });
});

// =========================================================================
// Rule 2: write → delete ⟹ delete only
// =========================================================================

describe('Journal Compaction — Rule 2: write → delete', () => {
  it('should compact write then delete to delete only', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'data');
    journal.recordDelete('/a.txt');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('delete');
    expect(ops[0].path).toBe('/a.txt');
  });

  it('should compact multiple writes then delete to delete only', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'v1');
    journal.recordWrite('/a.txt', 'v2');
    journal.recordWrite('/a.txt', 'v3');
    journal.recordDelete('/a.txt');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('delete');
  });

  it('delete → write should keep the write (file recreated)', () => {
    const journal = new OperationJournal();
    journal.recordDelete('/a.txt');
    journal.recordWrite('/a.txt', 'recreated');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('write');
    expect(ops[0].content).toBe('recreated');
  });
});

// =========================================================================
// Rule 2b: create → write → delete ⟹ nothing (if file didn't exist before)
// =========================================================================

describe('Journal Compaction — Rule 2b: create → delete ⟹ nothing', () => {
  it('should eliminate create-then-delete when path not in knownPaths', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/new.txt', 'data');
    journal.recordDelete('/new.txt');

    journal.compact(new Set()); // empty knownPaths = file didn't exist before
    const ops = journal.getPending();

    expect(ops).toHaveLength(0);
  });

  it('should keep delete when path IS in knownPaths', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/existing.txt', 'data');
    journal.recordDelete('/existing.txt');

    journal.compact(new Set(['/existing.txt'])); // file existed before
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('delete');
  });

  it('should eliminate create → write → delete chain', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/new.txt', 'v1');
    journal.recordWrite('/new.txt', 'v2');
    journal.recordWrite('/new.txt', 'v3');
    journal.recordDelete('/new.txt');

    journal.compact(new Set());
    const ops = journal.getPending();

    expect(ops).toHaveLength(0);
  });

  it('should handle create → delete → create → delete as nothing', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/tmp.txt', 'first');
    journal.recordDelete('/tmp.txt');
    journal.recordWrite('/tmp.txt', 'second');
    journal.recordDelete('/tmp.txt');

    journal.compact(new Set());
    const ops = journal.getPending();

    expect(ops).toHaveLength(0);
  });
});

// =========================================================================
// Rule 3: rename A→B → rename B→C ⟹ rename A→C
// =========================================================================

describe('Journal Compaction — Rule 3: rename chain', () => {
  it('should collapse rename A→B then B→C to A→C', () => {
    const journal = new OperationJournal();
    journal.recordRename('/a.txt', '/b.txt');
    journal.recordRename('/b.txt', '/c.txt');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('rename');
    expect(ops[0].path).toBe('/a.txt');
    expect(ops[0].newPath).toBe('/c.txt');
  });

  it('should handle triple rename chain', () => {
    const journal = new OperationJournal();
    journal.recordRename('/a.txt', '/b.txt');
    journal.recordRename('/b.txt', '/c.txt');
    journal.recordRename('/c.txt', '/d.txt');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('rename');
    expect(ops[0].path).toBe('/a.txt');
    expect(ops[0].newPath).toBe('/d.txt');
  });

  it('should keep independent renames separate', () => {
    const journal = new OperationJournal();
    journal.recordRename('/a.txt', '/b.txt');
    journal.recordRename('/x.txt', '/y.txt');

    journal.compact();
    const ops = journal.getPending();

    expect(ops).toHaveLength(2);
    const renameA = ops.find((o) => o.path === '/a.txt');
    const renameX = ops.find((o) => o.path === '/x.txt');
    expect(renameA?.newPath).toBe('/b.txt');
    expect(renameX?.newPath).toBe('/y.txt');
  });
});

// =========================================================================
// Rule 4: write A → rename A→B ⟹ delete A + write B
// =========================================================================

describe('Journal Compaction — Rule 4: write + rename', () => {
  it('should convert write+rename to delete+write when path existed', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'data');
    journal.recordRename('/a.txt', '/b.txt');

    journal.compact(new Set(['/a.txt'])); // A existed before
    const ops = journal.getPending();

    expect(ops).toHaveLength(2);
    const deleteOp = ops.find((o) => o.type === 'delete');
    const writeOp = ops.find((o) => o.type === 'write');
    expect(deleteOp?.path).toBe('/a.txt');
    expect(writeOp?.path).toBe('/b.txt');
    expect(writeOp?.content).toBe('data');
  });

  it('should omit delete when source was created in journal', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'data');
    journal.recordRename('/a.txt', '/b.txt');

    journal.compact(new Set()); // A didn't exist before
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('write');
    expect(ops[0].path).toBe('/b.txt');
    expect(ops[0].content).toBe('data');
  });

  it('should use latest content when multiple writes precede rename', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'v1');
    journal.recordWrite('/a.txt', 'v2');
    journal.recordWrite('/a.txt', 'v3');
    journal.recordRename('/a.txt', '/b.txt');

    journal.compact(new Set(['/a.txt']));
    const ops = journal.getPending();

    const writeOp = ops.find((o) => o.type === 'write');
    expect(writeOp?.path).toBe('/b.txt');
    expect(writeOp?.content).toBe('v3');
  });

  it('without knownPaths should emit delete+write', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'data');
    journal.recordRename('/a.txt', '/b.txt');

    journal.compact(); // no knownPaths — safe default
    const ops = journal.getPending();

    expect(ops).toHaveLength(2);
    const deleteOp = ops.find((o) => o.type === 'delete');
    const writeOp = ops.find((o) => o.type === 'write');
    expect(deleteOp?.path).toBe('/a.txt');
    expect(writeOp?.path).toBe('/b.txt');
    expect(writeOp?.content).toBe('data');
  });
});

// =========================================================================
// Rule 5: mkdir → rmdir ⟹ nothing (if dir didn't exist before)
// =========================================================================

describe('Journal Compaction — Rule 5: mkdir → rmdir', () => {
  it('should eliminate mkdir+delete when dir not in knownPaths', () => {
    const journal = new OperationJournal();
    journal.recordMkdir('/tmp/work');
    journal.recordDelete('/tmp/work');

    journal.compact(new Set());
    const ops = journal.getPending();

    expect(ops).toHaveLength(0);
  });

  it('should keep delete when dir existed before', () => {
    const journal = new OperationJournal();
    journal.recordMkdir('/tmp/work');
    journal.recordDelete('/tmp/work');

    journal.compact(new Set(['/tmp/work']));
    const ops = journal.getPending();

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('delete');
  });
});

// =========================================================================
// Replay Idempotency
// =========================================================================

describe('Journal Compaction — Replay Idempotency', () => {
  it('compacting twice should produce same result as compacting once', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'v1');
    journal.recordWrite('/a.txt', 'v2');
    journal.recordWrite('/b.txt', 'data');
    journal.recordDelete('/c.txt');
    journal.recordRename('/d.txt', '/e.txt');

    journal.compact();
    const firstCompaction = journal.getPending().map((op) => ({
      type: op.type,
      path: op.path,
      content: op.content,
      newPath: op.newPath,
    }));

    journal.compact();
    const secondCompaction = journal.getPending().map((op) => ({
      type: op.type,
      path: op.path,
      content: op.content,
      newPath: op.newPath,
    }));

    expect(secondCompaction).toEqual(firstCompaction);
  });

  it('replaying same write should be idempotent', () => {
    const journal = new OperationJournal();
    journal.recordWrite('/a.txt', 'hello');

    journal.compact();
    const ops1 = journal.getPending();
    expect(ops1).toHaveLength(1);
    expect(ops1[0].content).toBe('hello');

    // "Replay" — record the same write again
    journal.recordWrite('/a.txt', 'hello');
    journal.compact();
    const ops2 = journal.getPending();

    // Should still be a single write with same content
    expect(ops2).toHaveLength(1);
    expect(ops2[0].content).toBe('hello');
  });

  it('compacted journal should produce same filesystem state when applied', () => {
    // Create two journals with the same operations
    const journal1 = new OperationJournal();
    const journal2 = new OperationJournal();

    // Same sequence of operations
    journal1.recordWrite('/a.txt', 'v1');
    journal2.recordWrite('/a.txt', 'v1');
    journal1.recordWrite('/a.txt', 'v2');
    journal2.recordWrite('/a.txt', 'v2');
    journal1.recordWrite('/b.txt', 'data');
    journal2.recordWrite('/b.txt', 'data');
    journal1.recordDelete('/b.txt');
    journal2.recordDelete('/b.txt');
    journal1.recordMkdir('/dir');
    journal2.recordMkdir('/dir');

    // Compact only journal1
    journal1.compact();

    // Apply pending1 to a simulated state
    const state1 = new Map<string, string | 'dir' | 'deleted'>();
    for (const op of journal1.getPending()) {
      if (op.type === 'write') state1.set(op.path, op.content!);
      else if (op.type === 'delete') state1.set(op.path, 'deleted');
      else if (op.type === 'mkdir') state1.set(op.path, 'dir');
    }

    // Apply journal2's full log to a simulated state
    const state2 = new Map<string, string | 'dir' | 'deleted'>();
    for (const op of journal2.getPending()) {
      if (op.type === 'write') state2.set(op.path, op.content!);
      else if (op.type === 'delete') state2.set(op.path, 'deleted');
      else if (op.type === 'mkdir') state2.set(op.path, 'dir');
    }

    expect(state1).toEqual(state2);
  });
});

// =========================================================================
// Concurrent Edit Ordering
// =========================================================================

describe('Journal Compaction — Concurrent Edit Ordering', () => {
  it('ConflictResolver with local strategy should prefer local', async () => {
    const resolver = new ConflictResolver({ strategy: 'local' });

    const result = await resolver.resolve({
      path: '/a.txt',
      localContent: 'client version',
      remoteContent: 'server version',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });

    expect(result.resolvedContent).toBe('client version');
    expect(result.method).toBe('local');
  });

  it('ConflictResolver with remote strategy should prefer remote', async () => {
    const resolver = new ConflictResolver({ strategy: 'remote' });

    const result = await resolver.resolve({
      path: '/a.txt',
      localContent: 'client version',
      remoteContent: 'server version',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });

    expect(result.resolvedContent).toBe('server version');
    expect(result.method).toBe('remote');
  });

  it('ConflictResolver with merge strategy should produce conflict markers', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });

    const result = await resolver.resolve({
      path: '/a.txt',
      localContent: 'client line',
      remoteContent: 'server line',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });

    expect(result.resolvedContent).toContain('<<<<<<< LOCAL');
    expect(result.resolvedContent).toContain('=======');
    expect(result.resolvedContent).toContain('>>>>>>> REMOTE');
    expect(result.resolvedContent).toContain('client line');
    expect(result.resolvedContent).toContain('server line');
    expect(result.method).toBe('merged');
  });

  it('ConflictResolver with ask strategy should invoke callback', async () => {
    const resolver = new ConflictResolver({
      strategy: 'ask',
      onConflict: async (info) => ({
        resolvedContent: `merged: ${info.localContent} + ${info.remoteContent}`,
        method: 'manual' as const,
      }),
    });

    const result = await resolver.resolve({
      path: '/a.txt',
      localContent: 'local',
      remoteContent: 'remote',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });

    expect(result.resolvedContent).toBe('merged: local + remote');
    expect(result.method).toBe('manual');
  });

  it('both sides should converge after conflict resolution', async () => {
    // Simulate: client and server both edit the same file
    const clientJournal = new OperationJournal();
    clientJournal.recordWrite('/a.txt', 'client version');

    const serverJournal = new OperationJournal();
    serverJournal.recordWrite('/a.txt', 'server version');

    // Both compact
    clientJournal.compact();
    serverJournal.compact();

    // Resolve conflict with 'local' strategy (from client's perspective)
    const resolver = new ConflictResolver({ strategy: 'local' });

    const clientOps = clientJournal.getPending();
    const serverOps = serverJournal.getPending();

    // Find conflicting paths
    const clientPaths = new Set(clientOps.map((op) => op.path));
    const conflicts: string[] = [];
    for (const serverOp of serverOps) {
      if (clientPaths.has(serverOp.path)) {
        conflicts.push(serverOp.path);
      }
    }
    expect(conflicts).toContain('/a.txt');

    // Resolve
    const clientWrite = clientOps.find((op) => op.path === '/a.txt')!;
    const serverWrite = serverOps.find((op) => op.path === '/a.txt')!;

    const resolution = await resolver.resolve({
      path: '/a.txt',
      localContent: clientWrite.content!,
      remoteContent: serverWrite.content!,
      localTimestamp: clientWrite.timestamp,
      remoteTimestamp: serverWrite.timestamp,
    });

    // Both sides should converge to the resolved content
    expect(resolution.resolvedContent).toBe('client version');
    expect(typeof resolution.resolvedContent).toBe('string');
  });

  it('merge strategy should handle identical content as no conflict', async () => {
    const resolver = new ConflictResolver({ strategy: 'merge' });

    const result = await resolver.resolve({
      path: '/a.txt',
      localContent: 'same content',
      remoteContent: 'same content',
      localTimestamp: 1000,
      remoteTimestamp: 2000,
    });

    expect(result.resolvedContent).toBe('same content');
    expect(result.method).toBe('merged');
  });
});
