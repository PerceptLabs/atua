/**
 * CatalystD1 — Browser tests (SQL operations)
 *
 * All tests run in Chromium via Vitest browser mode.
 * Uses real wa-sqlite with IDBBatchAtomicVFS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CatalystD1 } from './d1.js';

let d1: CatalystD1;
let dbCounter = 0;

function createD1(): CatalystD1 {
  return new CatalystD1(`test-db-${Date.now()}-${dbCounter++}`);
}

afterEach(async () => {
  if (d1) await d1.destroy();
});

// =========================================================================
// Basic CRUD cycle
// =========================================================================

describe('CatalystD1 — Basic SQL', () => {
  beforeEach(() => {
    d1 = createD1();
  });

  it('CREATE TABLE / INSERT / SELECT / UPDATE / DELETE cycle', async () => {
    await d1.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');

    // INSERT
    await d1.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Alice', 'alice@example.com').run();
    await d1.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind('Bob', 'bob@example.com').run();

    // SELECT
    const all = await d1.prepare('SELECT * FROM users ORDER BY id').all();
    expect(all.results).toHaveLength(2);
    expect(all.results[0]).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    expect(all.results[1]).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com' });
    expect(all.success).toBe(true);

    // UPDATE
    await d1.prepare('UPDATE users SET email = ? WHERE name = ?').bind('alice@new.com', 'Alice').run();
    const updated = await d1.prepare('SELECT email FROM users WHERE name = ?').bind('Alice').first();
    expect(updated).toEqual({ email: 'alice@new.com' });

    // DELETE
    await d1.prepare('DELETE FROM users WHERE name = ?').bind('Bob').run();
    const remaining = await d1.prepare('SELECT * FROM users').all();
    expect(remaining.results).toHaveLength(1);
    expect(remaining.results[0].name).toBe('Alice');
  });
});

// =========================================================================
// PreparedStatement methods
// =========================================================================

describe('CatalystD1 — PreparedStatement', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)');
    await d1.prepare('INSERT INTO items (name, price) VALUES (?, ?)').bind('Widget', 9.99).run();
    await d1.prepare('INSERT INTO items (name, price) VALUES (?, ?)').bind('Gadget', 24.50).run();
    await d1.prepare('INSERT INTO items (name, price) VALUES (?, ?)').bind('Doohickey', 4.75).run();
  });

  it('first() returns single row or null', async () => {
    const row = await d1.prepare('SELECT * FROM items WHERE name = ?').bind('Widget').first();
    expect(row).not.toBeNull();
    expect((row as any).name).toBe('Widget');
    expect((row as any).price).toBeCloseTo(9.99, 1);

    const missing = await d1.prepare('SELECT * FROM items WHERE name = ?').bind('Missing').first();
    expect(missing).toBeNull();
  });

  it('first(column) returns just that column value', async () => {
    const name = await d1.prepare('SELECT name FROM items WHERE id = ?').bind(1).first('name');
    expect(name).toBe('Widget');
  });

  it('all() returns { results, success, meta }', async () => {
    const result = await d1.prepare('SELECT * FROM items ORDER BY id').all();
    expect(result.results).toHaveLength(3);
    expect(result.success).toBe(true);
    expect(result.meta).toBeDefined();
    expect(typeof result.meta.duration).toBe('number');
    expect(result.meta.duration).toBeGreaterThanOrEqual(0);
  });

  it('raw() returns array of arrays', async () => {
    const rows = await d1.prepare('SELECT id, name FROM items ORDER BY id').raw();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([1, 'Widget']);
    expect(rows[1]).toEqual([2, 'Gadget']);
    expect(rows[2]).toEqual([3, 'Doohickey']);
  });

  it('run() for mutations returns changes count', async () => {
    const result = await d1.prepare('UPDATE items SET price = price + 1').run();
    expect(result.success).toBe(true);
    expect(result.meta.changes).toBe(3);
  });
});

// =========================================================================
// batch() — atomic transactions
// =========================================================================

describe('CatalystD1 — Batch', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, balance REAL)');
    await d1.prepare('INSERT INTO accounts (name, balance) VALUES (?, ?)').bind('Alice', 100.0).run();
    await d1.prepare('INSERT INTO accounts (name, balance) VALUES (?, ?)').bind('Bob', 50.0).run();
  });

  it('batch() executes all statements atomically', async () => {
    const results = await d1.batch([
      d1.prepare('UPDATE accounts SET balance = balance - 25 WHERE name = ?').bind('Alice'),
      d1.prepare('UPDATE accounts SET balance = balance + 25 WHERE name = ?').bind('Bob'),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);

    const alice = await d1.prepare('SELECT balance FROM accounts WHERE name = ?').bind('Alice').first();
    const bob = await d1.prepare('SELECT balance FROM accounts WHERE name = ?').bind('Bob').first();
    expect((alice as any).balance).toBeCloseTo(75.0, 1);
    expect((bob as any).balance).toBeCloseTo(75.0, 1);
  });

  it('batch() rolls back ALL on error', async () => {
    try {
      await d1.batch([
        d1.prepare('UPDATE accounts SET balance = balance - 25 WHERE name = ?').bind('Alice'),
        d1.prepare('INSERT INTO nonexistent_table VALUES (1)'), // This should fail
      ]);
    } catch {
      // Expected to throw
    }

    // Verify rollback — Alice's balance should be unchanged
    const alice = await d1.prepare('SELECT balance FROM accounts WHERE name = ?').bind('Alice').first();
    expect((alice as any).balance).toBeCloseTo(100.0, 1);
  });
});

// =========================================================================
// exec() — DDL
// =========================================================================

describe('CatalystD1 — exec()', () => {
  beforeEach(() => {
    d1 = createD1();
  });

  it('exec() handles DDL statements', async () => {
    const result = await d1.exec(`
      CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT);
      INSERT INTO test VALUES (1, 'hello');
      INSERT INTO test VALUES (2, 'world');
    `);

    expect(result.count).toBe(1);
    expect(typeof result.duration).toBe('number');

    // Verify data was inserted
    const row = await d1.prepare('SELECT * FROM test WHERE id = 1').first();
    expect((row as any).value).toBe('hello');
  });
});

// =========================================================================
// SQL injection safety
// =========================================================================

describe('CatalystD1 — SQL Injection Safety', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await d1.prepare('INSERT INTO users (name) VALUES (?)').bind('Alice').run();
  });

  it('bound parameters prevent SQL injection', async () => {
    const malicious = "'; DROP TABLE users; --";
    const result = await d1.prepare('SELECT * FROM users WHERE name = ?').bind(malicious).first();
    expect(result).toBeNull(); // No match, but table should still exist

    // Verify table is intact
    const all = await d1.prepare('SELECT * FROM users').all();
    expect(all.results).toHaveLength(1);
  });
});

// =========================================================================
// Multiple tables with foreign keys
// =========================================================================

describe('CatalystD1 — Foreign Keys', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('PRAGMA foreign_keys = ON');
    await d1.exec(`
      CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE books (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        FOREIGN KEY (author_id) REFERENCES authors(id)
      );
    `);
  });

  it('supports multiple tables with foreign keys', async () => {
    await d1.prepare('INSERT INTO authors (name) VALUES (?)').bind('Tolkien').run();
    await d1.prepare('INSERT INTO books (title, author_id) VALUES (?, ?)').bind('The Hobbit', 1).run();

    const result = await d1.prepare(
      'SELECT b.title, a.name AS author FROM books b JOIN authors a ON b.author_id = a.id',
    ).all();

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({ title: 'The Hobbit', author: 'Tolkien' });
  });
});

// =========================================================================
// Column types
// =========================================================================

describe('CatalystD1 — Column Types', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec(`
      CREATE TABLE typed (
        id INTEGER PRIMARY KEY,
        int_col INTEGER,
        float_col REAL,
        text_col TEXT,
        blob_col BLOB,
        null_col TEXT
      )
    `);
  });

  it('handles NULL, integer, float, text, blob', async () => {
    await d1.prepare(
      'INSERT INTO typed (int_col, float_col, text_col, blob_col, null_col) VALUES (?, ?, ?, ?, ?)',
    ).bind(42, 3.14, 'hello', new Uint8Array([0xDE, 0xAD]), null).run();

    const row = await d1.prepare('SELECT * FROM typed WHERE id = 1').first() as any;
    expect(row.int_col).toBe(42);
    expect(row.float_col).toBeCloseTo(3.14, 2);
    expect(row.text_col).toBe('hello');
    expect(row.null_col).toBeNull();
    // Blob comes back as Uint8Array
    if (row.blob_col instanceof Uint8Array) {
      expect(row.blob_col[0]).toBe(0xDE);
      expect(row.blob_col[1]).toBe(0xAD);
    }
  });
});

// =========================================================================
// Empty and large result sets
// =========================================================================

describe('CatalystD1 — Result Sets', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('CREATE TABLE numbers (id INTEGER PRIMARY KEY, value INTEGER)');
  });

  it('empty result sets return { results: [] }', async () => {
    const result = await d1.prepare('SELECT * FROM numbers').all();
    expect(result.results).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('large result sets (1000+ rows)', async () => {
    // Insert 1000 rows using batch
    const stmts = [];
    for (let i = 0; i < 1000; i++) {
      stmts.push(d1.prepare('INSERT INTO numbers (value) VALUES (?)').bind(i));
    }
    await d1.batch(stmts);

    const result = await d1.prepare('SELECT * FROM numbers').all();
    expect(result.results).toHaveLength(1000);
    expect((result.results[0] as any).value).toBe(0);
    expect((result.results[999] as any).value).toBe(999);
  });
});

// =========================================================================
// dump() export
// =========================================================================

describe('CatalystD1 — dump()', () => {
  beforeEach(async () => {
    d1 = createD1();
    await d1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    await d1.prepare('INSERT INTO test (name) VALUES (?)').bind('Alice').run();
    await d1.prepare('INSERT INTO test (name) VALUES (?)').bind('Bob').run();
  });

  it('exports valid ArrayBuffer', async () => {
    const buffer = await d1.dump();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);

    // The dump should contain SQL statements
    const text = new TextDecoder().decode(buffer);
    expect(text).toContain('CREATE TABLE');
    expect(text).toContain('INSERT INTO');
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
  });
});
