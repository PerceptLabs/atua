/// <reference path="../../../nitro-shims.d.ts" />
/**
 * GET /api/hello → JSON
 */
export default defineEventHandler(() => {
  return { hello: 'world' };
});
