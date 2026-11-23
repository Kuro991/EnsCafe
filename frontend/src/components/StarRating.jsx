import { useState } from 'react';
import { cn } from '@/lib/utils';

// Muestra un promedio (0-5, con decimales) como estrellas parcialmente rellenas
export function StarRating({ value = 0, count, className }) {
  const pct = Math.max(0, Math.min(5, Number(value) || 0)) * 20;
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <span className="relative inline-block text-base leading-none tracking-tight" role="img" aria-label={count ? `${value} de 5 estrellas` : 'Sin calificaciones'}>
        <span className="text-border">★★★★★</span>
        <span className="absolute inset-0 overflow-hidden text-star" style={{ width: `${pct}%` }}>★★★★★</span>
      </span>
      {count === undefined ? null : count > 0
        ? <span className="text-muted-foreground"><strong className="text-foreground">{Number(value).toFixed(1)}</strong> ({count})</span>
        : <span className="text-muted-foreground">Sin reseñas</span>}
    </span>
  );
}

// Selector de 0 a 5. El 0 es una opción propia: "sin seleccionar" (null) y "0 estrellas" son cosas distintas.
export function RatingInput({ value, onChange, invalid, disabled }) {
  const [hover, setHover] = useState(null);
  const shown = hover ?? value ?? -1;
  return (
    <div>
      <div role="radiogroup" aria-label="Calificación de 0 a 5 estrellas" aria-invalid={invalid} className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        <button type="button" role="radio" aria-checked={value === 0} disabled={disabled} onClick={() => onChange(0)}
          className={cn('mr-2 h-8 rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', value === 0 ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
          0
        </button>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`} disabled={disabled}
            onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}
            className={cn('text-3xl leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', n <= shown ? 'text-star' : 'text-border')}>
            ★
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{value === null ? 'Sin seleccionar' : `${value} de 5`}</p>
    </div>
  );
}
