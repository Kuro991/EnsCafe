// Utilidades compartidas por los microservicios (workspace @enscafe/common).
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { z, express };

// Carga el .env de la raíz si existe (en producción las variables vienen del hosting). No pisa variables ya definidas.
try { process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env')); } catch { /* sin .env */ }

/* ---------- Entorno y guardas de producción ---------- */
export const PROD = process.env.NODE_ENV === 'production';
// Datos de ejemplo (administrador y cafeterías demo) solo en desarrollo, salvo que se pida explícitamente
export const SEED_DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : !PROD;

if (PROD) {
  const missing = ['JWT_SECRET', 'INTERNAL_KEY'].filter((k) => !process.env[k] || process.env[k].length < 32);
  if (missing.length) {
    console.error(`[config] En producción son obligatorios (mínimo 32 caracteres): ${missing.join(', ')}`);
    process.exit(1);
  }
}
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
export const INTERNAL_KEY = process.env.INTERNAL_KEY || 'dev-internal-key';
export const URLS = {
  auth: process.env.AUTH_URL || 'http://127.0.0.1:4001',
  catalog: process.env.CATALOG_URL || 'http://127.0.0.1:4002',
  reviews: process.env.REVIEWS_URL || 'http://127.0.0.1:4003',
};
// Los servicios internos solo escuchan en loopback; únicamente el gateway es público
export const INTERNAL_HOST = process.env.BIND_HOST || '127.0.0.1';

/* ---------- Errores ---------- */
export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export const isUnique = (e) => e?.code === '23505'; // unique_violation de PostgreSQL
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- PostgreSQL ---------- */
pg.types.setTypeParser(20, (v) => Number(v)); // int8 / COUNT(*) llegan como número, no como texto
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // numeric

const helpers = (client) => ({
  query: (sql, params = []) => client.query(sql, params),
  all: async (sql, params = []) => (await client.query(sql, params)).rows,
  get: async (sql, params = []) => (await client.query(sql, params)).rows[0] ?? null,
  run: (sql, params = []) => client.query(sql, params),
});

// Cada servicio usa SU esquema (auth, catalog, reviews). Con DATABASE_URL compartida van en una sola base;
// con AUTH_DATABASE_URL / CATALOG_DATABASE_URL / REVIEWS_DATABASE_URL pueden ir en bases o servidores distintos.
export function openDb(name) {
  const url =
    process.env[`${name.toUpperCase()}_DATABASE_URL`] ||
    process.env.DATABASE_URL ||
    (PROD ? null : 'postgres://enscafe:enscafe@localhost:5432/enscafe');
  if (!url) {
    console.error(`[${name}] Falta DATABASE_URL (o ${name.toUpperCase()}_DATABASE_URL)`);
    process.exit(1);
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  pool.on('error', (e) => console.error(`[${name}] error en una conexión inactiva:`, e.message));
  return {
    pool,
    ...helpers(pool),
    // Transacción: fn recibe un cliente con los mismos métodos; COMMIT si termina, ROLLBACK si lanza error
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(helpers(client));
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

// Migraciones SQL versionadas: archivos 001_*.sql, 002_*.sql… Cada una se aplica una sola vez, en orden y en transacción.
export async function migrate(db, schema, dir) {
  const files = fs.readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const c = await db.pool.connect();
  const lock = `enscafe-migrate-${schema}`;
  try {
    await c.query('SELECT pg_advisory_lock(hashtext($1))', [lock]); // evita carreras si arrancan varias instancias
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query(`SELECT name FROM ${schema}.schema_migrations`)).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      try {
        await c.query('BEGIN');
        await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await c.query(`INSERT INTO ${schema}.schema_migrations(name) VALUES ($1)`, [f]);
        await c.query('COMMIT');
        console.log(`[${schema}] migración aplicada: ${f}`);
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`la migración ${f} falló: ${e.message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]).catch(() => {});
    c.release();
  }
}

/* ---------- Validación (mensajes en español) ---------- */
export const text = (label, { min = 1, max = 100 } = {}) =>
  z
    .string({ required_error: `${label} es obligatorio`, invalid_type_error: `${label} debe ser texto` })
    .trim()
    .min(min, min === 1 ? `${label} es obligatorio` : `${label} debe tener al menos ${min} caracteres`)
    .max(max, `${label} no puede superar ${max} caracteres`);

export const optText = (label, max) =>
  z
    .string({ invalid_type_error: `${label} debe ser texto` })
    .trim()
    .max(max, `${label} no puede superar ${max} caracteres`)
    .nullish()
    .transform((v) => v ?? '');

// Acepta números o strings numéricos ("12.5"), rechaza "", "abc", NaN e Infinity.
export const num = (label, { min, max, int = false } = {}) => {
  let n = z
    .number({ required_error: `${label} es obligatorio`, invalid_type_error: `${label} debe ser un número` })
    .finite(`${label} debe ser un número`);
  if (int) n = n.int(`${label} debe ser un número entero`);
  if (min !== undefined) n = n.min(min, `${label} no puede ser menor que ${min}`);
  if (max !== undefined) n = n.max(max, `${label} no puede ser mayor que ${max}`);
  return z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), n);
};

export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields = {};
  for (const i of r.error.issues) {
    const k = i.path.join('.') || '_';
    if (!fields[k]) fields[k] = i.message;
  }
  throw new HttpError(422, 'Revisa los campos marcados', 'VALIDATION', fields);
}

export function pageParams(query, { defLimit = 12, maxLimit = 50 } = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = defLimit;
  limit = Math.min(limit, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}
// En PostgreSQL el carácter de escape por defecto de LIKE/ILIKE es la barra invertida
export const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');
export const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? n : null;
};

/* ---------- Autenticación ---------- */
// Access token de vida corta (15 min). La sesión larga la mantiene un refresh token opaco guardado (hasheado) en la BD.
export const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TTL_SECONDS || 900);
export const signToken = (u, extra = {}) =>
  jwt.sign({ name: u.name, role: u.role, ...extra }, JWT_SECRET, { subject: String(u.id), expiresIn: ACCESS_TTL_SECONDS, algorithm: 'HS256' });

/* ---------- Cookies HttpOnly ---------- */
export const COOKIE_NAMES = { access: 'enscafe_at', refresh: 'enscafe_rt' };
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie malformada */ }
  }
  return out;
}
// SameSite: "lax" si frontend y API comparten dominio de sitio (recomendado: app.tudominio.com + api.tudominio.com);
// "none" si están en sitios distintos (p. ej. *.pages.dev + otro hosting). "none" exige Secure.
export function serializeCookie(name, value, { maxAge, path: p = '/' } = {}) {
  let sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) sameSite = 'lax';
  const secure = PROD || sameSite === 'none';
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, 'HttpOnly', `SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`];
  if (secure) parts.push('Secure');
  if (process.env.COOKIE_DOMAIN) parts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge ?? 0))}`);
  return parts.join('; ');
}

export function authenticate(req, _res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type === 'Bearer' && token) {
    try {
      const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      req.user = { id: Number(p.sub), name: p.name, role: p.role };
    } catch (e) {
      req.authError = e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
    }
  }
  next();
}
export function requireAuth(req, _res, next) {
  if (req.user) return next();
  const expired = req.authError === 'TOKEN_EXPIRED';
  next(new HttpError(401, expired ? 'Tu sesión expiró. Inicia sesión de nuevo' : 'Debes iniciar sesión', req.authError || 'UNAUTHORIZED'));
}
export const requireAdmin = [
  requireAuth,
  (req, _res, next) =>
    req.user.role === 'admin' ? next() : next(new HttpError(403, 'No tienes permisos para esta acción', 'FORBIDDEN')),
];
export const internalOnly = (req, _res, next) =>
  req.headers['x-internal-key'] === INTERNAL_KEY ? next() : next(new HttpError(403, 'Solo uso interno', 'FORBIDDEN'));

/* ---------- Llamadas entre servicios (con timeout) ---------- */
export async function callService(url, { method = 'GET', body, internal = false, timeout = 4000 } = {}) {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(internal ? { 'x-internal-key': INTERNAL_KEY } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    const raw = await r.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* respuesta no JSON */ }
    return { ok: r.ok, status: r.status, data };
  } catch {
    throw new HttpError(503, 'Un servicio interno no está disponible. Intenta de nuevo en unos segundos', 'SERVICE_UNAVAILABLE');
  }
}

/* ---------- App base ---------- */
// CORS: solo los orígenes de CORS_ORIGINS (separados por coma). En desarrollo se permite el frontend local.
export function corsOrigins() {
  const list = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  return PROD ? false : ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

export function createApp({ db } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de Cloudflare/un proxy: TRUST_PROXY=1 (número de saltos) para que req.ip sea la IP real
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: corsOrigins(), credentials: true })); // credentials: el navegador envía las cookies HttpOnly
  app.use(express.json({ limit: '20kb' })); // evita cuerpos gigantes
  app.use(authenticate);
  app.get('/health', async (_req, res) => {
    try {
      if (db) await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  return app;
}

const isDbDown = (e) =>
  ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'].includes(e?.code) ||
  /^(08|53|57P0)/.test(e?.code ?? '') ||
  /timeout exceeded when trying to connect|Connection terminated|terminating connection/i.test(e?.message ?? '');

export async function start(app, name, port, { init, host } = {}) {
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    if (err.type === 'entity.parse.failed')
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'El cuerpo de la solicitud no es JSON válido' } });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'La solicitud es demasiado grande' } });
    if (isDbDown(err)) {
      console.error(`[${name}] base de datos no disponible:`, err.message);
      return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'La base de datos no está disponible. Intenta de nuevo en unos segundos' } });
    }
    console.error(`[${name}]`, err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
  });

  // La base puede tardar en estar lista (p. ej. el contenedor acaba de arrancar): reintenta antes de rendirse
  for (let attempt = 1; init; attempt++) {
    try { await init(); break; }
    catch (e) {
      if (attempt >= 15 || !isDbDown(e)) { console.error(`[${name}] no se pudo inicializar:`, e.message); process.exit(1); }
      console.warn(`[${name}] esperando a la base de datos… (${attempt}/15)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const ready = () => console.log(`[${name}] escuchando en el puerto ${port}`);
  return host ? app.listen(port, host, ready) : app.listen(port, ready);
}
