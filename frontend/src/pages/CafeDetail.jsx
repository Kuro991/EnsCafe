import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Clock, MapPin, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating, RatingInput } from '@/components/StarRating';
import { CafeMap } from '@/components/CafeMap';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { EmptyState, ErrorState } from '@/components/States';
import { Field } from '@/components/Field';
import NotFound from '@/pages/NotFound';

const MAX = 1000;

function ReviewForm({ cafeId, userId, existing, onChanged }) {
  const draftKey = `enscafe.draft.${userId}.${cafeId}`;
  // Si la página se recarga a mitad de escribir, se recupera el borrador
  const initial = () => {
    if (existing) return { rating: existing.rating, comment: existing.comment };
    try { const d = JSON.parse(localStorage.getItem(draftKey)); if (d) return { rating: Number.isInteger(d.rating) ? d.rating : null, comment: String(d.comment ?? '').slice(0, MAX) }; } catch { /* sin borrador */ }
    return { rating: null, comment: '' };
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (existing) return;
    try { localStorage.setItem(draftKey, JSON.stringify(form)); } catch { /* almacenamiento no disponible */ }
  }, [form, existing, draftKey]);

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return; // doble clic
    if (form.rating === null) { setErrors({ rating: 'Selecciona una puntuación de 0 a 5' }); return; }
    if (form.comment.length > MAX) { setErrors({ comment: `El comentario no puede superar ${MAX} caracteres` }); return; }
    busyRef.current = true; setBusy(true); setErrors({});
    try {
      const body = { rating: form.rating, comment: form.comment.trim() };
      if (existing) await api(`/reviews/${existing.id}`, { method: 'PUT', body });
      else await api('/reviews', { method: 'POST', body: { cafeId, ...body } });
      try { localStorage.removeItem(draftKey); } catch { /* noop */ }
      toast.success(existing ? 'Reseña actualizada' : 'Reseña publicada');
      onChanged();
    } catch (err) {
      if (err.fields) setErrors(err.fields);
      else toast.error(err.message);
      if (err.code === 'DUPLICATE') onChanged(); // ya existía: pasa a modo edición
    } finally { busyRef.current = false; setBusy(false); }
  };

  const remove = async () => {
    if (busyRef.current || !window.confirm('¿Eliminar tu reseña? Esta acción no se puede deshacer.')) return;
    busyRef.current = true; setBusy(true);
    try { await api(`/reviews/${existing.id}`, { method: 'DELETE' }); toast.success('Reseña eliminada'); onChanged(); }
    catch (err) { toast.error(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id="rating" label="Tu calificación" error={errors.rating}>
        <RatingInput value={form.rating} onChange={(rating) => { setForm({ ...form, rating }); setErrors({}); }} invalid={!!errors.rating} disabled={busy} />
      </Field>
      <Field id="comment" label="Comentario (opcional)" error={errors.comment} hint={`${form.comment.length}/${MAX}`}>
        <Textarea id="comment" value={form.comment} maxLength={MAX} disabled={busy} aria-invalid={!!errors.comment}
          onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="¿Qué tal el café, el ambiente, el servicio?" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>{existing ? 'Guardar cambios' : 'Publicar reseña'}</Button>
        {existing && <Button type="button" variant="outline" disabled={busy} onClick={remove}>Eliminar reseña</Button>}
      </div>
    </form>
  );
}

export default function CafeDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [topBusy, setTopBusy] = useState(false);

  const cafe = useQuery((s) => api(`/cafes/${encodeURIComponent(id)}`, { signal: s }), [id]);
  const reviews = useQuery((s) => api(`/reviews?cafeId=${encodeURIComponent(id)}&page=${page}&limit=8`, { signal: s }), [id, page]);
  const mine = useQuery(async (s) => (user ? api('/reviews/mine', { signal: s }) : { items: [] }), [user?.id]);
  const top = useQuery(async (s) => (user ? api('/top5/me', { signal: s }) : { cafeIds: [] }), [user?.id]);

  useEffect(() => { setPage(1); }, [id]);

  if (cafe.error?.status === 404) return <NotFound title="Esta cafetería no existe" message="Puede que haya sido dada de baja o que la dirección sea incorrecta." />;
  if (cafe.loading && !cafe.data) return <div className="space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-64" /></div>;
  if (cafe.error && !cafe.data) return <ErrorState message={cafe.error.message} onRetry={cafe.reload} />;

  const c = cafe.data.cafe;
  const myReview = mine.data?.items.find((r) => r.cafeId === c.id) ?? null;
  const inTop = top.data?.cafeIds.includes(c.id);
  const refresh = () => { cafe.reload(); reviews.reload(); mine.reload(); };

  const toggleTop = async () => {
    if (topBusy) return;
    const ids = inTop ? top.data.cafeIds.filter((x) => x !== c.id) : [...top.data.cafeIds, c.id];
    setTopBusy(true);
    try { await api('/top5/me', { method: 'PUT', body: { cafeIds: ids } }); toast.success(inTop ? 'Quitada de tu Top 5' : 'Agregada a tu Top 5'); top.reload(); }
    catch (err) { toast.error(err.message); }
    finally { setTopBusy(false); }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{c.zone}</Badge>{c.status === 'closed' && <Badge variant="warning">Cerrada temporalmente</Badge>}</div>
        <h1 className="break-words text-4xl font-bold">{c.name}</h1>
        <StarRating value={c.ratingAvg} count={c.ratingCount} className="text-base" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          {c.description && <p className="whitespace-pre-wrap break-words">{c.description}</p>}
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2 break-words"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{c.address}</li>
            {c.schedule && <li className="flex gap-2 break-words"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{c.schedule}</li>}
            {c.phone && <li className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{c.phone}</li>}
          </ul>
          {user && !top.loading && !top.error && (
            <div className="space-y-1">
              <Button variant={inTop ? 'secondary' : 'outline'} onClick={toggleTop} loading={topBusy} disabled={!inTop && top.data.cafeIds.length >= 5}>
                {inTop ? 'Quitar de mi Top 5' : 'Agregar a mi Top 5'}
              </Button>
              {!inTop && top.data.cafeIds.length >= 5 && <p className="text-xs text-muted-foreground">Tu Top 5 está lleno. Quita una cafetería desde tu perfil.</p>}
            </div>
          )}
        </div>
        {c.status === 'active'
          ? <ErrorBoundary><CafeMap cafes={[c]} selectedId={c.id} className="h-72" /></ErrorBoundary>
          : <Alert variant="warning">Esta cafetería no aparece en el mapa mientras esté cerrada temporalmente.</Alert>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="self-start">
          <CardHeader><CardTitle>{myReview ? 'Tu reseña' : 'Escribe una reseña'}</CardTitle></CardHeader>
          <CardContent>
            {!user ? (
              <div className="space-y-3 text-sm"><p className="text-muted-foreground">Inicia sesión para calificar y reseñar esta cafetería.</p>
                <Link to="/acceso" state={{ from: location.pathname }} className={buttonVariants()}>Iniciar sesión</Link></div>
            ) : mine.loading && !mine.data ? <Skeleton className="h-40" />
              : mine.error && !mine.data ? <ErrorState title="No pudimos revisar tus reseñas" message={mine.error.message} onRetry={mine.reload} />
              : myReview?.status === 'hidden' ? <Alert variant="warning">Tu reseña fue ocultada por moderación y no se puede editar.</Alert>
              : <ReviewForm key={myReview?.id ?? 'new'} cafeId={c.id} userId={user.id} existing={myReview} onChanged={refresh} />}
          </CardContent>
        </Card>

        <section className="space-y-3" aria-label="Reseñas">
          <h2 className="text-xl font-semibold">Reseñas de la comunidad</h2>
          {reviews.loading && !reviews.data ? <Skeleton className="h-32" />
            : reviews.error && !reviews.data ? <ErrorState title="No pudimos cargar las reseñas" message={reviews.error.message} onRetry={reviews.reload} />
            : reviews.data.items.length === 0 ? <EmptyState title="Aún no hay reseñas" message="Sé la primera persona en contar cómo estuvo." />
            : (
              <>
                <ul className="space-y-3">
                  {reviews.data.items.map((r) => (
                    <li key={r.id} className="rounded-lg border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-words font-medium">{r.userName}{r.userId === user?.id && <Badge className="ml-2">Tú</Badge>}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(r.updatedAt)}</span>
                      </div>
                      <StarRating value={r.rating} count={1} className="mt-1" />
                      {r.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
                    </li>
                  ))}
                </ul>
                {reviews.data.pages > 1 && (
                  <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                    <span className="text-sm text-muted-foreground">Página {page} de {reviews.data.pages}</span>
                    <Button variant="outline" size="sm" disabled={page >= reviews.data.pages} onClick={() => setPage(page + 1)}>Siguiente</Button>
                  </div>
                )}
              </>
            )}
        </section>
      </div>
    </div>
  );
}
