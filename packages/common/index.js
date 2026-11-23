// Utilidades compartidas por los microservicios (workspace @enscafe/common).
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite'; // SQLite incluido en Node 22.13+: sin módulos nativos que compilar
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { z, express };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
export const INTERNAL_KEY = process.env.INTERNAL_KEY || 'dev-internal-key';
export const URLS = {
  auth: process.env.AUTH_URL || 'http://localhost:4001',
  catalog: process.env.CATALOG_URL || 'http://localhost:4002',
  reviews: process.env.REVIEWS_URL || 'http://localhost:4003',
};

/* ---------- Errores ---------- */
export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export const isUnique = (e) => /UNIQUE constraint failed|PRIMARY KEY/i.test(e?.message ?? '') || [2067, 1555].includes(e?.errcode);
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- Base de datos (una por servicio) ---------- */
export function openDb(name) {
  const dir = process.env.DATA_DIR || path.join(ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, `${name}.db`));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  // Pequeño adaptador: añade db.transaction(fn) con BEGIN/COMMIT/ROLLBACK
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  return db;
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
export const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

/* ---------- Autenticación ---------- */
export const signToken = (u) =>
  jwt.sign({ name: u.name, role: u.role }, JWT_SECRET, { subject: String(u.id), expiresIn: '2h' });

export function authenticate(req, _res, next) {
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type === 'Bearer' && token) {
    try {
      const p = jwt.verify(token, JWT_SECRET);
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
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '20kb' })); // evita cuerpos gigantes
  app.use(authenticate);
  app.get('/health', (_req, res) => res.json({ ok: true }));
  return app;
}

export function start(app, name, port) {
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    if (err.type === 'entity.parse.failed')
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'El cuerpo de la solicitud no es JSON válido' } });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'La solicitud es demasiado grande' } });
    console.error(`[${name}]`, err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
  });
  app.listen(port, () => console.log(`[${name}] escuchando en http://localhost:${port}`));
}
