import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ platform }) => {
  return new Response(
    JSON.stringify({ hello: 'world', framework: 'sveltekit' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
};
