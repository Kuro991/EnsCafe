import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alert = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: { variant: { default: 'bg-card', destructive: 'border-destructive/40 bg-destructive/5 text-destructive', warning: 'border-star/50 bg-star/10' } },
  defaultVariants: { variant: 'default' },
});
export const Alert = ({ className, variant, ...p }) => <div role="alert" className={cn(alert({ variant }), className)} {...p} />;
