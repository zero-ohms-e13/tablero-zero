// Bitácora personal semanal · privacidad, plazo, estados, conflictos y evidencias (PGlite, datos ficticios).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, T, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
let ACTUAL = ''; // lunes de la semana actual (Mérida)
let PASADA = ''; // lunes de la semana anterior

const q = async <R,>(sql: string) => (await b.db.query<R>(sql)).rows;
const uno = async <R,>(quien: string | null, sql: string) => (await b.como<{ r: R }>(quien, `select ${sql} as r`))[0].r;
type Ver = { id: string; version: number };
const datos = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ aporte: 'Calibré el sensor', aprendizaje: 'El PID oscila si Kp es alto', siguiente: 'Probar en la cancha', necesita_ayuda: false, texto_libre: '', evidencias: [], ...o }).replace(/'/g, "''");
const guardar = (quien: string, semana: string, version: number, o: Record<string, unknown> = {}) =>
  uno<Ver>(quien, `public.guardar_bitacora('${semana}', ${version}, '${datos(o)}'::jsonb)`);
const falla = (quien: string | null, sql: string) => b.falla(quien, `select ${sql}`);

beforeAll(async () => {
  b = await crearBase();
  const [s] = await q<{ a: string; p: string }>(`select public.semana_merida()::text as a, (public.semana_merida() - 7)::text as p`);
  ACTUAL = s.a;
  PASADA = s.p;
}, 60_000);

describe('Bitácora · plazo y semana', () => {
  it('vence el domingo a las 20:00 de Mérida (lunes 02:00 UTC)', async () => {
    const [r] = await q<{ v: string }>(`select to_char(public.vence_bitacora('2026-11-23') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as v`);
    expect(r.v).toBe('2026-11-30 02:00');
  });

  it('solo se escribe la semana actual o hasta 4 anteriores, y siempre desde su lunes', async () => {
    const [f] = await q<{ fut: string; vieja: string; martes: string }>(`select (public.semana_merida() + 7)::text as fut, (public.semana_merida() - 35)::text as vieja, (public.semana_merida() + 1)::text as martes`);
    expect(await falla(U.ana, `public.guardar_bitacora('${f.fut}', 0, '${datos()}'::jsonb)`)).toMatch(/no está abierta/);
    expect(await falla(U.ana, `public.guardar_bitacora('${f.vieja}', 0, '${datos()}'::jsonb)`)).toMatch(/no está abierta/);
    expect(await falla(U.ana, `public.guardar_bitacora('${f.martes}', 0, '${datos()}'::jsonb)`)).toMatch(/no está abierta/);
  });
});

describe('Bitácora · borrador, entrega y conflictos', () => {
  let ana: Ver;

  it('el alumno guarda un borrador y lo sigue editando con su versión', async () => {
    ana = await guardar(U.ana, ACTUAL, 0, { aporte: '', texto_libre: '# Semana\n- Sensor\n- PID' });
    expect(ana.version).toBe(1);
    ana = await guardar(U.ana, ACTUAL, ana.version, { aporte: 'Calibré el sensor de color' });
    expect(ana.version).toBe(2);
    const [r] = await q<{ estado: string; aporte: string }>(`select estado, aporte from bitacoras where id = '${ana.id}'`);
    expect(r).toEqual({ estado: 'borrador', aporte: 'Calibré el sensor de color' });
  });

  it('dos pestañas: la versión vieja no pisa lo guardado (409) y lo guardado sigue intacto', async () => {
    expect(await falla(U.ana, `public.guardar_bitacora('${ACTUAL}', 1, '${datos({ aporte: 'versión vieja' })}'::jsonb)`)).toMatch(/conflicto: .*otra pestaña/);
    expect(await falla(U.ana, `public.guardar_bitacora('${ACTUAL}', 0, '${datos()}'::jsonb)`)).toMatch(/conflicto/);
    const [r] = await q<{ aporte: string }>(`select aporte from bitacoras where id = '${ana.id}'`);
    expect(r.aporte).toBe('Calibré el sensor de color');
  });

  it('no se entrega sin las tres respuestas; con ellas sí, y el reintento no truena', async () => {
    const vacia = await guardar(U.marco, ACTUAL, 0, { siguiente: '   ' });
    expect(await falla(U.marco, `public.entregar_bitacora('${vacia.id}', ${vacia.version})`)).toMatch(/tres preguntas/);
    const e = await uno<Ver>(U.ana, `public.entregar_bitacora('${ana.id}', ${ana.version})`);
    expect(await uno<Ver>(U.ana, `public.entregar_bitacora('${ana.id}', ${ana.version})`)).toEqual(e); // respuesta perdida
    const [r] = await q<{ estado: string; tarde: boolean }>(`select estado, primera_entrega_at > public.vence_bitacora(semana) as tarde from bitacoras where id = '${ana.id}'`);
    const [ahora] = await q<{ despues: boolean }>(`select now() > public.vence_bitacora(public.semana_merida()) as despues`);
    expect(r).toEqual({ estado: 'entregada', tarde: ahora.despues });
    ana = e;
  });

  it('entregada ya no se edita', async () => {
    expect(await falla(U.ana, `public.guardar_bitacora('${ACTUAL}', ${ana.version}, '${datos({ aporte: 'cambio tardío' })}'::jsonb)`)).toMatch(/ya se entregó/);
  });

  it('entregar una semana pasada queda marcado como tarde', async () => {
    const p = await guardar(U.diego, PASADA, 0);
    await uno(U.diego, `public.entregar_bitacora('${p.id}', ${p.version})`);
    const [r] = await q<{ tarde: boolean }>(`select primera_entrega_at > public.vence_bitacora(semana) as tarde from bitacoras where id = '${p.id}'`);
    expect(r.tarde).toBe(true);
  });
});

describe('Bitácora · privacidad', () => {
  it('solo la ven su autor y el coach/mentor; compañeros, tutor y anónimo no', async () => {
    const [a] = await q<{ id: string }>(`select id from bitacoras where alumno_id = '${U.ana}' and semana = '${ACTUAL}'`);
    expect(await b.como(U.ana, `select 1 from bitacoras where id = '${a.id}'`)).toHaveLength(1);
    expect(await b.como(U.coach, `select 1 from bitacoras where id = '${a.id}'`)).toHaveLength(1);
    expect(await b.como(U.aux, `select 1 from bitacoras where id = '${a.id}'`)).toHaveLength(1);
    for (const quien of [U.marco, U.diego, U.tutorAna]) {
      expect(await b.como(quien, `select 1 from bitacoras where id = '${a.id}'`), quien).toHaveLength(0);
      expect(await b.como(quien, `select 1 from bitacora_evidencias e join bitacoras x on x.id = e.bitacora_id where x.alumno_id = '${U.ana}'`), quien).toHaveLength(0);
    }
    expect(await b.falla(null, `select 1 from bitacoras`)).toMatch(/permission denied/);
  });

  it('un borrador es privado del alumno: el coach no lo lee hasta que se entrega', async () => {
    const [m] = await q<{ id: string }>(`select id from bitacoras where alumno_id = '${U.marco}' and semana = '${ACTUAL}'`);
    expect(await b.como(U.marco, `select 1 from bitacoras where id = '${m.id}'`)).toHaveLength(1);
    expect(await b.como(U.coach, `select 1 from bitacoras where id = '${m.id}'`)).toHaveLength(0);
    expect(await b.como(U.aux, `select 1 from bitacoras where id = '${m.id}'`)).toHaveLength(0);
  });

  it('tutor y coach no escriben bitácora; nadie escribe directo en las tablas', async () => {
    expect(await falla(U.tutorAna, `public.guardar_bitacora('${ACTUAL}', 0, '${datos()}'::jsonb)`)).toMatch(/Solo los alumnos/);
    expect(await falla(U.coach, `public.guardar_bitacora('${ACTUAL}', 0, '${datos()}'::jsonb)`)).toMatch(/Solo los alumnos/);
    expect(await b.falla(U.ana, `update bitacoras set estado = 'revisada' where alumno_id = '${U.ana}'`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `insert into bitacoras (alumno_id, semana) values ('${U.marco}', '${ACTUAL}')`)).toMatch(/permission denied/);
  });

  it('una cuenta desactivada deja de ver su bitácora', async () => {
    await b.db.exec(`update profiles set activo = false where id = '${U.ana}'`);
    expect(await b.como(U.ana, `select 1 from bitacoras`)).toHaveLength(0);
    await b.db.exec(`update profiles set activo = true where id = '${U.ana}'`);
  });
});

describe('Bitácora · evidencias', () => {
  let MAT = '';
  beforeAll(async () => {
    MAT = await uno<string>(U.luis, `public.crear_material('00000000-0000-0000-0000-0000000b0001', 'Diagrama', 'diseno')`);
    await uno(U.luis, `public.agregar_adjunto('${MAT}', 'enlace', '', null, 'https://drive.google.com/x')`);
    await uno(U.luis, `public.publicar_material('${MAT}')`);
  });

  it('vincula una tarea propia, una publicación del equipo y un enlace https', async () => {
    const v = await guardar(U.karla, ACTUAL, 0, {
      evidencias: [{ tipo: 'tarea', tarea_id: T.pits }, { tipo: 'material', material_id: MAT }, { tipo: 'enlace', url: 'https://github.com/zero-ohms-e13/robot', nombre: 'Repo' }],
    });
    expect(await q(`select tipo from bitacora_evidencias where bitacora_id = '${v.id}' order by orden`)).toEqual([{ tipo: 'tarea' }, { tipo: 'material' }, { tipo: 'enlace' }]);
  });

  it('no vincula lo que no puede ver ni enlaces inseguros (no amplía permisos)', async () => {
    // Sofía (Logística) no ve la tarea de Programación
    expect(await falla(U.sofia, `public.guardar_bitacora('${ACTUAL}', 0, '${datos({ evidencias: [{ tipo: 'tarea', tarea_id: T.odometria }] })}'::jsonb)`)).toMatch(/esa tarea/);
    const borrador = await uno<string>(U.marco, `public.crear_material('00000000-0000-0000-0000-0000000b0002', 'Borrador', 'otro')`);
    expect(await falla(U.sofia, `public.guardar_bitacora('${ACTUAL}', 0, '${datos({ evidencias: [{ tipo: 'material', material_id: borrador }] })}'::jsonb)`)).toMatch(/esa publicación/);
    expect(await falla(U.sofia, `public.guardar_bitacora('${ACTUAL}', 0, '${datos({ evidencias: [{ tipo: 'enlace', url: 'http://x.com' }] })}'::jsonb)`)).toMatch(/https/);
    // Nada quedó guardado a medias
    expect(await q(`select 1 from bitacoras where alumno_id = '${U.sofia}'`)).toHaveLength(0);
  });

  it('si la publicación se retira, la bitácora conserva la evidencia y el texto (el cliente la muestra como no disponible)', async () => {
    await uno(U.coach, `public.retirar_material('${MAT}')`);
    const [r] = await q<{ n: number }>(`select count(*)::int as n from bitacora_evidencias e join bitacoras x on x.id = e.bitacora_id where x.alumno_id = '${U.karla}' and e.material_id = '${MAT}'`);
    expect(r.n).toBe(1);
    expect(await b.como(U.karla, `select 1 from materiales where id = '${MAT}'`)).toHaveLength(0);
  });
});

describe('Bitácora · revisión del coach', () => {
  it('el coach devuelve con nota; el alumno recibe aviso, corrige y vuelve a entregar; la primera entrega se conserva', async () => {
    const [a] = await q<{ id: string; primera: string }>(`select id, primera_entrega_at::text as primera from bitacoras where alumno_id = '${U.ana}' and semana = '${ACTUAL}'`);
    expect(await falla(U.coach, `public.devolver_bitacora('${a.id}', '  ')`)).toMatch(/qué hay que corregir/);
    expect(await falla(U.marco, `public.devolver_bitacora('${a.id}', 'x')`)).toMatch(/Solo el coach/);
    await uno(U.coach, `public.devolver_bitacora('${a.id}', 'Cuenta qué valores de Kp probaste.')`);
    const av = await b.como<{ titulo: string }>(U.ana, `select titulo from avisos where tipo = 'bitacora'`);
    expect(av.map((x) => x.titulo)).toContain('Tu bitácora volvió para corregir');
    const [d] = await q<{ version: number; estado: string; retro: string }>(`select version, estado, retro from bitacoras where id = '${a.id}'`);
    expect(d.estado).toBe('devuelta');
    const v = await guardar(U.ana, ACTUAL, d.version, { aprendizaje: 'Con Kp 0.8 oscila; con 0.5 se estabiliza' });
    await uno(U.ana, `public.entregar_bitacora('${a.id}', ${v.version})`);
    const [f] = await q<{ estado: string; primera: string }>(`select estado, primera_entrega_at::text as primera from bitacoras where id = '${a.id}'`);
    expect(f).toEqual({ estado: 'entregada', primera: a.primera });
  });

  it('el coach la marca revisada con retroalimentación; el alumno ya no la cambia', async () => {
    const [a] = await q<{ id: string; version: number }>(`select id, version from bitacoras where alumno_id = '${U.ana}' and semana = '${ACTUAL}'`);
    await uno(U.aux, `public.revisar_bitacora('${a.id}', '¡Bien documentado!')`);
    const [r] = await b.como<{ estado: string; retro: string }>(U.ana, `select estado, retro from bitacoras where id = '${a.id}'`);
    expect(r).toEqual({ estado: 'revisada', retro: '¡Bien documentado!' });
    expect(await falla(U.ana, `public.revisar_bitacora('${a.id}', 'me la reviso yo')`)).toMatch(/Solo el coach/);
    expect(await falla(U.ana, `public.guardar_bitacora('${ACTUAL}', ${a.version + 1}, '${datos()}'::jsonb)`)).toMatch(/ya se entregó/);
  });

  it('el seguimiento lista a todos los alumnos activos con su estado; solo el coach lo ve', async () => {
    const r = await b.como<{ nombre_visible: string; estado: string; atrasada: boolean; tarde: boolean }>(U.coach, `select * from public.resumen_bitacoras('${ACTUAL}')`);
    expect(r).toHaveLength(6); // los 6 alumnos activos del seed
    const de = (n: string) => r.find((x) => x.nombre_visible === n)!;
    expect(de('Ana López').estado).toBe('revisada');
    expect(de('Marco Ruiz').estado).toBe('pendiente'); // solo borrador
    expect(de('Sofía Ramos').estado).toBe('pendiente'); // sin bitácora
    const pas = await b.como<{ nombre_visible: string; estado: string; atrasada: boolean; tarde: boolean }>(U.coach, `select * from public.resumen_bitacoras('${PASADA}')`);
    expect(pas.find((x) => x.nombre_visible === 'Diego Pérez')).toMatchObject({ estado: 'entregada', tarde: true, atrasada: false });
    expect(pas.find((x) => x.nombre_visible === 'Luis Medina')).toMatchObject({ estado: 'pendiente', atrasada: true });
    expect(await falla(U.ana, `public.resumen_bitacoras('${ACTUAL}')`)).toMatch(/Solo el coach/);
  });
});

describe('Bitácora · plazo editable por el coach', () => {
  it('solo el coach cambia la fecha; fuera de rango se rechaza', async () => {
    expect(await falla(U.ana, `public.fijar_plazo_bitacora('${ACTUAL}', now() + interval '1 day')`)).toMatch(/Solo el coach/);
    expect(await falla(U.coach, `public.fijar_plazo_bitacora('${ACTUAL}', '${ACTUAL}'::timestamp at time zone 'America/Merida' - interval '1 hour')`)).toMatch(/entre el inicio/);
    expect(await falla(U.coach, `public.fijar_plazo_bitacora('${ACTUAL}', '${ACTUAL}'::timestamp at time zone 'America/Merida' + interval '40 days')`)).toMatch(/entre el inicio/);
  });

  it('extender el plazo de una semana pasada quita la marca de tarde y de atrasada; volver al de omisión la regresa', async () => {
    const antes = await b.como<{ nombre_visible: string; tarde: boolean; atrasada: boolean }>(U.coach, `select * from public.resumen_bitacoras('${PASADA}')`);
    expect(antes.find((x) => x.nombre_visible === 'Diego Pérez')?.tarde).toBe(true);
    const [v] = await b.como<{ r: string }>(U.coach, `select public.fijar_plazo_bitacora('${PASADA}', now() + interval '2 days')::text as r`);
    expect(v.r).toBeTruthy();
    const desp = await b.como<{ nombre_visible: string; tarde: boolean; atrasada: boolean }>(U.coach, `select * from public.resumen_bitacoras('${PASADA}')`);
    expect(desp.find((x) => x.nombre_visible === 'Diego Pérez')?.tarde).toBe(false);
    expect(desp.find((x) => x.nombre_visible === 'Luis Medina')?.atrasada).toBe(false);
    // Los alumnos ven el plazo vigente y reciben aviso
    const [p] = await b.como<{ igual: boolean }>(U.luis, `select public.vence_bitacora('${PASADA}') = (select vence_at from bitacora_plazos where semana = '${PASADA}') as igual`);
    expect(p.igual).toBe(true);
    expect((await b.como<{ titulo: string }>(U.luis, `select titulo from avisos where tipo = 'bitacora'`)).map((x) => x.titulo)).toContain('Cambió la fecha de entrega de la bitácora');
    // Volver al domingo 20:00
    await b.como(U.coach, `select public.fijar_plazo_bitacora('${PASADA}', null)`);
    const [o] = await q<{ igual: boolean }>(`select public.vence_bitacora('${PASADA}') = public.vence_bitacora_omision('${PASADA}') as igual`);
    expect(o.igual).toBe(true);
  });

  it('nadie escribe directo los plazos y el tutor no los ve', async () => {
    expect(await b.falla(U.coach, `insert into bitacora_plazos (semana, vence_at) values ('${ACTUAL}', now())`)).toMatch(/permission denied/);
    await b.como(U.coach, `select public.fijar_plazo_bitacora('${ACTUAL}', now() + interval '3 days')`);
    expect(await b.como(U.tutorAna, `select 1 from bitacora_plazos`)).toHaveLength(0);
    expect(await b.como(U.ana, `select 1 from bitacora_plazos`)).toHaveLength(1);
  });
});
