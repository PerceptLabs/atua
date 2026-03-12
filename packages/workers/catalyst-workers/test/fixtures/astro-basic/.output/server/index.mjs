/**
 * Hand-crafted simulation of Astro SSR output with @aspect/catalyst-astro adapter.
 *
 * Simulates what Astro produces: a fetch handler wrapping Astro's App.render().
 * Routes, HTML rendering, API endpoints, and Astro.locals.catalyst.env access.
 */

// Simulated route handlers
const pages = {
  '/': () =>
    new Response(
      '<!DOCTYPE html><html><head><title>Astro on Catalyst</title></head>' +
        '<body><h1>Welcome to Astro</h1><p>Running on Catalyst</p></body></html>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    ),

  '/about': () =>
    new Response(
      '<!DOCTYPE html><html><body><h1>About</h1><p>Astro SSR page</p></body></html>',
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    ),
};

const apiRoutes = {
  '/api/hello': (locals) =>
    new Response(JSON.stringify({ hello: 'world', framework: 'astro' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),

  '/api/env': (locals) => {
    const env = locals?.catalyst?.env ?? {};
    return new Response(
      JSON.stringify({
        hasBindings: !!locals?.catalyst?.env,
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

    // Construct Astro.locals equivalent
    const locals = {
      catalyst: {
        env: env || {},
        ctx,
      },
    };

    // Check API routes first
    const apiHandler = apiRoutes[pathname];
    if (apiHandler) {
      return apiHandler(locals);
    }

    // Check pages
    const pageHandler = pages[pathname];
    if (pageHandler) {
      return pageHandler();
    }

    return new Response('Not Found', { status: 404 });
  },
};
