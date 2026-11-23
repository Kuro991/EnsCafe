import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { api, hasSessionHint, setSessionHint } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/States';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// La sesión vive en cookies HttpOnly: aquí solo se guarda el usuario en memoria.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(hasSessionHint);
  const [sessionError, setSessionError] = useState(null);

  const clearLocal = useCallback((message) => {
    setSessionHint(false);
    setUser(null);
    setSessionError(null);
    if (message) toast.info(message);
  }, []);

  const logout = useCallback(async (message) => {
    try { await api('/auth/logout', { method: 'POST', timeout: 5000 }); } catch { /* si no hay red, igual se cierra localmente */ }
    clearLocal(message);
  }, [clearLocal]);

  const logoutAll = useCallback(async () => {
    await api('/auth/logout-all', { method: 'POST' });
    clearLocal('Cerraste sesión en todos tus dispositivos');
  }, [clearLocal]);

  // Recarga de página: pregunta quién es el usuario (el navegador envía la cookie; si venció, api() la renueva)
  const restore = useCallback(async () => {
    if (!hasSessionHint()) { setLoading(false); return; }
    setLoading(true);
    try {
      const { user } = await api('/auth/me');
      setUser(user);
      setSessionError(null);
    } catch (e) {
      if (e.status === 401 || e.status === 403) clearLocal(e.status === 403 ? e.message : undefined);
      else setSessionError(e.message); // sin red: conserva la sesión y permite reintentar
    } finally {
      setLoading(false);
    }
  }, [clearLocal]);

  useEffect(() => { restore(); }, [restore]);
  useEffect(() => {
    const h = () => { setUser(null); toast.info('Tu sesión expiró. Inicia sesión de nuevo'); };
    window.addEventListener('enscafe:unauthorized', h);
    return () => window.removeEventListener('enscafe:unauthorized', h);
  }, []);

  const value = {
    user, loading, sessionError, restore, logout, logoutAll,
    login: async (email, password, captcha) => {
      const { user } = await api('/auth/login', { method: 'POST', body: { email, password }, captcha });
      setSessionHint(true);
      setUser(user);
      setSessionError(null);
      return user;
    },
    // El registro NO inicia sesión: hay que confirmar el correo primero
    register: (name, email, password, captcha) => api('/auth/register', { method: 'POST', body: { name, email, password }, captcha }),
    updateName: async (name) => setUser((await api('/auth/me', { method: 'PATCH', body: { name } })).user),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RequireAuth({ admin = false, children }) {
  const { user, loading, sessionError, restore } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Cargando" /></div>;
  if (sessionError) return <ErrorState message={sessionError} onRetry={restore} />;
  if (!user) return <Navigate to="/acceso" state={{ from: location.pathname + location.search }} replace />;
  if (admin && user.role !== 'admin')
    return <ErrorState title="Acceso denegado" message="Necesitas una cuenta de administrador para ver esta sección." />;
  return children;
}
