import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs) => twMerge(clsx(inputs));

export function formatDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z'); // SQLite guarda UTC
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const STATUS_LABEL = { draft: 'Borrador', active: 'Activa', closed: 'Cerrada temporalmente', retired: 'Dada de baja' };
