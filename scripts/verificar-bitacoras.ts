// Bitácoras · prueba de integración con Auth y PostgREST REALES en un proyecto Supabase DE PRUEBAS
// (seed de demo y migración 20261128000012 aplicada). Incluye concurrencia real (llamadas en paralelo).
// Uso: VERIFICAR_DESTINO=pruebas ENV_PRUEBAS=<.env del proyecto de pruebas> npx tsx scripts/verificar-bitacoras.ts
// No imprime llaves ni contraseñas. Borra lo que crea y restaura el arranque y los plazos.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: process.env.ENV_PRUEBAS ?? 'supabase/.env' });
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SEED_PASSWORD: PASS, SUPABASE_SERVICE_ROLE_KEY: SRV } = process.env as Record<string, string>;
const PRODUCCION = 'hyghwlmatnnvnkvmhxrt';
if (process.env.VERIFICAR_DESTINO !== 'pruebas' || !URL_ || URL_.includes(PRODUCCION)) {
  console.error('Detenido: este script solo corre contra un proyecto de PRUEBAS (VERIFICAR_DESTINO=pruebas y una URL que no sea producción).');
  process.exit(2);
}
const srv = createClient(URL_, SRV, { auth: { persistSession: false } });
let fallas = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`);
  if (!c) fallas++;
};
async function como(usuario: string): Promise<SupabaseClient> {
  const r = await fetch(`${URL_}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario, password: PASS }) });
  const d = (await r.json()) as { access_token?: string };
  if (r.status !== 200 || !d.access_token) throw new Error(`${usuario} no pudo entrar (${r.status})`);
  return createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${d.access_token}` } } });
}
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
const datos = (o: Record<string, unknown> = {}) => ({ aporte: 'Calibré el sensor', aprendizaje: 'El PID oscila', siguiente: 'Probar en la cancha', necesita_ayuda: false, texto_libre: '', evidencias: [], ...o });
const dia = (base: string, n: number) => new Date(Date.parse(`${base}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const inicioPrueba = new Date().toISOString();
let inicioOriginal: string | null = null;
const semanasTocadas = new Set<string>();
const ids = new Set<string>();

async function guardar(c: SupabaseClient, id: string, fecha: string, version: number, o: Record<string, unknown> = {}) {
  ids.add(id);
  return c.rpc('guardar_bitacora', { p_id: id, p_fecha: fecha, p_version: version, p_datos: datos(o) });
}

async function main() {
  const [ana, marco, sofia, coach, mentor, tutor] = await Promise.all(['ana.l', 'marco.r', 'sofia.r', 'jaime.l', 'laura.o', 'tutor.luis.m'].map(como));
  const { data: cfg } = await srv.from('bitacora_config').select('inicio').single();
  inicioOriginal = cfg?.inicio ?? null;
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const d = new Date(`${hoy}T00:00:00Z`);
  const lunes = dia(hoy, -((d.getUTCDay() + 6) % 7));
  const lunesPasada = dia(lunes, -7);
  const hace2 = dia(lunes, -14);
  semanasTocadas.add(lunes).add(lunesPasada).add(hace2);

  // Arranque hace 3 semanas (solo el coach principal)
  ok(!!(await mentor.rpc('fijar_inicio_bitacoras', { p_semana: dia(lunes, -21) })).error, 'el mentor no cambia el arranque');
  ok(!(await coach.rpc('fijar_inicio_bitacoras', { p_semana: dia(lunes, -21) })).error, 'el coach fija el arranque hace 3 semanas');

  // 1. Varias por semana, borrador privado, entrega
  const a1 = randomUUID();
  const a2 = randomUUID();
  const g1 = await guardar(ana, a1, lunes, 0, { aporte: 'Lunes de taller' });
  const g2 = await guardar(ana, a2, hoy, 0, { aporte: 'Otro día de taller', necesita_ayuda: true });
  ok(!g1.error && !g2.error, 'Ana guarda dos bitácoras en la misma semana');
  const coachVeBorrador = await coach.from('bitacoras').select('id').in('id', [a1, a2]);
  ok((coachVeBorrador.data ?? []).length === 0, 'el coach no ve los borradores');
  const e1 = await ana.rpc('entregar_bitacora', { p_id: a1, p_version: g1.data.version });
  const e2 = await ana.rpc('entregar_bitacora', { p_id: a2, p_version: g2.data.version });
  ok(!e1.error && !e2.error, 'Ana entrega las dos');
  ok(((await coach.from('bitacoras').select('id').in('id', [a1, a2])).data ?? []).length === 2, 'el coach ve las dos entregadas');
  for (const [c, n] of [[mentor, 'el mentor'], [marco, 'un compañero'], [tutor, 'el tutor']] as const) {
    ok(((await c.from('bitacoras').select('id').in('id', [a1, a2])).data ?? []).length === 0, `${n} no ve las bitácoras de Ana`);
  }
  ok(!!(await anon.from('bitacoras').select('id').limit(1)).error, 'anónimo no lee bitácoras');

  // 2. Atrasada de hace dos semanas: se entrega y queda como tarde
  const at = randomUUID();
  const ga = await guardar(sofia, at, dia(hace2, 3), 0, { aporte: 'Atrasada' });
  await sofia.rpc('entregar_bitacora', { p_id: at, p_version: ga.data?.version });
  const { data: atr } = await srv.from('bitacoras').select('semana, estado, primera_entrega_at').eq('id', at).single();
  const { data: venceAt } = await srv.rpc('vence_bitacora', { p_semana: hace2 });
  ok(atr?.semana === hace2 && atr?.estado === 'entregada' && new Date(atr.primera_entrega_at) > new Date(venceAt), 'Sofía entrega una atrasada de hace 2 semanas y queda tarde');
  ok(!!(await guardar(sofia, randomUUID(), dia(lunes, -28), 0)).error, 'antes del arranque no se puede escribir');
  ok(!!(await guardar(sofia, randomUUID(), dia(hoy, 1), 0)).error, 'no se aceptan fechas futuras');

  // 3. Seguimiento del coach
  const { data: res } = await coach.rpc('resumen_bitacoras', { p_semana: lunes });
  const filaAna = (res ?? []).find((x: { nombre_visible: string }) => x.nombre_visible === 'Ana López');
  ok(filaAna?.entregadas === 2 && filaAna?.por_revisar === 2 && filaAna?.necesita_ayuda === true, 'seguimiento: Ana con 2 entregadas, 2 por revisar y pide ayuda');
  ok(!!(await mentor.rpc('resumen_bitacoras', { p_semana: lunes })).error, 'el mentor no ve el seguimiento');

  // 4. Devolver, aviso, reentregar; revisar
  ok(!(await coach.rpc('devolver_bitacora', { p_id: a1, p_nota: 'Cuenta qué probaste.' })).error, 'el coach devuelve una con nota');
  const { data: avisos } = await ana.from('avisos').select('titulo').eq('tipo', 'bitacora').gte('creado_at', inicioPrueba);
  ok((avisos ?? []).some((x) => x.titulo === 'Tu bitácora volvió para corregir'), 'Ana recibe el aviso de devolución');
  const { data: dv } = await ana.from('bitacoras').select('version').eq('id', a1).single();
  const gc = await guardar(ana, a1, lunes, dv!.version, { aporte: 'Corregida' });
  ok(!(await ana.rpc('entregar_bitacora', { p_id: a1, p_version: gc.data?.version })).error, 'Ana corrige y reentrega');
  ok(!(await coach.rpc('revisar_bitacora', { p_id: a2, p_retro: '¡Bien!' })).error && !!(await mentor.rpc('revisar_bitacora', { p_id: a1, p_retro: 'x' })).error, 'el coach revisa; el mentor no');

  // 5. Concurrencia: mismo id, contenido idéntico en paralelo → misma fila y versión
  const mismo = randomUUID();
  const [p1, p2] = await Promise.all([guardar(marco, mismo, hoy, 0, { aporte: 'doble toque' }), guardar(marco, mismo, hoy, 0, { aporte: 'doble toque' })]);
  ok(!p1.error && !p2.error && p1.data?.id === p2.data?.id && p1.data?.version === p2.data?.version, 'mismo id e idéntico en paralelo: misma fila y versión, sin error');
  // mismo id, contenido distinto en paralelo → una pasa y la otra 409, sin sobrescribir
  const dist = randomUUID();
  const [q1, q2] = await Promise.all([guardar(marco, dist, hoy, 0, { aporte: 'versión A' }), guardar(marco, dist, hoy, 0, { aporte: 'versión B' })]);
  const unaFalla = [q1, q2].filter((x) => x.error).length === 1;
  const ganadora = !q1.error ? 'versión A' : 'versión B';
  const { data: fd } = await srv.from('bitacoras').select('aporte, version').eq('id', dist).single();
  ok(unaFalla && fd?.aporte === ganadora && fd?.version === 1, 'mismo id y distinto en paralelo: una gana y la otra recibe 409 sin sobrescribir');
  // dos ids distintos con 9 en la semana → exactamente 10
  const { count: yaMarco } = await srv.from('bitacoras').select('id', { count: 'exact', head: true }).eq('alumno_id', (await marco.auth.getUser()).data.user?.id ?? '').eq('semana', lunes);
  for (let i = yaMarco ?? 0; i < 9; i++) await guardar(marco, randomUUID(), hoy, 0, { aporte: `relleno ${i}` });
  const [r1, r2] = await Promise.all([guardar(marco, randomUUID(), hoy, 0, { aporte: 'carrera 1' }), guardar(marco, randomUUID(), hoy, 0, { aporte: 'carrera 2' })]);
  const { count: total } = await srv.from('bitacoras').select('id', { count: 'exact', head: true }).eq('alumno_id', (await marco.auth.getUser()).data.user?.id ?? '').eq('semana', lunes);
  ok(total === 10 && [r1, r2].filter((x) => x.error).length === 1, `nueve + dos altas en paralelo dejan exactamente 10 (hay ${total})`);

  // 6. Plazo editable y vuelta al de omisión
  ok(!(await coach.rpc('fijar_plazo_bitacora', { p_semana: lunesPasada, p_vence: new Date(Date.now() + 2 * 86400_000).toISOString() })).error, 'el coach extiende el plazo de la semana pasada');
  ok(!(await coach.rpc('fijar_plazo_bitacora', { p_semana: lunesPasada, p_vence: null })).error, 'y lo regresa al domingo 8 p. m.');
  ok(!!(await marco.rpc('fijar_plazo_bitacora', { p_semana: lunesPasada, p_vence: null })).error, 'un alumno no cambia plazos');
}

async function limpiar() {
  if (ids.size) await srv.from('bitacoras').delete().in('id', [...ids]);
  // Relleno creado por la prueba de concurrencia (ids generados dentro de Promise.all ya se registraron en ids)
  await srv.from('bitacora_plazos').delete().in('semana', [...semanasTocadas]);
  if (inicioOriginal) await srv.from('bitacora_config').update({ inicio: inicioOriginal }).eq('unica', true);
  await srv.from('avisos').delete().eq('tipo', 'bitacora').gte('creado_at', inicioPrueba);
  const { count } = await srv.from('bitacoras').select('id', { count: 'exact', head: true }).in('id', [...ids].length ? [...ids] : [randomUUID()]);
  console.log(`Limpieza: ${ids.size} bitácoras de prueba borradas; quedan ${count ?? '?'}.`);
}

main()
  .catch((e) => {
    fallas++;
    console.error('ERROR', (e as Error).message);
  })
  .finally(async () => {
    await limpiar();
    console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo en verde');
    process.exit(fallas ? 1 : 0);
  });
