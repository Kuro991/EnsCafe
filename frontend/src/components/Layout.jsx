import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Coffee, WifiOff } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuth } from '@/auth/AuthContext';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useOnline } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const nav = ({ isActive }) => cn('rounded-md px-3 py-2 text-sm font-medium hover:bg-muted', isActive && 'bg-secondary');

export default function Layout() {
  const { user, logout, sessionError, restore } = useAuth();
  const online = useOnline();
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[2000] border-b bg-background/95 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-between gap-2 py-3">
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold text-primary"><Coffee className="h-5 w-5" aria-hidden />EnsCafe</Link>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Principal">
            <NavLink to="/explorar" className={nav}>Explorar</NavLink>
            <NavLink to="/mapa" className={nav}>Mapa</NavLink>
            <NavLink to="/top" className={nav}>Top</NavLink>
            {user?.role === 'admin' && <NavLink to="/admin" className={nav}>Administración</NavLink>}
            {user ? (
              <>
                <NavLink to="/perfil" className={nav}><span className="inline-block max-w-[10rem] truncate align-bottom">{user.name}</span></NavLink>
                <Button variant="ghost" size="sm" onClick={() => logout()}>Salir</Button>
              </>
            ) : (
              <>
                <Link to="/acceso" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Iniciar sesión</Link>
                <Link to="/registro" className={buttonVariants({ size: 'sm' })}>Crear cuenta</Link>
              </>
            )}
          </nav>
        </div>
        {!online && <div role="status" className="flex items-center justify-center gap-2 bg-star/20 px-4 py-1.5 text-sm"><WifiOff className="h-4 w-4" aria-hidden />Sin conexión a internet. Algunas funciones no estarán disponibles.</div>}
        {sessionError && (
          <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-star/20 px-4 py-1.5 text-sm">
            No pudimos verificar tu sesión. <Button variant="link" size="sm" className="h-auto p-0" onClick={restore}>Reintentar</Button>
          </div>
        )}
      </header>
      <main className="container flex-1 py-8">
        {/* key: al cambiar de ruta el boundary se reinicia */}
        <ErrorBoundary key={pathname}><Outlet /></ErrorBoundary>
      </main>
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">EnsCafe · Proyecto integral de Aplicaciones Web · UABC</footer>
      <Toaster richColors position="top-center" />
    </div>
  );
}
