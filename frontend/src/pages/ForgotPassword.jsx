import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/Field';
import Turnstile, { SITE_KEY } from '@/components/Turnstile';
import { EMAIL_RE } from '@/lib/validation';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const busyRef = useRef(false);
  const ts = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    setError('');
    if (!email.trim()) return setFieldError('El correo es obligatorio');
    if (!EMAIL_RE.test(email.trim())) return setFieldError('El correo no tiene un formato válido');
    setFieldError('');
    if (SITE_KEY && !captcha) return setError('Completa la verificación anti-robots antes de continuar');
    busyRef.current = true; setBusy(true);
    try {
      const { message } = await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() }, captcha });
      setDone(message);
    } catch (err) {
      if (err.fields?.email) setFieldError(err.fields.email); else setError(err.message);
    } finally { busyRef.current = false; setBusy(false); ts.current?.reset(); }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="text-2xl">Recuperar contraseña</CardTitle></CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4 text-sm">
              <Alert>{done}</Alert>
              <p className="text-muted-foreground">Revisa también la carpeta de spam. Si no llega en unos minutos, puedes pedirlo de nuevo.</p>
              <Link to="/acceso" className={buttonVariants({ variant: 'outline' })}>Volver a iniciar sesión</Link>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-4">
              <p className="text-sm text-muted-foreground">Escribe tu correo y te enviaremos un enlace para elegir una contraseña nueva.</p>
              {error && <Alert variant="destructive">{error}</Alert>}
              <Field id="email" label="Correo" error={fieldError}>
                <Input id="email" type="email" value={email} maxLength={120} autoComplete="email" aria-invalid={!!fieldError}
                  onChange={(e) => { setEmail(e.target.value); setFieldError(''); }} />
              </Field>
              <Turnstile ref={ts} onToken={setCaptcha} action="forgot" />
              <Button type="submit" className="w-full" loading={busy}>Enviar enlace</Button>
              <p className="text-center text-sm"><Link to="/acceso" className="text-primary underline">Volver</Link></p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
