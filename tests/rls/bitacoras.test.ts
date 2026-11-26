// Bitácoras · varias por semana, atrasadas, privacidad, plazo, estados, conflictos y evidencias (PGlite, datos ficticios).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, T, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
let ACTUAL = ''; // lunes de la semana actual (Mérida)
let PASADA = ''; // lunes de la semana anterior
let HOY = ''; // hoy en Mérida
let DIA_PASADA = ''; // un día de la semana anterior

const q = async <R,>(sql: string) => (await b.db.query<R>(sql)).rows;
const uno = async <R,>(quien: string | null, sql: string) => (await b.como<{ r: R }>(quien, `select ${sql} as r`))[0].r;
type Ver = { id: string; version: number };
let n = 0;
const nuevoId = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const datos = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ aporte: 'Calibré el sensor', aprendizaje: 'El PID oscila si Kp es alto', siguiente: 'Probar en la cancha', necesita_ayuda: false, texto_libre: '', evidencias: [], ...o }).replace(/'/g, "''");
const guardar = (quien: string, id: string, fecha: string, version: number, o: Record<string, unknown> = {}) =>
  uno<Ver>(quien, `public.guardar_bitacora('${id}', '${fecha}', ${version}, '${datos(o)}'::jsonb)`);
const falla = (quien: string | null, sql: string) => b.falla(quien, `select ${sql}`);
type FilaR = { nombre_visible: string; estado: string; entregadas: number; por_revisar: number; tarde: boolean; atrasada: boolean; exigible: boolean; necesita_ayuda: boolean };
const resumen = (quien: string, semana: string) => b.como<FilaR>(quien, `select * from public.resumen_bitacoras('${semana}')`);
const dia = async (expr: string) => (await q<{ d: string }>(`select (${expr})::date::text as d`))[0].d;

beforeAll(async () => {
  b = await crearBase();
  ACTUAL = await dia('public.semana_merida()');
  PASADA = await dia('public.semana_merida() - 7');
  HOY = await dia(`now() at time zone 'America/Merida'`);
  DIA_PASADA = await dia('public.semana_merida() - 5');
  // Arranque hace 3 semanas: se pueden entregar atrasadas desde ahí
  await b.como(U.coach, `select public.fijar_inicio_bitacoras(('${ACTUAL}'::date - 21))`);
}, 60_000);

describe('Bitácora · plazo, fechas y semanas abiertas', () => {
  it('vence el domingo a las 20:00 de Mérida (lunes 02:00 UTC)', async () => {
    const [r] = await q<{ v: string }>(`select to_char(public.vence_bitacora('2026-11-23') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as v`);
    expect(r.v).toBe('2026-11-30 02:00');
  });

  it('la semana sale de la fecha; no se aceptan fechas futuras ni anteriores al arranque', async () => {
    const v = await guardar(U.ana, nuevoId(), DIA_PASADA, 0);
    expect((await q<{ semana: string }>(`select semana::text from bitacoras where id = '${v.id}'`))[0].semana).toBe(PASADA);
    expect(await falla(U.ana, `public.guardar_bitacora('${nuevoId()}', ('${HOY}'::date + 1), 0, '${datos()}'::jsonb)`)).toMatch(/futura/);
    expect(await falla(U.ana, `public.guardar_bitacora('${nuevoId()}', ('${ACTUAL}'::date - 28), 0, '${datos()}'::jsonb)`)).toMatch(/no está abierta/);
  });

  it('bitácoras atrasadas: se escriben y entregan semanas pasadas desde el arranque, y quedan como tarde', async () => {
    const atr = await guardar(U.diego, nuevoId(), await dia(`'${ACTUAL}'::date - 18`), 0);
    await uno(U.diego, `public.entregar_bitacora('${atr.id}', ${atr.version})`);
    const [r] = await q<{ tarde: boolean }>(`select primera_entrega_at > public.vence_bitacora(semana) as tarde from bitacoras where id = '${atr.id}'`);
    expect(r.tarde).toBe(true);
  });
});

describe('Bitácora · varias por semana', () => {
  it('un alumno escribe y entrega varias bitácoras en la misma semana, cada una con su fecha', async () => {
    const a = await guardar(U.marco, nuevoId(), ACTUAL, 0, { aporte: 'Lunes de taller' });
    const c = await guardar(U.marco, nuevoId(), HOY, 0, { aporte: 'Otro día de taller' });
    await uno(U.marco, `public.entregar_bitacora('${a.id}', ${a.version})`);
    await uno(U.marco, `public.entregar_bitacora('${c.id}', ${c.version})`);
    const filas = await b.como<{ estado: string }>(U.marco, `select estado from bitacoras where semana = '${ACTUAL}'`);
    expect(filas.map((x) => x.estado)).toEqual(['entregada', 'entregada']);
    const r = (await resumen(U.coach, ACTUAL)).find((x) => x.nombre_visible === 'Marco Ruiz')!;
    expect(r).toMatchObject({ estado: 'entregada', entregadas: 2, por_revisar: 2 });
  });

  it('máximo 10 por semana', async () => {
    for (let i = 0; i < 10; i++) await guardar(U.karla, nuevoId(), ACTUAL, 0);
    expect(await falla(U.karla, `public.guardar_bitacora('${nuevoId()}', '${ACTUAL}', 0, '${datos()}'::jsonb)`)).toMatch(/máximo de 10/);
  });

  it('el id lo pone el cliente: reintentar la creación no duplica; el id de otro alumno no se puede tocar', async () => {
    const id = nuevoId();
    const v1 = await guardar(U.sofia, id, HOY, 0, { aporte: 'primera' });
    const v2 = await guardar(U.sofia, id, HOY, 0, { aporte: 'primera' }); // la respuesta se perdió: mismo intento
    expect(v2.id).toBe(v1.id);
    expect((await q<{ n: number }>(`select count(*)::int as n from bitacoras where alumno_id = '${U.sofia}'`))[0].n).toBe(1);
    expect(await falla(U.luis, `public.guardar_bitacora('${id}', '${HOY}', 2, '${datos({ aporte: 'hackeo' })}'::jsonb)`)).toMatch(/permiso/);
  });
});

describe('Bitácora · borrador, entrega y conflictos', () => {
  let ana: Ver;
  const ID_ANA = '00000000-0000-0000-0000-0000000a0a0a';

  it('borrador que se sigue editando con su versión', async () => {
    ana = await guardar(U.ana, ID_ANA, HOY, 0, { aporte: '', texto_libre: '# Semana\n- Sensor\n- PID' });
    expect(ana.version).toBe(1);
    ana = await guardar(U.ana, ID_ANA, HOY, ana.version, { aporte: 'Calibré el sensor de color' });
    expect(ana.version).toBe(2);
  });

  it('dos pestañas: la versión vieja no pisa lo guardado (409) y lo guardado sigue intacto', async () => {
    expect(await falla(U.ana, `public.guardar_bitacora('${ID_ANA}', '${HOY}', 1, '${datos({ aporte: 'versión vieja' })}'::jsonb)`)).toMatch(/conflicto: .*otra pestaña/);
    expect((await q<{ aporte: string }>(`select aporte from bitacoras where id = '${ID_ANA}'`))[0].aporte).toBe('Calibré el sensor de color');
  });

  it('no se entrega sin las tres respuestas; con ellas sí, y el reintento no truena', async () => {
    const vacia = await guardar(U.luis, nuevoId(), HOY, 0, { siguiente: '   ' });
    expect(await falla(U.luis, `public.entregar_bitacora('${vacia.id}', ${vacia.version})`)).toMatch(/tres preguntas/);
    const e = await uno<Ver>(U.ana, `public.entregar_bitacora('${ID_ANA}', ${ana.version})`);
    expect(await uno<Ver>(U.ana, `public.entregar_bitacora('${ID_ANA}', ${ana.version})`)).toEqual(e);
    ana = e;
  });

  it('entregada ya no se edita', async () => {
    expect(await falla(U.ana, `public.guardar_bitacora('${ID_ANA}', '${HOY}', ${ana.version}, '${datos({ aporte: 'cambio tardío' })}'::jsonb)`)).toMatch(/ya se entregó/);
  });
});

describe('Bitácora · privacidad', () => {
  it('solo la ven su autor y el coach principal; mentor, compañeros, tutor y anónimo no', async () => {
    const [a] = await q<{ id: string }>(`select id from bitacoras where alumno_id = '${U.ana}' and estado = 'entregada' limit 1`);
    expect(await b.como(U.ana, `select 1 from bitacoras where id = '${a.id}'`)).toHaveLength(1);
    expect(await b.como(U.coach, `select 1 from bitacoras where id = '${a.id}'`)).toHaveLength(1);
    for (const quien of [U.aux, U.marco, U.diego, U.tutorAna]) {
      expect(await b.como(quien, `select 1 from bitacoras where id = '${a.id}'`), quien).toHaveLength(0);
    }
    expect(await b.falla(null, `select 1 from bitacoras`)).toMatch(/permission denied/);
  });

  it('un borrador es privado del alumno: el coach no lo lee hasta que se entrega', async () => {
    const [m] = await q<{ id: string }>(`select id from bitacoras where alumno_id = '${U.karla}' and estado = 'borrador' limit 1`);
    expect(await b.como(U.karla, `select 1 from bitacoras where id = '${m.id}'`)).toHaveLength(1);
    expect(await b.como(U.coach, `select 1 from bitacoras where id = '${m.id}'`)).toHaveLength(0);
  });

  it('tutor y coach no escriben bitácora; nadie escribe directo en las tablas', async () => {
    expect(await falla(U.tutorAna, `public.guardar_bitacora('${nuevoId()}', '${HOY}', 0, '${datos()}'::jsonb)`)).toMatch(/Solo los alumnos/);
    expect(await falla(U.coach, `public.guardar_bitacora('${nuevoId()}', '${HOY}', 0, '${datos()}'::jsonb)`)).toMatch(/Solo los alumnos/);
    expect(await b.falla(U.ana, `update bitacoras set estado = 'revisada' where alumno_id = '${U.ana}'`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `insert into bitacoras (alumno_id, fecha, semana) values ('${U.marco}', '${HOY}', '${ACTUAL}')`)).toMatch(/permission denied/);
  });

  it('una cuenta desactivada deja de ver sus bitácoras', async () => {
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
    const v = await guardar(U.sofia, nuevoId(), DIA_PASADA, 0, {
      evidencias: [{ tipo: 'tarea', tarea_id: T.post }, { tipo: 'material', material_id: MAT }, { tipo: 'enlace', url: 'https://github.com/zero-ohms-e13/robot', nombre: 'Repo' }],
    });
    expect(await q(`select tipo from bitacora_evidencias where bitacora_id = '${v.id}' order by orden`)).toEqual([{ tipo: 'tarea' }, { tipo: 'material' }, { tipo: 'enlace' }]);
  });

  it('no vincula lo que no puede ver ni enlaces inseguros (no amplía permisos)', async () => {
    const id = nuevoId();
    expect(await falla(U.sofia, `public.guardar_bitacora('${id}', '${HOY}', 0, '${datos({ evidencias: [{ tipo: 'tarea', tarea_id: T.odometria }] })}'::jsonb)`)).toMatch(/esa tarea/);
    const borrador = await uno<string>(U.marco, `public.crear_material('00000000-0000-0000-0000-0000000b0002', 'Borrador', 'otro')`);
    expect(await falla(U.sofia, `public.guardar_bitacora('${id}', '${HOY}', 0, '${datos({ evidencias: [{ tipo: 'material', material_id: borrador }] })}'::jsonb)`)).toMatch(/esa publicación/);
    expect(await falla(U.sofia, `public.guardar_bitacora('${id}', '${HOY}', 0, '${datos({ evidencias: [{ tipo: 'enlace', url: 'http://x.com' }] })}'::jsonb)`)).toMatch(/https/);
    expect(await q(`select 1 from bitacoras where id = '${id}'`)).toHaveLength(0); // nada a medias
  });

  it('si la publicación se retira, la bitácora conserva la evidencia (el cliente la muestra como no disponible)', async () => {
    await uno(U.coach, `public.retirar_material('${MAT}')`);
    expect((await q<{ n: number }>(`select count(*)::int as n from bitacora_evidencias where material_id = '${MAT}'`))[0].n).toBe(1);
    expect(await b.como(U.sofia, `select 1 from materiales where id = '${MAT}'`)).toHaveLength(0);
  });
});

describe('Bitácora · revisión del coach', () => {
  const ID_ANA = '00000000-0000-0000-0000-0000000a0a0a';

  it('el coach devuelve con nota; el alumno recibe aviso, corrige y vuelve a entregar; la primera entrega se conserva', async () => {
    const [a] = await q<{ primera: string }>(`select primera_entrega_at::text as primera from bitacoras where id = '${ID_ANA}'`);
    expect(await falla(U.coach, `public.devolver_bitacora('${ID_ANA}', '  ')`)).toMatch(/qué hay que corregir/);
    expect(await falla(U.marco, `public.devolver_bitacora('${ID_ANA}', 'x')`)).toMatch(/Solo el coach/);
    await uno(U.coach, `public.devolver_bitacora('${ID_ANA}', 'Cuenta qué valores de Kp probaste.')`);
    expect((await b.como<{ titulo: string }>(U.ana, `select titulo from avisos where tipo = 'bitacora'`)).map((x) => x.titulo)).toContain('Tu bitácora volvió para corregir');
    const [d] = await q<{ version: number }>(`select version from bitacoras where id = '${ID_ANA}'`);
    const v = await guardar(U.ana, ID_ANA, HOY, d.version, { aprendizaje: 'Con Kp 0.8 oscila; con 0.5 se estabiliza' });
    await uno(U.ana, `public.entregar_bitacora('${ID_ANA}', ${v.version})`);
    const [f] = await q<{ estado: string; primera: string }>(`select estado, primera_entrega_at::text as primera from bitacoras where id = '${ID_ANA}'`);
    expect(f).toEqual({ estado: 'entregada', primera: a.primera });
  });

  it('el coach principal la marca revisada; el mentor y el alumno no; ya no se edita', async () => {
    const [a] = await q<{ version: number }>(`select version from bitacoras where id = '${ID_ANA}'`);
    expect(await falla(U.aux, `public.revisar_bitacora('${ID_ANA}', 'del mentor')`)).toMatch(/Solo el coach/);
    expect(await falla(U.ana, `public.revisar_bitacora('${ID_ANA}', 'me la reviso yo')`)).toMatch(/Solo el coach/);
    await uno(U.coach, `public.revisar_bitacora('${ID_ANA}', '¡Bien documentado!')`);
    expect((await b.como<{ estado: string; retro: string }>(U.ana, `select estado, retro from bitacoras where id = '${ID_ANA}'`))[0]).toEqual({ estado: 'revisada', retro: '¡Bien documentado!' });
    expect(await falla(U.ana, `public.guardar_bitacora('${ID_ANA}', '${HOY}', ${a.version + 1}, '${datos()}'::jsonb)`)).toMatch(/ya se entregó/);
  });

  it('una bitácora devuelta se corrige aunque su semana ya no esté abierta (y se queda en su semana)', async () => {
    const f = await dia('public.semana_merida() - 40');
    const s = await dia(`date_trunc('week', public.semana_merida() - 40)`);
    const [x] = await q<{ id: string }>(`insert into bitacoras (alumno_id, fecha, semana, estado, aporte, aprendizaje, siguiente, entregada_at, primera_entrega_at) values ('${U.luis}', '${f}', '${s}', 'entregada', 'a', 'b', 'c', now(), now()) returning id`);
    expect(await falla(U.luis, `public.guardar_bitacora('${nuevoId()}', '${f}', 0, '${datos()}'::jsonb)`)).toMatch(/no está abierta/);
    await uno(U.coach, `public.devolver_bitacora('${x.id}', 'Agrega qué probaste.')`);
    const [d] = await q<{ version: number }>(`select version from bitacoras where id = '${x.id}'`);
    const g = await guardar(U.luis, x.id, HOY, d.version, { aporte: 'Corregida' });
    await uno(U.luis, `public.entregar_bitacora('${x.id}', ${g.version})`);
    expect((await q<{ estado: string; semana: string }>(`select estado, semana::text from bitacoras where id = '${x.id}'`))[0]).toEqual({ estado: 'entregada', semana: s });
  });
});

describe('Bitácora · seguimiento del coach', () => {
  it('agrupa por alumno: cuántas entregó, cuántas faltan por revisar y el estado de la semana', async () => {
    const r = await resumen(U.coach, ACTUAL);
    expect(r).toHaveLength(6); // los 6 alumnos activos del seed
    const de = (nombre: string) => r.find((x) => x.nombre_visible === nombre)!;
    expect(de('Ana López')).toMatchObject({ estado: 'revisada', entregadas: 1, por_revisar: 0 });
    expect(de('Marco Ruiz')).toMatchObject({ estado: 'entregada', entregadas: 2 });
    expect(de('Karla Torres')).toMatchObject({ estado: 'pendiente', entregadas: 0 }); // solo borradores
    expect(await falla(U.ana, `public.resumen_bitacoras('${ACTUAL}')`)).toMatch(/Solo el coach/);
    expect(await falla(U.aux, `public.resumen_bitacoras('${ACTUAL}')`)).toMatch(/Solo el coach/);
  });

  it('semana pasada: quien no entregó está atrasado; antes del arranque no se marcan atrasos', async () => {
    const pas = await resumen(U.coach, PASADA);
    expect(pas.find((x) => x.nombre_visible === 'Karla Torres')).toMatchObject({ estado: 'pendiente', atrasada: true, exigible: true });
    const vieja = await resumen(U.coach, await dia('public.semana_merida() - 35'));
    expect(vieja.find((x) => x.nombre_visible === 'Karla Torres')).toMatchObject({ atrasada: false, exigible: false });
    expect(await falla(U.aux, `public.fijar_inicio_bitacoras('${PASADA}')`)).toMatch(/Solo el coach/);
  });
});

describe('Bitácora · plazo editable por el coach', () => {
  it('solo el coach cambia la fecha; fuera de rango se rechaza', async () => {
    expect(await falla(U.ana, `public.fijar_plazo_bitacora('${ACTUAL}', now() + interval '1 day')`)).toMatch(/Solo el coach/);
    expect(await falla(U.coach, `public.fijar_plazo_bitacora('${ACTUAL}', '${ACTUAL}'::timestamp at time zone 'America/Merida' - interval '1 hour')`)).toMatch(/entre el inicio/);
    expect(await falla(U.coach, `public.fijar_plazo_bitacora('${ACTUAL}', '${ACTUAL}'::timestamp at time zone 'America/Merida' + interval '40 days')`)).toMatch(/entre el inicio/);
  });

  it('extender el plazo de una semana pasada quita atrasos; volver al de omisión los regresa', async () => {
    await b.como(U.coach, `select public.fijar_plazo_bitacora('${PASADA}', now() + interval '2 days')`);
    expect((await resumen(U.coach, PASADA)).find((x) => x.nombre_visible === 'Karla Torres')?.atrasada).toBe(false);
    expect((await b.como<{ titulo: string }>(U.luis, `select titulo from avisos where tipo = 'bitacora'`)).map((x) => x.titulo)).toContain('Cambió la fecha de entrega de la bitácora');
    await b.como(U.coach, `select public.fijar_plazo_bitacora('${PASADA}', null)`);
    expect((await q<{ igual: boolean }>(`select public.vence_bitacora('${PASADA}') = public.vence_bitacora_omision('${PASADA}') as igual`))[0].igual).toBe(true);
  });

  it('nadie escribe directo los plazos y el tutor no los ve', async () => {
    expect(await b.falla(U.coach, `insert into bitacora_plazos (semana, vence_at) values ('${ACTUAL}', now())`)).toMatch(/permission denied/);
    await b.como(U.coach, `select public.fijar_plazo_bitacora('${ACTUAL}', now() + interval '3 days')`);
    expect(await b.como(U.tutorAna, `select 1 from bitacora_plazos`)).toHaveLength(0);
    expect(await b.como(U.ana, `select 1 from bitacora_plazos`)).toHaveLength(1);
  });
});
