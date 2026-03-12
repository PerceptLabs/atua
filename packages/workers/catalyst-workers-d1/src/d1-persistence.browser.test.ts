/**
 * CatalystD1 — Persistence browser tests
 *
 * Tests that data persists across destroy/recreate cycles.
 * Uses real wa-sqlite with IDBBatchAtomicVFS + IndexedDB.
 */
import { describe, it, expect } from 'vitest';
import { CatalystD1 } from './d1.js';

// Use a shared DB name for persistence tests
let persistCounter = 0;

describe('CatalystD1 — Persistence', () => {
  it('write → destroy → recreate → read → data intact', async () => {
    const dbName = `persist-test-${Date.now()}-${persistCounter++}`;

    // Phase 1: Create and write data
    const d1a = new CatalystD1(dbName);
    await d1a.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)');
    await d1a.prepare('INSERT INTO notes (content) VALUES (?)').bind('Hello from first session').run();
    await d1a.prepare('INSERT INTO notes (content) VALUES (?)').bind('Second note').run();

    // Verify data exists before destroy
    const before = await d1a.prepare('SELECT * FROM notes ORDER BY id').all();
    expect(before.results).toHaveLength(2);

    // Phase 2: Destroy
    await d1a.destroy();

    // Phase 3: Recreate with same name
    const d1b = new CatalystD1(dbName);

    // Phase 4: Read — data should be intact
    const after = await d1b.prepare('SELECT * FROM notes ORDER BY id').all();
    expect(after.results).toHaveLength(2);
    expect((after.results[0] as any).content).toBe('Hello from first session');
    expect((after.results[1] as any).content).toBe('Second note');

    await d1b.destroy();
  });

  it('multiple tables persist correctly', async () => {
    const dbName = `persist-multi-${Date.now()}-${persistCounter++}`;

    // Phase 1: Create tables and data
    const d1a = new CatalystD1(dbName);
    await d1a.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
    `);
    await d1a.prepare('INSERT INTO users (name) VALUES (?)').bind('Alice').run();
    await d1a.prepare('INSERT INTO posts (user_id, title) VALUES (?, ?)').bind(1, 'First Post').run();
    await d1a.destroy();

    // Phase 2: Reopen and verify
    const d1b = new CatalystD1(dbName);
    const users = await d1b.prepare('SELECT * FROM users').all();
    const posts = await d1b.prepare('SELECT * FROM posts').all();

    expect(users.results).toHaveLength(1);
    expect((users.results[0] as any).name).toBe('Alice');
    expect(posts.results).toHaveLength(1);
    expect((posts.results[0] as any).title).toBe('First Post');

    await d1b.destroy();
  });
});
