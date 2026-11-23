import { useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { MailCheck } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/Field';
import Turnstile, { SITE_KEY } from '@/components/Turnstile';
import { EMAIL_RE } from '@/lib/validation';

function validate(mode, f) {
  const e = {};
  if (mode === 'register') {
    if (!f.name.trim()) e.name = 'El nombre es obligatorio';
    else if (f.name.trim().length < 2) e.name = 'El nombre debe tener al menos 2 caracteres';
  }
  if (!f.email.trim()) e.email = 'El correo es obligatorio';
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'El correo no tiene un formato válido';
  if (!f.password) e.password = 'La contraseña es obligatoria';
  else if (mode === 'register' && f.password.length < 8) e.password = 'La contraseña debe tener al menos 8 caracteres';
  return e;
}

// Pantalla tras registrarse: pide confirmar el correo y permite reenviar el enlace
export function CheckInbox({ email }) {
  const [state, setState] = useState('idle'); // idle | sending | sent
  const [captcha, setCaptcha] = useState('');
  const [error, setError] = useState('');
  const ts = useRef(null);
  const busy = useRef(false);
  const resend = async () => {
    if (busy.current) return;
    if (SITE_KEY && !captcha) { setError('Completa la verificación anti-robots'); return; }
    busy.current = true; setState('sending'); setError('');
    try { await api('/auth/resend-verification', { method: 'POST', body: { email }, captcha }); setState('sent'); }
    catch (e) { setError(e.message); setState('idle'); }
    finally { busy.current = false; ts.current?.reset(); }
  };
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-2xl"><MailCheck className="h-6 w-6 text-primary" /> Revisa tu correo</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>Si <strong>{email}</strong> puede registrarse, te enviamos un enlace para confirmar tu cuenta (vence en 24 horas). Revisa también la carpeta de spam.</p>
          {error && <Alert variant="destructive">{error}</Alert>}
          {state === 'sent' && <Alert>Listo: si la cuenta está pendiente de confirmar, enviamos un nuevo enlace.</Alert>}
          <Turnstile ref={ts} onToken={setCaptcha} action="resend" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resend} loading={state === 'sending'}>Reenviar correo</Button>
            <Link to="/acceso" className={buttonVariants({ variant: 'ghost' })}>Ir a iniciar sesión</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthPage({ mode }) {
  const { user, login, register } = useAuth();
  const from = useLocation().state?.from || '/';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState(null);
  const [captcha, setCaptcha] = useState('');
  const ts = useRef(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // el estado tarda en actualizarse: el ref bloquea el segundo clic inmediato
  const isRegister = mode === 'register';

  if (user) return <Navigate to={from} replace />;
  if (registeredEmail) return <CheckInbox email={registeredEmail} />;
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    const v = validate(mode, form);
    setErrors(v);
    setFormError('');
    setUnverified(false);
    if (Object.keys(v).length) return;
    if (SITE_KEY && !captcha) { setFormError('Completa la verificación anti-robots antes de continuar'); return; }
    busyRef.current = true; setBusy(true);
    try {
      if (isRegister) {
        await register(form.name.trim(), form.email.trim(), form.password, captcha);
        setRegisteredEmail(form.email.trim());
      } else {
        await login(form.email.trim(), form.password, captcha);
        toast.success('Sesión iniciada'); // al haber usuario, el componente redirige solo
      }
    } catch (err) {
      setErrors(err.fields || {});
      if (err.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      if (!err.fields) setFormError(err.message);
    } finally {
      busyRef.current = false; setBusy(false);
      ts.current?.reset(); // el token del captcha es de un solo uso
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="text-2xl">{isRegister ? 'Crear cuenta' : 'Iniciar sesión'}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
            {unverified && (
              <Alert variant="warning">
                ¿No te llegó el correo?{' '}
                <button type="button" className="font-medium underline" onClick={() => setRegisteredEmail(form.email.trim())}>Reenviar enlace de confirmación</button>
              </Alert>
            )}
            {isRegister && (
              <Field id="name" label="Nombre" error={errors.name}>
                <Input id="name" value={form.name} onChange={set('name')} maxLength={60} autoComplete="name" aria-invalid={!!errors.name} />
              </Field>
            )}
            <Field id="email" label="Correo" error={errors.email}>
              <Input id="email" type="email" value={form.email} onChange={set('email')} maxLength={120} autoComplete="email" aria-invalid={!!errors.email} />
            </Field>
            <Field id="password" label="Contraseña" error={errors.password} hint={isRegister ? 'Mínimo 8 caracteres' : undefined}>
              <Input id="password" type="password" value={form.password} onChange={set('password')} maxLength={72} autoComplete={isRegister ? 'new-password' : 'current-password'} aria-invalid={!!errors.password} />
            </Field>
            {!isRegister && <p className="text-right text-sm"><Link to="/olvide" className="text-primary underline">¿Olvidaste tu contraseña?</Link></p>}
            <Turnstile ref={ts} onToken={setCaptcha} action={isRegister ? 'register' : 'login'} />
            <Button type="submit" className="w-full" loading={busy}>{isRegister ? 'Crear cuenta' : 'Iniciar sesión'}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isRegister ? '¿Ya tienes cuenta? ' : '¿Aún no tienes cuenta? '}
            <Link to={isRegister ? '/acceso' : '/registro'} state={{ from }} className="font-medium text-primary underline">{isRegister ? 'Inicia sesión' : 'Regístrate'}</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
