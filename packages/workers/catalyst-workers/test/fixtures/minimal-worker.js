/**
 * Minimal Worker — returns a plain text greeting.
 * Tests basic module-format loading and fetch routing.
 */
export default {
  async fetch(request, env, ctx) {
    return new Response('Hello from Catalyst Worker!', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
