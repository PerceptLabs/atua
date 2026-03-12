/**
 * D1 Worker — queries env.MY_DB binding.
 * Demonstrates AtuaD1 integration in the runtime shell.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/d1/init') {
      await env.MY_DB.exec(
        'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)',
      );
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/d1/insert') {
      const name = url.searchParams.get('name');
      await env.MY_DB.prepare('INSERT INTO items (name) VALUES (?)')
        .bind(name)
        .run();
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/d1/list') {
      const result = await env.MY_DB.prepare('SELECT * FROM items').all();
      return new Response(JSON.stringify(result.results), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
