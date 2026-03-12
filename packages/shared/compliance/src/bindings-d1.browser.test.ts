/**
 * Workers Compliance — D1 Binding API Shape
 *
 * Validates that D1Database binding matches Cloudflare's API:
 * prepare, exec, batch, dump (dump may be partial)
 * D1PreparedStatement: bind, first, all, raw, run
 *
 * Uses a single shared D1 instance to avoid browser resource exhaustion.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { AtuaWorkers } from '../../../workers/atua-workers/src/runtime.js';
import { AtuaD1 } from '@aspect/atua-workers-d1';
import type { WorkerModule } from '../../../workers/atua-workers/src/runtime.js';

const dbName = `compliance-d1-${crypto.randomUUID()}`;
let db: AtuaD1 | null = null;

afterAll(async () => {
  if (db) {
    await db.destroy();
    db = null;
  }
});

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

describe('Workers Compliance — D1 Binding', () => {
  it('D1Database + PreparedStatement API shape and CRUD', async () => {
    db = new AtuaD1(dbName);
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);

          if (url.pathname === '/shape') {
            const d1 = env.DB as AtuaD1;
            const stmt = d1.prepare('SELECT * FROM items');
            return new Response(JSON.stringify({
              hasPrepare: typeof d1.prepare === 'function',
              hasExec: typeof d1.exec === 'function',
              hasBatch: typeof d1.batch === 'function',
              hasBind: typeof stmt.bind === 'function',
              hasFirst: typeof stmt.first === 'function',
              hasAll: typeof stmt.all === 'function',
              hasRaw: typeof stmt.raw === 'function',
              hasRun: typeof stmt.run === 'function',
            }));
          }

          if (url.pathname === '/insert') {
            await (env.DB as AtuaD1).prepare('INSERT INTO items (value) VALUES (?)').bind('test-item').run();
            return new Response('inserted');
          }

          if (url.pathname === '/query') {
            const result = await (env.DB as AtuaD1).prepare('SELECT * FROM items').all();
            return new Response(JSON.stringify(result.results));
          }

          if (url.pathname === '/first') {
            const row = await (env.DB as AtuaD1).prepare('SELECT * FROM items LIMIT 1').first();
            return new Response(JSON.stringify(row));
          }

          return new Response('not found', { status: 404 });
        },
      },
    };

    const runtime = await AtuaWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { DB: { type: 'd1', instance: db } },
          routes: ['/**'],
        },
      },
    });

    // Check API shape
    const shapeRes = await runtime.fetch(req('/shape'));
    const shape = await shapeRes!.json();
    expect(shape.hasPrepare).toBe(true);
    expect(shape.hasExec).toBe(true);
    expect(shape.hasBatch).toBe(true);
    expect(shape.hasBind).toBe(true);
    expect(shape.hasFirst).toBe(true);
    expect(shape.hasAll).toBe(true);
    expect(shape.hasRaw).toBe(true);
    expect(shape.hasRun).toBe(true);

    // CRUD: insert
    await runtime.fetch(req('/insert'));

    // CRUD: query all
    const allRes = await runtime.fetch(req('/query'));
    const rows = await allRes!.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('test-item');

    // CRUD: first
    const firstRes = await runtime.fetch(req('/first'));
    const first = await firstRes!.json();
    expect(first.value).toBe('test-item');

    await runtime.destroy();
  });

  it('D1 exec runs multiple statements', async () => {
    // Reuse the same db instance
    if (!db) db = new AtuaD1(dbName);

    const worker: WorkerModule = {
      default: {
        async fetch(request, env) {
          await (env.DB as AtuaD1).exec(`
            CREATE TABLE IF NOT EXISTS multi (id INTEGER PRIMARY KEY, val TEXT);
            INSERT INTO multi (val) VALUES ('a');
            INSERT INTO multi (val) VALUES ('b');
          `);
          const result = await (env.DB as AtuaD1).prepare('SELECT * FROM multi ORDER BY id').all();
          return new Response(JSON.stringify(result.results));
        },
      },
    };

    const runtime = await AtuaWorkers.create({
      workers: {
        w: {
          module: worker,
          bindings: { DB: { type: 'd1', instance: db } },
          routes: ['/**'],
        },
      },
    });

    const res = await runtime.fetch(req('/'));
    const rows = await res!.json();
    expect(rows).toHaveLength(2);
    expect(rows[0].val).toBe('a');
    expect(rows[1].val).toBe('b');

    await runtime.destroy();
  });
});
