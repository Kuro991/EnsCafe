import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// CAPTCHA de Cloudflare Turnstile. Sin VITE_TURNSTILE_SITE_KEY (desarrollo) no muestra nada y el servidor tampoco lo exige.
// El token es de un solo uso: llama a ref.current.reset() después de cada envío (haya salido bien o mal).
export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading = null;
const loadScript = () => {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => { loading = null; s.remove(); reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return loading;
};

const Turnstile = forwardRef(function Turnstile({ onToken, action }, ref) {
  const box = useRef(null);
  const widget = useRef(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [status, setStatus] = useState(SITE_KEY ? 'loading' : 'off'); // loading | ready | error | off
  const [attempt, setAttempt] = useState(0);

  useImperativeHandle(ref, () => ({
    reset() { cb.current(''); try { if (widget.current != null) window.turnstile?.reset(widget.current); } catch { /* widget ya destruido */ } },
  }), []);

  useEffect(() => {
    if (!SITE_KEY) return undefined;
    let cancelled = false;
    setStatus('loading');
    loadScript().then(() => {
      if (cancelled || !box.current) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY, action, theme: 'auto', language: 'es',
        callback: (t) => { setStatus('ready'); cb.current(t); },
        'expired-callback': () => cb.current(''),
        'timeout-callback': () => cb.current(''),
        'error-callback': () => { cb.current(''); setStatus('error'); },
      });
      setStatus('ready');
    }).catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      try { if (widget.current != null) window.turnstile?.remove(widget.current); } catch { /* noop */ }
      widget.current = null;
    };
  }, [action, attempt]);

  if (status === 'off') return null;
  return (
    <div className="space-y-1">
      <div ref={box} className="min-h-[65px]" />
      {status === 'error' && (
        <p role="alert" className="text-xs font-medium text-destructive">
          No se pudo cargar la verificación anti-robots (revisa tu conexión o desactiva bloqueadores).{' '}
          <button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button>
        </p>
      )}
    </div>
  );
});
export default Turnstile;
