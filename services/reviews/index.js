// Microservicio de RESEÑAS y TOP 5 (puerto 4003, base reviews.db)
import {
  z, express, createApp, start, openDb, wrap, parse, optText, num, HttpError, isUnique,
  pageParams, requireAuth, requireAdmin, callService, URLS,
} from '@enscafe/common';

const db = openDb('reviews');
db.exec(`
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafe_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cafe_id, user_id)            -- una reseña por usuario y cafetería (anti-duplicados)
);
CREATE TABLE IF NOT EXISTS top5(
  user_id INTEGER NOT NULL,
  cafe_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, cafe_id),      -- sin cafeterías repetidas
  UNIQUE(user_id, position)           -- sin posiciones repetidas
);`);

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

// Mantiene el promedio en catalog-service (consistencia eventual: si falla, se resincroniza al reiniciar)
async function pushStats(cafeId) {
  const s = db.prepare(`SELECT COALESCE(AVG(rating),0) avg, COUNT(*) n FROM reviews WHERE cafe_id=? AND status='published'`).get(cafeId);
  try {
    await callService(`${URLS.catalog}/internal/cafes/${cafeId}/rating`, { method: 'PUT', internal: true, body: { avg: s.avg, count: s.n } });
  } catch (e) {
    console.warn(`[reviews] no se pudo actualizar el promedio de la cafetería ${cafeId}`);
  }
}
async function assertCafe(cafeId) {
  const r = await callService(`${URLS.catalog}/cafes/${cafeId}`);
  if (r.status === 404 || (r.ok && !['active', 'closed'].includes(r.data?.cafe?.status)))
    throw new HttpError(404, 'La cafetería no existe', 'CAFE_NOT_FOUND');
  if (!r.ok) throw new HttpError(503, 'No se pudo verificar la cafetería. Intenta de nuevo', 'SERVICE_UNAVAILABLE');
}
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
  return n;
};
const getReview = (id) => {
  const row = db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Reseña no encontrada', 'NOT_FOUND');
  return row;
};

const r = express.Router();

r.get('/', wrap(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, { defLimit: 10, maxLimit: 50 });
  const where = [];
  const params = [];
  // Solo el administrador puede ver reseñas ocultas
  const st = req.query.status;
  if (st === 'hidden' || st === 'all') {
    if (req.user?.role !== 'admin') throw new HttpError(403, 'No tienes permisos para esta acción', 'FORBIDDEN');
    if (st === 'hidden') where.push(`status='hidden'`);
  } else where.push(`status='published'`);
  const cafeId = Number(req.query.cafeId);
  if (req.query.cafeId !== undefined) { where.push('cafe_id=?'); params.push(Number.isInteger(cafeId) ? cafeId : -1); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM reviews ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM reviews ${w} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ items: rows.map(toReview), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

r.get('/mine', requireAuth, wrap(async (req, res) => {
  const rows = db.prepare('SELECT * FROM reviews WHERE user_id=? ORDER BY updated_at DESC, id DESC LIMIT 200').all(req.user.id);
  res.json({ items: rows.map(toReview) });
}));

r.post('/', requireAuth, wrap(async (req, res) => {
  const d = parse(createSchema, req.body);
  await assertCafe(d.cafeId);
  let id;
  try {
    id = db.prepare('INSERT INTO reviews(cafe_id,user_id,user_name,rating,comment) VALUES (?,?,?,?,?)')
      .run(d.cafeId, req.user.id, req.user.name, d.rating, d.comment).lastInsertRowid;
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'Ya reseñaste esta cafetería. Edita tu reseña existente', 'DUPLICATE');
    throw e;
  }
  await pushStats(d.cafeId);
  res.status(201).json({ review: toReview(getReview(id)) });
}));

r.put('/:id', requireAuth, wrap(async (req, res) => {
  const row = getReview(parseId(req.params.id));
  if (row.user_id !== req.user.id) throw new HttpError(403, 'Solo puedes editar tus propias reseñas', 'FORBIDDEN');
  if (row.status === 'hidden') throw new HttpError(409, 'Esta reseña fue ocultada por moderación y no se puede editar', 'HIDDEN');
  const d = parse(updateSchema, req.body);
  db.prepare(`UPDATE reviews SET rating=?, comment=?, updated_at=datetime('now') WHERE id=?`).run(d.rating, d.comment, row.id);
  await pushStats(row.cafe_id);
  res.json({ review: toReview(getReview(row.id)) });
}));

r.delete('/:id', requireAuth, wrap(async (req, res) => {
  const row = getReview(parseId(req.params.id));
  if (row.user_id !== req.user.id && req.user.role !== 'admin')
    throw new HttpError(403, 'Solo puedes eliminar tus propias reseñas', 'FORBIDDEN');
  db.prepare('DELETE FROM reviews WHERE id=?').run(row.id);
  await pushStats(row.cafe_id);
  res.status(204).end();
}));

r.patch('/:id/moderate', ...requireAdmin, wrap(async (req, res) => {
  const row = getReview(parseId(req.params.id));
  const { status } = parse(z.object({ status: z.enum(['published', 'hidden'], { errorMap: () => ({ message: 'Estado no válido' }) }) }), req.body);
  db.prepare(`UPDATE reviews SET status=? WHERE id=?`).run(status, row.id);
  await pushStats(row.cafe_id);
  res.json({ review: toReview(getReview(row.id)) });
}));

/* ---------- Top 5 ---------- */
const top = express.Router();
const listTop = (userId) => db.prepare('SELECT cafe_id FROM top5 WHERE user_id=? ORDER BY position').all(userId).map((x) => x.cafe_id);

top.get('/me', requireAuth, wrap(async (req, res) => res.json({ cafeIds: listTop(req.user.id) })));
top.get('/user/:id', wrap(async (req, res) => res.json({ cafeIds: listTop(Number(req.params.id) || -1) })));

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
  db.transaction(() => {
    db.prepare('DELETE FROM top5 WHERE user_id=?').run(req.user.id);
    const ins = db.prepare('INSERT INTO top5(user_id,cafe_id,position) VALUES (?,?,?)');
    cafeIds.forEach((id, i) => ins.run(req.user.id, id, i + 1));
  })();
  res.json({ cafeIds: listTop(req.user.id) });
}));

const app = createApp();
app.use('/reviews', r);
app.use('/top5', top);
start(app, 'reviews', Number(process.env.REVIEWS_PORT || 4003));

// Al iniciar, resincroniza promedios por si catalog estuvo caído cuando se publicó una reseña
setTimeout(async () => {
  for (const { cafe_id } of db.prepare('SELECT DISTINCT cafe_id FROM reviews').all()) await pushStats(cafe_id);
}, 3000);
