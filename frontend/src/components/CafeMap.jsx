import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { StarRating } from '@/components/StarRating';

const CENTER = [31.8667, -116.6235]; // Ensenada
const CUP = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>';
// Marcador personalizado (no depende de imágenes: evita el clásico icono roto de Leaflet con bundlers)
const pin = (active) => L.divIcon({
  className: '',
  html: `<div class="cafe-pin ${active ? 'is-active' : ''}">${CUP}</div>`,
  iconSize: active ? [44, 44] : [34, 34],
  iconAnchor: active ? [22, 53] : [17, 42],
  popupAnchor: [0, active ? -52 : -42],
});
const validCoords = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

function Viewport({ cafes, selected }) {
  const map = useMap();
  const key = cafes.map((c) => c.id).join(',');
  useEffect(() => {
    if (!cafes.length) { map.setView(CENTER, 13); return; }
    map.fitBounds(L.latLngBounds(cafes.map((c) => [c.lat, c.lng])), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  useEffect(() => { if (selected) map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { duration: 0.6 }); }, [selected, map]);
  return null;
}

export function CafeMap({ cafes, selectedId, onSelect, className = 'h-[420px]' }) {
  const points = useMemo(() => cafes.filter(validCoords), [cafes]);
  const selected = points.find((c) => c.id === selectedId) ?? null;
  const [tilesFailed, setTilesFailed] = useState(false);
  const tilesLoaded = useRef(0);

  return (
    <div className={`relative overflow-hidden rounded-lg border ${className}`}>
      <MapContainer center={CENTER} zoom={13} scrollWheelZoom className="h-full w-full" aria-label="Mapa de cafeterías de Ensenada">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileload: () => { tilesLoaded.current += 1; setTilesFailed(false); },
            tileerror: () => { if (!tilesLoaded.current) setTilesFailed(true); },
          }}
        />
        <Viewport cafes={points} selected={selected} />
        {points.map((c) => (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={pin(c.id === selectedId)} title={c.name}
            eventHandlers={{ click: () => onSelect?.(c.id) }}>
            <Popup>
              <p className="mb-1 break-words text-sm font-semibold">{c.name}</p>
              <StarRating value={c.ratingAvg} count={c.ratingCount} />
              <p className="mt-1 break-words text-xs text-muted-foreground">{c.address}</p>
              <Link to={`/cafeteria/${c.id}`} className="mt-2 inline-block text-sm font-medium text-primary underline">Ver detalle</Link>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {tilesFailed && (
        <div role="alert" className="absolute inset-x-3 top-3 z-[1000] flex items-center gap-2 rounded-md border border-star/60 bg-card p-3 text-sm shadow">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          No se pudo cargar el mapa base (sin conexión o servicio de mapas no disponible). Los puntos de interés y la lista siguen disponibles.
        </div>
      )}
    </div>
  );
}
