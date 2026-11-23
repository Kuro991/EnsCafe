import { AlertTriangle, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function ErrorState({ title = 'No pudimos cargar esta información', message, onRetry }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {onRetry && <Button variant="outline" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <Coffee className="h-7 w-7 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {action}
    </div>
  );
}

export const CardGridSkeleton = ({ n = 6 }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Cargando">
    {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-36" />)}
  </div>
);
