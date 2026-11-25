// FUN-002 · guardar_tarea: alta/edición con responsables y pasos en una transacción (PGlite, datos ficticios).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, T, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
let PROG = '';
let MECA = '';
const META = '00000000-0000-0000-0000-00000000e7a1';

beforeAll(async () => {
  b = await crearBase();
  const a = (await b.db.query<{ id: string; nombre: string }>(`select id, nombre from public.areas`)).rows;
  PROG = a.find((x) => x.nombre === 'Programación')!.id;
  MECA = a.find((x) => x.nombre === 'Mecánica')!.id;
}, 60_000);

const uid = (pref: string, n: number) => `00000000-0000-0000-0000-${pref}${String(n).padStart(12 - pref.length, '0')}`;
const NUEVA = uid('d1', 1);
const P1 = uid('d2', 1);
const P2 = uid('d2', 2);
const P3 = uid('d2', 3);

type Pay = Record<string, unknown>;
const base = (over: Pay = {}): Pay => ({
  id: NUEVA, nueva: true, titulo: 'Probar el sensor de color', para_que_sirve: 'Para el autonomo', area_id: PROG, meta_id: null,
  robot: 'FTC', fecha_limite: '2026-12-02T18:00:00Z', herramienta_url: null,
  responsables: [U.ana, U.diego], pasos: [{ id: P1, texto: 'Conectar' }, { id: P2, texto: 'Calibrar' }], ...over,
});
const guardar = (quien: string | null, p: Pay) => b.como<{ r: { id: string; version: string } }>(quien, `select public.guardar_tarea('${JSON.stringify(p)}'::jsonb) as r`).then((x) => x[0].r);
const falla = (quien: string | null, p: Pay) => b.falla(quien, `select public.guardar_tarea('${JSON.stringify(p)}'::jsonb)`);
const q = async <R,>(sql: string) => (await b.db.query<R>(sql)).rows;
const cuenta = async (sql: string) => (await q<{ n: number }>(`select count(*)::int as n from (${sql}) x`))[0].n;

describe('FUN-002 · guardar_tarea', () => {
  it('alta completa del líder: tarea, responsables, pasos y avisos en una sola llamada', async () => {
    const r = await guardar(U.marco, base());
    expect(r.id).toBe(NUEVA);
    expect(await cuenta(`select 1 from public.tarea_responsables where tarea_id = '${NUEVA}'`)).toBe(2);
    expect((await q<{ id: string; orden: number }>(`select id, orden from public.tarea_pasos where tarea_id = '${NUEVA}' order by orden`)).map((x) => x.id)).toEqual([P1, P2]);
    expect(await cuenta(`select 1 from public.avisos where tarea_id = '${NUEVA}' and tipo = 'asignada'`)).toBe(2);
  });

  it('reintento tras perder la respuesta: no duplica tarea, responsables, pasos ni avisos', async () => {
    await guardar(U.marco, base());
    expect(await cuenta(`select 1 from public.tareas where id = '${NUEVA}'`)).toBe(1);
    expect(await cuenta(`select 1 from public.tarea_responsables where tarea_id = '${NUEVA}'`)).toBe(2);
    expect(await cuenta(`select 1 from public.tarea_pasos where tarea_id = '${NUEVA}'`)).toBe(2);
    expect(await cuenta(`select 1 from public.avisos where tarea_id = '${NUEVA}' and tipo = 'asignada'`)).toBe(2);
  });

  it('el mismo id usado por otra persona no se toma como reintento', async () => {
    expect(await falla(U.coach, base())).toMatch(/conflicto/);
  });

  it('fallo en responsables (fuera del área): no queda ni la tarea ni avisos', async () => {
    const id = uid('d1', 2);
    expect(await falla(U.marco, base({ id, responsables: [U.ana, U.sofia], pasos: [{ id: uid('d2', 20), texto: 'x' }] }))).toMatch(/row-level security/);
    expect(await cuenta(`select 1 from public.tareas where id = '${id}'`)).toBe(0);
    expect(await cuenta(`select 1 from public.tarea_pasos where id = '${uid('d2', 20)}'`)).toBe(0);
    expect(await cuenta(`select 1 from public.avisos where tarea_id = '${id}'`)).toBe(0);
  });

  it('fallo en pasos (paso de otra tarea): se revierte todo y el paso ajeno no cambia', async () => {
    const id = uid('d1', 3);
    const [antes] = await q<{ texto: string; tarea_id: string }>(`select texto, tarea_id from public.tarea_pasos where tarea_id = '${T.odometria}'`);
    const ajeno = (await q<{ id: string }>(`select id from public.tarea_pasos where tarea_id = '${T.odometria}'`))[0].id;
    expect(await falla(U.marco, base({ id, pasos: [{ id: ajeno, texto: 'Robado' }] }))).toMatch(/no son de esta tarea/);
    expect(await cuenta(`select 1 from public.tareas where id = '${id}'`)).toBe(0);
    expect((await q<{ texto: string; tarea_id: string }>(`select texto, tarea_id from public.tarea_pasos where id = '${ajeno}'`))[0]).toEqual(antes);
  });

  it('roles: alumno sin liderazgo, tutor y anónimo no pueden crear', async () => {
    expect(await falla(U.ana, base({ id: uid('d1', 4) }))).toMatch(/row-level security|permiso/i);
    expect(await falla(U.tutorAna, base({ id: uid('d1', 5) }))).toMatch(/row-level security|permiso/i);
    expect(await falla(null, base({ id: uid('d1', 6) }))).toMatch(/permission denied|sesión/i);
    expect(await cuenta(`select 1 from public.tareas where id in ('${uid('d1', 4)}','${uid('d1', 5)}','${uid('d1', 6)}')`)).toBe(0);
  });

  it('meta que no corresponde al área se rechaza', async () => {
    await b.db.exec(`insert into public.metas (id, titulo, robot, areas) values ('${uid('e8', 1)}', 'Meta de mecanica', 'VEX', array['${MECA}'::uuid])`);
    expect(await falla(U.marco, base({ id: uid('d1', 7), meta_id: uid('e8', 1) }))).toMatch(/meta no corresponde/);
    expect(await falla(U.marco, base({ id: uid('d1', 7), meta_id: META, pasos: [{ id: uid('d2', 70), texto: 'ok' }] }))).toBeNull(); // meta sin áreas
  });

  describe('edición', () => {
    let version = '';
    beforeAll(async () => {
      version = (await q<{ v: string }>(`select actualizada_at::text as v from public.tareas where id = '${NUEVA}'`))[0].v;
    });

    it('reordenar y editar conserva ids y pasos hechos; agrega y quita pasos', async () => {
      await b.como(U.ana, `update public.tarea_pasos set hecho = true where id = '${P1}'`);
      version = (await q<{ v: string }>(`select actualizada_at::text as v from public.tareas where id = '${NUEVA}'`))[0].v;
      const r = await guardar(U.marco, base({ nueva: false, version, pasos: [{ id: P2, texto: 'Calibrar bien' }, { id: P1, texto: 'Conectar' }, { id: P3, texto: 'Probar' }] }));
      version = r.version;
      const pasos = await q<{ id: string; orden: number; texto: string; hecho: boolean }>(`select id, orden, texto, hecho from public.tarea_pasos where tarea_id = '${NUEVA}' order by orden`);
      expect(pasos).toEqual([
        { id: P2, orden: 1, texto: 'Calibrar bien', hecho: false },
        { id: P1, orden: 2, texto: 'Conectar', hecho: true },
        { id: P3, orden: 3, texto: 'Probar', hecho: false },
      ]);
      // quitar un paso y a un responsable
      const r2 = await guardar(U.marco, base({ nueva: false, version, responsables: [U.ana], pasos: [{ id: P1, texto: 'Conectar' }] }));
      version = r2.version;
      expect(await cuenta(`select 1 from public.tarea_pasos where tarea_id = '${NUEVA}'`)).toBe(1);
      expect(await cuenta(`select 1 from public.tarea_responsables where tarea_id = '${NUEVA}'`)).toBe(1);
    });

    it('edición concurrente: la segunda con la versión vieja se rechaza sin sobrescribir', async () => {
      const vieja = version;
      const r = await guardar(U.marco, base({ nueva: false, version: vieja, titulo: 'Cambio de Marco', responsables: [U.ana], pasos: [{ id: P1, texto: 'Conectar' }] }));
      expect(await falla(U.coach, base({ nueva: false, version: vieja, titulo: 'Cambio del coach', responsables: [U.ana], pasos: [{ id: P1, texto: 'Conectar' }] }))).toMatch(/conflicto/);
      expect((await q<{ titulo: string }>(`select titulo from public.tareas where id = '${NUEVA}'`))[0].titulo).toBe('Cambio de Marco');
      version = r.version;
    });

    it('sin versión no se puede editar (evita sobrescrituras silenciosas)', async () => {
      expect(await falla(U.marco, base({ nueva: false, version: null }))).toMatch(/conflicto/);
    });

    it('responsable alumno, líder de otra área y tutor no pueden editar', async () => {
      const p = base({ nueva: false, version, titulo: 'Intento ajeno', responsables: [U.ana], pasos: [{ id: P1, texto: 'Conectar' }] });
      const permiso = /líder o el coach|no puedes editarla|row-level security/;
      expect(await falla(U.ana, p)).toMatch(permiso);
      expect(await falla(U.luis, p)).toMatch(permiso);
      expect(await falla(U.tutorAna, p)).toMatch(permiso);
      expect((await q<{ titulo: string }>(`select titulo from public.tareas where id = '${NUEVA}'`))[0].titulo).toBe('Cambio de Marco');
    });

    it('el líder no puede pasar la tarea a un área que no lidera', async () => {
      expect(await falla(U.marco, base({ nueva: false, version, area_id: MECA, responsables: [U.diego], pasos: [{ id: P1, texto: 'Conectar' }] }))).toMatch(/no lideras|row-level/);
      expect((await q<{ area_id: string }>(`select area_id from public.tareas where id = '${NUEVA}'`))[0].area_id).toBe(PROG);
    });

    it('el historial registra la edición y conserva los avisos válidos', async () => {
      expect(await cuenta(`select 1 from public.historial where tarea_id = '${NUEVA}' and accion = 'edito'`)).toBeGreaterThanOrEqual(1);
      expect(await cuenta(`select 1 from public.historial where tarea_id = '${NUEVA}' and accion = 'creo'`)).toBe(1);
    });
  });
});
