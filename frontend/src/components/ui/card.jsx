import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }) => <div className={cn('rounded-lg border bg-card text-card-foreground', className)} {...p} />;
export const CardHeader = ({ className, ...p }) => <div className={cn('flex flex-col gap-1 p-5 pb-2', className)} {...p} />;
export const CardTitle = ({ className, ...p }) => <h3 className={cn('text-lg font-semibold leading-tight', className)} {...p} />;
export const CardContent = ({ className, ...p }) => <div className={cn('p-5 pt-2', className)} {...p} />;
