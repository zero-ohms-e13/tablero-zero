// Registro de cargas de datos · solo el coach principal, sin contraseñas (PGlite, datos ficticios).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
const ID = '00000000-0000-0000-0000-00000000f00d';
beforeAll(async () => {
  b = await crearBase();
}, 60_000);

describe('Importaciones · registro de lotes', () => {
  it('el coach principal registra un lote y cada etapa agrega lo suyo', async () => {
    await b.como(U.coach, `select public.registrar_importacion('${ID}', 'equipo.xlsx', 'en_curso', '{"areas": ["Mecánica"]}'::jsonb)`);
    await b.como(U.coach, `select public.registrar_importacion('${ID}', 'equipo.xlsx', 'terminado', '{"cuentas": ["diego.p"]}'::jsonb)`);
    const r = await b.como<{ etapa: string; resumen: Record<string, string[]> }>(U.coach, `select etapa, resumen from importaciones where id = '${ID}'`);
    expect(r).toEqual([{ etapa: 'terminado', resumen: { areas: ['Mecánica'], cuentas: ['diego.p'] } }]);
  });

  it('nadie más lo ve ni lo escribe; no acepta contraseñas', async () => {
    for (const quien of [U.aux, U.ana, U.tutorAna]) {
      expect(await b.como(quien, `select 1 from importaciones`), quien).toHaveLength(0);
      expect(await b.falla(quien, `select public.registrar_importacion('${ID}', 'x', 'terminado', '{}'::jsonb)`), quien).toMatch(/Solo el coach principal/);
    }
    expect(await b.falla(U.coach, `select public.registrar_importacion('${ID}', 'x', 'terminado', '{"fichas": [{"password": "cobre-123"}]}'::jsonb)`)).toMatch(/no guarda contraseñas/);
    expect(await b.falla(U.coach, `select public.registrar_importacion('${ID}', 'x', 'terminado', '{"notas": ["algo"]}'::jsonb)`)).toMatch(/formato no permitido/);
    expect(await b.falla(U.coach, `select public.registrar_importacion('${ID}', 'x', 'terminado', '{"fallos": [{"msg": "x"}]}'::jsonb)`)).toMatch(/formato no permitido/);
    expect(await b.falla(U.coach, `select public.registrar_importacion('${ID}', 'x', 'terminado', '{"fallos": ["${'x'.repeat(200)}"]}'::jsonb)`)).toMatch(/formato no permitido/);
    expect(await b.falla(U.coach, `insert into importaciones (id, archivo) values (gen_random_uuid(), 'x')`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select 1 from importaciones`)).toMatch(/permission denied/);
  });

  it('un reintento une las listas (no borra lo que el lote creó antes)', async () => {
    const L = '00000000-0000-0000-0000-00000000beef';
    await b.como(U.coach, `select public.registrar_importacion('${L}', 'x.xlsx', 'en_curso', '{"cuentas": ["diego.p"], "filas": ["cuenta:ALU-01:creada:abc"]}'::jsonb)`);
    await b.como(U.coach, `select public.registrar_importacion('${L}', 'x.xlsx', 'terminado', '{"cuentas": [], "asignaciones": ["ALU-02 → MEC"], "filas": ["cuenta:ALU-01:creada:abc", "asignacion:ALU-02/MEC:creada"]}'::jsonb)`);
    const [r] = await b.como<{ resumen: Record<string, string[]> }>(U.coach, `select resumen from importaciones where id = '${L}'`);
    expect(r.resumen.cuentas).toEqual(['diego.p']);
    expect(r.resumen.asignaciones).toEqual(['ALU-02 → MEC']);
    expect(r.resumen.filas.sort()).toEqual(['asignacion:ALU-02/MEC:creada', 'cuenta:ALU-01:creada:abc']);
  });

  it('altas_previas: solo altas completas del propio coach principal, sin contraseñas', async () => {
    const S1 = '00000000-0000-0000-0000-0000000a1a01';
    const S2 = '00000000-0000-0000-0000-0000000a1a02';
    await b.comoServicio(`insert into altas_cuentas (solicitud_id, coach_id, huella, estado, resultado) values
      ('${S1}', '${U.coach}', 'h', 'completa', '[{"usuario_id": "${U.diego}", "usuario": "diego.p2", "nombre": "Diego", "rol": "alumno"}]'),
      ('${S2}', '${U.coach}', 'h', 'incompleta', null)`);
    const r = await b.como<{ solicitud_id: string; resultado: { usuario: string }[] }>(U.coach, `select * from public.altas_previas(array['${S1}', '${S2}']::uuid[])`);
    expect(r).toEqual([{ solicitud_id: S1, resultado: [expect.objectContaining({ usuario: 'diego.p2' })] }]);
    for (const quien of [U.aux, U.ana, U.tutorAna]) {
      expect(await b.como(quien, `select * from public.altas_previas(array['${S1}']::uuid[])`), quien).toHaveLength(0);
    }
    expect(await b.falla(null, `select * from public.altas_previas(array['${S1}']::uuid[])`)).toMatch(/permission denied/);
  });
});
