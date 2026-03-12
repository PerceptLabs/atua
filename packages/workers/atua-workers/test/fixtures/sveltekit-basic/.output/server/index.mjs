/**
 * Hand-crafted simulation of SvelteKit output with @aspect/atua-sveltekit adapter.
 *
 * Simulates what SvelteKit produces: a fetch handler wrapping SvelteKit's Server.
 * Routes, page rendering, API routes, and platform.catalyst.env access.
 */

// Simulated route handlers
const pages = {
  '/': () =>
    new Response(
      '<!DOCTYPE html><html><head><title>SvelteKit on Catalyst</title></head>' +
        '<body><div id="svelte"><h1>Welcome to SvelteKit</h1><p>Running on Catalyst</p></div></body></html>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    ),

  '/about': () =>
    new Response(
      '<!DOCTYPE html><html><body><div id="svelte"><h1>About</h1><p>SvelteKit SSR page</p></div></body></html>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    ),
};

const apiRoutes = {
  '/api/hello': (platform) =>
    new Response(
      JSON.stringify({ hello: 'world', framework: 'sveltekit' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),

  '/api/env': (platform) => {
    const env = platform?.catalyst?.env ?? {};
    return new Response(
      JSON.stringify({
        hasBindings: !!platform?.catalyst?.env,
        envKeys: Object.keys(env),
        values: env,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Construct SvelteKit platform equivalent
    const platform = {
      catalyst: {
        env: env || {},
        ctx,
      },
    };

    // Check API routes first
    const apiHandler = apiRoutes[pathname];
    if (apiHandler) {
      return apiHandler(platform);
    }

    // Check pages
    const pageHandler = pages[pathname];
    if (pageHandler) {
      return pageHandler();
    }

    return new Response('Not Found', { status: 404 });
  },
};
