import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { CafeCard } from '@/components/CafeCard';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States';
import { buttonVariants } from '@/components/ui/button';

export default function Top() {
  const { data, error, loading, reload } = useQuery((signal) => api('/cafes/top?limit=10', { signal }), []);
  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">Top cafeterías</h1><p className="text-muted-foreground">Ordenadas por el promedio de las reseñas de la comunidad.</p></div>
      {loading && !data ? <CardGridSkeleton />
        : error && !data ? <ErrorState message={error.message} onRetry={reload} />
        : data.items.length === 0 ? <EmptyState title="Todavía no hay calificaciones" message="El ranking aparecerá cuando haya reseñas publicadas." action={<Link to="/explorar" className={buttonVariants({ variant: 'outline' })}>Explorar cafeterías</Link>} />
        : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.items.map((c, i) => <CafeCard key={c.id} cafe={c} rank={i + 1} />)}</div>}
    </div>
  );
}
