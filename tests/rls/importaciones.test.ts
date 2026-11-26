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
    expect(await b.falla(U.coach, `insert into importaciones (id, archivo) values (gen_random_uuid(), 'x')`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select 1 from importaciones`)).toMatch(/permission denied/);
  });
});
