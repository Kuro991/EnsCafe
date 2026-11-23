// Aplica las migraciones de los tres servicios: pnpm db:migrate
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../services');
for (const name of ['auth', 'catalog', 'reviews']) {
  const db = openDb(name);
  await migrate(db, name, path.join(root, name, 'migrations'));
  await db.pool.end();
}
console.log('Migraciones al día.');
