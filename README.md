# EnsCafe

Aplicación web para descubrir, ubicar y reseñar cafeterías de Ensenada. React + shadcn/ui + Tailwind en el frontend y **microservicios** Node/Express con **PostgreSQL** en el backend.

## Arquitectura

```
Cloudflare Pages (frontend)  ──HTTPS──▶  API Gateway :4000 (único servicio público)
                                           ├─▶ auth-service    :4001 ─┐
                                           ├─▶ catalog-service :4002 ─┼─▶ PostgreSQL (esquemas auth / catalog / reviews)
                                           └─▶ reviews-service :4003 ─┘
reviews-service ──(interno, X-Internal-Key)──▶ catalog-service   verifica cafetería y actualiza el promedio
```

- **Persistencia:** PostgreSQL. Cada servicio es dueño de su esquema (`auth`, `catalog`, `reviews`) y nunca consulta tablas ajenas: se hablan por HTTP. Con `AUTH_DATABASE_URL`, `CATALOG_DATABASE_URL` y `REVIEWS_DATABASE_URL` pueden ir en bases o servidores distintos.
- **Migraciones versionadas:** `services/*/migrations/001_*.sql`. Se aplican una sola vez, en orden y en transacción (con candado para evitar carreras).
- Los servicios internos solo escuchan en `127.0.0.1`; el gateway es lo único expuesto.
- `packages/common` reúne lo compartido: conexión a PostgreSQL, migraciones, validación (zod), errores, JWT y guardas de producción.

## Desarrollo local

Requiere **Node 22.13+** y **pnpm**. Necesitas un PostgreSQL:

**Opción 1: Docker** (datos persistentes en un volumen)
```bash
pnpm db:up          # docker compose up -d db
```
**Opción 2: un PostgreSQL gestionado gratuito** (Neon, Supabase…): copia `.env.example` a `.env` y define `DATABASE_URL` (y `DATABASE_SSL=true`).

```bash
pnpm install
pnpm dev            # 4 servicios + frontend → http://localhost:5173
```

Al arrancar, los servicios aplican las migraciones y, **solo en desarrollo**, crean datos de ejemplo: el administrador `admin@enscafe.mx` / `Admin12345` y 10 cafeterías ficticias (`services/catalog/seed.js`; reemplázalas por cafeterías reales). `GET /api/health` muestra el estado de los servicios y de la base.

| Comando | Qué hace |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Levanta / detiene el PostgreSQL de Docker (los datos se conservan) |
| `pnpm db:migrate` | Aplica migraciones pendientes (también se aplican al arrancar, salvo `AUTO_MIGRATE=false`) |
| `pnpm db:seed` | Carga las cafeterías de `seed.js` si el catálogo está vacío |
| `pnpm db:reset` | **Borra** los esquemas (solo desarrollo; se niega con `NODE_ENV=production`) |
| `ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm admin:create` | Crea un administrador o promueve una cuenta existente (sin `ADMIN_PASSWORD` solo promueve) |
| `pnpm start:api` | Arranca los 4 procesos del backend como en producción |

En PowerShell: `$env:ADMIN_EMAIL="tu@correo.com"; $env:ADMIN_PASSWORD="una-clave-larga"; pnpm admin:create`. La contraseña mínima es de 12 caracteres. Tras promover una cuenta, hay que cerrar sesión y volver a entrar (el rol viaja en el token).

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `NODE_ENV=production` | backend | Activa las guardas de producción (sin datos demo, secretos obligatorios, CORS cerrado) |
| `DATABASE_URL` | backend | Cadena de conexión de PostgreSQL (obligatoria en producción) |
| `DATABASE_SSL=true` | backend | Conexión con SSL (proveedores gestionados) |
| `JWT_SECRET`, `INTERNAL_KEY` | backend | Mínimo 32 caracteres y distintos entre sí. `openssl rand -base64 48`. **Sin ellos, en producción el servicio no arranca** |
| `CORS_ORIGINS` | backend | Dominios del frontend permitidos, separados por coma |
| `TRUST_PROXY=1` | backend | Número de proxies delante (para obtener la IP real) |
| `TRUST_CLOUDFLARE=true` | backend | Usa `CF-Connecting-IP` para el rate limit. **Solo** si el origen únicamente recibe tráfico de Cloudflare |
| `SEED_DEMO` | backend | `true`/`false`; por defecto `true` en desarrollo y `false` en producción |
| `TURNSTILE_SECRET` | backend | Clave secreta de Cloudflare Turnstile. **En producción es obligatoria** (o `CAPTCHA_DISABLED=true`). Sin ella en desarrollo el captcha se omite |
| `VITE_TURNSTILE_SITE_KEY` | frontend (build) | Clave pública (site key) de Turnstile. Sin ella el widget no se muestra |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | backend | Servidor de correo (Resend, Brevo, SES, Gmail con clave de aplicación…). 587 = STARTTLS (`SMTP_SECURE=false`), 465 = `true`. Sin `SMTP_HOST` en desarrollo los correos se imprimen en la consola del servicio `auth` |
| `MAIL_FROM`, `APP_URL` | backend | Remitente (`EnsCafe <no-reply@tudominio.com>`) y URL pública del frontend para los enlaces de los correos. Obligatorios en producción |
| `COOKIE_SAMESITE` | backend | `lax` (por defecto; frontend y API en el mismo sitio, p. ej. `www.` y `api.tudominio.com`) o `none` (sitios distintos, p. ej. `*.pages.dev` + otro host; fuerza `Secure`) |
| `COOKIE_DOMAIN` | backend | Opcional: `.tudominio.com` para compartir la cookie entre subdominios |
| `ACCESS_TTL_SECONDS`, `REFRESH_IDLE_DAYS`, `REFRESH_ABSOLUTE_DAYS`, `ROTATE_GRACE_SECONDS` | backend | Duración del access token (900), inactividad máxima (14 d), vida máxima de la sesión (30 d) y tolerancia a refrescos simultáneos (10 s) |
| `PORT` | backend | Puerto del gateway (los hostings suelen asignarlo) |
| `VITE_API_URL` | frontend (build) | Origen público del gateway, p. ej. `https://api.tudominio.com` |

## Despliegue en producción

**1. Base de datos.** Crea un PostgreSQL gestionado (Neon, Supabase, Railway, etc.), activa los backups / recuperación a un punto en el tiempo y copia la cadena de conexión. Usa la URL con pool si el proveedor la ofrece. Las tablas se crean solas con las migraciones; si usas roles restringidos por servicio, crea antes los esquemas `auth`, `catalog` y `reviews` y da a cada rol permisos solo sobre el suyo.

**2. Backend (gateway + servicios).** Despliégalo en un host que ejecute Node o contenedores (Render, Railway, Fly.io, un VPS…) con el `Dockerfile` incluido, que ejecuta los 4 procesos y publica solo el gateway. *El Dockerfile no se pudo probar en el entorno de desarrollo: verifica el build.* Define las variables de la tabla anterior en el panel del hosting (nunca en el repositorio). Crea tu administrador una vez:
`ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm admin:create` (con `DATABASE_URL` de producción). Luego haz commit de `pnpm-lock.yaml` y cambia el Dockerfile a `--frozen-lockfile`.

**3. Frontend en Cloudflare Pages.** Conecta el repositorio y configura:
- Comando de compilación: `pnpm install && pnpm --filter @enscafe/frontend build`
- Directorio de salida: `frontend/dist` (ajústalo si configuras otra raíz)
- Variable de compilación: `VITE_API_URL=https://api.tudominio.com`

El build genera `_headers` (HSTS, CSP con tu dominio de API, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, caché inmutable de `/assets`) y `_redirects` (las rutas como `/mapa` siempre cargan la app). Prueba la CSP con la consola del navegador abierta; no se verificó en un navegador real.

**4. Cloudflare delante del API (recomendado).** Apunta `api.tudominio.com` al backend con el proxy activado, o mejor con **Cloudflare Tunnel** (sin puertos abiertos), y configura: reglas de *rate limiting* sobre `/api/auth/*`, WAF y Bot Fight Mode. Con ello puedes activar `TRUST_CLOUDFLARE=true`.

## Seguridad: qué incluye y qué falta

Incluido: secretos obligatorios en producción; sin administrador ni datos demo en producción; CORS restringido (con credenciales); servicios internos solo en loopback y `/internal/*` no expuesto; cabeceras HTTP de seguridad (`helmet`) en el API; contraseñas con bcrypt; consultas parametrizadas; validación en servidor con zod; límite de tamaño de cuerpo; rate limit en gateway (más estricto en login, registro y correos); restricciones `UNIQUE`/`CHECK` en la base; roles verificados en servidor.

**CAPTCHA (Cloudflare Turnstile).** Se exige en registro, login, recuperar contraseña, reenviar verificación y publicar reseñas. El navegador envía el token en `X-Captcha-Token`; el gateway lo valida contra Cloudflare (los tokens son de un solo uso y el widget se reinicia tras cada envío). Crea el widget en el panel de Cloudflare → Turnstile, pon el *site key* en `VITE_TURNSTILE_SITE_KEY` y el *secret* en `TURNSTILE_SECRET`. Claves de prueba oficiales: site `1x00000000000000000000AA` y secret `1x0000000000000000000000000000000AA` (siempre pasan).

**Verificación de correo.** El registro responde siempre lo mismo (no revela si el correo ya existe; al dueño se le avisa por correo) y no inicia sesión. El enlace (`/verificar?token=…`, 24 h, un solo uso) confirma la cuenta; hasta entonces el login devuelve `EMAIL_NOT_VERIFIED`. Los tokens se guardan solo como hash SHA-256. Las cuentas anteriores a esta versión quedan como verificadas.

**Recuperar contraseña.** `/olvide` → correo con enlace (`/restablecer?token=…`, 30 min, un solo uso, un envío por minuto por cuenta) → al guardar se **revocan todas las sesiones** y se avisa por correo. La respuesta es genérica exista o no la cuenta.

**Sesión en cookies HttpOnly.** El JavaScript del navegador ya no ve ningún token: `enscafe_at` (JWT de 15 min, `Path=/`) y `enscafe_rt` (refresh token opaco, `Path=/api/auth`) son `HttpOnly`, `Secure` en producción y `SameSite`. El refresh token **rota en cada uso**, se guarda hasheado en `auth.sessions` y, si un token ya usado se presenta de nuevo, se revoca toda la cadena (posible robo). Suspender a un usuario, restablecer su contraseña o “Cerrar sesión en todos mis dispositivos” revocan sus sesiones (el access token restante dura como máximo 15 min). **CSRF:** como las cookies viajan solas, el gateway exige `X-Requested-With: enscafe` en toda petición que modifica datos y valida `Origin` contra `CORS_ORIGINS`.

> **Importante para Cloudflare Pages:** si el frontend está en `*.pages.dev` y el API en otro dominio, el navegador trata las cookies como de terceros y muchos navegadores las bloquean. Lo robusto es usar un dominio propio para ambos (`www.tudominio.com` en Pages y `api.tudominio.com` para el API) con `COOKIE_SAMESITE=lax`. Si no es posible, usa `COOKIE_SAMESITE=none` sabiendo que Safari y Firefox con protección estricta pueden bloquearlas.

Pendiente (recomendado antes de tener usuarios reales): aviso de privacidad (LFPDPPP); proveedor de mapas con clave si hay mucho tráfico (el servidor público de OpenStreetMap es para uso moderado); registro y monitoreo de eventos de seguridad; 2FA para administradores; limitar sesiones activas por usuario. *Limitaciones de las pruebas:* el widget real de Turnstile y el envío por SMTP real no se probaron (se simularon el endpoint `siteverify`, el widget y el correo en consola); la CSP y las cookies `Secure`/`SameSite=None` no se probaron en producción.
