// QA-001 · Migraciones nuevas (20261126*) sobre una copia SINTÉTICA del esquema anterior y reaplicación.
// La base vacía ya se valida en cada suite (crearBase aplica todas las migraciones desde cero).
import { describe, expect, it } from 'vitest';
import { aplicar, crearBase, migraciones, T, U } from './pglite';

const NUEVAS = '20261126000007';

describe('QA-001 · migraciones', () => {
  it('se aplican sobre el esquema anterior con datos y los conservan', async () => {
    const b = await crearBase({
      antesDe: NUEVAS,
      entre: async (db) => {
        // Datos del esquema viejo: una felicitación existente y un contador del bloqueo anterior
        await db.exec(`insert into public.felicitaciones (tarea_id, usuario_id) values ('${T.torre}', '${U.diego}');
                       insert into public.intentos_login (usuario, fallidos) values ('ana.l', 3);`);
      },
    });
    expect((await b.db.query(`select 1 from public.felicitaciones where tarea_id = '${T.torre}' and usuario_id = '${U.diego}'`)).rows).toHaveLength(1);
    expect((await b.db.query(`select fallidos from public.intentos_login where usuario = 'ana.l'`)).rows).toEqual([{ fallidos: 3 }]);
    // Las funciones nuevas existen y la app sigue leyendo lo viejo
    for (const f of ['felicitar', 'reservar_intento', 'liquidar_intento', 'guardar_tarea', 'completar_alta', 'iniciar_alta']) {
      expect((await b.db.query(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${f}'`)).rows.length).toBeGreaterThan(0);
    }
    expect(await b.como(U.diego, `select tarea_id from felicitaciones where tarea_id = '${T.torre}'`)).toHaveLength(1);
    // La recuperación del coach también limpia el contador viejo
    await b.comoServicio(`select public.desbloquear_usuario('ana.l')`);
    expect((await b.db.query(`select 1 from public.intentos_login where usuario = 'ana.l'`)).rows).toHaveLength(0);
  }, 60_000);

  it('reaplicar las migraciones nuevas no falla ni duplica (despliegue repetido)', async () => {
    const b = await crearBase();
    const nuevas = migraciones().filter((f) => f >= NUEVAS);
    expect(nuevas.length).toBeGreaterThanOrEqual(4);
    await aplicar(b.db, nuevas);
    expect((await b.db.query(`select count(*)::int as n from pg_policies where tablename = 'felicitaciones' and cmd in ('INSERT', 'DELETE')`)).rows).toEqual([{ n: 0 }]);
    expect(await b.falla(U.marco, `insert into felicitaciones (tarea_id, usuario_id) values ('${T.garra}', '${U.marco}')`)).toMatch(/permission denied/);
  }, 60_000);

  it('las migraciones nuevas son aditivas (no borran tablas ni columnas)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const f of migraciones().filter((x) => x >= NUEVAS)) {
      // Se ignoran los cuerpos de función ($$ … $$): ahí un delete es lógica de la app, no un cambio de datos al migrar
      const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', f), 'utf8').toLowerCase().replace(/\$\$[\s\S]*?\$\$/g, '$$$$');
      expect(sql, f).not.toMatch(/drop\s+table|drop\s+column|truncate|delete\s+from\s+public\.(tareas|profiles|felicitaciones|membresias)/);
    }
  });
});
