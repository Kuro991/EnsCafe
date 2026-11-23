// Microservicio de AUTENTICACIÓN y USUARIOS (puerto 4001, base auth.db)
import bcrypt from 'bcryptjs';
import {
  z, express, createApp, start, openDb, wrap, parse, text, HttpError, isUnique,
  signToken, requireAuth, requireAdmin,
} from '@enscafe/common';

const db = openDb('auth');
db.exec(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Administrador inicial (solo desarrollo; cambia la contraseña en producción)
if (!db.prepare(`SELECT 1 FROM users WHERE role='admin'`).get()) {
  db.prepare(`INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?, 'admin')`)
    .run('Administrador', 'admin@enscafe.mx', bcrypt.hashSync('Admin12345', 10));
}

const DUMMY_HASH = bcrypt.hashSync('no-existe', 10); // iguala el tiempo de respuesta si el correo no existe
const toUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.created_at });

const email = z
  .string({ required_error: 'El correo es obligatorio', invalid_type_error: 'El correo debe ser texto' })
  .trim().toLowerCase()
  .min(1, 'El correo es obligatorio')
  .max(120, 'El correo no puede superar 120 caracteres')
  .email('El correo no tiene un formato válido');
const password = z
  .string({ required_error: 'La contraseña es obligatoria', invalid_type_error: 'La contraseña debe ser texto' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres');

const registerSchema = z.object({ name: text('El nombre', { min: 2, max: 60 }), email, password });
const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'La contraseña es obligatoria' }).min(1, 'La contraseña es obligatoria').max(72, 'Contraseña no válida'),
});

const r = express.Router();

r.post('/register', wrap(async (req, res) => {
  const d = parse(registerSchema, req.body);
  const hash = await bcrypt.hash(d.password, 10);
  try {
    const info = db.prepare(`INSERT INTO users(name,email,password_hash) VALUES (?,?,?)`).run(d.name, d.email, hash);
    const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(info.lastInsertRowid);
    res.status(201).json({ token: signToken(user), user: toUser(user) });
  } catch (e) {
    // La restricción UNIQUE también protege contra doble clic / peticiones simultáneas
    if (isUnique(e)) throw new HttpError(409, 'Ese correo ya está registrado', 'EMAIL_TAKEN', { email: 'Ese correo ya está registrado' });
    throw e;
  }
}));

r.post('/login', wrap(async (req, res) => {
  const d = parse(loginSchema, req.body);
  const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(d.email);
  const ok = await bcrypt.compare(d.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Correo o contraseña incorrectos', 'BAD_CREDENTIALS');
  if (user.status === 'suspended') throw new HttpError(403, 'Tu cuenta está suspendida. Contacta al administrador', 'SUSPENDED');
  res.json({ token: signToken(user), user: toUser(user) });
}));

const currentUser = (req) => {
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  if (!u) throw new HttpError(401, 'La cuenta ya no existe', 'UNAUTHORIZED');
  if (u.status === 'suspended') throw new HttpError(403, 'Tu cuenta está suspendida', 'SUSPENDED');
  return u;
};

r.get('/me', requireAuth, wrap(async (req, res) => res.json({ user: toUser(currentUser(req)) })));

r.patch('/me', requireAuth, wrap(async (req, res) => {
  currentUser(req);
  const d = parse(z.object({ name: text('El nombre', { min: 2, max: 60 }) }), req.body);
  db.prepare(`UPDATE users SET name=? WHERE id=?`).run(d.name, req.user.id);
  res.json({ user: toUser(currentUser(req)) });
}));

// ---- Administración de usuarios (gestionarUsuarios) ----
r.get('/users', ...requireAdmin, wrap(async (_req, res) => {
  res.json({ items: db.prepare(`SELECT * FROM users ORDER BY id DESC LIMIT 200`).all().map(toUser) });
}));
r.patch('/users/:id/status', ...requireAdmin, wrap(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'suspended'], { errorMap: () => ({ message: 'Estado no válido' }) }) }), req.body);
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(409, 'No puedes suspender tu propia cuenta', 'SELF_ACTION');
  const info = db.prepare(`UPDATE users SET status=? WHERE id=?`).run(status, id);
  if (!info.changes) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
  res.json({ user: toUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(id)) });
}));

const app = createApp();
app.use('/auth', r);
start(app, 'auth', Number(process.env.AUTH_PORT || 4001));
