// POST /api/upload — upload file to R2
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const r2 = event.context.atua.env.UPLOADS;
  await r2.put(body.key, body.data);
  return { uploaded: true, key: body.key };
});
