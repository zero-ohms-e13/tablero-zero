// Datos de ejemplo INVENTADOS para probar Tablero Zero.
// Uso: npm run seed   (lee supabase/.env; necesita la service role key)
// Vuelve a correrlo cuando quieras: borra las cuentas demo y las crea de nuevo.
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: 'supabase/.env' });
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEED_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SEED_PASSWORD || SEED_PASSWORD.length < 8) {
  console.error('Falta llenar supabase/.env (URL, SERVICE_ROLE_KEY y SEED_PASSWORD de 8+ caracteres).');
  process.exit(1);
}
const srv = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const correo = (u: string) => `${u}@zeroohms.local`;

type Cuenta = {
  usuario: string; nombre: string; rol: 'coach' | 'coach_aux' | 'alumno' | 'tutor'; color: string;
  areas?: [string, boolean][]; primerIngreso?: boolean;
};

// Nombres inventados (salvo el coach, a petición suya).
export const CUENTAS: Cuenta[] = [
  { usuario: 'jaime.l', nombre: 'Coach Jaime Lugo', rol: 'coach', color: '#590202' },
  { usuario: 'laura.o', nombre: 'Laura Ortiz', rol: 'coach_aux', color: '#5A4335' },
  { usuario: 'ana.l', nombre: 'Ana López', rol: 'alumno', color: '#2F5D8A', areas: [['Programación', false], ['Rama femenil', false]] },
  { usuario: 'marco.r', nombre: 'Marco Ruiz', rol: 'alumno', color: '#2F5D8A', areas: [['Programación', true]] },
  { usuario: 'diego.p', nombre: 'Diego Pérez', rol: 'alumno', color: '#7A3E06', areas: [['Programación', false], ['Mecánica', false]] },
  { usuario: 'luis.m', nombre: 'Luis Medina', rol: 'alumno', color: '#7A3E06', areas: [['Mecánica', true]] },
  { usuario: 'karla.t', nombre: 'Karla Torres', rol: 'alumno', color: '#8A3B6B', areas: [['Mecánica', true], ['Rama femenil', false]] },
  { usuario: 'sofia.r', nombre: 'Sofía Ramos', rol: 'alumno', color: '#2E5A36', areas: [['Logística', true]] },
  { usuario: 'tutor.ana.l', nombre: 'Familia de Ana', rol: 'tutor', color: '#5A4335', primerIngreso: true },
  { usuario: 'tutor.luis.m', nombre: 'Familia de Luis', rol: 'tutor', color: '#5A4335' },
];
const TUTORES: [string, string][] = [['tutor.ana.l', 'ana.l'], ['tutor.luis.m', 'luis.m']];

const ini = (n: string) => n.replace(/^Coach\s+/, '').split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// Fechas relativas a esta semana (lunes a domingo, hora de Mérida UTC-6)
function dia(offsetDesdeHoy: number, hora = 18) {
  const d = new Date();
  d.setUTCHours(hora + 6, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDesdeHoy);
  return d.toISOString();
}

async function main() {
  // Protección: el seed BORRA todas las tareas y metas. Solo para pruebas, nunca con el equipo real.
  if (!process.argv.includes('--solo-pruebas')) {
    console.error('El seed borra TODAS las tareas y metas. Úsalo solo en una base de pruebas: npm run seed -- --solo-pruebas');
    process.exit(1);
  }
  const { data: existentes } = await srv.from('profiles').select('usuario');
  const demo = new Set(CUENTAS.map((c) => c.usuario));
  const reales = (existentes ?? []).filter((p) => !demo.has(p.usuario));
  if (reales.length) {
    console.error(`No corro el seed: hay ${reales.length} cuentas que no son de prueba (por ejemplo ${reales[0].usuario}). Borraría sus tareas.`);
    process.exit(1);
  }

  console.log('Borrando cuentas demo anteriores…');
  const { data: lista } = await srv.auth.admin.listUsers({ perPage: 1000 });
  const demo = new Set(CUENTAS.map((c) => correo(c.usuario)));
  for (const u of lista?.users ?? []) if (u.email && demo.has(u.email)) await srv.auth.admin.deleteUser(u.id);
  await srv.from('tareas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await srv.from('metas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await srv.from('competencias').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const { data: areas } = await srv.from('areas').select('id, nombre');
  const area = (n: string) => areas!.find((a) => a.nombre === n)!.id;

  console.log('Creando cuentas…');
  const id: Record<string, string> = {};
  for (const c of CUENTAS) {
    const { data, error } = await srv.auth.admin.createUser({ email: correo(c.usuario), password: SEED_PASSWORD, email_confirm: true });
    if (error) throw error;
    id[c.usuario] = data.user!.id;
    const { error: e2 } = await srv.from('profiles').insert({
      id: data.user!.id, usuario: c.usuario, nombre_visible: c.nombre, iniciales: ini(c.nombre), color: c.color,
      rol_global: c.rol, debe_cambiar_password: !!c.primerIngreso,
      password_temporal_vence: c.primerIngreso ? new Date(Date.now() + 7 * 864e5).toISOString() : null,
    });
    if (e2) throw e2;
    for (const [a, lider] of c.areas ?? []) {
      await srv.from('membresias').insert({ usuario_id: data.user!.id, area_id: area(a), es_lider: lider });
    }
  }
  for (const [t, a] of TUTORES) await srv.from('tutores_alumnos').insert({ tutor_id: id[t], alumno_id: id[a] });

  console.log('Competencia y metas…');
  const { data: comp } = await srv.from('competencias').insert({
    nombre: 'Girl Powered', fecha_inicio: '2026-11-30', fecha_fin: '2026-12-01', equipo: 'Rama femenil',
  }).select().single();
  const { data: metas } = await srv.from('metas').insert([
    { titulo: 'Autonomous de 15 s probado en la cancha', robot: 'FTC', competencia_id: comp!.id, fecha: '2026-11-27', areas: [area('Programación')] },
    { titulo: 'Robot de la rama femenil listo para pits', robot: 'VEX', competencia_id: comp!.id, fecha: '2026-11-28', areas: [area('Rama femenil'), area('Mecánica')] },
  ]).select();
  const [mAuto, mPits] = metas!;

  console.log('Tareas…');
  type T = {
    titulo: string; para: string; area: string; meta: string; robot: string; estado: string; fecha: string;
    resp: string[]; por: string; pasos: [string, boolean][]; ayuda?: string; herramienta?: string;
  };
  const tareas: T[] = [
    { titulo: 'Calibrar la odometría del chasis', para: 'Sin esto el autonomous no sabe dónde está y se pasa de la línea.', area: 'Programación', meta: mAuto.id, robot: 'FTC', estado: 'en_proceso', fecha: dia(0), resp: ['ana.l', 'diego.p'], por: 'marco.r', herramienta: 'https://github.com/', pasos: [['Medir el diámetro de las ruedas de odometría', true], ['Ajustar ticks por pulgada en el código', true], ['Probar 3 recorridos de 1 m y anotar el error', false]] },
    { titulo: 'Rutina autonomous de 15 s', para: 'Sumar puntos sin control en los primeros 15 segundos.', area: 'Programación', meta: mAuto.id, robot: 'FTC', estado: 'en_proceso', fecha: dia(2), resp: ['diego.p'], por: 'marco.r', ayuda: 'No sé cómo leer la odometría en el código', pasos: [['Escribir la ruta en papel', true], ['Programar la ruta', false], ['Probar en la cancha', false]] },
    { titulo: 'Clase Garra con límites', para: 'Que la garra no se abra de más y rompa el servo.', area: 'Programación', meta: mAuto.id, robot: 'FTC', estado: 'en_revision', fecha: dia(1), resp: ['ana.l'], por: 'marco.r', pasos: [['Leer el límite del servo', true], ['Probar abrir y cerrar 10 veces', true]] },
    { titulo: 'Probar sensor de color', para: 'Detectar la muestra correcta en el autonomous.', area: 'Programación', meta: mAuto.id, robot: 'FTC', estado: 'hecha', fecha: dia(-1), resp: ['ana.l'], por: 'marco.r', pasos: [['Conectar el sensor', true], ['Anotar lecturas', true]] },
    { titulo: 'Montar la batería y cableado', para: 'Sin cableado limpio el robot se apaga en la cancha.', area: 'Mecánica', meta: mPits.id, robot: 'VEX', estado: 'en_proceso', fecha: dia(-2), resp: ['diego.p'], por: 'luis.m', ayuda: 'El motor no responde', pasos: [['Fijar la batería', true], ['Pasar cables por la canaleta', false]] },
    { titulo: 'Ensamblar la torre del DR4B', para: 'El elevador necesita la torre firme para subir sin forzar.', area: 'Mecánica', meta: mPits.id, robot: 'VEX', estado: 'en_revision', fecha: dia(0), resp: ['luis.m'], por: 'karla.t', pasos: [['Cortar los canales', true], ['Atornillar la torre', true]] },
    { titulo: 'Diseñar la garra neumática', para: 'Tomar dos piezas a la vez y ahorrar viajes.', area: 'Mecánica', meta: mPits.id, robot: 'VEX', estado: 'por_hacer', fecha: dia(3), resp: ['luis.m'], por: 'karla.t', pasos: [['Bocetar en papel', false], ['Armar prototipo', false]] },
    { titulo: 'Base del chasis de práctica', para: 'El robot de la rama femenil necesita base para todo lo demás.', area: 'Rama femenil', meta: mPits.id, robot: 'VEX', estado: 'hecha', fecha: dia(-3), resp: ['karla.t', 'ana.l'], por: 'jaime.l', pasos: [['Armar la base', true]] },
    { titulo: 'Checklist de pits', para: 'Llegar a Girl Powered sin olvidar herramientas ni refacciones.', area: 'Rama femenil', meta: mPits.id, robot: 'VEX', estado: 'por_hacer', fecha: dia(4), resp: ['karla.t'], por: 'jaime.l', pasos: [['Listar herramientas', false], ['Listar refacciones', false]] },
    { titulo: 'Post: presentación del robot', para: 'Que la comunidad conozca al equipo antes del evento.', area: 'Logística', meta: mPits.id, robot: 'Ambos', estado: 'en_revision', fecha: dia(1), resp: ['sofia.r'], por: 'sofia.r', herramienta: 'https://www.canva.com/', pasos: [['Tomar fotos del robot', true], ['Diseñar el post', true]] },
  ];
  for (const t of tareas) {
    const { data: nueva, error } = await srv.from('tareas').insert({
      titulo: t.titulo, para_que_sirve: t.para, area_id: area(t.area), meta_id: t.meta, robot: t.robot,
      estado: 'por_hacer', fecha_limite: t.fecha, creada_por: id[t.por], herramienta_url: t.herramienta ?? null,
    }).select().single();
    if (error) throw error;
    await srv.from('tarea_responsables').insert(t.resp.map((u) => ({ tarea_id: nueva.id, usuario_id: id[u] })));
    await srv.from('tarea_pasos').insert(t.pasos.map(([texto, hecho], i) => ({ tarea_id: nueva.id, orden: i + 1, texto, hecho })));
    await srv.from('tareas').update({
      estado: t.estado, pide_ayuda: !!t.ayuda, mensaje_ayuda: t.ayuda ?? null,
      aprobada_por: t.estado === 'hecha' ? id[t.por] : null, aprobada_at: t.estado === 'hecha' ? new Date().toISOString() : null,
    }).eq('id', nueva.id);
  }
  await srv.from('avisos').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  console.log('\nListo. Cuentas demo (todas con la contraseña SEED_PASSWORD de supabase/.env):');
  for (const c of CUENTAS) console.log(`  ${c.usuario.padEnd(14)} ${c.rol.padEnd(10)} ${c.nombre}${c.primerIngreso ? '  (primer ingreso)' : ''}`);
}

main().catch((e) => {
  console.error('El seed falló:', e.message ?? e);
  process.exit(1);
});
