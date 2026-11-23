// BORRA los esquemas auth, catalog y reviews (solo desarrollo): pnpm db:reset
import { openDb, PROD } from '../index.js';

if (PROD && process.env.FORCE_RESET !== 'yes') {
  console.error('Se niega a borrar datos con NODE_ENV=production (usa FORCE_RESET=yes si de verdad lo quieres).');
  process.exit(1);
}
const db = openDb('auth');
for (const s of ['auth', 'catalog', 'reviews']) await db.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
await db.pool.end();
console.log('Esquemas auth, catalog y reviews eliminados. Se recrean al iniciar los servicios.');
