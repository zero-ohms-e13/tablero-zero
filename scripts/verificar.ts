// Prueba de humo contra el proyecto real: login sin correo, permisos por rol y bloqueo.
// Uso: npx tsx scripts/verificar.ts   (lee supabase/.env; no imprime llaves ni contraseñas)
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: 'supabase/.env' });
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SEED_PASSWORD: PASS, SUPABASE_SERVICE_ROLE_KEY: SRV } = process.env as Record<string, string>;
const INICIO = new Date().toISOString();
let fallas = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`);
  if (!c) fallas++;
};

async function entrar(usuario: string, password: string) {
  const r = await fetch(`${URL_}/functions/v1/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ usuario, password }),
  });
  return { status: r.status, data: await r.json() };
}

async function como(usuario: string) {
  const r = await entrar(usuario, PASS);
  if (r.status !== 200) throw new Error(`${usuario} no pudo entrar: ${r.status} ${JSON.stringify(r.data)}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  await c.auth.setSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token });
  return c;
}

async function main() {
  // Login
  ok((await entrar('ana.l', 'mala-123')).status === 401, 'contraseña incorrecta da 401');
  const bloq = [];
  for (let i = 0; i < 5; i++) bloq.push((await entrar('nadie.x', 'mala-123')).status);
  ok(bloq[4] === 423 && (await entrar('nadie.x', 'mala-123')).status === 423, `bloqueo tras 5 intentos (${bloq.join(',')})`);

  // Integrante
  const ana = await como('ana.l');
  const { data: tAna } = await ana.from('tareas').select('titulo, area_id, areas(nombre)');
  const areasAna = new Set((tAna ?? []).map((t: any) => t.areas.nombre));
  ok(tAna!.length > 0 && [...areasAna].every((a) => a === 'Programación' || a === 'Rama femenil'), `ana ve ${tAna!.length} tareas solo de Programación/Rama femenil`);
  const { data: pSof } = await ana.from('profiles').select('id').eq('usuario', 'sofia.r');
  ok(pSof!.length === 0, 'ana no ve a sofía (otra área)');
  const garra = (tAna ?? []).find((t: any) => t.titulo.startsWith('Clase Garra'));
  ok(!!garra, 'ana ve su tarea en revisión');
  const { error: eAuto } = await ana.from('tareas').update({ estado: 'hecha' }).eq('titulo', 'Clase Garra con límites');
  ok(!!eAuto, 'ana no puede aprobarse sola');

  // Líder
  const marco = await como('marco.r');
  const { data: areas } = await marco.from('areas').select('id, nombre');
  const meca = areas!.find((a) => a.nombre === 'Mecánica')!.id;
  const { error: eOtra } = await marco.from('tareas').insert({ titulo: 'Intruso', area_id: meca, robot: 'VEX' });
  ok(!!eOtra, 'marco no crea tareas en Mecánica');
  const { data: garraM } = await marco.from('tareas').select('id').eq('titulo', 'Clase Garra con límites').single();
  const { error: eAp } = await marco.rpc('aprobar_tarea', { p_tarea: garraM!.id });
  ok(!eAp, 'marco aprueba la tarea de ana');
  const { data: av } = await ana.from('avisos').select('tipo').eq('tipo', 'aprobada');
  ok(av!.length >= 1, 'ana recibe aviso de aprobada');
  await marco.from('tareas').update({ estado: 'en_revision' }).eq('id', garraM!.id); // deja el seed como estaba

  // Tutor (primer ingreso pendiente, pero ya puede leer con su sesión)
  const tutor = await como('tutor.ana.l');
  const { data: tTut } = await tutor.from('tareas').select('id, tarea_responsables(usuario_id)');
  const { data: pTut } = await tutor.from('profiles').select('usuario').eq('rol_global', 'alumno');
  ok(pTut!.map((p) => p.usuario).join() === 'ana.l', `tutor solo ve el perfil de ana (${pTut!.map((p) => p.usuario)})`);
  ok(tTut!.length > 0 && tTut!.every((t: any) => t.tarea_responsables.length === 1), `tutor ve ${tTut!.length} tareas y solo a ana como responsable`);
  const { data: aa } = await tutor.rpc('avance_areas');
  ok(aa!.length === 4, 'tutor ve avance de las 4 áreas');

  // Coach
  const coach = await como('jaime.l');
  const { count } = await coach.from('tareas').select('id', { count: 'exact', head: true });
  ok((count ?? 0) >= 10, `coach ve todas las tareas (${count})`);
  const { data: s } = await coach.auth.getSession();
  const r = await fetch(`${URL_}/functions/v1/admin-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${s.session!.access_token}` },
    body: JSON.stringify({ accion: 'bloqueos' }),
  });
  const b = await r.json();
  ok(r.status === 200 && b.bloqueos.some((x: any) => x.usuario === 'nadie.x'), 'coach ve bloqueos vía admin-accounts');
  const { data: s2 } = await ana.auth.getSession();
  const r2 = await fetch(`${URL_}/functions/v1/admin-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${s2.session!.access_token}` },
    body: JSON.stringify({ accion: 'bloqueos' }),
  });
  ok(r2.status === 403, 'una alumna no puede usar admin-accounts');

  // Limpieza: quita los avisos e intentos que generó esta prueba para no ensuciar los datos reales
  const srv = createClient(URL_, SRV, { auth: { persistSession: false } });
  await srv.from('avisos').delete().gte('creado_at', INICIO).in('tipo', ['aprobada', 'bateria']);
  await srv.from('intentos_login').delete().in('usuario', ['nadie.x', 'ana.l']);
  console.log(fallas ? `\n${fallas} fallas` : '\nTodo bien (avisos de prueba limpiados).');
  process.exit(fallas ? 1 : 0);
}
main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
