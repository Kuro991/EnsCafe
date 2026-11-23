import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Al compilar genera, junto al sitio, los archivos que Cloudflare Pages lee: cabeceras de seguridad (_headers)
// y el fallback de la SPA (_redirects). La política CSP se arma con el dominio del API (VITE_API_URL).
function cloudflarePagesFiles(apiOrigin) {
  return {
    name: 'cloudflare-pages-files',
    apply: 'build',
    generateBundle() {
      const csp = [
        "default-src 'self'",
        "script-src 'self' https://challenges.cloudflare.com", // CAPTCHA (Cloudflare Turnstile)
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Leaflet y React usan estilos en línea
        'font-src https://fonts.gstatic.com',
        "img-src 'self' data: https://*.tile.openstreetmap.org", // mosaicos del mapa
        `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
        'frame-src https://challenges.cloudflare.com', // iframe del widget Turnstile
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; ');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: strict-origin-when-cross-origin',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
          `  Content-Security-Policy: ${csp}`,
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      });
      this.emitFile({ type: 'asset', fileName: '_redirects', source: '/* /index.html 200\n' });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let apiOrigin = '';
  try { apiOrigin = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : ''; } catch { /* URL inválida: se ignora */ }
  return {
    plugins: [react(), cloudflarePagesFiles(apiOrigin)],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } }, // todo pasa por el API Gateway
  };
});
