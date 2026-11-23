// Envío de correo (SMTP vía nodemailer). En desarrollo, si no hay SMTP_HOST, el correo se imprime en la consola.
import nodemailer from 'nodemailer';
import { PROD } from '@enscafe/common';

export const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const FROM = process.env.MAIL_FROM || 'EnsCafe <no-reply@enscafe.local>';

export function checkMailConfig() {
  if (!PROD) return;
  const missing = ['SMTP_HOST', 'MAIL_FROM', 'APP_URL'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[auth] En producción son obligatorias para enviar correos: ${missing.join(', ')}`);
    process.exit(1);
  }
}

let transport = null;
const getTransport = () =>
  (transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true = puerto 465; false = STARTTLS en 587
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Nunca lanza: un fallo de correo no debe romper la petición (y no revela si la cuenta existe)
export async function sendMail({ to, subject, text, html }) {
  if (!process.env.SMTP_HOST) {
    console.log(`\n[mail:dev] Para: ${to}\n[mail:dev] Asunto: ${subject}\n${text}\n`);
    return true;
  }
  try {
    await getTransport().sendMail({ from: FROM, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('[auth] no se pudo enviar el correo:', e.message);
    return false;
  }
}

const layout = (title, body, cta, url) => `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2b2118;max-width:480px;margin:auto">
<h2 style="color:#7a4a21">${esc(title)}</h2>${body}
${cta ? `<p><a href="${esc(url)}" style="display:inline-block;background:#7a4a21;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(cta)}</a></p>
<p style="font-size:12px;color:#777">Si el botón no funciona, copia este enlace en tu navegador:<br>${esc(url)}</p>` : ''}
<p style="font-size:12px;color:#777">EnsCafe · Cafeterías de Ensenada</p></body></html>`;

export const verifyEmailMessage = (name, token, ttlH) => {
  const url = `${APP_URL}/verificar?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirma tu correo en EnsCafe',
    text: `Hola ${name}:\n\nConfirma tu correo para activar tu cuenta (el enlace vence en ${ttlH} horas):\n${url}\n\nSi no creaste la cuenta, ignora este mensaje.`,
    html: layout('Confirma tu correo', `<p>Hola ${esc(name)}, confirma tu correo para activar tu cuenta. El enlace vence en ${ttlH} horas.</p><p>Si no creaste la cuenta, ignora este mensaje.</p>`, 'Confirmar correo', url),
  };
};
export const resetPasswordMessage = (name, token, ttlMin) => {
  const url = `${APP_URL}/restablecer?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Restablece tu contraseña de EnsCafe',
    text: `Hola ${name}:\n\nPara elegir una contraseña nueva usa este enlace (vence en ${ttlMin} minutos y solo sirve una vez):\n${url}\n\nSi no lo pediste, ignora este mensaje: tu contraseña no cambiará.`,
    html: layout('Restablece tu contraseña', `<p>Hola ${esc(name)}, recibimos una solicitud para restablecer tu contraseña. El enlace vence en ${ttlMin} minutos y solo se puede usar una vez.</p><p>Si no lo pediste, ignora este mensaje.</p>`, 'Elegir contraseña nueva', url),
  };
};
export const passwordChangedMessage = (name) => ({
  subject: 'Tu contraseña de EnsCafe cambió',
  text: `Hola ${name}:\n\nTu contraseña se cambió y se cerraron todas tus sesiones. Si no fuiste tú, restablécela de inmediato: ${APP_URL}/olvide`,
  html: layout('Tu contraseña cambió', `<p>Hola ${esc(name)}, tu contraseña se cambió y se cerraron todas tus sesiones.</p><p>Si no fuiste tú, restablécela de inmediato.</p>`, 'Restablecer contraseña', `${APP_URL}/olvide`),
});
export const accountExistsMessage = (name) => ({
  subject: 'Ya tienes una cuenta en EnsCafe',
  text: `Hola ${name}:\n\nAlguien intentó registrarse con este correo, pero ya tienes cuenta. Inicia sesión: ${APP_URL}/acceso\nSi olvidaste la contraseña: ${APP_URL}/olvide`,
  html: layout('Ya tienes una cuenta', `<p>Hola ${esc(name)}, alguien intentó registrarse con este correo, pero ya tienes una cuenta.</p>`, 'Iniciar sesión', `${APP_URL}/acceso`),
});
