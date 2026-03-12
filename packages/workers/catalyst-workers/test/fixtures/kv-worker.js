/**
 * KV Worker — reads and writes from env.MY_KV binding.
 * Demonstrates CatalystKV integration in the runtime shell.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/kv/get') {
      const key = url.searchParams.get('key');
      const value = await env.MY_KV.get(key);
      return new Response(value, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    if (url.pathname === '/kv/put') {
      const key = url.searchParams.get('key');
      const value = url.searchParams.get('value');
      await env.MY_KV.put(key, value);
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/kv/delete') {
      const key = url.searchParams.get('key');
      await env.MY_KV.delete(key);
      return new Response('OK', { status: 200 });
    }

    if (url.pathname === '/kv/list') {
      const result = await env.MY_KV.list();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
