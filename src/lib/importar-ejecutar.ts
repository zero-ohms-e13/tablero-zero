// Ejecuta un plan revisado (lib/importar.ts) por etapas: áreas → cuentas y asignaciones → tutorías → tareas.
// Usa los mismos caminos que la app: admin-accounts para crear cuentas (fichas con contraseña temporal),
// RLS del coach para áreas, asignaciones y tutorías, y guardar_tarea para tareas.
// Idempotente: cada fila usa un id estable (repetir la carga no duplica) y, tras crear cuentas, se vuelve a
// leer lo existente. Una fila que falla se reporta y no detiene las demás.
import { idEstable, type Existentes, type Plan } from './importar';
import type { Ficha } from './datos';

export type Deps = {
  crearArea: (a: { nombre: string; color: string; color_claro: string; icono: string; orden: number }) => Promise<string>;
  crearCuenta: (cuerpo: Record<string, unknown>) => Promise<{ fichas: Ficha[]; ya_creadas?: { usuario: string }[] }>;
  asignar: (usuario_id: string, area_id: string, es_lider: boolean) => Promise<void>;
  vincularTutor: (tutor_id: string, alumno_id: string) => Promise<void>;
  guardarTarea: (p: Record<string, unknown>) => Promise<void>;
  existentes: () => Promise<Existentes>;
  registrar: (etapa: 'en_curso' | 'terminado' | 'con_errores', resumen: Record<string, unknown>) => Promise<void>;
};
export type Etapa = 'areas' | 'cuentas' | 'tutorias' | 'tareas';
export type Avance = { etapa: Etapa; hechas: number; total: number };
export type Resultado = {
  fichas: Ficha[];
  creados: { areas: string[]; cuentas: string[]; asignaciones: string[]; tutorias: string[]; tareas: string[] };
  fallos: { etapa: Etapa; clave: string; mensaje: string }[];
};

const PALETA: [string, string, string][] = [
  ['#2F5D8A', '#E2EAF3', 'codigo'], ['#7A3E06', '#F6E3CC', 'engrane'], ['#2E5A36', '#E1ECE2', 'camara'],
  ['#8A3B6B', '#F1E0EA', 'estrella'], ['#5A4335', '#EFE6DD', 'megafono'], ['#590202', '#F6D6D6', 'rayo'],
];

export async function ejecutar(plan: Plan, deps: Deps, avance: (a: Avance) => void = () => {}): Promise<Resultado> {
  if (plan.bloquea) throw new Error('La hoja tiene errores: corrígelos antes de cargar.');
  const r: Resultado = { fichas: [], creados: { areas: [], cuentas: [], asignaciones: [], tutorias: [], tareas: [] }, fallos: [] };
  const falla = (etapa: Etapa, clave: string, e: unknown) => r.fallos.push({ etapa, clave, mensaje: (e as Error).message ?? String(e) });
  await deps.registrar('en_curso', {});

  // ---------- 1. Áreas ----------
  let ex = await deps.existentes();
  const areaId = new Map<string, string>(); // clave (mayúsculas) → id
  for (const a of plan.areas) if (a.id) areaId.set(a.clave.toUpperCase(), a.id);
  const nuevasAreas = plan.areas.filter((a) => a.estado === 'nueva');
  let orden = ex.areas.length;
  for (const [i, a] of nuevasAreas.entries()) {
    try {
      const ya = ex.areas.find((x) => x.nombre.toLowerCase() === a.nombre.toLowerCase()); // reintento: ya se creó
      const [color, color_claro, icono] = PALETA[(orden + i) % PALETA.length];
      const id = ya?.id ?? (await deps.crearArea({ nombre: a.nombre, color, color_claro, icono, orden: ++orden }));
      areaId.set(a.clave.toUpperCase(), id);
      if (!ya) r.creados.areas.push(a.nombre);
    } catch (e) {
      falla('areas', a.clave, e);
    }
    avance({ etapa: 'areas', hechas: i + 1, total: nuevasAreas.length });
  }
  // Áreas de la app nombradas directamente en otras pestañas
  for (const x of ex.areas) if (!areaId.has(x.nombre.toUpperCase())) areaId.set(x.nombre.toUpperCase(), x.id);
  const idDeArea = (clave: string) => areaId.get(clave.toUpperCase());
  await deps.registrar('en_curso', { areas: r.creados.areas });

  // ---------- 2. Cuentas (alumnos y mentores; los tutores después, con su alumno) y asignaciones ----------
  const personaId = new Map<string, string>(); // clave → id
  for (const c of plan.cuentas) if (c.id) personaId.set(c.clave.toUpperCase(), c.id);
  const nuevas = plan.cuentas.filter((c) => c.estado === 'nueva' && c.rol !== 'tutor');
  for (const [i, c] of nuevas.entries()) {
    try {
      const membresias = c.membresias.map((m) => ({ area_id: idDeArea(m.clave_area), es_lider: m.es_lider }));
      if (membresias.some((m) => !m.area_id)) throw new Error('Falta un área (no se creó en la etapa anterior).');
      const res = await deps.crearCuenta({
        accion: 'crear', solicitud_id: await idEstable(`cuenta|${c.clave}|${c.usuario}|${c.nombre}`),
        nombre: c.nombre, usuario: c.usuario, rol: c.rol, membresias, con_tutor: false,
      });
      const propia = res.fichas.find((f) => f.rol === c.rol) ?? res.fichas[0];
      if (propia) {
        personaId.set(c.clave.toUpperCase(), propia.usuario_id);
        r.fichas.push(...res.fichas);
        r.creados.cuentas.push(propia.usuario);
      }
    } catch (e) {
      falla('cuentas', c.clave, e);
    }
    avance({ etapa: 'cuentas', hechas: i + 1, total: nuevas.length });
  }
  // Releer: ids de cuentas que ya se habían creado en un intento anterior (o cuyo usuario ajustó el servidor)
  ex = await deps.existentes();
  for (const c of plan.cuentas) {
    if (personaId.has(c.clave.toUpperCase())) continue;
    const p = ex.perfiles.find((x) => x.usuario === c.usuario);
    if (p) personaId.set(c.clave.toUpperCase(), p.id);
  }
  // Asignaciones que faltan (cuentas que ya existían, o áreas agregadas a alguien existente)
  for (const c of plan.cuentas.filter((x) => x.rol === 'alumno' && x.estado === 'existente')) {
    const uid = personaId.get(c.clave.toUpperCase());
    if (!uid) continue;
    for (const m of c.membresias) {
      const aid = idDeArea(m.clave_area);
      if (!aid) continue;
      const ya = ex.membresias.find((x) => x.usuario_id === uid && x.area_id === aid);
      if (ya && ya.es_lider === m.es_lider) continue;
      try {
        await deps.asignar(uid, aid, m.es_lider);
        r.creados.asignaciones.push(`${c.usuario} → ${m.clave_area}${m.es_lider ? ' (líder)' : ''}`);
      } catch (e) {
        falla('cuentas', c.clave, e);
      }
    }
  }
  await deps.registrar('en_curso', { cuentas: r.creados.cuentas, asignaciones: r.creados.asignaciones });

  // ---------- 3. Tutores y tutorías ----------
  const tutorias = plan.tutorias.filter((t) => t.estado === 'nueva');
  const tutoresNuevos = plan.cuentas.filter((c) => c.estado === 'nueva' && c.rol === 'tutor');
  for (const [i, t] of tutoresNuevos.entries()) {
    try {
      if (personaId.has(t.clave.toUpperCase())) continue; // ya creado en un intento anterior
      const primero = tutorias.find((x) => x.clave_tutor.toUpperCase() === t.clave.toUpperCase());
      const alumno = primero && personaId.get(primero.clave_alumno.toUpperCase());
      if (!alumno) throw new Error('Su alumno no quedó creado; reintenta la carga.');
      const res = await deps.crearCuenta({
        accion: 'crear', solicitud_id: await idEstable(`cuenta|${t.clave}|${t.usuario}|${t.nombre}`),
        nombre: t.nombre, usuario: t.usuario, rol: 'tutor', alumno_id: alumno, color: '#5A4335',
      });
      const propia = res.fichas.find((f) => f.rol === 'tutor');
      if (propia) {
        personaId.set(t.clave.toUpperCase(), propia.usuario_id);
        r.fichas.push(...res.fichas);
        r.creados.cuentas.push(propia.usuario);
        r.creados.tutorias.push(`${t.clave} → ${primero.clave_alumno}`); // el primer vínculo se crea junto con la cuenta
      }
    } catch (e) {
      falla('tutorias', t.clave, e);
    }
    avance({ etapa: 'tutorias', hechas: i + 1, total: tutoresNuevos.length + tutorias.length });
  }
  ex = await deps.existentes();
  for (const c of tutoresNuevos) {
    if (!personaId.has(c.clave.toUpperCase())) {
      const p = ex.perfiles.find((x) => x.usuario === c.usuario);
      if (p) personaId.set(c.clave.toUpperCase(), p.id);
    }
  }
  for (const [i, t] of tutorias.entries()) {
    const tid = personaId.get(t.clave_tutor.toUpperCase());
    const aid = personaId.get(t.clave_alumno.toUpperCase());
    try {
      if (!tid || !aid) throw new Error('Falta el tutor o el alumno.');
      if (!ex.tutorias.some((x) => x.tutor_id === tid && x.alumno_id === aid)) {
        await deps.vincularTutor(tid, aid);
        r.creados.tutorias.push(`${t.clave_tutor} → ${t.clave_alumno}`);
      }
    } catch (e) {
      falla('tutorias', `${t.clave_tutor}/${t.clave_alumno}`, e);
    }
    avance({ etapa: 'tutorias', hechas: tutoresNuevos.length + i + 1, total: tutoresNuevos.length + tutorias.length });
  }
  await deps.registrar('en_curso', { cuentas: r.creados.cuentas, tutorias: r.creados.tutorias });

  // ---------- 4. Tareas ----------
  const tareas = plan.tareas.filter((t) => t.estado === 'nueva');
  for (const [i, t] of tareas.entries()) {
    try {
      const area_id = idDeArea(t.clave_area);
      const responsables = t.responsables.map((c) => personaId.get(c.toUpperCase()));
      if (!area_id) throw new Error('Su área no quedó creada.');
      if (responsables.some((x) => !x)) throw new Error('Algún responsable no quedó creado.');
      const id = await idEstable(`tarea|${t.clave}|${t.titulo}|${t.clave_area}`);
      await deps.guardarTarea({
        id, nueva: true, guardado: await idEstable(`guardado|${id}`), titulo: t.titulo, para_que_sirve: t.para_que_sirve,
        area_id, meta_id: null, robot: t.robot, fecha_limite: t.fecha_limite, herramienta_url: null, responsables,
        pasos: await Promise.all(t.pasos.map(async (texto, n) => ({ id: await idEstable(`paso|${id}|${n}`), texto }))),
      });
      r.creados.tareas.push(t.titulo);
    } catch (e) {
      falla('tareas', t.clave, e);
    }
    avance({ etapa: 'tareas', hechas: i + 1, total: tareas.length });
  }

  await deps.registrar(r.fallos.length ? 'con_errores' : 'terminado', {
    ...r.creados,
    fallos: r.fallos.map((f) => `${f.etapa}: ${f.clave}: ${f.mensaje}`),
  });
  return r;
}
