// Simulacro de recuperación en el proyecto de PRUEBAS: respalda, "rompe" a propósito (borra una cuenta con sus
// vínculos, borra un archivo, mete basura), restaura y comprueba que todo volvió igual: la cuenta entra con su
// contraseña ANTERIOR, conserva id, rol y áreas, y el archivo vuelve idéntico. Nunca toca producción.
// Uso:  node scripts/simulacro-restauracion.mjs
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destino, leerEnv, validar } from './respaldo-comun.mjs';

const TZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d = destino('pruebas', resolve(TZ, '..'));
validar(d);
const { SUPABASE_ANON_KEY: ANON, SEED_PASSWORD: PASS } = leerEnv(resolve(TZ, '../tz-candidata/supabase/.env'));
const srv = createClient(d.url, d.srv, { auth: { persistSession: false } });
let fallas = 0;
const ok = (c, m) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`);
  if (!c) fallas++;
};
const entrar = async (usuario, password) => (await fetch(`${d.url}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario, password }) })).status;
const correr = (script, ...args) => {
  const r = spawnSync(process.execPath, [join(TZ, 'scripts', script), ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout.split('\n').map((l) => (l ? `      ${l}` : l)).join('\n'));
  if (r.status !== 0) throw new Error(`${script} falló: ${r.stderr.slice(0, 600)}`);
  return r.stdout;
};

const ruta = `simulacro/${randomUUID()}.txt`;
const contenido = Buffer.from(`archivo de simulacro ${new Date().toISOString()}`);
let carpeta = '';
try {
  // Estado antes
  const { error: eu } = await srv.storage.from('materiales').upload(ruta, contenido, { contentType: 'text/plain' });
  ok(!eu, 'archivo de prueba subido a materiales');
  const { data: ana } = await srv.from('profiles').select('id, rol_global, nombre_visible').eq('usuario', 'ana.l').single();
  const { data: mAntes } = await srv.from('membresias').select('area_id, es_lider').eq('usuario_id', ana.id).order('area_id');
  const { data: tAntes } = await srv.from('tutores_alumnos').select('tutor_id').eq('alumno_id', ana.id);
  ok((await entrar('ana.l', PASS)) === 200, 'ana.l entra antes del simulacro');

  // Respaldo
  const salida = correr('respaldo.mjs', 'pruebas');
  carpeta = /respaldos\/(\S+)/.exec(salida)?.[0] ?? '';
  ok(!!carpeta, `respaldo creado (${carpeta})`);

  // Daño a propósito
  await srv.auth.admin.deleteUser(ana.id);
  await srv.storage.from('materiales').remove([ruta]);
  await srv.from('areas').insert({ nombre: `Basura simulacro ${ruta.slice(10, 16)}`, color: '#000000', color_claro: '#FFFFFF', icono: 'rayo', orden: 99 });
  ok((await entrar('ana.l', PASS)) !== 200, 'tras el daño, ana.l ya no existe');

  // Restauración
  correr('restaurar.mjs', 'pruebas', carpeta);

  // Comprobaciones
  ok((await entrar('ana.l', PASS)) === 200, 'ana.l vuelve a entrar con su contraseña ANTERIOR');
  const { data: ana2 } = await srv.from('profiles').select('id, rol_global, nombre_visible').eq('usuario', 'ana.l').single();
  ok(ana2?.id === ana.id && ana2.rol_global === ana.rol_global && ana2.nombre_visible === ana.nombre_visible, 'mismo id, rol y nombre');
  const { data: mDespues } = await srv.from('membresias').select('area_id, es_lider').eq('usuario_id', ana.id).order('area_id');
  ok(JSON.stringify(mDespues) === JSON.stringify(mAntes), `mismas áreas (${mDespues?.length})`);
  const { data: tDespues } = await srv.from('tutores_alumnos').select('tutor_id').eq('alumno_id', ana.id);
  ok(JSON.stringify(tDespues) === JSON.stringify(tAntes), 'mismos vínculos de tutor');
  const { data: f } = await srv.storage.from('materiales').download(ruta);
  ok(!!f && Buffer.from(await f.arrayBuffer()).equals(contenido), 'el archivo volvió idéntico');
  const { data: basura } = await srv.from('areas').select('id').like('nombre', 'Basura simulacro%');
  ok(basura?.length === 0, 'la basura metida después del respaldo ya no está');
  const coach = await fetch(`${d.url}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario: 'jaime.l', password: PASS }) });
  const tok = (await coach.json()).access_token;
  const { data: vis } = await createClient(d.url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${tok}` } } }).from('profiles').select('id');
  ok((vis?.length ?? 0) > 1, 'el coach entra y los permisos (RLS) funcionan tras restaurar');
} catch (e) {
  console.error('Error:', e instanceof Error ? e.message : e);
  fallas++;
} finally {
  await srv.storage.from('materiales').remove([ruta]);
  console.log(fallas ? `\n${fallas} fallas` : '\nSimulacro OK');
  process.exit(fallas ? 1 : 0);
}
