import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CafeCard } from '@/components/CafeCard';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States';

export default function Home() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const top = useQuery((signal) => api('/cafes/top?limit=3', { signal }), []);
  const zones = useQuery((signal) => api('/cafes/zones', { signal }), []);

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/explorar?q=${encodeURIComponent(term)}` : '/explorar');
  };

  return (
    <div className="space-y-12">
      <section className="max-w-3xl space-y-5 py-6">
        <h1 className="text-4xl font-bold leading-[1.05] sm:text-6xl">El café de Ensenada, reseñado por quienes lo toman.</h1>
        <p className="max-w-xl text-lg text-muted-foreground">Encuentra cafeterías en el mapa, lee reseñas de 0 a 5 estrellas y arma tu Top 5 personal.</p>
        <form onSubmit={submit} className="flex max-w-xl gap-2" role="search">
          <Input value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} placeholder="Busca por nombre, zona o dirección" aria-label="Buscar cafeterías" />
          <Button type="submit"><Search className="h-4 w-4" aria-hidden />Buscar</Button>
        </form>
        <Link to="/mapa" className={buttonVariants({ variant: 'outline' })}>Ver el mapa de cafeterías</Link>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between"><h2 className="text-2xl font-semibold">Mejor calificadas</h2><Link to="/top" className="text-sm font-medium text-primary underline">Ver el Top completo</Link></div>
        {top.loading && !top.data ? <CardGridSkeleton n={3} />
          : top.error ? <ErrorState message={top.error.message} onRetry={top.reload} />
          : top.data.items.length === 0 ? <EmptyState title="Aún no hay calificaciones" message="Sé la primera persona en reseñar una cafetería." action={<Link to="/explorar" className={buttonVariants({ variant: 'outline' })}>Explorar cafeterías</Link>} />
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{top.data.items.map((c, i) => <CafeCard key={c.id} cafe={c} rank={i + 1} />)}</div>}
      </section>

      {zones.data?.items.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Explora por zona</h2>
          <div className="flex flex-wrap gap-2">
            {zones.data.items.map((z) => <Link key={z} to={`/explorar?zone=${encodeURIComponent(z)}`}><Badge variant="secondary" className="px-3 py-1.5 text-sm hover:bg-primary/10">{z}</Badge></Link>)}
          </div>
        </section>
      )}
    </div>
  );
}
