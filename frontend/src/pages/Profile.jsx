import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, fetchCafesByIds } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { StarRating } from '@/components/StarRating';
import { EmptyState, ErrorState } from '@/components/States';
import { Field } from '@/components/Field';

function NameForm() {
  const { user, updateName } = useAuth();
  const [name, setName] = useState(user.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    const n = name.trim();
    if (n.length < 2) return setError(n ? 'El nombre debe tener al menos 2 caracteres' : 'El nombre es obligatorio');
    if (n === user.name) return setError('No hay cambios que guardar');
    busyRef.current = true; setBusy(true); setError('');
    try { await updateName(n); toast.success('Perfil actualizado'); }
    catch (err) { setError(err.fields?.name || err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1"><Field id="profile-name" label="Nombre" error={error}>
        <Input id="profile-name" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(''); }} aria-invalid={!!error} />
      </Field></div>
      <Button type="submit" loading={busy}>Guardar</Button>
    </form>
  );
}

export default function Profile() {
  const { user, logoutAll } = useAuth();
  const [saving, setSaving] = useState(false);
  const { data, error, loading, reload } = useQuery(async (signal) => {
    const [t, m] = await Promise.all([api('/top5/me', { signal }), api('/reviews/mine', { signal })]);
    const cafes = await fetchCafesByIds([...t.cafeIds, ...m.items.map((r) => r.cafeId)], signal);
    return { top: t.cafeIds, reviews: m.items, cafes };
  }, []);

  const saveTop = async (ids) => {
    if (saving) return;
    setSaving(true);
    try { await api('/top5/me', { method: 'PUT', body: { cafeIds: ids } }); reload(); }
    catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };
  const move = (i, d) => { const ids = [...data.top]; [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; saveTop(ids); };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3"><h1 className="break-words text-3xl font-bold">Mi perfil</h1><Badge variant="secondary">{user.email}</Badge></div>
      <Card><CardHeader><CardTitle>Datos de la cuenta</CardTitle></CardHeader><CardContent className="space-y-4">
        <NameForm />
        <div className="border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => logoutAll().catch((e) => toast.error(e.message))}>Cerrar sesión en todos mis dispositivos</Button>
          <p className="mt-1 text-xs text-muted-foreground">Úsalo si dejaste tu sesión abierta en un equipo que no es tuyo.</p>
        </div>
      </CardContent></Card>

      {loading && !data ? <Skeleton className="h-56" />
        : error && !data ? <ErrorState message={error.message} onRetry={reload} />
        : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3" aria-label="Mi Top 5">
              <h2 className="text-xl font-semibold">Mi Top 5</h2>
              {data.top.length === 0 ? (
                <EmptyState title="Tu Top 5 está vacío" message="Abre la ficha de una cafetería y usa “Agregar a mi Top 5”." action={<Link to="/explorar" className={buttonVariants({ variant: 'outline' })}>Explorar cafeterías</Link>} />
              ) : (
                <ol className="space-y-2">
                  {data.top.map((id, i) => {
                    const c = data.cafes[id];
                    return (
                      <li key={id} className="flex items-center gap-2 rounded-lg border bg-card p-3">
                        <span className="w-6 text-center font-display text-lg font-bold text-primary">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          {c ? <Link to={`/cafeteria/${id}`} className="block break-words font-medium hover:underline">{c.name}</Link> : <span className="text-muted-foreground">Cafetería no disponible</span>}
                          {c && <StarRating value={c.ratingAvg} count={c.ratingCount} />}
                        </div>
                        <Button size="icon" variant="ghost" aria-label="Subir" disabled={saving || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Bajar" disabled={saving || i === data.top.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Quitar del Top 5" disabled={saving} onClick={() => saveTop(data.top.filter((x) => x !== id))}><X className="h-4 w-4" /></Button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            <section className="space-y-3" aria-label="Mis reseñas">
              <h2 className="text-xl font-semibold">Mis reseñas</h2>
              {data.reviews.length === 0 ? (
                <EmptyState title="Aún no has publicado reseñas" message="Cuéntanos qué cafeterías has visitado." action={<Link to="/explorar" className={buttonVariants({ variant: 'outline' })}>Buscar una cafetería</Link>} />
              ) : (
                <ul className="space-y-3">
                  {data.reviews.map((r) => (
                    <li key={r.id} className="rounded-lg border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link to={`/cafeteria/${r.cafeId}`} className="min-w-0 break-words font-medium hover:underline">{data.cafes[r.cafeId]?.name ?? 'Cafetería no disponible'}</Link>
                        <span className="text-xs text-muted-foreground">{formatDate(r.updatedAt)}</span>
                      </div>
                      <div className="flex items-center gap-2"><StarRating value={r.rating} count={1} />{r.status === 'hidden' && <Badge variant="destructive">Oculta por moderación</Badge>}</div>
                      {r.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
    </div>
  );
}
