// Importar datos · ejecución por etapas con dependencias simuladas (sin red, datos ficticios).
import { describe, expect, it } from 'vitest';
import { revisar, type AltaPrevia, type Existentes, type Hoja } from '../../src/lib/importar';
import { ejecutar, type Deps } from '../../src/lib/importar-ejecutar';

const hoja: Hoja = {
  areas: [{ clave_area: 'MEC', nombre: 'Mecánica' }, { clave_area: 'PROG', nombre: 'Programación' }],
  cuentas: [
    { clave_persona: 'ALU-01', nombre_visible: 'Diego Pérez', usuario_deseado: '', rol: 'alumno' },
    { clave_persona: 'ALU-02', nombre_visible: 'Ana López', usuario_deseado: 'ana.l', rol: 'alumno' },
    { clave_persona: 'TUT-01', nombre_visible: 'Familia de Diego', usuario_deseado: 'diego.p', rol: 'tutor' },
  ],
  asignaciones: [
    { clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: 'lider' },
    { clave_persona: 'ALU-02', clave_area: 'PROG', rol_en_area: '' },
    { clave_persona: 'ALU-02', clave_area: 'MEC', rol_en_area: '' },
  ],
  tutorias: [{ clave_tutor: 'TUT-01', clave_alumno: 'ALU-01' }, { clave_tutor: 'TUT-01', clave_alumno: 'ALU-02' }],
  tareas: [
    { clave_tarea: 'TAR-01', titulo: 'Armar el chasis', clave_area: 'MEC', responsables: 'ALU-01, ALU-02', fecha_limite: '2026-12-05', robot: 'VEX', descripcion_opcional: 'Base del robot', pasos: 'Cortar; Atornillar' },
    { clave_tarea: 'TAR-02', titulo: 'Rutina autónoma', clave_area: 'PROG', responsables: 'ALU-02', fecha_limite: '', robot: '', descripcion_opcional: '', pasos: '' },
  ],
};

/** Base simulada: guarda lo que se crea y responde como la app (admin-accounts devuelve fichas). */
function base(fallar: { cuenta?: string; tarea?: string; registro?: string; ocupar?: string; perder?: string } = {}) {
  const db: Existentes = { areas: [{ id: 'a-prog', nombre: 'Programación' }], perfiles: [], membresias: [], tutorias: [], tareas: [] };
  const llamadas: string[] = [];
  const solicitudes = new Map<string, { usuario_id: string; usuario: string; rol: string }>(); // idempotencia de admin-accounts
  const registros: Record<string, unknown>[] = [];
  let n = 0;
  const responsablesDe = new Map<string, string[]>();
  const deps: Deps = {
    crearArea: async (a) => {
      llamadas.push(`area:${a.nombre}`);
      const id = `a-${++n}`;
      db.areas.push({ id, nombre: a.nombre });
      return id;
    },
    crearCuenta: async (c) => {
      llamadas.push(`cuenta:${c.usuario}`);
      if (fallar.cuenta === c.usuario) throw new Error('Sin internet (simulado)');
      const sol = String(c.solicitud_id);
      if (solicitudes.has(sol)) return { fichas: [], ya_creadas: [solicitudes.get(sol)!] };
      let usuario = String(c.usuario);
      if (fallar.ocupar === usuario) {
        // Otra persona tomó ese usuario entre la revisión y el alta: el servidor ajusta el nuestro
        db.perfiles.push({ id: 'p-ajena', usuario, nombre_visible: 'Otra Persona', rol_global: String(c.rol), activo: true });
        usuario = `${usuario}2`;
      }
      const id = `p-${++n}`;
      db.perfiles.push({ id, usuario, nombre_visible: String(c.nombre), rol_global: String(c.rol), activo: true });
      for (const m of (c.membresias as { area_id: string; es_lider: boolean }[]) ?? []) db.membresias.push({ usuario_id: id, ...m });
      if (c.alumno_id) db.tutorias.push({ tutor_id: id, alumno_id: String(c.alumno_id) });
      solicitudes.set(sol, { usuario_id: id, usuario, rol: String(c.rol) });
      if (fallar.perder === String(c.usuario)) { fallar.perder = undefined; throw new Error('Failed to fetch (simulado)'); }
      return { fichas: [{ usuario_id: id, usuario, password: 'cobre-123', nombre: String(c.nombre), rol: String(c.rol), vence: '2026-12-02' }] };
    },
    asignar: async (u, a, l) => {
      llamadas.push(`asignar:${u}:${a}:${l}`);
      db.membresias = db.membresias.filter((m) => !(m.usuario_id === u && m.area_id === a)).concat({ usuario_id: u, area_id: a, es_lider: l });
    },
    vincularTutor: async (t, a) => {
      llamadas.push(`tutor:${t}:${a}`);
      db.tutorias.push({ tutor_id: t, alumno_id: a });
    },
    guardarTarea: async (p) => {
      llamadas.push(`tarea:${p.titulo}`);
      if (fallar.tarea === p.titulo) throw new Error('conflicto simulado');
      if (!db.tareas.some((t) => t.id === p.id)) db.tareas.push({ id: String(p.id), titulo: String(p.titulo), area_id: String(p.area_id) });
      responsablesDe.set(String(p.titulo), p.responsables as string[]);
    },
    existentes: async () => structuredClone(db),
    registrar: async (etapa, resumen) => {
      llamadas.push(`registro:${etapa}`);
      registros.push(resumen);
      if (fallar.registro === etapa) throw new Error('Sin internet (simulado)');
      expect(JSON.stringify(resumen)).not.toMatch(/cobre-123|password/); // nunca contraseñas en el registro
    },
  };
  const altasPrevias = async (ids: string[]) => {
    const r: Record<string, AltaPrevia[]> = {};
    for (const id of ids) if (solicitudes.has(id)) r[id] = [solicitudes.get(id)!];
    return r;
  };
  return { db, deps, llamadas, registros, responsablesDe, altasPrevias };
}

describe('Importar · ejecución por etapas', async () => {
  it('carga todo en orden: áreas, cuentas con sus áreas, tutor con sus dos alumnos y tareas con responsables', async () => {
    const { db, deps, llamadas } = base();
    const plan = await revisar(hoja, await deps.existentes());
    expect(plan.bloquea).toBe(false);
    const avances: string[] = [];
    const r = await ejecutar(plan, deps, (a) => avances.push(`${a.etapa} ${a.hechas}/${a.total}`));
    expect(r.fallos).toEqual([]);
    expect(r.creados.areas).toEqual(['Mecánica']); // Programación ya existía
    expect(r.creados.cuentas.sort()).toEqual(['ana.l', 'diego.p', 'tutor.diego.p']);
    expect(r.fichas.map((f) => f.usuario).sort()).toEqual(['ana.l', 'diego.p', 'tutor.diego.p']);
    const id = (u: string) => db.perfiles.find((p) => p.usuario === u)!.id;
    const mec = db.areas.find((a) => a.nombre === 'Mecánica')!.id;
    expect(db.membresias).toContainEqual({ usuario_id: id('diego.p'), area_id: mec, es_lider: true });
    expect(db.membresias.filter((m) => m.usuario_id === id('ana.l')).map((m) => m.area_id).sort()).toEqual(['a-prog', mec].sort());
    expect(db.tutorias.sort((a, b) => a.alumno_id.localeCompare(b.alumno_id))).toEqual(
      [{ tutor_id: id('tutor.diego.p'), alumno_id: id('diego.p') }, { tutor_id: id('tutor.diego.p'), alumno_id: id('ana.l') }].sort((a, b) => a.alumno_id.localeCompare(b.alumno_id)),
    );
    expect(db.tareas.map((t) => t.titulo).sort()).toEqual(['Armar el chasis', 'Rutina autónoma']);
    // Orden de etapas: el área antes de las cuentas, las cuentas antes del tutor, todo antes de las tareas
    const pos = (s: string) => llamadas.findIndex((x) => x.startsWith(s));
    expect(pos('area:Mecánica')).toBeLessThan(pos('cuenta:diego.p'));
    expect(pos('cuenta:ana.l')).toBeLessThan(pos('cuenta:tutor.diego.p'));
    expect(pos('cuenta:tutor.diego.p')).toBeLessThan(pos('tarea:'));
    expect(llamadas.at(-1)).toBe('registro:terminado');
    expect(avances).toContain('tareas 2/2');
  });

  it('repetir la misma hoja no duplica nada: todo sale como existente y no se llama a crear', async () => {
    const { deps, llamadas } = base();
    await ejecutar(await revisar(hoja, await deps.existentes()), deps);
    llamadas.length = 0;
    const plan2 = await revisar(hoja, await deps.existentes());
    expect([...plan2.areas, ...plan2.cuentas, ...plan2.tareas].every((x) => x.estado === 'existente')).toBe(true);
    const r = await ejecutar(plan2, deps);
    expect(llamadas.filter((x) => /^(area|cuenta|tarea|tutor):/.test(x))).toEqual([]);
    expect(r.creados).toEqual({ areas: [], cuentas: [], asignaciones: [], tutorias: [], tareas: [] });
  });

  it('una fila que falla no detiene las demás; reintentar termina lo que faltó sin duplicar', async () => {
    const primera = base({ cuenta: 'ana.l' });
    const r1 = await ejecutar(await revisar(hoja, await primera.deps.existentes()), primera.deps);
    expect(r1.fallos.map((f) => f.clave)).toEqual(expect.arrayContaining(['ALU-02', 'TAR-01', 'TAR-02']));
    expect(r1.creados.cuentas.sort()).toEqual(['diego.p', 'tutor.diego.p']); // Diego y su tutor sí quedaron
    expect(primera.llamadas.at(-1)).toBe('registro:con_errores');
    // Segundo intento con la red bien, partiendo de lo que dejó el primero
    const reintento = base();
    Object.assign(reintento.db, structuredClone(primera.db));
    const r2 = await ejecutar(await revisar(hoja, await reintento.deps.existentes()), reintento.deps);
    expect(r2.fallos).toEqual([]);
    expect(r2.creados.cuentas).toEqual(['ana.l']);
    expect(reintento.db.perfiles.filter((p) => p.usuario === 'diego.p')).toHaveLength(1);
    expect(reintento.db.tareas.map((t) => t.titulo).sort()).toEqual(['Armar el chasis', 'Rutina autónoma']);
  });

  it('una hoja con errores no se ejecuta', async () => {
    const { deps } = base();
    const mala = await revisar({ ...hoja, tareas: [{ clave_tarea: 'X', titulo: 'ab', clave_area: 'MEC', responsables: '', fecha_limite: '', robot: '', descripcion_opcional: '', pasos: '' }] }, await deps.existentes());
    await expect(ejecutar(mala, deps)).rejects.toThrow(/errores/);
  });

  it('si el servidor ajusta el usuario, todo se vincula con el id que devolvió, nunca con quien tiene ese usuario', async () => {
    const { db, deps, responsablesDe } = base({ ocupar: 'diego.p' });
    const r = await ejecutar(await revisar(hoja, await deps.existentes()), deps);
    expect(r.fallos).toEqual([]);
    const nuestro = db.perfiles.find((p) => p.usuario === 'diego.p2')!.id;
    expect(responsablesDe.get('Armar el chasis')).toContain(nuestro);
    expect(responsablesDe.get('Armar el chasis')).not.toContain('p-ajena');
    expect(db.membresias.some((m) => m.usuario_id === 'p-ajena')).toBe(false);
    expect(db.tutorias.some((t) => t.alumno_id === 'p-ajena')).toBe(false);
    expect(db.tutorias).toContainEqual(expect.objectContaining({ alumno_id: nuestro }));
  });

  it('respuesta perdida: con el mismo plan, el servidor devuelve ya_creadas y se usan esos ids (sin duplicar ni fichas nuevas)', async () => {
    const { db, deps, responsablesDe } = base();
    const plan = await revisar(hoja, await deps.existentes());
    await ejecutar(plan, deps);
    const antes = db.perfiles.length;
    const r = await ejecutar(plan, deps); // plan viejo: aún dice que las cuentas son nuevas
    expect(db.perfiles).toHaveLength(antes);
    expect(r.fichas).toEqual([]);
    expect(r.recuperadas.sort()).toEqual(['ana.l', 'diego.p', 'tutor.diego.p']);
    expect(r.fallos).toEqual([]);
    expect(responsablesDe.get('Rutina autónoma')).toEqual([db.perfiles.find((p) => p.usuario === 'ana.l')!.id]);
  });

  it('si el registro falla al final, la carga y las fichas siguen; el registro solo lleva códigos, no mensajes', async () => {
    const { deps, registros } = base({ registro: 'con_errores', tarea: 'Rutina autónoma' });
    const r = await ejecutar(await revisar(hoja, await deps.existentes()), deps);
    expect(r.registroFallo).toBe(true);
    expect(r.fichas.length).toBe(3);
    const ultimo = registros.at(-1) as { fallos: string[] };
    expect(ultimo.fallos).toEqual(['tareas:TAR-02:conflicto']);
    expect(JSON.stringify(registros)).not.toMatch(/simulado/);
  });

  it('reanudar de verdad: usuario ajustado, respuesta perdida, se cierra la app y se vuelve a subir la hoja', async () => {
    const { db, deps, responsablesDe, altasPrevias } = base({ ocupar: 'diego.p', perder: 'diego.p' });
    const r1 = await ejecutar(await revisar(hoja, await deps.existentes()), deps);
    expect(r1.fallos.map((f) => f.clave)).toContain('ALU-01');
    // Nueva sesión: se reconstruye el plan desde cero con lo que hay en la base
    const plan = await revisar(hoja, await deps.existentes(), { coachPrincipal: true, altasPrevias });
    expect(plan.bloquea).toBe(false);
    const nuestro = db.perfiles.find((p) => p.usuario === 'diego.p2')!.id;
    expect(plan.cuentas[0]).toMatchObject({ estado: 'existente', id: nuestro });
    const antes = db.perfiles.length;
    const r2 = await ejecutar(plan, deps);
    expect(r2.fallos).toEqual([]);
    expect(db.perfiles).toHaveLength(antes); // el tutor ya se creó con Ana en el primer intento: nada nuevo
    expect(responsablesDe.get('Armar el chasis')).toContain(nuestro);
    expect(db.tutorias).toContainEqual(expect.objectContaining({ alumno_id: nuestro }));
    expect(db.membresias.some((m) => m.usuario_id === 'p-ajena')).toBe(false);
  });

  it('si falla la relectura tras un alta, el resultado parcial y las fichas siguen visibles', async () => {
    const { deps } = base();
    let lecturas = 0;
    const leer = deps.existentes;
    deps.existentes = async () => {
      if (++lecturas > 1) throw new Error('Failed to fetch (simulado)');
      return leer();
    };
    const r = await ejecutar(await revisar(hoja, await leer()), deps);
    expect(r.fichas.map((f) => f.usuario).sort()).toEqual(['ana.l', 'diego.p', 'tutor.diego.p']);
    expect(r.creados.tareas).toHaveLength(2);
  });
});
