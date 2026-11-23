// Cliente HTTP único: timeout, cancelación, errores legibles y manejo de sesión expirada.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR', fields } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const TOKEN_KEY = 'enscafe.token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

export async function api(path, { method = 'GET', body, signal, timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const token = readToken();

  try {
    let res;
    let raw;
    try {
      res = await fetch(`/api${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      if (res.status === 401 && token && String(err?.code).startsWith('TOKEN_')) window.dispatchEvent(new Event('enscafe:unauthorized'));
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

export async function fetchCafesByIds(ids, signal) {
  const list = [...new Set(ids)].slice(0, 50);
  if (!list.length) return {};
  const { items } = await api(`/cafes?ids=${list.join(',')}&limit=50`, { signal });
  return Object.fromEntries(items.map((c) => [c.id, c]));
}
