import { useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/Field';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export default function AuthPage({ mode }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from || '/';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // el estado tarda en actualizarse: el ref bloquea el segundo clic inmediato
  const isRegister = mode === 'register';

  if (user) return <Navigate to={from} replace />;
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    const v = validate(mode, form);
    setErrors(v);
    setFormError('');
    if (Object.keys(v).length) return;
    busyRef.current = true; setBusy(true);
    try {
      if (isRegister) await register(form.name.trim(), form.email.trim(), form.password);
      else await login(form.email.trim(), form.password);
      toast.success(isRegister ? 'Cuenta creada. ¡Bienvenido!' : 'Sesión iniciada');
      navigate(from, { replace: true });
    } catch (err) {
      setErrors(err.fields || {});
      if (!err.fields) setFormError(err.message);
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle className="text-2xl">{isRegister ? 'Crear cuenta' : 'Iniciar sesión'}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
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
