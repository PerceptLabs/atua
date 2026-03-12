/// <reference path="../../../nitro-shims.d.ts" />
// GET /api/todos — list all todos from D1
export default defineEventHandler(async (event) => {
  const db = event.context.atua.env.MY_DB;
  const result = await db.prepare('SELECT * FROM todos ORDER BY id').all();
  return result.results;
});
