import { useState } from 'react';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { CafeMap } from '@/components/CafeMap';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EmptyState, ErrorState } from '@/components/States';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/StarRating';

export default function MapPage() {
  const { data, error, loading, reload } = useQuery((signal) => api('/cafes/map', { signal }), []);
  const [selectedId, setSelectedId] = useState(null);

  if (loading && !data) return <Skeleton className="h-[560px]" />;
  if (error && !data) return <ErrorState title="No pudimos cargar el mapa" message={error.message} onRetry={reload} />;
  if (!data.items.length) return <EmptyState title="Aún no hay cafeterías en el mapa" message="Cuando se registren cafeterías activas aparecerán aquí como puntos de interés." />;

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Mapa de cafeterías</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <ErrorBoundary>
          <CafeMap cafes={data.items} selectedId={selectedId} onSelect={setSelectedId} className="h-[60vh] min-h-[380px]" />
        </ErrorBoundary>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1" aria-label="Lista de cafeterías">
          {data.items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setSelectedId(c.id)} aria-pressed={c.id === selectedId}
                className={cn('w-full rounded-lg border bg-card p-3 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', c.id === selectedId && 'border-primary ring-1 ring-primary')}>
                <span className="block break-words font-medium">{c.name}</span>
                <StarRating value={c.ratingAvg} count={c.ratingCount} />
                <span className="block break-words text-xs text-muted-foreground">{c.address}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
