import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const base = 'w-full rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-[invalid=true]:border-destructive';
export const Input = forwardRef(({ className, ...props }, ref) => <input ref={ref} className={cn(base, 'h-10', className)} {...props} />);
Input.displayName = 'Input';
export const Textarea = forwardRef(({ className, ...props }, ref) => <textarea ref={ref} className={cn(base, 'min-h-[96px] py-2', className)} {...props} />);
Textarea.displayName = 'Textarea';
export const Select = forwardRef(({ className, ...props }, ref) => <select ref={ref} className={cn(base, 'h-10', className)} {...props} />);
Select.displayName = 'Select';
