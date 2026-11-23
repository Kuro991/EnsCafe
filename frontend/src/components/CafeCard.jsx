import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StarRating } from '@/components/StarRating';

export function CafeCard({ cafe, rank }) {
  return (
    <Link to={`/cafeteria/${cafe.id}`} className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-colors group-hover:border-primary/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="min-w-0 break-words">{rank ? <span className="mr-2 text-primary">{rank}.</span> : null}{cafe.name}</CardTitle>
            <Badge variant="secondary" className="shrink-0">{cafe.zone}</Badge>
          </div>
          <StarRating value={cafe.ratingAvg} count={cafe.ratingCount} />
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="flex items-start gap-1.5 break-words text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{cafe.address}</p>
          {cafe.status === 'closed' && <Badge variant="warning">Cerrada temporalmente</Badge>}
        </CardContent>
      </Card>
    </Link>
  );
}
