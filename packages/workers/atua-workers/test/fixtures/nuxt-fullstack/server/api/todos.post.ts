// POST /api/todos — create a new todo in D1
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const db = event.context.atua.env.MY_DB;
  const result = await db
    .prepare('INSERT INTO todos (title, completed) VALUES (?, ?)')
    .bind(body.title, body.completed ? 1 : 0)
    .run();
  return { id: result.meta.last_row_id, ...body };
});
