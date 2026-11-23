// Arranca los 4 procesos del backend en un solo contenedor/servidor (pnpm start:api o la imagen Docker).
// Siguen siendo microservicios independientes: cada uno es su propio proceso y habla con los demás por HTTP.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const services = ['auth', 'catalog', 'reviews', 'gateway'];
const children = services.map((name) => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(root, 'services', name), stdio: 'inherit', env: process.env,
  });
  child.on('exit', (code, signal) => {
    console.error(`[start-all] ${name} terminó (${signal ?? code}); se detiene todo para que el hosting lo reinicie`);
    stop(1);
  });
  return child;
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
