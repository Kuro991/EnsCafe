// Carga las cafeterías de seed.js si el catálogo está vacío: pnpm --filter @enscafe/catalog seed
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '@enscafe/common';
import { seedIfEmpty } from '../seed.js';

const db = openDb('catalog');
await migrate(db, 'catalog', path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations'));
console.log((await seedIfEmpty(db)) ? 'Cafeterías de ejemplo cargadas.' : 'El catálogo ya tiene datos: no se hizo nada.');
await db.pool.end();
