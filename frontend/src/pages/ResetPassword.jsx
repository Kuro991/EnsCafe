import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/Field';

export default function ResetPassword() {
  const token = useSearchParams()[0].get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    const v = {};
    if (!pw) v.password = 'La contraseña es obligatoria';
    else if (pw.length < 8) v.password = 'La contraseña debe tener al menos 8 caracteres';
    if (pw2 !== pw) v.confirm = 'Las contraseñas no coinciden';
    setErrors(v); setError('');
    if (Object.keys(v).length) return;
    busyRef.current = true; setBusy(true);
    try { setDone((await api('/auth/reset-password', { method: 'POST', body: { token, password: pw } })).message); }
    catch (err) { if (err.fields) setErrors(err.fields); else setError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="text-2xl">Contraseña nueva</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!token ? (
            <>
              <Alert variant="destructive">Este enlace está incompleto. Vuelve a pedir uno nuevo.</Alert>
              <Link to="/olvide" className={buttonVariants({ variant: 'outline' })}>Pedir un enlace nuevo</Link>
            </>
          ) : done ? (
            <>
              <Alert>{done}</Alert>
              <Link to="/acceso" className={buttonVariants()}>Iniciar sesión</Link>
            </>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  {error} <Link to="/olvide" className="font-medium underline">Pedir un enlace nuevo</Link>
                </Alert>
              )}
              <Field id="password" label="Contraseña nueva" error={errors.password} hint="Mínimo 8 caracteres. Al cambiarla se cerrarán tus otras sesiones.">
                <Input id="password" type="password" value={pw} maxLength={72} autoComplete="new-password" aria-invalid={!!errors.password}
                  onChange={(e) => { setPw(e.target.value); setErrors({ ...errors, password: undefined }); }} />
              </Field>
              <Field id="confirm" label="Repite la contraseña" error={errors.confirm}>
                <Input id="confirm" type="password" value={pw2} maxLength={72} autoComplete="new-password" aria-invalid={!!errors.confirm}
                  onChange={(e) => { setPw2(e.target.value); setErrors({ ...errors, confirm: undefined }); }} />
              </Field>
              <Button type="submit" className="w-full" loading={busy}>Guardar contraseña</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
