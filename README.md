# EnsCafe

Aplicación web para descubrir, ubicar y reseñar cafeterías de Ensenada. React + shadcn/ui + Tailwind en el frontend y **microservicios** Node/Express en el backend, cada uno con su propia base de datos.

## Arquitectura

```
React (Vite :5173) ──/api──▶ API Gateway :4000 ──▶ auth-service    :4001  (auth.db)     usuarios, login, roles
                                                ├─▶ catalog-service :4002  (catalog.db)  cafeterías, búsqueda, mapa, ranking
                                                └─▶ reviews-service :4003  (reviews.db)  reseñas, moderación, Top 5
reviews-service ──(interno, X-Internal-Key)──▶ catalog-service   verifica cafetería y actualiza el promedio
```

- **Base de datos por servicio** (SQLite integrado en Node con `node:sqlite`, archivos en `data/`). Ningún servicio lee la base de otro: se hablan por HTTP.
- El **gateway** es la única puerta de entrada: enruta, limita el uso (rate limit) y convierte caídas/lentitud en errores claros (503/504). Las rutas `/internal/*` no se exponen.
- **JWT** (2 h) firmado con un secreto compartido; cada servicio valida el token y los roles (`user`, `admin`).
- `packages/common` reúne lo compartido (validación con zod, errores, auth, helper para llamar a otros servicios).
- Para pasar a PostgreSQL basta cambiar `openDb()` en `packages/common` y las consultas de cada servicio; la arquitectura no cambia.

## Cómo correrlo

Requiere **Node 22.13 o superior** y **pnpm** (probado con Node 22 y pnpm 10; es un monorepo pnpm, no usa npm).

```bash
pnpm install
pnpm dev             # levanta los 4 servicios + el frontend
```

La base de datos es el SQLite que ya trae Node (`node:sqlite`), así que no hay módulos nativos que compilar.

Abre http://localhost:5173. Administrador de desarrollo: `admin@enscafe.mx` / `Admin12345`
(cámbialo y define `JWT_SECRET` / `INTERNAL_KEY` en producción; ver `.env.example`).
`pnpm reset-db` borra los datos. `GET /api/health` muestra qué servicios están arriba.

> Las 10 cafeterías iniciales (`services/catalog/seed.js`) son **datos de ejemplo** con nombres ficticios y coordenadas aproximadas. Reemplázalas por cafeterías reales con coordenadas verificadas.

## Casos límite: qué pasa y dónde está resuelto

| Caso | Comportamiento | Dónde |
|---|---|---|
| Formulario con campos vacíos | Mensaje bajo cada campo; no se envía | cliente (`AuthPage`, `Admin`, reseñas) y servidor (zod → 422 con `fields`) |
| Texto donde va un número / negativo | Latitud y longitud son campos de texto que se validan a mano (un `type=number` borra en silencio lo inválido). Puntuación fuera de 0–5, decimal o texto → 422 | `num()` en `packages/common`, `validate()` en `Admin.jsx` |
| Puntuación 0 | Es válida y distinta de "sin seleccionar" (se compara con `null`, no con falsy) | `RatingInput`, `reviews-service` |
| Texto muy largo | `maxLength` en inputs + límites en servidor (nombre 80, comentario 1000…) + cuerpo máximo 20 kB; `break-words` evita que una palabra de 200 letras rompa el diseño | todo el proyecto |
| Buscar algo que no existe | Estado vacío con "Limpiar filtros"; `%` y `_` se escapan en el `LIKE` | `Explore.jsx`, `catalog-service` |
| Doble clic en guardar | Botón con `loading` + guarda con `useRef` + restricciones `UNIQUE` en la BD (una reseña por usuario/cafetería, correo único, cafetería única); un duplicado devuelve 409 con mensaje | formularios y esquemas SQL |
| Recargar a mitad de un proceso | Filtros en la URL, sesión restaurada desde el token, borrador de reseña guardado por cafetería | `Explore`, `AuthContext`, `ReviewForm` |
| API lenta o caída | Timeout de 10 s en el cliente y 8 s en el gateway; mensaje + botón Reintentar; si cae `catalog`, el login y las reseñas ya publicadas siguen funcionando (probado) | `lib/api.js`, `gateway`, `States.jsx` |
| Sin internet | Banner "Sin conexión" y errores de red legibles | `Layout`, `api.js` |
| Mapa no disponible | Aviso si no cargan los mosaicos; los puntos y la lista siguen disponibles (CU-04) | `CafeMap.jsx` |
| Listas vacías | Cada lista tiene su estado vacío con una acción | `States.jsx` |
| Pantalla en blanco | `ErrorBoundary` por ruta; rutas inexistentes y `id` inválidos → 404 amable | `ErrorBoundary`, `NotFound` |
| Token vencido o falso | 401 → cierre de sesión con aviso | `api.js`, `AuthContext` |
| Top 5 lleno o con repetidos | Botón deshabilitado y 422 en servidor; la lista se guarda completa y de forma atómica | `reviews-service` |
| Permisos | Editar reseña ajena → 403; panel admin solo con rol admin (cliente y servidor) | servicios + `RequireAuth` |
| Inyección SQL | Solo consultas parametrizadas; el orden se elige de una lista blanca | servicios |

## Decisiones y supuestos

- **Comentario opcional**: el diagrama de clases lo define así, pero los diagramas de estados y de secuencia dicen que "texto vacío = error". Elegí opcional; si tu profesor espera lo otro, cambia `optText` por `text` en `reviews-service`.
- **Baja de cafetería = baja lógica** (`status = retired`) para no dejar reseñas ni Top 5 huérfanos.
- **Consistencia eventual del promedio**: si `catalog` está caído cuando se publica una reseña, la reseña se guarda y el promedio se corrige al reiniciar `reviews`.
- Un usuario suspendido conserva su token hasta que expire (2 h); `/auth/me` ya lo rechaza.
- Pendientes razonables: perfiles públicos de otros usuarios, subir fotos, Dockerfile/docker-compose, pruebas automáticas.
