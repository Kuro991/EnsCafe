import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useDebounced, useQuery } from '@/lib/hooks';
import { plural } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { CafeCard } from '@/components/CafeCard';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/States';

export default function Explore() {
  // Los filtros viven en la URL: sobreviven a recargas y se pueden compartir
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const zone = params.get('zone') ?? '';
  const minRating = params.get('minRating') ?? '';
  const sort = params.get('sort') ?? 'name';
  const page = Math.max(1, parseInt(params.get('page'), 10) || 1);

  const [qInput, setQInput] = useState(q);
  const debounced = useDebounced(qInput, 400);
  useEffect(() => { setQInput(q); }, [q]); // botón "atrás" o enlaces externos

  const update = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries({ page: '', ...patch }).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  useEffect(() => { if (debounced.trim() !== q.trim()) update({ q: debounced.trim() }); /* eslint-disable-next-line */ }, [debounced]);

  const qs = new URLSearchParams({ ...(q && { q }), ...(zone && { zone }), ...(minRating && { minRating }), sort, page, limit: 9 }).toString();
  const list = useQuery((signal) => api(`/cafes?${qs}`, { signal }), [qs]);
  const zones = useQuery((signal) => api('/cafes/zones', { signal }), []);

  const hasFilters = q || zone || minRating;
  const clear = () => { setQInput(''); setParams({}, { replace: true }); };
  const data = list.data;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Explorar cafeterías</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <Input value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={80} placeholder="Buscar por nombre, zona o dirección" aria-label="Buscar" className="lg:col-span-1" />
        <Select value={zone} onChange={(e) => update({ zone: e.target.value })} aria-label="Zona">
          <option value="">Todas las zonas</option>
          {zones.data?.items.map((z) => <option key={z} value={z}>{z}</option>)}
        </Select>
        <Select value={minRating} onChange={(e) => update({ minRating: e.target.value })} aria-label="Calificación mínima">
          <option value="">Cualquier calificación</option>
          {[4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}+ estrellas</option>)}
        </Select>
        <Select value={sort} onChange={(e) => update({ sort: e.target.value === 'name' ? '' : e.target.value })} aria-label="Ordenar por">
          <option value="name">Orden alfabético</option>
          <option value="rating">Mejor calificadas</option>
          <option value="reviews">Más reseñadas</option>
        </Select>
      </div>

      {list.loading && !data ? <CardGridSkeleton />
        : list.error && !data ? <ErrorState message={list.error.message} onRetry={list.reload} />
        : (
          <>
            {list.error && <ErrorState title="No se pudo actualizar la lista" message={list.error.message} onRetry={list.reload} />}
            {data.total === 0 ? (
              <EmptyState
                title={q ? `No encontramos resultados para “${q}”` : 'No hay cafeterías con esos filtros'}
                message={hasFilters ? 'Prueba con otra palabra, otra zona o quita los filtros.' : 'Todavía no hay cafeterías registradas.'}
                action={hasFilters && <Button variant="outline" onClick={clear}>Limpiar filtros</Button>} />
            ) : data.items.length === 0 ? (
              <EmptyState title="Esa página no existe" action={<Button variant="outline" onClick={() => update({ page: '' })}>Ir a la primera página</Button>} />
            ) : (
              <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
                <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{plural(data.total, 'cafetería', 'cafeterías')}</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.items.map((c) => <CafeCard key={c.id} cafe={c} />)}</div>
                {data.pages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button variant="outline" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Anterior</Button>
                    <span className="text-sm text-muted-foreground">Página {page} de {data.pages}</span>
                    <Button variant="outline" disabled={page >= data.pages} onClick={() => update({ page: String(page + 1) })}>Siguiente</Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
    </div>
  );
}
