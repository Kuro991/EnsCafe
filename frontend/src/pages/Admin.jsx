import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, fetchCafesByIds } from '@/lib/api';
import { useQuery } from '@/lib/hooks';
import { cn, formatDate, STATUS_LABEL } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/StarRating';
import { EmptyState, ErrorState } from '@/components/States';
import { Field } from '@/components/Field';

const EMPTY = { name: '', address: '', zone: '', phone: '', schedule: '', description: '', lat: '', lng: '', status: 'active' };
const B = { latMin: 31.6, latMax: 32.1, lngMin: -116.9, lngMax: -116.3 };

// Validación en el cliente (el servidor vuelve a validar: nunca se confía solo en el navegador)
function validate(f) {
  const e = {};
  const req = (k, label, min, max) => {
    const v = f[k].trim();
    if (!v) e[k] = `${label} es obligatorio`;
    else if (v.length < min) e[k] = `${label} debe tener al menos ${min} caracteres`;
    else if (v.length > max) e[k] = `${label} no puede superar ${max} caracteres`;
  };
  req('name', 'El nombre', 2, 80); req('address', 'La dirección', 5, 160); req('zone', 'La zona', 2, 40);
  if (f.phone.trim() && !/^[0-9+()\-\s]{7,20}$/.test(f.phone.trim())) e.phone = 'Teléfono no válido (solo números, espacios, + - ( ))';
  const coord = (k, label, min, max) => {
    const raw = f[k].trim().replace(',', '.');
    const n = Number(raw);
    if (!raw) e[k] = `${label} es obligatoria`;
    else if (!Number.isFinite(n)) e[k] = `${label} debe ser un número`;
    else if (n < min || n > max) e[k] = `${label} debe estar entre ${min} y ${max} (zona de Ensenada)`;
  };
  coord('lat', 'La latitud', B.latMin, B.latMax); coord('lng', 'La longitud', B.lngMin, B.lngMax);
  return e;
}

function CafeForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(initial ? { ...EMPTY, ...initial, lat: String(initial.lat), lng: String(initial.lng) } : EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); };

  const submit = async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    const v = validate(f);
    setErrors(v);
    if (Object.keys(v).length) return;
    busyRef.current = true; setBusy(true);
    try {
      const body = { ...f, lat: Number(f.lat.trim().replace(',', '.')), lng: Number(f.lng.trim().replace(',', '.')) };
      if (initial) await api(`/cafes/${initial.id}`, { method: 'PUT', body });
      else await api('/cafes', { method: 'POST', body });
      toast.success(initial ? 'Cafetería actualizada' : 'Cafetería creada');
      onSaved();
    } catch (err) {
      if (err.fields) setErrors(err.fields); else toast.error(err.message);
    } finally { busyRef.current = false; setBusy(false); }
  };

  const text = (k, label, max, extra = {}) => (
    <Field id={`f-${k}`} label={label} error={errors[k]} {...extra}>
      <Input id={`f-${k}`} value={f[k]} onChange={set(k)} maxLength={max} aria-invalid={!!errors[k]} disabled={busy} />
    </Field>
  );
  return (
    <Card>
      <CardHeader><CardTitle>{initial ? 'Editar cafetería' : 'Nueva cafetería'}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Nombre', 80)}{text('zone', 'Zona', 40)}
          <div className="sm:col-span-2">{text('address', 'Dirección', 160)}</div>
          {text('schedule', 'Horario', 120)}{text('phone', 'Teléfono', 20)}
          {text('lat', 'Latitud', 20, { hint: 'Ej. 31.8667' })}{text('lng', 'Longitud', 20, { hint: 'Ej. -116.6235' })}
          <div className="sm:col-span-2">
            <Field id="f-description" label="Descripción" error={errors.description} hint={`${f.description.length}/600`}>
              <Textarea id="f-description" value={f.description} onChange={set('description')} maxLength={600} disabled={busy} />
            </Field>
          </div>
          <Field id="f-status" label="Estado" error={errors.status}>
            <Select id="f-status" value={f.status} onChange={set('status')} disabled={busy}>
              {['draft', 'active', 'closed', 'retired'].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" loading={busy}>{initial ? 'Guardar cambios' : 'Crear cafetería'}</Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CafesTab() {
  const { data, error, loading, reload } = useQuery((s) => api('/cafes?includeAll=1&limit=50', { signal: s }), []);
  const [editing, setEditing] = useState(null); // null | 'new' | cafe
  const retire = async (c) => {
    if (!window.confirm(`¿Dar de baja “${c.name}”? Dejará de aparecer en el catálogo y el mapa.`)) return;
    try { await api(`/cafes/${c.id}`, { method: 'DELETE' }); toast.success('Cafetería dada de baja'); reload(); } catch (e) { toast.error(e.message); }
  };
  if (editing) return <CafeForm initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-between"><p className="text-sm text-muted-foreground">{data ? `${data.total} cafeterías` : ''}</p><Button onClick={() => setEditing('new')}>Nueva cafetería</Button></div>
      {loading && !data ? <Skeleton className="h-48" /> : error && !data ? <ErrorState message={error.message} onRetry={reload} />
        : data.items.length === 0 ? <EmptyState title="No hay cafeterías" message="Crea la primera con el botón “Nueva cafetería”." />
        : (
          <ul className="space-y-2">
            {data.items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
                <div className="min-w-0 flex-1"><p className="break-words font-medium">{c.name}</p><p className="break-words text-xs text-muted-foreground">{c.address}</p></div>
                <Badge variant={c.status === 'active' ? 'default' : c.status === 'retired' ? 'destructive' : 'warning'}>{STATUS_LABEL[c.status]}</Badge>
                <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Editar</Button>
                {c.status !== 'retired' && <Button size="sm" variant="ghost" onClick={() => retire(c)}>Dar de baja</Button>}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function ModerationTab() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useQuery(async (signal) => {
    const r = await api(`/reviews?status=${filter}&page=${page}&limit=10`, { signal });
    return { ...r, cafes: await fetchCafesByIds(r.items.map((x) => x.cafeId), signal) };
  }, [filter, page]);
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-4">
      <Select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} className="max-w-xs" aria-label="Filtro">
        <option value="all">Todas las reseñas</option><option value="hidden">Solo ocultas</option>
      </Select>
      {loading && !data ? <Skeleton className="h-48" /> : error && !data ? <ErrorState message={error.message} onRetry={reload} />
        : data.items.length === 0 ? <EmptyState title="No hay reseñas para moderar" />
        : (
          <>
            <ul className="space-y-2">
              {data.items.map((r) => (
                <li key={r.id} className={cn('space-y-1 rounded-lg border bg-card p-3', r.status === 'hidden' && 'bg-muted')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-words text-sm"><strong>{r.userName}</strong> en {data.cafes[r.cafeId]?.name ?? `cafetería #${r.cafeId}`}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(r.updatedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2"><StarRating value={r.rating} count={1} />{r.status === 'hidden' && <Badge variant="destructive">Oculta</Badge>}</div>
                  {r.comment && <p className="whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
                  <div className="flex gap-2 pt-1">
                    {r.status === 'published'
                      ? <Button size="sm" variant="outline" onClick={() => act(() => api(`/reviews/${r.id}/moderate`, { method: 'PATCH', body: { status: 'hidden' } }), 'Reseña ocultada')}>Ocultar</Button>
                      : <Button size="sm" variant="outline" onClick={() => act(() => api(`/reviews/${r.id}/moderate`, { method: 'PATCH', body: { status: 'published' } }), 'Reseña restaurada')}>Restaurar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => window.confirm('¿Eliminar definitivamente esta reseña?') && act(() => api(`/reviews/${r.id}`, { method: 'DELETE' }), 'Reseña eliminada')}>Eliminar</Button>
                  </div>
                </li>
              ))}
            </ul>
            {data.pages > 1 && <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <span className="text-sm text-muted-foreground">Página {page} de {data.pages}</span>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Siguiente</Button></div>}
          </>
        )}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useQuery((s) => api('/auth/users', { signal: s }), []);
  const toggle = async (u) => {
    try { await api(`/auth/users/${u.id}/status`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }); reload(); }
    catch (e) { toast.error(e.message); }
  };
  if (loading && !data) return <Skeleton className="h-48" />;
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  return (
    <ul className="space-y-2">
      {data.items.map((u) => (
        <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{u.name}</p><p className="break-all text-xs text-muted-foreground">{u.email}</p></div>
          <Badge variant="secondary">{u.role === 'admin' ? 'Administrador' : 'Usuario'}</Badge>
          <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>{u.status === 'active' ? 'Activa' : 'Suspendida'}</Badge>
          {u.id !== me.id && <Button size="sm" variant="outline" onClick={() => toggle(u)}>{u.status === 'active' ? 'Suspender' : 'Reactivar'}</Button>}
        </li>
      ))}
    </ul>
  );
}

const TABS = [['cafes', 'Cafeterías', CafesTab], ['reviews', 'Moderación', ModerationTab], ['users', 'Usuarios', UsersTab]];
export default function Admin() {
  const [tab, setTab] = useState('cafes');
  const Current = TABS.find((t) => t[0] === tab)[2];
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Panel de administración</h1>
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>
        ))}
      </div>
      <Current />
    </div>
  );
}
