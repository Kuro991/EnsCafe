import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary/10 text-primary',
      secondary: 'bg-secondary text-secondary-foreground',
      warning: 'bg-star/15 text-[hsl(30,80%,28%)]',
      destructive: 'bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});
export const Badge = ({ className, variant, ...p }) => <span className={cn(badge({ variant }), className)} {...p} />;
