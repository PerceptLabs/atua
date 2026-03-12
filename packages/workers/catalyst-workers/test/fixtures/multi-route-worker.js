/**
 * Multi-route Worker — returns JSON with path and method info.
 * Used to test route pattern matching (exact, prefix, wildcard).
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    return new Response(
      JSON.stringify({
        path: url.pathname,
        method: request.method,
        worker: 'multi-route',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};
