// Microservicio de CATÁLOGO de cafeterías (puerto 4002, base catalog.db)
import {
  z, express, createApp, start, openDb, wrap, parse, text, optText, num, HttpError, isUnique,
  pageParams, escapeLike, requireAdmin, internalOnly,
} from '@enscafe/common';
import { SEED } from './seed.js';

const db = openDb('catalog');
db.exec(`CREATE TABLE IF NOT EXISTS cafes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  zone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','closed','retired')),
  rating_avg REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- evita cafeterías duplicadas (mismo nombre y dirección) aunque se envíe el formulario dos veces
CREATE UNIQUE INDEX IF NOT EXISTS ux_cafe_name_addr ON cafes(name COLLATE NOCASE, address COLLATE NOCASE);`);

if (db.prepare('SELECT COUNT(*) n FROM cafes').get().n === 0) {
  const ins = db.prepare(`INSERT INTO cafes(name,address,description,schedule,phone,lat,lng,zone) VALUES (?,?,?,?,?,?,?,?)`);
  db.transaction(() => SEED.forEach((s) => ins.run(...s)))();
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
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'La cafetería no existe', 'NOT_FOUND');
  return n;
};
const getCafe = (id, req) => {
  const c = db.prepare('SELECT * FROM cafes WHERE id=?').get(id);
  const hidden = !c || (['draft', 'retired'].includes(c.status) && req.user?.role !== 'admin');
  if (hidden) throw new HttpError(404, 'La cafetería no existe', 'NOT_FOUND');
  return c;
};

const r = express.Router();

// Catálogo con búsqueda, filtros, orden y paginación
r.get('/', wrap(async (req, res) => {
  const { page, limit, offset } = pageParams(req.query, { defLimit: 12, maxLimit: 50 });
  const where = [];
  const params = [];
  const isAdmin = req.user?.role === 'admin' && req.query.includeAll === '1';
  if (!isAdmin) where.push(`status IN ('active','closed')`);

  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR zone LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like);
  }
  const zone = String(req.query.zone ?? '').trim();
  if (zone) { where.push('zone = ? COLLATE NOCASE'); params.push(zone); }
  const minRating = Number(req.query.minRating);
  if (req.query.minRating !== undefined && req.query.minRating !== '' && Number.isFinite(minRating) && minRating > 0 && minRating <= 5) {
    where.push('rating_avg >= ? AND rating_count > 0'); params.push(minRating);
  }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    where.push(`id IN (${ids.length ? ids.map(() => '?').join(',') : 'NULL'})`); params.push(...ids);
  }
  const ORDER = {
    rating: 'rating_avg DESC, rating_count DESC, name COLLATE NOCASE',
    reviews: 'rating_count DESC, rating_avg DESC, name COLLATE NOCASE',
    name: 'name COLLATE NOCASE',
  };
  const order = ORDER[req.query.sort] ?? ORDER.name;
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM cafes ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM cafes ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ items: rows.map(toCafe), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// Puntos para el mapa: solo cafeterías activas con coordenadas válidas
r.get('/map', wrap(async (_req, res) => {
  const rows = db.prepare(`SELECT * FROM cafes WHERE status='active'`).all()
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  res.json({ items: rows.map(toCafe) });
}));

r.get('/zones', wrap(async (_req, res) => {
  res.json({ items: db.prepare(`SELECT DISTINCT zone FROM cafes WHERE status IN ('active','closed') ORDER BY zone COLLATE NOCASE`).all().map((z) => z.zone) });
}));

r.get('/top', wrap(async (req, res) => {
  const { limit } = pageParams(req.query, { defLimit: 10, maxLimit: 30 });
  const rows = db.prepare(`SELECT * FROM cafes WHERE status='active' AND rating_count>0
    ORDER BY rating_avg DESC, rating_count DESC, name COLLATE NOCASE LIMIT ?`).all(limit);
  res.json({ items: rows.map(toCafe) });
}));

r.get('/:id', wrap(async (req, res) => res.json({ cafe: toCafe(getCafe(parseId(req.params.id), req)) })));

const COLS = '@name,@address,@description,@schedule,@phone,@lat,@lng,@zone,@status';
r.post('/', ...requireAdmin, wrap(async (req, res) => {
  const d = parse(cafeSchema, req.body);
  try {
    const info = db.prepare(`INSERT INTO cafes(name,address,description,schedule,phone,lat,lng,zone,status) VALUES (${COLS})`).run(d);
    res.status(201).json({ cafe: toCafe(db.prepare('SELECT * FROM cafes WHERE id=?').get(info.lastInsertRowid)) });
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'Ya existe una cafetería con ese nombre y dirección', 'DUPLICATE');
    throw e;
  }
}));

r.put('/:id', ...requireAdmin, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  getCafe(id, req);
  const d = parse(cafeSchema, req.body);
  try {
    db.prepare(`UPDATE cafes SET name=@name,address=@address,description=@description,schedule=@schedule,phone=@phone,
      lat=@lat,lng=@lng,zone=@zone,status=@status,updated_at=datetime('now') WHERE id=@id`).run({ ...d, id });
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, 'Ya existe una cafetería con ese nombre y dirección', 'DUPLICATE');
    throw e;
  }
  res.json({ cafe: toCafe(db.prepare('SELECT * FROM cafes WHERE id=?').get(id)) });
}));

// Baja lógica: conserva reseñas y Top 5 sin referencias rotas
r.delete('/:id', ...requireAdmin, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  getCafe(id, req);
  db.prepare(`UPDATE cafes SET status='retired', updated_at=datetime('now') WHERE id=?`).run(id);
  res.status(204).end();
}));

const app = createApp();
app.use('/cafes', r);

// Solo accesible entre servicios (el gateway NO lo expone). Lo llama reviews-service.
app.put('/internal/cafes/:id/rating', internalOnly, wrap(async (req, res) => {
  const d = parse(z.object({ avg: num('avg', { min: 0, max: 5 }), count: num('count', { min: 0, int: true }) }), req.body);
  db.prepare('UPDATE cafes SET rating_avg=?, rating_count=? WHERE id=?').run(d.avg, d.count, Number(req.params.id));
  res.json({ ok: true });
}));

start(app, 'catalog', Number(process.env.CATALOG_PORT || 4002));
