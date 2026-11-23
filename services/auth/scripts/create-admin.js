// Crea un administrador (o promueve una cuenta existente).
//   ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='una-clave-larga' pnpm --filter @enscafe/auth create-admin
// Si la cuenta ya existe y no das ADMIN_PASSWORD, solo se le asigna el rol de administrador.
// Las credenciales se pasan por variables de entorno para que no queden en el historial de comandos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { openDb, migrate } from '@enscafe/common';

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? '';
const name = (process.env.ADMIN_NAME ?? 'Administrador').trim();
const fail = (msg) => { console.error(msg); process.exit(1); };

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Define ADMIN_EMAIL con un correo válido.');
if (password && (password.length < 12 || password.length > 72)) fail('ADMIN_PASSWORD debe tener entre 12 y 72 caracteres.');

const db = openDb('auth');
await migrate(db, 'auth', path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations'));
const existing = await db.get('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);

if (existing) {
  if (password) await db.run(`UPDATE auth.users SET role = 'admin', status = 'active', password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [existing.id, await bcrypt.hash(password, 10)]);
  else await db.run(`UPDATE auth.users SET role = 'admin', status = 'active', email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [existing.id]);
  await db.run(`UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [existing.id]); // fuerza a reingresar con el rol nuevo
  console.log(`${email} ahora es administrador${password ? ' (contraseña actualizada)' : ''}. Debe cerrar sesión y volver a entrar.`);
} else {
  if (!password) fail('La cuenta no existe: define también ADMIN_PASSWORD para crearla.');
  await db.run(`INSERT INTO auth.users(name, email, password_hash, role, email_verified_at) VALUES ($1, $2, $3, 'admin', now())`, [name, email, await bcrypt.hash(password, 10)]);
  console.log(`Administrador creado: ${email}`);
}
await db.pool.end();
