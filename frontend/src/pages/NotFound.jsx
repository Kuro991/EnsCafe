import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/States';
import { buttonVariants } from '@/components/ui/button';

export default function NotFound({ title = 'Esta página no existe', message = 'Revisa la dirección o vuelve al inicio.' }) {
  return <EmptyState title={title} message={message} action={<Link to="/" className={buttonVariants({ variant: 'outline' })}>Ir al inicio</Link>} />;
}
