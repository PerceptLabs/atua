// GET /api/todos — list all todos from D1
export default defineEventHandler(async (event) => {
  const db = event.context.catalyst.env.MY_DB;
  const result = await db.prepare('SELECT * FROM todos ORDER BY id').all();
  return result.results;
});
