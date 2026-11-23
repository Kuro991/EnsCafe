// Cliente HTTP único: timeout, cancelación, errores legibles y sesión por cookies HttpOnly.
// El navegador guarda y envía las cookies solo (JavaScript nunca ve los tokens). Si el access token venció,
// se renueva UNA vez con /auth/refresh (aunque varias peticiones fallen a la vez) y se reintenta la petición.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR', fields } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// Solo una pista no sensible ("hubo sesión") para no pedir /me ni renovar a los visitantes anónimos
export const SESSION_HINT = 'enscafe.session';
export const hasSessionHint = () => { try { return localStorage.getItem(SESSION_HINT) === '1'; } catch { return false; } };
export const setSessionHint = (on) => { try { on ? localStorage.setItem(SESSION_HINT, '1') : localStorage.removeItem(SESSION_HINT); } catch { /* modo privado */ } };

// En producción el API puede estar en otro dominio (VITE_API_URL); en desarrollo /api pasa por el proxy de Vite
export const API_BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api`;
const NO_REFRESH = /^\/auth\/(login|register|refresh|logout|verify-email|resend-verification|forgot-password|reset-password)/;

async function request(path, { method = 'GET', body, signal, timeout = 10000, captcha } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    let res;
    let raw;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        signal: ctrl.signal,
        credentials: 'include', // envía/recibe las cookies de sesión
        headers: {
          'X-Requested-With': 'enscafe', // defensa CSRF: el gateway exige esta cabecera en peticiones que modifican datos
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(captcha ? { 'X-Captcha-Token': captcha } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      raw = await res.text();
    } catch (e) {
      if (signal?.aborted) throw e; // la pantalla cambió: no es un error para el usuario
      if (timedOut) throw new ApiError('El servidor tardó demasiado en responder. Intenta de nuevo', { code: 'TIMEOUT' });
      throw new ApiError(
        navigator.onLine === false ? 'Sin conexión a internet. Revisa tu red' : 'No se pudo conectar con el servidor. Intenta de nuevo en unos segundos',
        { code: 'NETWORK' },
      );
    }
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* respuesta que no es JSON (p. ej. error HTML de un proxy) */ }
    if (!res.ok) {
      const err = data?.error;
      throw new ApiError(err?.message || `El servidor respondió con un error inesperado (${res.status})`, {
        status: res.status, code: err?.code || 'HTTP_ERROR', fields: err?.fields,
      });
    }
    if (res.status !== 204 && data === null) throw new ApiError('Respuesta inesperada del servidor', { status: res.status, code: 'BAD_RESPONSE' });
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

let refreshing = null; // una sola renovación a la vez
let lastRefreshOk = 0; // cuándo terminó la última renovación exitosa
function refreshSession() {
  refreshing ??= request('/auth/refresh', { method: 'POST' })
    .then((d) => { lastRefreshOk = Date.now(); return d; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, opts = {}) {
  const startedAt = Date.now();
  try {
    return await request(path, opts);
  } catch (e) {
    const expired = e instanceof ApiError && e.status === 401 && ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED'].includes(e.code);
    if (!expired || NO_REFRESH.test(path) || !hasSessionHint()) throw e;
    try {
      // si otra petición ya renovó la sesión mientras esta viajaba, basta con reintentar
      if (lastRefreshOk < startedAt) await refreshSession();
    } catch (re) {
      if (re instanceof ApiError && re.status === 401) { // la sesión ya no existe (vencida, revocada o cerrada en otro lado)
        setSessionHint(false);
        window.dispatchEvent(new Event('enscafe:unauthorized'));
        throw e;
      }
      throw re; // sin red u otro fallo temporal: la sesión sigue; solo falló esta petición
    }
    return request(path, opts);
  }
}

export async function fetchCafesByIds(ids, signal) {
  const list = [...new Set(ids)].slice(0, 50);
  if (!list.length) return {};
  const { items } = await api(`/cafes?ids=${list.join(',')}&limit=50`, { signal });
  return Object.fromEntries(items.map((c) => [c.id, c]));
}
