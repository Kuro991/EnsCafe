import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { api, TOKEN_KEY } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/States';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => !!readToken());
  const [sessionError, setSessionError] = useState(null);

  const logout = useCallback((message) => {
    writeToken(null);
    setUser(null);
    setSessionError(null);
    if (message) toast.info(message);
  }, []);

  // Recarga de página: recupera la sesión con el token guardado
  const restore = useCallback(async () => {
    if (!readToken()) { setLoading(false); return; }
    setLoading(true);
    try {
      const { user } = await api('/auth/me');
      setUser(user);
      setSessionError(null);
    } catch (e) {
      if (e.status === 401 || e.status === 403) logout(e.status === 403 ? e.message : undefined);
      else setSessionError(e.message); // sin red: conserva el token y permite reintentar
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { restore(); }, [restore]);
  useEffect(() => {
    const h = () => logout('Tu sesión expiró. Inicia sesión de nuevo');
    window.addEventListener('enscafe:unauthorized', h);
    return () => window.removeEventListener('enscafe:unauthorized', h);
  }, [logout]);

  const authenticate = async (path, body) => {
    const { token, user } = await api(path, { method: 'POST', body });
    writeToken(token);
    setUser(user);
    setSessionError(null);
    return user;
  };
  const value = {
    user, loading, sessionError, restore, logout,
    login: (email, password) => authenticate('/auth/login', { email, password }),
    register: (name, email, password) => authenticate('/auth/register', { name, email, password }),
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
