import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ locals }) => {
  return new Response(JSON.stringify({ hello: 'world', framework: 'astro' }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
