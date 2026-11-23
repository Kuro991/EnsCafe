// Microservicio de RESEÑAS y TOP 5 (esquema "reviews" en PostgreSQL)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  z, express, createApp, start, openDb, migrate, wrap, parse, optText, num, HttpError, isUnique,
  pageParams, toId, requireAuth, requireAdmin, callService, URLS, INTERNAL_HOST,
} from '@enscafe/common';

const db = openDb('reviews');
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Mantiene el promedio en catalog-service (consistencia eventual: si falla, se resincroniza al reiniciar)
async function pushStats(cafeId) {
  try {
    const s = await db.get(`SELECT COALESCE(AVG(rating), 0)::float8 AS avg, COUNT(*)::int AS n
                            FROM reviews.reviews WHERE cafe_id = $1 AND status = 'published'`, [cafeId]);
    await callService(`${URLS.catalog}/internal/cafes/${cafeId}/rating`, { method: 'PUT', internal: true, body: { avg: s.avg, count: s.n } });
  } catch {
    console.warn(`[reviews] no se pudo actualizar el promedio de la cafetería ${cafeId}`);
  }
}

async function init() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate(db, 'reviews', MIGRATIONS);
  // Al iniciar, resincroniza promedios por si catalog estuvo caído cuando se publicó una reseña
  setTimeout(async () => {
    try { for (const { cafe_id } of await db.all('SELECT DISTINCT cafe_id FROM reviews.reviews')) await pushStats(cafe_id); }
    catch (e) { console.warn('[reviews] resincronización omitida:', e.message); }
  }, 3000);
}

const toReview = (r) => ({
  id: r.id, cafeId: r.cafe_id, userId: r.user_id, userName: r.user_name, rating: r.rating,
  comment: r.comment, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

const reviewFields = {
  // 0 es una puntuación válida: se valida el rango, nunca "si es falsy"
  rating: num('La puntuación', { min: 0, max: 5, int: true }),
  comment: optText('El comentario', 1000),
};
const createSchema = z.object({ cafeId: num('La cafetería', { min: 1, int: true }), ...reviewFields });
const updateSchema = z.object(reviewFields);

async function assertCafe(cafeId) {
  const r = await callService(`${URLS.catalog}/cafes/${cafeId}`);
  if (r.status === 404 || (r.ok && !['active', 'closed'].includes(r.data?.cafe?.status)))
    throw new HttpError(404, 'La cafetería no existe', 'CAFE_NOT_FOUND');
  if (!r.ok) throw new HttpError(503, 'No se pudo verificar la cafetería. Intenta de nuevo', 'SERVICE_UNAVAILABLE');
}
const getReview = async (rawId) => {
  const id = toId(rawId);
  const row = id && (await db.get('SELECT * FROM reviews.reviews WHERE id = $1', [id]));
  if (!row) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
  return row;
};

const r = express.Router();

r.get('/', wrap(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, { defLimit: 10, maxLimit: 50 });
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  // Solo el administrador puede ver reseñas ocultas
  const st = req.query.status;
  if (st === 'hidden' || st === 'all') {
    if (req.user?.role !== 'admin') throw new HttpError(403, 'No tienes permisos para esta acción', 'FORBIDDEN');
    if (st === 'hidden') where.push(`status = 'hidden'`);
  } else where.push(`status = 'published'`);
  if (req.query.cafeId !== undefined) where.push(`cafe_id = ${p(toId(req.query.cafeId) ?? -1)}`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM reviews.reviews ${w}`, params);
  const rows = await db.all(`SELECT * FROM reviews.reviews ${w} ORDER BY updated_at DESC, id DESC LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);
  res.json({ items: rows.map(toReview), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

r.get('/mine', requireAuth, wrap(async (req, res) => {
  const rows = await db.all('SELECT * FROM reviews.reviews WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 200', [req.user.id]);
  res.json({ items: rows.map(toReview) });
}));

r.post('/', requireAuth, wrap(async (req, res) => {
  const d = parse(createSchema, req.body);
  await assertCafe(d.cafeId);
  let row;
  try {
    row = await db.get('INSERT INTO reviews.reviews(cafe_id, user_id, user_name, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [d.cafeId, req.user.id, req.user.name, d.rating, d.comment]);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'Ya reseñaste esta cafetería. Edita tu reseña existente', 'DUPLICATE');
    throw e;
  }
  await pushStats(d.cafeId);
  res.status(201).json({ review: toReview(row) });
}));

r.put('/:id', requireAuth, wrap(async (req, res) => {
  const row = await getReview(req.params.id);
  if (row.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes editar tus propias reseñas', 'FORBIDDEN');
  if (row.status === 'hidden') throw new HttpError(409, 'Esta reseña fue ocultada por moderación y no se puede editar', 'HIDDEN');
  const d = parse(updateSchema, req.body);
  const updated = await db.get('UPDATE reviews.reviews SET rating = $1, comment = $2, updated_at = now() WHERE id = $3 RETURNING *', [d.rating, d.comment, row.id]);
  await pushStats(row.cafe_id);
  res.json({ review: toReview(updated) });
}));

r.delete('/:id', requireAuth, wrap(async (req, res) => {
  const row = await getReview(req.params.id);
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    throw new HttpError(403, 'Solo puedes eliminar tus propias reseñas', 'FORBIDDEN');
  await db.run('DELETE FROM reviews.reviews WHERE id = $1', [row.id]);
  await pushStats(row.cafe_id);
  res.status(204).end();
}));

r.patch('/:id/moderate', ...requireAdmin, wrap(async (req, res) => {
  const row = await getReview(req.params.id);
  const { status } = parse(z.object({ status: z.enum(['published', 'hidden'], { errorMap: () => ({ message: 'Estado no válido' }) }) }), req.body);
  const updated = await db.get('UPDATE reviews.reviews SET status = $1 WHERE id = $2 RETURNING *', [status, row.id]);
  await pushStats(row.cafe_id);
  res.json({ review: toReview(updated) });
}));

/* ---------- Top 5 ---------- */
const top = express.Router();
const listTop = async (userId) => (await db.all('SELECT cafe_id FROM reviews.top5 WHERE user_id = $1 ORDER BY position', [userId])).map((x) => x.cafe_id);

top.get('/me', requireAuth, wrap(async (req, res) => res.json({ cafeIds: await listTop(req.user.id) })));
top.get('/user/:id', wrap(async (req, res) => res.json({ cafeIds: await listTop(toId(req.params.id) ?? -1) })));

// Reemplaza la lista completa de forma atómica: sirve para agregar, quitar y reordenar, y es idempotente (doble clic seguro)
top.put('/me', requireAuth, wrap(async (req, res) => {
  const { cafeIds } = parse(z.object({
    cafeIds: z.array(z.number({ invalid_type_error: 'Identificador de cafetería no válido' }).int('Identificador de cafetería no válido').positive('Identificador de cafetería no válido'),
      { required_error: 'Falta la lista de cafeterías', invalid_type_error: 'La lista no es válida' })
      .max(5, 'Tu Top 5 admite máximo 5 cafeterías'),
  }), req.body);
  if (new Set(cafeIds).size !== cafeIds.length) throw new HttpError(422, 'No puedes repetir cafeterías en tu Top 5', 'VALIDATION');
  if (cafeIds.length) {
    const c = await callService(`${URLS.catalog}/cafes?ids=${cafeIds.join(',')}&limit=50`);
    if (!c.ok) throw new HttpError(503, 'No se pudo verificar las cafeterías. Intenta de nuevo', 'SERVICE_UNAVAILABLE');
    if (c.data.items.filter((x) => ['active', 'closed'].includes(x.status)).length !== cafeIds.length)
      throw new HttpError(422, 'Alguna de las cafeterías ya no existe', 'VALIDATION');
  }
  await db.tx(async (t) => {
    await t.run('DELETE FROM reviews.top5 WHERE user_id = $1', [req.user.id]);
    for (const [i, id] of cafeIds.entries())
      await t.run('INSERT INTO reviews.top5(user_id, cafe_id, position) VALUES ($1,$2,$3)', [req.user.id, id, i + 1]);
  });
  res.json({ cafeIds: await listTop(req.user.id) });
}));

const app = createApp({ db });
app.use('/reviews', r);
app.use('/top5', top);
start(app, 'reviews', Number(process.env.REVIEWS_PORT || 4003), { init, host: INTERNAL_HOST });
