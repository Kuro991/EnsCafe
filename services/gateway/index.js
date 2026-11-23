// API GATEWAY (puerto 4000): único punto de entrada para el frontend.
// Enruta /api/* al microservicio correcto, aplica límites de uso y traduce fallos de red a mensajes claros.
import rateLimit from 'express-rate-limit';
import { createApp, start, URLS, express, PROD, corsOrigins, parseCookies, COOKIE_NAMES } from '@enscafe/common';

const TIMEOUT = 8000;
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// Cookie HttpOnly -> cabecera Authorization para los microservicios (el navegador nunca ve el token)
const bearerFor = (req) => {
  if (req.headers.authorization) return req.headers.authorization;
  const at = parseCookies(req.headers.cookie)[COOKIE_NAMES.access];
  return at ? `Bearer ${at}` : null;
};

const forward = (target) => async (req, res) => {
  const url = target + req.originalUrl.slice('/api'.length);
  try {
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
    const r = await fetch(url, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        ...(bearerFor(req) ? { authorization: bearerFor(req) } : {}),
        // el refresh token (cookie con Path=/api/auth) solo se reenvía al servicio de autenticación
        ...(target === URLS.auth && req.headers.cookie ? { cookie: req.headers.cookie } : {}),
        'user-agent': req.headers['user-agent'] || '',
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    res.status(r.status);
    for (const c of r.headers.getSetCookie?.() ?? []) res.append('Set-Cookie', c);
    res.set('Cache-Control', 'no-store');
    if (r.status === 204) return res.end();
    res.type('application/json').send(await r.text());
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError')
      return fail(res, 504, 'GATEWAY_TIMEOUT', 'El servidor tardó demasiado en responder. Intenta de nuevo');
    fail(res, 503, 'SERVICE_UNAVAILABLE', 'El servicio no está disponible por el momento. Intenta de nuevo en unos segundos');
  }
};

const app = createApp();

/* ---------- CSRF ----------
   Las cookies viajan solas, así que toda petición que modifica datos debe (1) traer la cabecera personalizada
   X-Requested-With: enscafe (un sitio ajeno no puede enviarla sin pasar el preflight de CORS) y (2) si trae Origin,
   que sea uno de CORS_ORIGINS. Además las cookies son SameSite. */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (SAFE.has(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'enscafe') return fail(res, 403, 'CSRF', 'Solicitud no permitida (falta la cabecera de seguridad)');
  const allowed = corsOrigins();
  const origin = req.headers.origin;
  if (origin && Array.isArray(allowed) && !allowed.includes(origin)) return fail(res, 403, 'CSRF', 'Origen no permitido');
  if (origin && allowed === false) return fail(res, 403, 'CSRF', 'Origen no permitido');
  next();
});
// Detrás de Cloudflare la IP real del visitante llega en CF-Connecting-IP. Solo se confía en esa cabecera si
// TRUST_CLOUDFLARE=true (es decir, si el origen únicamente es alcanzable a través de Cloudflare / Tunnel).
const clientIp = (req) => (process.env.TRUST_CLOUDFLARE === 'true' && req.headers['cf-connecting-ip']) || req.ip;
const limiter = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: clientIp,
    validate: { xForwardedForHeader: false, trustProxy: false },
    handler: (_req, res) => fail(res, 429, 'RATE_LIMIT', message) });

app.use('/api', limiter(60_000, 300, 'Demasiadas solicitudes. Espera un momento'));
app.use('/api/auth/login', limiter(10 * 60_000, 20, 'Demasiados intentos de inicio de sesión. Espera unos minutos'));
app.use('/api/auth/register', limiter(60 * 60_000, 20, 'Demasiados registros desde esta conexión. Intenta más tarde'));
app.use('/api/auth/forgot-password', limiter(60 * 60_000, 10, 'Demasiadas solicitudes de recuperación. Intenta más tarde'));
app.use('/api/auth/resend-verification', limiter(60 * 60_000, 10, 'Demasiadas solicitudes. Intenta más tarde'));
app.use('/api/auth/reset-password', limiter(60 * 60_000, 20, 'Demasiados intentos. Intenta más tarde'));
app.use('/api/auth/verify-email', limiter(60 * 60_000, 30, 'Demasiados intentos. Intenta más tarde'));
app.use('/api/auth/refresh', limiter(60_000, 60, 'Demasiadas renovaciones de sesión. Espera un momento'));

// Estado de los microservicios (útil para la demo)
app.get('/api/health', async (_req, res) => {
  const out = {};
  await Promise.all(Object.entries(URLS).map(async ([name, u]) => {
    try { out[name] = (await fetch(`${u}/health`, { signal: AbortSignal.timeout(2000) })).ok ? 'up' : 'down'; }
    catch { out[name] = 'down'; }
  }));
  res.json({ gateway: 'up', ...out });
});

/* ---------- CAPTCHA (Cloudflare Turnstile) ----------
   El navegador manda el token en X-Captcha-Token; aquí se valida contra Cloudflare. Cada token sirve una sola vez. */
const CAPTCHA_ON = !!process.env.TURNSTILE_SECRET && process.env.CAPTCHA_DISABLED !== 'true';
if (PROD && !CAPTCHA_ON && process.env.CAPTCHA_DISABLED !== 'true') {
  console.error('[gateway] En producción define TURNSTILE_SECRET (o CAPTCHA_DISABLED=true bajo tu responsabilidad)');
  process.exit(1);
}
if (!CAPTCHA_ON) console.warn('[gateway] CAPTCHA desactivado (sin TURNSTILE_SECRET)');
const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const captcha = async (req, res, next) => {
  if (!CAPTCHA_ON) return next();
  const token = String(req.headers['x-captcha-token'] || '');
  if (!token || token.length > 2048) return fail(res, 400, 'CAPTCHA_REQUIRED', 'Completa la verificación anti-robots e intenta de nuevo');
  try {
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token, remoteip: clientIp(req) || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    if (data.success) return next();
    const codes = data['error-codes'] || [];
    console.warn('[gateway] captcha rechazado:', codes.join(','));
    if (codes.includes('internal-error')) return fail(res, 503, 'CAPTCHA_UNAVAILABLE', 'No pudimos verificar el anti-robots. Intenta de nuevo');
    return fail(res, 400, 'CAPTCHA_FAILED', 'La verificación anti-robots falló o venció. Inténtalo de nuevo');
  } catch {
    return fail(res, 503, 'CAPTCHA_UNAVAILABLE', 'No pudimos verificar el anti-robots. Intenta de nuevo en unos segundos');
  }
};
const post = (path) => (req, res, next) => (req.method === 'POST' && req.path === path ? captcha(req, res, next) : next());
// Endpoints que abusan los bots: registro, login, correos (recuperar / reenviar) y publicar reseñas
for (const p of ['/register', '/login', '/forgot-password', '/resend-verification']) app.use('/api/auth', post(p));
app.use('/api/reviews', post('/'));

app.use('/api/auth', forward(URLS.auth));
app.use('/api/cafes', forward(URLS.catalog));
app.use('/api/reviews', forward(URLS.reviews));
app.use('/api/top5', forward(URLS.reviews));
// /internal/* no se enruta: solo es accesible entre servicios

// El gateway es el único servicio público: escucha en todas las interfaces y usa PORT si el hosting lo asigna
start(app, 'gateway', Number(process.env.PORT || process.env.GATEWAY_PORT || 4000));
