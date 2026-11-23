// API GATEWAY (puerto 4000): único punto de entrada para el frontend.
// Enruta /api/* al microservicio correcto, aplica límites de uso y traduce fallos de red a mensajes claros.
import rateLimit from 'express-rate-limit';
import { createApp, start, URLS, express } from '@enscafe/common';

const TIMEOUT = 8000;
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

const forward = (target) => async (req, res) => {
  const url = target + req.originalUrl.slice('/api'.length);
  try {
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(req.method);
    const r = await fetch(url, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    res.status(r.status);
    if (r.status === 204) return res.end();
    res.type('application/json').send(await r.text());
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError')
      return fail(res, 504, 'GATEWAY_TIMEOUT', 'El servidor tardó demasiado en responder. Intenta de nuevo');
    fail(res, 503, 'SERVICE_UNAVAILABLE', 'El servicio no está disponible por el momento. Intenta de nuevo en unos segundos');
  }
};

const app = createApp();
const limiter = (windowMs, limit, message) =>
  rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => fail(res, 429, 'RATE_LIMIT', message) });

app.use('/api', limiter(60_000, 300, 'Demasiadas solicitudes. Espera un momento'));
app.use('/api/auth/login', limiter(10 * 60_000, 20, 'Demasiados intentos de inicio de sesión. Espera unos minutos'));
app.use('/api/auth/register', limiter(60 * 60_000, 20, 'Demasiados registros desde esta conexión. Intenta más tarde'));

// Estado de los microservicios (útil para la demo)
app.get('/api/health', async (_req, res) => {
  const out = {};
  await Promise.all(Object.entries(URLS).map(async ([name, u]) => {
    try { out[name] = (await fetch(`${u}/health`, { signal: AbortSignal.timeout(2000) })).ok ? 'up' : 'down'; }
    catch { out[name] = 'down'; }
  }));
  res.json({ gateway: 'up', ...out });
});

app.use('/api/auth', forward(URLS.auth));
app.use('/api/cafes', forward(URLS.catalog));
app.use('/api/reviews', forward(URLS.reviews));
app.use('/api/top5', forward(URLS.reviews));
// /internal/* no se enruta: solo es accesible entre servicios

start(app, 'gateway', Number(process.env.PORT || 4000));
