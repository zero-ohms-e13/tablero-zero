// Importar datos · ensayo de integración con Auth, Edge Functions y PostgREST REALES en un proyecto Supabase
// DE PRUEBAS (seed de demo, migración 20261130000014 aplicada). Usa el revisor y el ejecutor de la app tal cual.
// Uso: VERIFICAR_DESTINO=pruebas ENV_PRUEBAS=<.env del proyecto de pruebas> npx tsx scripts/verificar-importar.ts
// Datos ficticios con un sufijo aleatorio. No imprime llaves ni contraseñas. Borra lo que crea.
//
// Casos (los acordados en la revisión del PR #4):
//  1. .xlsx real (escrito y leído con las mismas librerías) con "00:00" escrito como texto y una fecha sin hora.
//  2. El registro del lote falla al final: la carga y las fichas siguen; el detalle por fila ya quedó guardado.
//  3. Asignación pendiente en cuentas existentes y cambio de líder.
//  4. Usuario ocupado por otra persona entre la revisión y el alta + respuesta perdida + "cerrar la app":
//     el plan se reconstruye desde cero y la cuenta se reconoce por su solicitud (altas_previas).
//  5. Dos pestañas confirman el mismo lote a la vez: sin duplicados; al repetir, todo queda confirmado.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { conteo, filasDe, idEstable, pestanaDe, revisar, type AltaPrevia, type Existentes, type Hoja, type OpcionesRevision } from '../src/lib/importar';
import { ejecutar, type CuentaCreada, type Deps } from '../src/lib/importar-ejecutar';
import type { Ficha } from '../src/lib/datos';

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
const R = randomUUID().replace(/[^a-f]/g, '').slice(0, 4).padEnd(4, 'x'); // sufijo de solo letras
const U = (x: string) => `imp${R}.${x}`;
const lotes = new Set<string>();
const inicio = new Date().toISOString();
let token = '';
let cli: SupabaseClient;

async function entrar(usuario: string, password: string) {
  const r = await fetch(`${URL_}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario, password }) });
  return { status: r.status, data: (await r.json()) as Record<string, string> };
}
async function admin(body: Record<string, unknown>) {
  const r = await fetch(`${URL_}/functions/v1/admin-accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const data = (await r.json()) as { fichas?: Ficha[]; ya_creadas?: CuentaCreada[]; error?: string };
  if (!r.ok) throw new Error(`${r.status} ${data.error ?? ''}`);
  return { fichas: data.fichas ?? [], ya_creadas: data.ya_creadas };
}

// Mismas lecturas que la pantalla Importar
async function existentes(): Promise<Existentes> {
  const [a, p, m, t, ta] = await Promise.all([
    cli.from('areas').select('id, nombre'),
    cli.from('profiles').select('id, usuario, nombre_visible, rol_global, activo'),
    cli.from('membresias').select('usuario_id, area_id, es_lider'),
    cli.from('tutores_alumnos').select('tutor_id, alumno_id'),
    cli.from('tareas').select('id, titulo, area_id, fecha_limite, robot'),
  ]);
  const e = a.error ?? p.error ?? m.error ?? t.error ?? ta.error;
  if (e) throw new Error(e.message);
  return { areas: a.data!, perfiles: p.data!, membresias: m.data!, tutorias: t.data!, tareas: ta.data! };
}
const OPC: OpcionesRevision = {
  coachPrincipal: true,
  altasPrevias: async (solicitudes) => {
    const { data, error } = await cli.rpc('altas_previas', { p_solicitudes: solicitudes });
    if (error) throw new Error(error.message);
    return Object.fromEntries((data as { solicitud_id: string; resultado: AltaPrevia[] | null }[]).map((x) => [x.solicitud_id, x.resultado ?? []]));
  },
};

/** Las mismas dependencias que la pantalla, con fallas inyectables. */
function deps(lote: string, f: { perder?: string; romperRegistro?: string } = {}): Deps {
  lotes.add(lote);
  return {
    crearArea: async (a) => {
      const { data, error: e } = await cli.from('areas').insert(a).select('id').single();
      if (e?.code === '23505') {
        const { data: ya } = await cli.from('areas').select('id').eq('nombre', a.nombre).maybeSingle();
        if (ya?.id) return ya.id as string;
      }
      if (e || !data?.id) throw new Error(e?.message ?? 'No se pudo crear el área.');
      return data.id as string;
    },
    crearCuenta: async (cuerpo) => {
      const r = await admin(cuerpo);
      if (f.perder && cuerpo.usuario === f.perder) {
        f.perder = undefined;
        throw new Error('Failed to fetch (respuesta perdida, simulada)'); // el servidor sí la creó
      }
      return r;
    },
    asignar: async (usuario_id, area_id, es_lider) => {
      const { error: e } = await cli.from('membresias').upsert({ usuario_id, area_id, es_lider });
      if (e) throw new Error(e.message);
    },
    vincularTutor: async (tutor_id, alumno_id) => {
      const { error: e } = await cli.from('tutores_alumnos').upsert({ tutor_id, alumno_id });
      if (e) throw new Error(e.message);
    },
    guardarTarea: async (p) => {
      const { error: e } = await cli.rpc('guardar_tarea', { p });
      if (e) throw new Error(e.message);
    },
    existentes,
    registrar: async (etapa, resumen) => {
      if (f.romperRegistro === etapa) throw new Error('Failed to fetch (registro, simulado)');
      const { error: e } = await cli.rpc('registrar_importacion', { p_id: lote, p_archivo: `ensayo-${R}.xlsx`, p_etapa: etapa, p_resumen: resumen });
      if (e) throw new Error(e.message);
    },
  };
}
const nada = (h: Hoja) => async () => {
  const c = conteo(await revisar(h, await existentes(), OPC));
  return Object.values(c).every((x) => x.nueva === 0 && x.cambio === 0 && x.error === 0);
};
const id = async (usuario: string) => (await srv.from('profiles').select('id').eq('usuario', usuario).maybeSingle()).data?.id as string | undefined;

async function main() {
  const c = await entrar('jaime.l', PASS);
  if (c.status !== 200) throw new Error(`el coach demo no pudo entrar: ${c.status}`);
  token = c.data.access_token;
  cli = createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const AREA = `Imp ${R}`;

  // ---------- 1 y 2. Hoja .xlsx real; el registro final falla ----------
  const dir = mkdtempSync(join(tmpdir(), 'tz-imp-'));
  const T = (rows: string[][]) => rows.map((r) => r.map((value) => ({ value })));
  const archivo = join(dir, 'equipo.xlsx');
  await writeXlsxFile([
    { sheet: 'Áreas', data: T([['clave_area', 'nombre'], ['MAT', AREA]]) },
    { sheet: 'Cuentas', data: T([['clave_persona', 'nombre_visible', 'usuario_deseado', 'rol'],
      ['ALU-1', `Ana Imp ${R}`, U('ana'), 'alumno'], ['ALU-2', `Beto Imp ${R}`, U('beto'), 'alumno'], ['TUT-1', `Familia Imp ${R}`, U('fam'), 'tutor']]) },
    { sheet: 'Asignaciones', data: T([['clave_persona', 'clave_area', 'rol_en_area'], ['ALU-1', 'MAT', 'lider'], ['ALU-2', 'MAT', '']]) },
    { sheet: 'Tutorías', data: T([['clave_tutor', 'clave_alumno'], ['TUT-1', 'ALU-1'], ['TUT-1', 'ALU-2']]) },
    { sheet: 'Tareas', data: T([['clave_tarea', 'titulo', 'clave_area', 'responsables', 'fecha_limite', 'robot', 'descripcion_opcional', 'pasos'],
      ['T-1', `Chasis ${R}`, 'MAT', 'ALU-1, ALU-2', '2026-12-05 00:00', 'VEX', 'Base', 'Cortar; Atornillar'],
      ['T-2', `Rutina ${R}`, 'MAT', 'ALU-2', '2026-12-07', '', '', '']]) },
  ]).toFile(archivo);
  const hoja1: Hoja = { areas: [], cuentas: [], asignaciones: [], tutorias: [], tareas: [] };
  for (const s of await readXlsxFile(archivo)) {
    const k = pestanaDe(s.sheet);
    if (k) hoja1[k] = filasDe(s.data as unknown[][]);
  }
  rmSync(dir, { recursive: true, force: true });
  ok(hoja1.tareas[0]?.fecha_limite === '2026-12-05 00:00', 'el .xlsx conserva "00:00" escrito como texto');

  const plan1 = await revisar(hoja1, await existentes(), OPC);
  ok(!plan1.bloquea, `hoja 1 lista para cargar ${plan1.bloquea ? JSON.stringify(plan1.problemas) : ''}`);
  const lote1 = await idEstable(`lote|ensayo|${R}|1`);
  const r1 = await ejecutar(plan1, deps(lote1, { romperRegistro: 'terminado' }));
  ok(r1.fallos.length === 0, `hoja 1 sin fallos ${JSON.stringify(r1.fallos)}`);
  ok(r1.registroFallo && r1.fichas.length === 3, 'el registro final falló, pero las 3 fichas se entregan');
  const ana = await id(U('ana'));
  const beto = await id(U('beto'));
  const fam = await id(`tutor.${U('fam')}`);
  ok(!!ana && !!beto && !!fam, 'las 3 cuentas existen');
  const e1 = await entrar(U('ana'), r1.fichas.find((f) => f.usuario === U('ana'))!.password);
  ok(e1.status === 200, 'Ana entra con la contraseña de su ficha');
  const { data: tareas1 } = await srv.from('tareas').select('id, titulo, fecha_limite, robot').in('titulo', [`Chasis ${R}`, `Rutina ${R}`]);
  const chasis = tareas1?.find((t) => t.titulo === `Chasis ${R}`);
  const rutina = tareas1?.find((t) => t.titulo === `Rutina ${R}`);
  ok(!!chasis && Date.parse(chasis.fecha_limite) === Date.parse('2026-12-05T06:00:00Z'), `"2026-12-05 00:00" se guardó como las 00:00 de Mérida (${chasis?.fecha_limite})`);
  ok(!!rutina && Date.parse(rutina.fecha_limite) === Date.parse('2026-12-08T05:59:00Z'), `una fecha sin hora vence a las 23:59 de Mérida (${rutina?.fecha_limite})`);
  const { data: resp } = await srv.from('tarea_responsables').select('usuario_id').eq('tarea_id', chasis?.id ?? '');
  ok(resp?.map((x) => x.usuario_id).sort().join() === [ana, beto].sort().join(), 'Chasis tiene a Ana y Beto como responsables');
  const { data: vinc } = await srv.from('tutores_alumnos').select('alumno_id').eq('tutor_id', fam ?? '');
  ok(vinc?.length === 2, 'el tutor quedó vinculado a sus 2 alumnos');
  const { data: reg1 } = await srv.from('importaciones').select('etapa, resumen').eq('id', lote1).single();
  const filas1 = (reg1?.resumen as { filas?: string[] })?.filas ?? [];
  ok(reg1?.etapa === 'en_curso' && filas1.includes(`cuenta:ALU-1:creada:${ana}`), 'aunque falló el final, el registro ya tiene la fila → id de Ana');
  ok(!JSON.stringify(reg1).match(/password|contrase|cobre|simulad/i), 'el registro no tiene contraseñas ni mensajes crudos');
  ok(await nada(hoja1)(), 'al volver a revisar la hoja 1, todo sale como ya existente');

  // ---------- 3 y 4. Asignación pendiente + cambio de líder + usuario ocupado + respuesta perdida ----------
  const hoja2: Hoja = {
    areas: [{ clave_area: 'MAT', nombre: AREA }],
    cuentas: [
      { clave_persona: 'ALU-1', nombre_visible: `Ana Imp ${R}`, usuario_deseado: U('ana'), rol: 'alumno' },
      { clave_persona: 'ALU-2', nombre_visible: `Beto Imp ${R}`, usuario_deseado: U('beto'), rol: 'alumno' },
      { clave_persona: 'ALU-3', nombre_visible: `Caro Imp ${R}`, usuario_deseado: U('caro'), rol: 'alumno' },
    ],
    asignaciones: [
      { clave_persona: 'ALU-1', clave_area: 'MAT', rol_en_area: '' }, // era líder
      { clave_persona: 'ALU-2', clave_area: 'MAT', rol_en_area: '' },
      { clave_persona: 'ALU-2', clave_area: 'Programación', rol_en_area: '' }, // pendiente en cuenta existente
      { clave_persona: 'ALU-3', clave_area: 'MAT', rol_en_area: '' },
    ],
    tutorias: [],
    tareas: [{ clave_tarea: 'T-3', titulo: `Sensor ${R}`, clave_area: 'MAT', responsables: 'ALU-3', fecha_limite: '', robot: 'FTC', descripcion_opcional: '', pasos: '' }],
  };
  const plan2 = await revisar(hoja2, await existentes(), OPC);
  const c2 = conteo(plan2);
  ok(!plan2.bloquea && c2.cuentas.nueva === 1 && c2.asignaciones.nueva === 1 && c2.asignaciones.cambio === 1, `hoja 2: 1 cuenta nueva, 1 asignación pendiente y 1 cambio de líder (${JSON.stringify(c2.asignaciones)})`);
  // Otra persona toma "caro" entre la revisión y la carga
  const otra = await admin({ accion: 'crear', solicitud_id: randomUUID(), nombre: `Otra Persona ${R}`, usuario: U('caro'), rol: 'alumno', membresias: [] });
  const ajena = otra.fichas[0]?.usuario_id;
  ok(!!ajena && otra.fichas[0].usuario === U('caro'), 'otra persona ocupa el usuario de Caro');
  const lote2 = await idEstable(`lote|ensayo|${R}|2`);
  const r2 = await ejecutar(plan2, deps(lote2, { perder: U('caro') }));
  ok(r2.fallos.some((f) => f.clave === 'ALU-3') && r2.fallos.some((f) => f.clave === 'T-3'), 'respuesta perdida: Caro y su tarea quedan pendientes, sin vincular a nadie');
  const caro = (await srv.from('profiles').select('id, usuario').like('usuario', `${U('caro')}_%`).neq('id', ajena!)).data?.[0];
  ok(!!caro && caro.usuario !== U('caro'), `el servidor sí creó a Caro con otro usuario (${caro?.usuario})`);
  // "Cerrar la app": plan nuevo desde cero
  const plan2b = await revisar(hoja2, await existentes(), OPC);
  const caroPlan = plan2b.cuentas.find((x) => x.clave === 'ALU-3');
  ok(!plan2b.bloquea && caroPlan?.estado === 'existente' && caroPlan.id === caro?.id, 'al reanudar, Caro se reconoce por su solicitud (no como la otra persona)');
  const r2b = await ejecutar(plan2b, deps(lote2));
  ok(r2b.fallos.length === 0 && r2b.fichas.length === 0, `la reanudación termina sin fallos ni cuentas nuevas ${JSON.stringify(r2b.fallos)}`);
  const { data: t3 } = await srv.from('tareas').select('id').eq('titulo', `Sensor ${R}`);
  const { data: resp3 } = await srv.from('tarea_responsables').select('usuario_id').eq('tarea_id', t3?.[0]?.id ?? '');
  ok(t3?.length === 1 && resp3?.length === 1 && resp3[0].usuario_id === caro?.id, 'la tarea de Caro existe una vez y es de la Caro correcta');
  const { data: mAjena } = await srv.from('membresias').select('area_id').eq('usuario_id', ajena!);
  ok(mAjena?.length === 0, 'la otra persona no recibió áreas');
  const { data: mAna } = await srv.from('membresias').select('es_lider, areas(nombre)').eq('usuario_id', ana!);
  const { data: mBeto } = await srv.from('membresias').select('areas(nombre)').eq('usuario_id', beto!);
  ok(mAna?.length === 1 && mAna[0].es_lider === false, 'Ana dejó de ser líder');
  ok(JSON.stringify(mBeto).includes('Programación'), 'Beto recibió la asignación pendiente (Programación)');
  const { data: reg2 } = await srv.from('importaciones').select('etapa, resumen').eq('id', lote2).single();
  const res2 = reg2?.resumen as Record<string, string[]>;
  ok(reg2?.etapa === 'terminado' && res2.recuperadas?.includes(caro!.usuario) && res2.fallos?.some((x) => x.startsWith('cuentas:ALU-3:')),
    'el registro del lote conserva el fallo del primer intento y la recuperación del segundo');
  ok(await nada(hoja2)(), 'al volver a revisar la hoja 2, no queda nada pendiente');

  // ---------- 5. Dos pestañas confirman a la vez ----------
  const AREA2 = `Imp2 ${R}`;
  const hoja3: Hoja = {
    areas: [{ clave_area: 'OTRA', nombre: AREA2 }],
    cuentas: [{ clave_persona: 'ALU-4', nombre_visible: `Dani Imp ${R}`, usuario_deseado: U('dani'), rol: 'alumno' }],
    asignaciones: [{ clave_persona: 'ALU-4', clave_area: 'OTRA', rol_en_area: 'lider' }],
    tutorias: [],
    tareas: [{ clave_tarea: 'T-4', titulo: `Pits ${R}`, clave_area: 'OTRA', responsables: 'ALU-4', fecha_limite: '2026-12-10 18:30', robot: '', descripcion_opcional: '', pasos: 'Uno; Dos' }],
  };
  const plan3 = await revisar(hoja3, await existentes(), OPC);
  const lote3 = await idEstable(`lote|ensayo|${R}|3`);
  const [ra, rb] = await Promise.all([ejecutar(plan3, deps(lote3)), ejecutar(plan3, deps(lote3))]);
  console.log(`INFO  pestañas: A ${ra.fallos.length} fallos, B ${rb.fallos.length} fallos (${[...ra.fallos, ...rb.fallos].map((f) => f.mensaje.slice(0, 50)).join(' | ')})`);
  const { data: areas3 } = await srv.from('areas').select('id').eq('nombre', AREA2);
  const { data: dani } = await srv.from('profiles').select('id').like('usuario', `${U('dani')}%`);
  const { data: t4 } = await srv.from('tareas').select('id').eq('titulo', `Pits ${R}`);
  ok(areas3?.length === 1 && dani?.length === 1 && (t4?.length ?? 0) <= 1, `sin duplicados: ${areas3?.length} área, ${dani?.length} cuenta, ${t4?.length} tarea`);
  ok(ra.fichas.length + rb.fichas.length === 1, 'solo una pestaña recibe la ficha de Dani');
  // Repetir la hoja termina lo que haya quedado pendiente
  const plan3b = await revisar(hoja3, await existentes(), OPC);
  const r3b = await ejecutar(plan3b, deps(lote3));
  ok(r3b.fallos.length === 0, `al repetir, sin fallos ${JSON.stringify(r3b.fallos)}`);
  ok(await nada(hoja3)(), 'tras repetir, la hoja 3 queda toda confirmada');
  const { data: t4b } = await srv.from('tareas').select('id').eq('titulo', `Pits ${R}`);
  const { data: md } = await srv.from('membresias').select('es_lider').eq('usuario_id', dani![0].id);
  ok(t4b?.length === 1 && md?.length === 1 && md[0].es_lider, 'Dani: una tarea y líder de su área');
  const { data: reg3 } = await srv.from('importaciones').select('etapa, resumen').eq('id', lote3).single();
  const f3 = (reg3?.resumen as { filas?: string[] })?.filas ?? [];
  ok(reg3?.etapa === 'terminado' && f3.some((x) => x.startsWith('cuenta:ALU-4:creada:')) && f3.some((x) => x.startsWith('area:OTRA:')) && f3.some((x) => x.startsWith('tarea:T-4:creada:')),
    'el registro del lote 3 conserva las filas de ambas pestañas y termina en "terminado"');
}

main()
  .catch((e) => {
    console.error('Error:', e instanceof Error ? e.message : e);
    fallas++;
  })
  .finally(async () => {
    // Limpieza de todo lo creado por este ensayo (por sufijo)
    const { data: perfiles } = await srv.from('profiles').select('id').or(`usuario.like.imp${R}.%,usuario.like.tutor.imp${R}.%`);
    const { data: tareas } = await srv.from('tareas').select('id').like('titulo', `% ${R}`);
    for (const t of tareas ?? []) await srv.from('tareas').delete().eq('id', t.id);
    for (const p of perfiles ?? []) await srv.auth.admin.deleteUser(p.id);
    await srv.from('areas').delete().in('nombre', [`Imp ${R}`, `Imp2 ${R}`]);
    await srv.from('importaciones').delete().in('id', [...lotes]);
    const { data: yo } = await srv.from('profiles').select('id').eq('usuario', 'jaime.l').single();
    await srv.from('altas_cuentas').delete().gte('creada', inicio).eq('coach_id', yo?.id ?? '');
    console.log(`\nLimpieza: ${perfiles?.length ?? 0} cuentas, ${tareas?.length ?? 0} tareas, 2 áreas y ${lotes.size} lotes de prueba borrados.`);
    console.log(fallas ? `${fallas} fallas` : 'Todo OK');
    process.exit(fallas ? 1 : 0);
  });
