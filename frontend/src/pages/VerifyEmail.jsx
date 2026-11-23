import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';

// El enlace del correo apunta aquí. Se confirma al abrir la página (una sola vez por token, aun con StrictMode).
const sent = new Set();

export default function VerifyEmail() {
  const token = useSearchParams()[0].get('token') || '';
  const [state, setState] = useState(token ? { s: 'loading' } : { s: 'error', msg: 'Este enlace está incompleto.' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const key = `${token}:${attempt}`;
    if (sent.has(key)) return;
    sent.add(key);
    setState({ s: 'loading' });
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then((d) => setState({ s: 'ok', msg: d.message }))
      .catch((e) => setState({ s: 'error', msg: e.message, retry: e.code === 'NETWORK' || e.code === 'TIMEOUT' }));
  }, [token, attempt]);

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="text-2xl">Confirmar correo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {state.s === 'loading' && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Confirmando…</p>}
          {state.s === 'ok' && (<><Alert>{state.msg}</Alert><Link to="/acceso" className={buttonVariants()}>Iniciar sesión</Link></>)}
          {state.s === 'error' && (
            <>
              <Alert variant="destructive">{state.msg}</Alert>
              {state.retry
                ? <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>Reintentar</Button>
                : <p className="text-sm text-muted-foreground">Inicia sesión con tu correo: si aún no está confirmado, podrás pedir un enlace nuevo.</p>}
              <Link to="/acceso" className={buttonVariants({ variant: 'ghost' })}>Ir a iniciar sesión</Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
