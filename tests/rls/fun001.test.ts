// FUN-001 · el aviso de batería llena usa los mismos límites que el cliente:
// lunes 00:00 (incluido) a lunes siguiente 00:00 (excluido) en America/Merida. Datos ficticios.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
beforeAll(async () => {
  b = await crearBase();
}, 60_000);

// Semana del lunes 7 dic 2026 en Mérida: 2026-12-07T06:00Z a 2026-12-14T06:00Z (excluido).
const MECA = `(select id from public.areas where nombre = 'Mecánica')`;
async function tarea(id: string, fecha: string) {
  await b.db.exec(`insert into public.tareas (id, titulo, area_id, robot, estado, creada_por, fecha_limite)
    values ('${id}', 'Ficticia ${id.slice(-2)}', ${MECA}, 'VEX', 'en_revision', '${U.luis}', '${fecha}');
    insert into public.tarea_responsables values ('${id}', '${U.luis}');`);
}
const terminar = (id: string) => b.db.exec(`update public.tareas set estado = 'hecha' where id = '${id}'`);
const avisos = async () =>
  (await b.db.query<{ n: number }>(`select count(*)::int as n from public.avisos where usuario_id = '${U.luis}' and tipo = 'bateria'`)).rows[0].n;

const id = (n: number) => `00000000-0000-0000-0000-0000000f00${String(n).padStart(2, '0')}`;

describe('FUN-001 · aviso de batería con límites de semana de Mérida', () => {
  it('lunes 00:00 está dentro; el lunes siguiente no impide llenar la batería', async () => {
    await tarea(id(1), '2026-12-07T06:00:00Z'); // lunes 00:00 Mérida
    await tarea(id(2), '2026-12-14T06:00:00Z'); // lunes siguiente 00:00: otra semana
    await tarea(id(3), '2026-12-07T05:59:59Z'); // domingo anterior 23:59:59: otra semana
    const antes = await avisos();
    await terminar(id(1));
    expect(await avisos()).toBe(antes + 1);
  });

  it('el domingo 23:59:59 sí cuenta: mientras esté pendiente no hay aviso', async () => {
    await tarea(id(4), '2026-12-09T18:00:00Z'); // miércoles
    await tarea(id(5), '2026-12-14T05:59:59Z'); // domingo 23:59:59 Mérida
    const antes = await avisos();
    await terminar(id(4));
    expect(await avisos()).toBe(antes); // id(5) sigue pendiente en la misma semana
    await terminar(id(5));
    expect(await avisos()).toBe(antes + 1);
  });
});
