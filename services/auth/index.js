// Microservicio de AUTENTICACIÓN y USUARIOS (esquema "auth" en PostgreSQL)
// Sesión = access JWT (15 min) + refresh token opaco rotativo (guardado hasheado en BD), ambos en cookies HttpOnly.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import {
  z, express, createApp, start, openDb, migrate, wrap, parse, text, HttpError, isUnique, toId,
  signToken, requireAuth, requireAdmin, SEED_DEMO, INTERNAL_HOST, ACCESS_TTL_SECONDS,
  COOKIE_NAMES, parseCookies, serializeCookie,
} from '@enscafe/common';
import {
  checkMailConfig, sendMail, verifyEmailMessage, resetPasswordMessage, passwordChangedMessage, accountExistsMessage,
} from './mailer.js';

checkMailConfig();
const db = openDb('auth');
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

const REFRESH_IDLE_S = Number(process.env.REFRESH_IDLE_DAYS || 14) * 86400;      // inactividad máxima
const REFRESH_ABSOLUTE_S = Number(process.env.REFRESH_ABSOLUTE_DAYS || 30) * 86400; // duración máxima total
const ROTATE_GRACE_S = Number(process.env.ROTATE_GRACE_SECONDS || 10);           // tolera pestañas que refrescan a la vez
const VERIFY_TTL_H = 24;
const RESET_TTL_MIN = 30;
const RESEND_COOLDOWN_S = 60;

async function init() {
  if (process.env.AUTO_MIGRATE !== 'false') await migrate(db, 'auth', MIGRATIONS);
  // Solo desarrollo: administrador de prueba. En producción usa: pnpm --filter @enscafe/auth create-admin
  if (SEED_DEMO && !(await db.get(`SELECT 1 FROM auth.users WHERE role = 'admin'`))) {
    await db.run(`INSERT INTO auth.users(name, email, password_hash, role, email_verified_at) VALUES ($1, $2, $3, 'admin', now())`,
      ['Administrador', 'admin@enscafe.mx', bcrypt.hashSync('Admin12345', 10)]);
    console.log('[auth] administrador de DESARROLLO creado: admin@enscafe.mx / Admin12345');
  }
  const clean = () => db.run(`
    WITH a AS (DELETE FROM auth.sessions WHERE absolute_expires_at < now() - interval '1 day' OR expires_at < now() - interval '1 day')
    DELETE FROM auth.email_tokens WHERE expires_at < now() - interval '7 days'`).catch((e) => console.error('[auth] limpieza:', e.message));
  clean();
  setInterval(clean, 6 * 3600_000).unref();
}

const DUMMY_HASH = bcrypt.hashSync('no-existe', 10); // iguala el tiempo de respuesta si el correo no existe
const toUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, verified: !!u.email_verified_at, createdAt: u.created_at });
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

const email = z
  .string({ required_error: 'El correo es obligatorio', invalid_type_error: 'El correo debe ser texto' })
  .trim().toLowerCase()
  .min(1, 'El correo es obligatorio')
  .max(120, 'El correo no puede superar 120 caracteres')
  .email('El correo no tiene un formato válido');
const password = z
  .string({ required_error: 'La contraseña es obligatoria', invalid_type_error: 'La contraseña debe ser texto' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres');
const tokenField = z
  .string({ required_error: 'El enlace no es válido', invalid_type_error: 'El enlace no es válido' })
  .min(20, 'El enlace no es válido').max(100, 'El enlace no es válido');

const registerSchema = z.object({ name: text('El nombre', { min: 2, max: 60 }), email, password });
const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'La contraseña es obligatoria' }).min(1, 'La contraseña es obligatoria').max(72, 'Contraseña no válida'),
});

/* ---------- Sesiones y cookies ---------- */
const setAccessCookie = (res, user, sid) =>
  res.append('Set-Cookie', serializeCookie(COOKIE_NAMES.access, signToken(user, { sid }), { maxAge: ACCESS_TTL_SECONDS }));
// El refresh token solo viaja a /api/auth (Path) y nunca es legible desde JavaScript
const setRefreshCookie = (res, token, maxAge) =>
  res.append('Set-Cookie', serializeCookie(COOKIE_NAMES.refresh, token, { maxAge, path: '/api/auth' }));
const clearCookies = (res) => {
  res.append('Set-Cookie', serializeCookie(COOKIE_NAMES.access, '', { maxAge: 0 }));
  res.append('Set-Cookie', serializeCookie(COOKIE_NAMES.refresh, '', { maxAge: 0, path: '/api/auth' }));
};

async function startSession(req, res, user) {
  const token = newToken();
  const familyId = crypto.randomUUID();
  const s = await db.get(
    `INSERT INTO auth.sessions(user_id, family_id, token_hash, expires_at, absolute_expires_at, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), now() + make_interval(secs => $5), $6) RETURNING id`,
    [user.id, familyId, sha256(token), REFRESH_IDLE_S, REFRESH_ABSOLUTE_S, String(req.headers['user-agent'] || '').slice(0, 200)]);
  setAccessCookie(res, user, s.id);
  setRefreshCookie(res, token, REFRESH_IDLE_S);
}
const revokeAllSessions = (userId) =>
  db.run(`UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

/* ---------- Correos con token ---------- */
async function issueEmailToken(userId, purpose, ttlSeconds) {
  const token = newToken();
  await db.tx(async (t) => {
    await t.run(`UPDATE auth.email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]); // invalida los anteriores
    await t.run(`INSERT INTO auth.email_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [userId, purpose, sha256(token), ttlSeconds]);
  });
  return token;
}
const recentlyIssued = (userId, purpose) =>
  db.get(`SELECT 1 FROM auth.email_tokens WHERE user_id = $1 AND purpose = $2 AND created_at > now() - make_interval(secs => $3)`, [userId, purpose, RESEND_COOLDOWN_S]);
// Fire-and-forget: la respuesta no espera al SMTP, así el tiempo no revela si la cuenta existe
const later = (fn) => { fn().catch((e) => console.error('[auth] tarea en segundo plano:', e.message)); };

const sendVerification = async (user) => {
  const token = await issueEmailToken(user.id, 'verify', VERIFY_TTL_H * 3600);
  await sendMail({ to: user.email, ...verifyEmailMessage(user.name, token, VERIFY_TTL_H) });
};
const sendReset = async (user) => {
  const token = await issueEmailToken(user.id, 'reset', RESET_TTL_MIN * 60);
  await sendMail({ to: user.email, ...resetPasswordMessage(user.name, token, RESET_TTL_MIN) });
};

const r = express.Router();
const GENERIC_REGISTER = { message: 'Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja (y la carpeta de spam).' };
const GENERIC_RESEND = { message: 'Si el correo corresponde a una cuenta pendiente de confirmar, te enviamos un nuevo enlace.' };
const GENERIC_FORGOT = { message: 'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Vence en 30 minutos.' };

r.post('/register', wrap(async (req, res) => {
  const d = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(d.password, 10);
  try {
    const user = await db.get(`INSERT INTO auth.users(name, email, password_hash) VALUES ($1, $2, $3) RETURNING *`, [d.name, d.email, hash]);
    later(() => sendVerification(user));
  } catch (e) {
    // Anti-enumeración: misma respuesta exista o no el correo; al dueño se le avisa por correo
    if (!isUnique(e)) throw e;
    later(async () => {
      const u = await db.get(`SELECT name, email FROM auth.users WHERE lower(email) = $1`, [d.email]);
      if (u) await sendMail({ to: u.email, ...accountExistsMessage(u.name) });
    });
  }
  res.status(202).json(GENERIC_REGISTER);
}));

r.post('/login', wrap(async (req, res) => {
  const d = parse(loginSchema, req.body);
  const user = await db.get(`SELECT * FROM auth.users WHERE lower(email) = lower($1)`, [d.email]);
  const ok = await bcrypt.compare(d.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Correo o contraseña incorrectos', 'BAD_CREDENTIALS');
  if (user.status === 'suspended') throw new HttpError(403, 'Tu cuenta está suspendida. Contacta al administrador', 'SUSPENDED');
  if (!user.email_verified_at) throw new HttpError(403, 'Confirma tu correo para iniciar sesión. Revisa tu bandeja o pide un nuevo enlace', 'EMAIL_NOT_VERIFIED');
  await startSession(req, res, user);
  res.json({ user: toUser(user) });
}));

r.post('/verify-email', wrap(async (req, res) => {
  const { token } = parse(z.object({ token: tokenField }), req.body);
  const ok = await db.tx(async (t) => {
    const row = await t.get(
      `UPDATE auth.email_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(token)]);
    if (!row) return false;
    await t.run(`UPDATE auth.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [row.user_id]);
    return true;
  });
  if (!ok) throw new HttpError(400, 'El enlace no es válido o ya venció. Pide uno nuevo', 'TOKEN_INVALID_LINK');
  res.json({ message: 'Correo confirmado. Ya puedes iniciar sesión.' });
}));

r.post('/resend-verification', wrap(async (req, res) => {
  const { email: addr } = parse(z.object({ email }), req.body);
  const user = await db.get(`SELECT * FROM auth.users WHERE lower(email) = $1`, [addr]);
  if (user && !user.email_verified_at && user.status === 'active' && !(await recentlyIssued(user.id, 'verify'))) later(() => sendVerification(user));
  res.status(202).json(GENERIC_RESEND);
}));

r.post('/forgot-password', wrap(async (req, res) => {
  const { email: addr } = parse(z.object({ email }), req.body);
  const user = await db.get(`SELECT * FROM auth.users WHERE lower(email) = $1`, [addr]);
  if (user && user.status === 'active' && !(await recentlyIssued(user.id, 'reset'))) later(() => sendReset(user));
  res.status(202).json(GENERIC_FORGOT);
}));

r.post('/reset-password', wrap(async (req, res) => {
  const d = parse(z.object({ token: tokenField, password }), req.body);
  const hash = await bcrypt.hash(d.password, 10);
  const user = await db.tx(async (t) => {
    const row = await t.get(
      `UPDATE auth.email_tokens SET used_at = now()
       WHERE token_hash = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [sha256(d.token)]);
    if (!row) return null;
    // Quien recibe el enlace controla el correo: también queda verificado. Y se cierran TODAS las sesiones.
    const u = await t.get(`UPDATE auth.users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING *`, [row.user_id, hash]);
    await t.run(`UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
    await t.run(`UPDATE auth.email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL`, [row.user_id]);
    return u;
  });
  if (!user) throw new HttpError(400, 'El enlace no es válido o ya venció. Pide uno nuevo', 'TOKEN_INVALID_LINK');
  later(() => sendMail({ to: user.email, ...passwordChangedMessage(user.name) }));
  clearCookies(res);
  res.json({ message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' });
}));

// Renueva el access token. El refresh token rota en cada uso; presentar uno ya usado (fuera de la tolerancia) = posible robo.
r.post('/refresh', wrap(async (req, res) => {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAMES.refresh];
  const denied = (message = 'Tu sesión expiró. Inicia sesión de nuevo') => {
    clearCookies(res);
    return new HttpError(401, message, 'NO_SESSION');
  };
  if (!raw || raw.length > 100) throw denied();
  const nextToken = newToken();

  const result = await db.tx(async (t) => {
    const s = await t.get(`SELECT * FROM auth.sessions WHERE token_hash = $1 FOR UPDATE`, [sha256(raw)]);
    if (!s) return { fail: true };
    const now = Date.now();
    if (s.revoked_at || new Date(s.expires_at) < now || new Date(s.absolute_expires_at) < now) return { fail: true };
    if (s.rotated_at) {
      const age = (now - new Date(s.rotated_at)) / 1000;
      if (age > ROTATE_GRACE_S) { // reutilización: se revoca toda la cadena
        await t.run(`UPDATE auth.sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id]);
        console.warn(`[auth] posible reutilización de refresh token (usuario ${s.user_id}); sesión revocada`);
        return { fail: true };
      }
      // Petición simultánea (otra pestaña): ya se emitió el token nuevo; solo se renueva el access token
      const u = await t.get(`SELECT * FROM auth.users WHERE id = $1`, [s.user_id]);
      return { user: u, sid: s.id, graceOnly: true };
    }
    const u = await t.get(`SELECT * FROM auth.users WHERE id = $1`, [s.user_id]);
    if (!u || u.status !== 'active') {
      await t.run(`UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [s.user_id]);
      return { fail: true, suspended: u?.status === 'suspended' };
    }
    await t.run(`UPDATE auth.sessions SET rotated_at = now() WHERE id = $1`, [s.id]);
    const left = Math.min(REFRESH_IDLE_S, Math.max(0, Math.floor((new Date(s.absolute_expires_at) - now) / 1000)));
    const ns = await t.get(
      `INSERT INTO auth.sessions(user_id, family_id, token_hash, expires_at, absolute_expires_at, user_agent)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6) RETURNING id`,
      [s.user_id, s.family_id, sha256(nextToken), left, s.absolute_expires_at, s.user_agent]);
    return { user: u, sid: ns.id, left };
  });

  if (result.fail) throw denied(result.suspended ? 'Tu cuenta está suspendida' : undefined);
  setAccessCookie(res, result.user, result.sid);
  if (!result.graceOnly) setRefreshCookie(res, nextToken, result.left);
  res.json({ user: toUser(result.user) });
}));

r.post('/logout', wrap(async (req, res) => {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAMES.refresh];
  if (raw && raw.length <= 100)
    await db.run(`UPDATE auth.sessions SET revoked_at = now() WHERE family_id = (SELECT family_id FROM auth.sessions WHERE token_hash = $1) AND revoked_at IS NULL`, [sha256(raw)]);
  clearCookies(res);
  res.json({ ok: true });
}));

r.post('/logout-all', requireAuth, wrap(async (req, res) => {
  await revokeAllSessions(req.user.id);
  clearCookies(res);
  res.json({ ok: true });
}));

const currentUser = async (req) => {
  const u = await db.get(`SELECT * FROM auth.users WHERE id = $1`, [req.user.id]);
  if (!u) throw new HttpError(401, 'La cuenta ya no existe', 'UNAUTHORIZED');
  if (u.status === 'suspended') throw new HttpError(403, 'Tu cuenta está suspendida', 'SUSPENDED');
  return u;
};

r.get('/me', requireAuth, wrap(async (req, res) => res.json({ user: toUser(await currentUser(req)) })));

r.patch('/me', requireAuth, wrap(async (req, res) => {
  await currentUser(req);
  const d = parse(z.object({ name: text('El nombre', { min: 2, max: 60 }) }), req.body);
  const u = await db.get(`UPDATE auth.users SET name = $1 WHERE id = $2 RETURNING *`, [d.name, req.user.id]);
  res.json({ user: toUser(u) });
}));

// ---- Administración de usuarios (gestionarUsuarios) ----
r.get('/users', ...requireAdmin, wrap(async (_req, res) => {
  res.json({ items: (await db.all(`SELECT * FROM auth.users ORDER BY id DESC LIMIT 200`)).map(toUser) });
}));
r.patch('/users/:id/status', ...requireAdmin, wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'suspended'], { errorMap: () => ({ message: 'Estado no válido' }) }) }), req.body);
  const id = toId(req.params.id);
  if (id === req.user.id) throw new HttpError(409, 'No puedes suspender tu propia cuenta', 'SELF_ACTION');
  const u = id && (await db.get(`UPDATE auth.users SET status = $1 WHERE id = $2 RETURNING *`, [status, id]));
  if (!u) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
  if (status === 'suspended') await revokeAllSessions(u.id); // no podrá renovar su sesión
  res.json({ user: toUser(u) });
}));

const app = createApp({ db });
app.use('/auth', r);
start(app, 'auth', Number(process.env.AUTH_PORT || 4001), { init, host: INTERNAL_HOST });
