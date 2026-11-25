// Deja la base lista para el equipo real: borra todas las cuentas que no son coach
// principal, todas las tareas y metas de ejemplo, avisos y fotos. Conserva áreas y competencias.
// Al coach le pone una contraseña temporal (vence en 7 días, la cambia al entrar) y la escribe en
// ACCESO_COACH.txt (archivo local que git ignora). No imprime contraseñas ni llaves.
// Uso: npx tsx scripts/limpiar-demo.ts --si-borrar
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';

if (!process.argv.includes('--si-borrar')) {
  console.error('Esto borra datos. Corre con --si-borrar para confirmar.');
  process.exit(1);
}
config({ path: 'supabase/.env' });
const srv = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const NADA = '00000000-0000-0000-0000-000000000000';

// 1) Fotos de evidencia en Storage
const { data: carpetas } = await srv.storage.from('evidencias').list('', { limit: 1000 });
for (const c of carpetas ?? []) {
  const { data: archivos } = await srv.storage.from('evidencias').list(c.name, { limit: 1000 });
  if (archivos?.length) await srv.storage.from('evidencias').remove(archivos.map((a) => `${c.name}/${a.name}`));
}

// 2) Contenido (tareas arrastran pasos, responsables, comentarios, evidencias e historial)
for (const t of ['tareas', 'metas', 'avisos', 'solicitudes_reinicio', 'suscripciones_push']) {
  const { error } = await srv.from(t).delete().neq('id', NADA);
  if (error) throw new Error(`${t}: ${error.message}`);
}
await srv.from('intentos_login').delete().neq('usuario', '');

// 3) Cuentas que no son el coach principal
const { data: perfiles } = await srv.from('profiles').select('id, usuario, rol_global');
const coach = perfiles?.find((p) => p.rol_global === 'coach');
if (!coach) throw new Error('No encontré la cuenta del coach principal; no borro cuentas.');
let borradas = 0;
for (const p of perfiles ?? []) {
  if (p.id === coach.id) continue;
  const { error } = await srv.auth.admin.deleteUser(p.id);
  if (error) throw new Error(`${p.usuario}: ${error.message}`);
  borradas++;
}

// 4) Contraseña temporal del coach (palabra-número, como las fichas)
const palabras = ['cobre', 'vino', 'crema', 'ambar', 'chasis', 'engrane', 'torre', 'garra', 'polea', 'voltio', 'chispa', 'servo'];
const temporal = `${palabras[randomInt(palabras.length)]}-${randomInt(100, 1000)}${palabras[randomInt(palabras.length)]}`;
const { error: e1 } = await srv.auth.admin.updateUserById(coach.id, { password: temporal });
if (e1) throw new Error(e1.message);
const vence = new Date(Date.now() + 7 * 864e5).toISOString();
await srv.from('profiles').update({ debe_cambiar_password: true, password_temporal_vence: vence }).eq('id', coach.id);
writeFileSync(
  'ACCESO_COACH.txt',
  `Tablero Zero · acceso del coach\n\nDirección: https://tablero-zero.vercel.app\nUsuario:    ${coach.usuario}\nContraseña temporal: ${temporal}\nVence:      ${vence.slice(0, 10)} (7 días)\n\nAl entrar te pide cambiarla por una tuya. Después BORRA este archivo.\n`,
);

console.log(`Listo: ${borradas} cuentas de prueba borradas, tareas/metas/avisos/fotos de ejemplo borrados.`);
console.log(`Se conservaron: la cuenta ${coach.usuario}, las áreas y las competencias.`);
console.log('La contraseña temporal del coach quedó en ACCESO_COACH.txt (no se subió a git).');
