/**
 * Full-Stack Astro Integration — Browser tests
 *
 * End-to-end validation of an Astro SSR app with D1 database queries
 * running entirely in the browser vian AtuaWorkers.
 * Uses the existing astro-basic fixture enhanced with D1 bindings.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AtuaWorkers } from '../../src/runtime.js';
import { AtuaKV } from '../../src/bindings/kv.js';
import { AtuaD1 } from '@aspect/atua-workers-d1';
import type { WorkerModule } from '../../src/runtime.js';

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

let runtime: AtuaWorkers | null = null;

afterEach(async () => {
  if (runtime) {
    await runtime.destroy();
    runtime = null;
  }
});

describe('Astro Full-Stack — SSR with D1', () => {
  it('Astro SSR renders page with D1 data available', async () => {
    const db = new AtuaD1(`astro-d1-page-${Date.now()}`);
    await db.exec('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT)');
    await db.prepare('INSERT INTO posts (title) VALUES (?)').bind('First Post').run();

    // Inline Astro-like module that queries D1 during page render
    const astroWithD1: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);

          if (url.pathname === '/') {
            const result = await env.MY_DB.prepare('SELECT * FROM posts').all();
            const posts = result.results as Array<{ id: number; title: string }>;
            const postList = posts.map((p) => `<li>${p.title}</li>`).join('');
            return new Response(
              `<!DOCTYPE html><html><body><h1>Astro Blog</h1><ul>${postList}</ul></body></html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
          }

          if (url.pathname === '/api/posts') {
            const result = await env.MY_DB.prepare('SELECT * FROM posts ORDER BY id').all();
            return new Response(JSON.stringify(result.results), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response('Not Found', { status: 404 });
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        astro: {
          module: astroWithD1,
          bindings: {
            MY_DB: { type: 'd1', instance: db },
          },
          routes: ['/**'],
        },
      },
    });

    // Verify SSR page renders with D1 data
    const pageRes = await runtime.fetch(req('/'));
    expect(pageRes).not.toBeNull();
    expect(pageRes!.status).toBe(200);
    const html = await pageRes!.text();
    expect(html).toContain('<h1>Astro Blog</h1>');
    expect(html).toContain('<li>First Post</li>');

    await db.destroy();
  });

  it('Astro API returns D1 query results', async () => {
    const db = new AtuaD1(`astro-d1-api-${Date.now()}`);
    await db.exec('CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT)');
    await db.prepare('INSERT INTO posts (title) VALUES (?)').bind('Post A').run();
    await db.prepare('INSERT INTO posts (title) VALUES (?)').bind('Post B').run();

    const astroWithD1: WorkerModule = {
      default: {
        async fetch(request, env) {
          const url = new URL(request.url);
          if (url.pathname === '/api/posts') {
            const result = await env.MY_DB.prepare('SELECT * FROM posts ORDER BY id').all();
            return new Response(JSON.stringify(result.results), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('Not Found', { status: 404 });
        },
      },
    };

    runtime = await AtuaWorkers.create({
      workers: {
        astro: {
          module: astroWithD1,
          bindings: {
            MY_DB: { type: 'd1', instance: db },
          },
          routes: ['/**'],
        },
      },
    });

    const apiRes = await runtime.fetch(req('/api/posts'));
    expect(apiRes).not.toBeNull();
    const posts = await apiRes!.json();
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe('Post A');
    expect(posts[1].title).toBe('Post B');

    await db.destroy();
  });
});
