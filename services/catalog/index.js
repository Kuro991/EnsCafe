// Microservicio de CATÁLOGO de cafeterías (esquema "catalog" en PostgreSQL)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  z, express, createApp, start, openDb, migrate, wrap, parse, text, optText, num, HttpError, isUnique,
  pageParams, escapeLike, toId, requireAdmin, internalOnly, SEED_DEMO, INTERNAL_HOST,
} from '@enscafe/common';
import { seedIfEmpty } from './seed.js';

const db = openDb('catalog');
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function init() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate(db, 'catalog', MIGRATIONS);
  if (SEED_DEMO && (await seedIfEmpty(db))) console.log('[catalog] cafeterías de ejemplo cargadas (solo desarrollo)');
}

// Área aproximada de la ciudad de Ensenada: rechaza coordenadas fuera de lugar (ej. lat/lng invertidas)
const B = { latMin: 31.6, latMax: 32.1, lngMin: -116.9, lngMax: -116.3 };
const cafeSchema = z.object({
  name: text('El nombre', { min: 2, max: 80 }),
  address: text('La dirección', { min: 5, max: 160 }),
  zone: text('La zona', { min: 2, max: 40 }),
  description: optText('La descripción', 600),
  schedule: optText('El horario', 120),
  phone: optText('El teléfono', 20).refine((v) => v === '' || /^[0-9+()\-\s]{7,20}$/.test(v), 'Teléfono no válido (solo números, espacios, + - ( ))'),
  lat: num('La latitud', { min: B.latMin, max: B.latMax }),
  lng: num('La longitud', { min: B.lngMin, max: B.lngMax }),
  status: z.enum(['draft', 'active', 'closed', 'retired'], { errorMap: () => ({ message: 'Estado no válido' }) }).default('active'),
});

const toCafe = (c) => ({
  id: c.id, name: c.name, address: c.address, description: c.description, schedule: c.schedule,
  phone: c.phone, lat: c.lat, lng: c.lng, zone: c.zone, status: c.status,
  ratingAvg: Math.round(c.rating_avg * 10) / 10, ratingCount: c.rating_count,
});
const notFound = () => new HttpError(404, 'La cafetería no existe', 'NOT_FOUND');
const getCafe = async (rawId, req) => {
  const id = toId(rawId);
  const c = id && (await db.get('SELECT * FROM catalog.cafes WHERE id = $1', [id]));
  if (!c || (['draft', 'retired'].includes(c.status) && req.user?.role !== 'admin')) throw notFound();
  return c;
};
const duplicate = () => new HttpError(409, 'Ya existe una cafetería con ese nombre y dirección', 'DUPLICATE');

const r = express.Router();

// Catálogo con búsqueda, filtros, orden y paginación
r.get('/', wrap(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, { defLimit: 12, maxLimit: 50 });
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  const isAdmin = req.user?.role === 'admin' && req.query.includeAll === '1';
  if (!isAdmin) where.push(`status IN ('active','closed')`);

  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q) {
    const like = p(`%${escapeLike(q)}%`);
    where.push(`(name ILIKE ${like} OR address ILIKE ${like} OR description ILIKE ${like} OR zone ILIKE ${like})`);
  }
  const zone = String(req.query.zone ?? '').trim();
  if (zone) where.push(`lower(zone) = lower(${p(zone)})`);
  const minRating = Number(req.query.minRating);
  if (req.query.minRating !== undefined && req.query.minRating !== '' && Number.isFinite(minRating) && minRating > 0 && minRating <= 5)
    where.push(`rating_avg >= ${p(minRating)} AND rating_count > 0`);
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(toId).filter(Boolean).slice(0, 50);
    where.push(ids.length ? `id = ANY(${p(ids)}::int[])` : 'FALSE');
  }
  const ORDER = {
    rating: 'rating_avg DESC, rating_count DESC, lower(name)',
    reviews: 'rating_count DESC, rating_avg DESC, lower(name)',
    name: 'lower(name)',
  };
  const order = ORDER[req.query.sort] ?? ORDER.name; // lista blanca: nunca se interpola texto del usuario
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n: total } = await db.get(`SELECT COUNT(*)::int AS n FROM catalog.cafes ${w}`, params);
  const rows = await db.all(`SELECT * FROM catalog.cafes ${w} ORDER BY ${order} LIMIT ${p(limit)} OFFSET ${p(offset)}`, params);
  res.json({ items: rows.map(toCafe), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// Puntos para el mapa: solo cafeterías activas con coordenadas válidas
r.get('/map', wrap(async (_req, res) => {
  const rows = await db.all(`SELECT * FROM catalog.cafes WHERE status = 'active'`);
  res.json({ items: rows.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map(toCafe) });
}));

r.get('/zones', wrap(async (_req, res) => {
  const rows = await db.all(`SELECT zone FROM catalog.cafes WHERE status IN ('active','closed') GROUP BY zone ORDER BY lower(zone)`);
  res.json({ items: rows.map((z) => z.zone) });
}));

r.get('/top', wrap(async (req, res) => {
  const { limit } = pageParams(req.query, { defLimit: 10, maxLimit: 30 });
  const rows = await db.all(`SELECT * FROM catalog.cafes WHERE status = 'active' AND rating_count > 0
    ORDER BY rating_avg DESC, rating_count DESC, lower(name) LIMIT $1`, [limit]);
  res.json({ items: rows.map(toCafe) });
}));

r.get('/:id', wrap(async (req, res) => res.json({ cafe: toCafe(await getCafe(req.params.id, req)) })));

r.post('/', ...requireAdmin, wrap(async (req, res) => {
  const d = parse(cafeSchema, req.body);
  try {
    const c = await db.get(
      `INSERT INTO catalog.cafes(name, address, description, schedule, phone, lat, lng, zone, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.name, d.address, d.description, d.schedule, d.phone, d.lat, d.lng, d.zone, d.status]);
    res.status(201).json({ cafe: toCafe(c) });
  } catch (e) {
    if (isUnique(e)) throw duplicate();
    throw e;
  }
}));

r.put('/:id', ...requireAdmin, wrap(async (req, res) => {
  const current = await getCafe(req.params.id, req);
  const d = parse(cafeSchema, req.body);
  try {
    const c = await db.get(
      `UPDATE catalog.cafes SET name=$1, address=$2, description=$3, schedule=$4, phone=$5, lat=$6, lng=$7, zone=$8, status=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [d.name, d.address, d.description, d.schedule, d.phone, d.lat, d.lng, d.zone, d.status, current.id]);
    res.json({ cafe: toCafe(c) });
  } catch (e) {
    if (isUnique(e)) throw duplicate();
    throw e;
  }
}));

// Baja lógica: conserva reseñas y Top 5 sin referencias rotas
r.delete('/:id', ...requireAdmin, wrap(async (req, res) => {
  const c = await getCafe(req.params.id, req);
  await db.run(`UPDATE catalog.cafes SET status = 'retired', updated_at = now() WHERE id = $1`, [c.id]);
  res.status(204).end();
}));

const app = createApp({ db });
app.use('/cafes', r);

// Solo accesible entre servicios (el gateway NO lo expone). Lo llama reviews-service.
app.put('/internal/cafes/:id/rating', internalOnly, wrap(async (req, res) => {
  const d = parse(z.object({ avg: num('avg', { min: 0, max: 5 }), count: num('count', { min: 0, int: true }) }), req.body);
  const id = toId(req.params.id);
  if (!id) throw notFound();
  await db.run('UPDATE catalog.cafes SET rating_avg = $1, rating_count = $2 WHERE id = $3', [d.avg, d.count, id]);
  res.json({ ok: true });
}));

start(app, 'catalog', Number(process.env.CATALOG_PORT || 4002), { init, host: INTERNAL_HOST });
