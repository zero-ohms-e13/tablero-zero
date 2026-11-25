// FUN-003 · RPCs SQL del alta de cuentas (PGlite, datos ficticios). Auth real queda para Supabase aislado.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
let PROG = '';
beforeAll(async () => {
  b = await crearBase();
  PROG = (await b.db.query<{ id: string }>(`select id from public.areas where nombre = 'Programación'`)).rows[0].id;
}, 60_000);

const S1 = '00000000-0000-4000-8000-0000000a1001';
const S2 = '00000000-0000-4000-8000-0000000a1002';
const ALU = '00000000-0000-4000-8000-0000000b0001';
const TUT = '00000000-0000-4000-8000-0000000b0002';
const sv = <R,>(sql: string) => b.comoServicio<R>(sql);
const iniciar = (s: string, huella = 'h1', coach: string = U.coach) =>
  sv<{ r: { previo: string | null; creados?: string[] } }>(`select public.iniciar_alta('${s}', '${coach}', '${huella}') as r`).then((x) => x[0].r);
const cuenta = async (sql: string) => (await b.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`)).rows[0].n;
const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    solicitud: S1,
    perfiles: [
      { id: ALU, usuario: 'mia.s', nombre_visible: 'Mia Soto', iniciales: 'MS', color: '#2F5D8A', rol_global: 'alumno', vence: '2026-12-02T18:00:00Z' },
      { id: TUT, usuario: 'tutor.mia.s', nombre_visible: 'Familia de Mia', iniciales: 'FD', color: '#5A4335', rol_global: 'tutor', vence: '2026-12-02T18:00:00Z' },
    ],
    membresias: [{ usuario_id: ALU, area_id: PROG, es_lider: false }],
    vinculo: { tutor_id: TUT, alumno_id: ALU },
    resultado: [{ usuario_id: ALU, usuario: 'mia.s', nombre: 'Mia Soto', rol: 'alumno' }],
    ...over,
  });

describe('FUN-003 · altas_cuentas', () => {
  it('iniciar: nueva → en curso → otra huella', async () => {
    expect((await iniciar(S1)).previo).toBeNull();
    expect((await iniciar(S1)).previo).toBe('en_curso');
    expect((await iniciar(S1, 'h2')).previo).toBe('otra');
    expect((await iniciar(S1, 'h1', U.aux)).previo).toBe('otra');
  });

  it('completar es una transacción: un fallo en la membresía no deja perfiles', async () => {
    await b.db.exec(`insert into auth.users (id) values ('${ALU}'), ('${TUT}')`);
    await sv(`select public.registrar_creado_alta('${S1}', '${ALU}'); select public.registrar_creado_alta('${S1}', '${TUT}'); select public.registrar_creado_alta('${S1}', '${TUT}');`);
    const [r] = await sv<{ creados: string[] }>(`select creados from public.altas_cuentas where solicitud_id = '${S1}'`);
    expect(r.creados).toEqual([ALU, TUT]); // sin duplicados
    const malo = payload({ membresias: [{ usuario_id: ALU, area_id: '00000000-0000-4000-8000-00000000dead', es_lider: false }] });
    const err = await sv<{ e: string | null }>(`select public.tz_probar($q$select public.completar_alta('${malo}'::jsonb)$q$) as e`);
    expect(err[0].e).toMatch(/foreign key|violates/);
    expect(await cuenta(`select 1 from public.profiles where id in ('${ALU}', '${TUT}')`)).toBe(0);
    expect(await cuenta(`select 1 from public.tutores_alumnos where tutor_id = '${TUT}'`)).toBe(0);
  });

  it('un vínculo con alumno inexistente revierte todo', async () => {
    const malo = payload({ vinculo: { tutor_id: TUT, alumno_id: '00000000-0000-4000-8000-00000000beef' } });
    const err = await sv<{ e: string | null }>(`select public.tz_probar($q$select public.completar_alta('${malo}'::jsonb)$q$) as e`);
    expect(err[0].e).toMatch(/alumno del vínculo/);
    expect(await cuenta(`select 1 from public.profiles where id in ('${ALU}', '${TUT}')`)).toBe(0);
  });

  it('no escribe perfiles de identidades que esta solicitud no creó', async () => {
    const ajeno = payload({ perfiles: [{ id: U.ana, usuario: 'robo', nombre_visible: 'X', iniciales: 'X', color: '#000000', rol_global: 'coach', vence: '2026-12-02T18:00:00Z' }] });
    const err = await sv<{ e: string | null }>(`select public.tz_probar($q$select public.completar_alta('${ajeno}'::jsonb)$q$) as e`);
    expect(err[0].e).toMatch(/ajeno/);
    expect((await b.db.query<{ rol_global: string }>(`select rol_global from public.profiles where id = '${U.ana}'`)).rows[0].rol_global).toBe('alumno');
  });

  it('completar correcto: perfiles, membresía y vínculo; la solicitud queda completa y el reintento lo sabe', async () => {
    await sv(`select public.completar_alta('${payload()}'::jsonb)`);
    expect(await cuenta(`select 1 from public.profiles where id in ('${ALU}', '${TUT}') and debe_cambiar_password`)).toBe(2);
    expect(await cuenta(`select 1 from public.membresias where usuario_id = '${ALU}'`)).toBe(1);
    expect(await cuenta(`select 1 from public.tutores_alumnos where tutor_id = '${TUT}' and alumno_id = '${ALU}'`)).toBe(1);
    const r = await iniciar(S1);
    expect(r.previo).toBe('completa');
    // completar otra vez (solicitud ya no está en curso) no se permite
    const err = await sv<{ e: string | null }>(`select public.tz_probar($q$select public.completar_alta('${payload()}'::jsonb)$q$) as e`);
    expect(err[0].e).toMatch(/no está en curso/);
  });

  it('incompleta se retoma y olvidar_creados solo quita los confirmados', async () => {
    expect((await iniciar(S2)).previo).toBeNull();
    await sv(`select public.registrar_creado_alta('${S2}', '${U.marco}'); select public.registrar_creado_alta('${S2}', '${U.luis}');`);
    await sv(`select public.marcar_alta('${S2}', 'incompleta', 'compensacion')`);
    expect((await sv<{ solicitud_id: string }>(`select solicitud_id from public.altas_incompletas()`)).map((x) => x.solicitud_id)).toContain(S2);
    const r = await iniciar(S2);
    expect(r).toMatchObject({ previo: 'incompleta', creados: [U.marco, U.luis] });
    await sv(`select public.olvidar_creados_alta('${S2}', array['${U.marco}']::uuid[])`);
    expect((await sv<{ creados: string[] }>(`select creados from public.altas_cuentas where solicitud_id = '${S2}'`))[0].creados).toEqual([U.luis]);
  });

  it('las contraseñas temporales nunca se guardan en la solicitud', async () => {
    const filas = await sv<{ t: string }>(`select row_to_json(a)::text as t from public.altas_cuentas a`);
    expect(filas.every((f) => !/password/i.test(f.t))).toBe(true);
  });

  it('solo service_role: coach, alumno y anónimo no pueden usar las RPCs ni leer la tabla', async () => {
    expect(await b.falla(U.coach, `select public.iniciar_alta(gen_random_uuid(), '${U.coach}', 'h')`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `select public.completar_alta('{}'::jsonb)`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `select * from public.altas_cuentas`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select public.altas_incompletas()`)).toMatch(/permission denied/);
  });
});
