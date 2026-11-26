// Ejecuta un plan revisado (lib/importar.ts) por etapas: áreas → cuentas y asignaciones → tutorías → tareas.
// Usa los mismos caminos que la app: admin-accounts para crear cuentas (fichas con contraseña temporal),
// RLS del coach para áreas, asignaciones y tutorías, y guardar_tarea para tareas.
// Identidad: una cuenta nueva se vincula SOLO con el usuario_id que devuelve el servidor (fichas o
// ya_creadas de la misma solicitud), nunca buscando por usuario: si el servidor ajustó el usuario, o si ese
// usuario es de otra persona, no se cruzan. Si no se puede confirmar, sus asignaciones, tutorías y tareas
// fallan en lugar de ir a otra persona.
// Idempotente: ids estables por fila; repetir la carga no duplica. Una fila que falla no detiene las demás.
// Registro: solo campos definidos (claves de fila, nombres de lo creado y un código de error); nunca
// contraseñas ni mensajes crudos. Si el registro falla a mitad, la carga sigue y las fichas se muestran igual.
import { idEstable, solicitudCuenta, type Existentes, type Plan } from './importar';
import type { Ficha } from './datos';

export type CuentaCreada = { usuario_id: string; usuario: string; rol: string };
export type Deps = {
  crearArea: (a: { nombre: string; color: string; color_claro: string; icono: string; orden: number }) => Promise<string>;
  crearCuenta: (cuerpo: Record<string, unknown>) => Promise<{ fichas: Ficha[]; ya_creadas?: CuentaCreada[] }>;
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
  /** cuentas que ya se habían creado en un intento anterior (sin ficha: se reinicia su contraseña en Cuentas) */
  recuperadas: string[];
  fallos: { etapa: Etapa; clave: string; mensaje: string }[];
  /** cada escritura confirmada: "tipo:clave:resultado[:id]" (para el registro del lote) */
  filas: string[];
  /** true si no se pudo guardar el registro del lote (la carga sí se hizo) */
  registroFallo: boolean;
};

const PALETA: [string, string, string][] = [
  ['#2F5D8A', '#E2EAF3', 'codigo'], ['#7A3E06', '#F6E3CC', 'engrane'], ['#2E5A36', '#E1ECE2', 'camara'],
  ['#8A3B6B', '#F1E0EA', 'estrella'], ['#5A4335', '#EFE6DD', 'megafono'], ['#590202', '#F6D6D6', 'rayo'],
];

/** Código corto para el registro (el mensaje completo solo se muestra en pantalla). */
export function codigoError(mensaje: string): string {
  if (/fetch|network|internet|conexi|timeout|503|502|504/i.test(mensaje)) return 'red';
  if (/409|ya se usó|en curso|procesando|duplicate|conflict/i.test(mensaje)) return 'conflicto';
  if (/permis|401|403|solo el coach|denied/i.test(mensaje)) return 'permiso';
  if (/falta|no quedó|no se pudo confirmar/i.test(mensaje)) return 'dependencia';
  return 'error';
}

export async function ejecutar(plan: Plan, deps: Deps, avance: (a: Avance) => void = () => {}): Promise<Resultado> {
  if (plan.bloquea) throw new Error('La hoja tiene errores: corrígelos antes de cargar.');
  const r: Resultado = { fichas: [], creados: { areas: [], cuentas: [], asignaciones: [], tutorias: [], tareas: [] }, recuperadas: [], fallos: [], filas: [], registroFallo: false };
  const falla = (etapa: Etapa, clave: string, e: unknown) => r.fallos.push({ etapa, clave, mensaje: (e as Error)?.message ?? String(e) });
  // El primer registro sí es obligatorio (aún no se creó nada); los siguientes no detienen la carga.
  await deps.registrar('en_curso', {});
  const registrar = async (etapa: 'en_curso' | 'terminado' | 'con_errores', resumen: Record<string, unknown>) => {
    try {
      await deps.registrar(etapa, resumen);
    } catch {
      r.registroFallo = true;
    }
  };

  let etapa: Etapa = 'areas';
  try {
    // ---------- 1. Áreas ----------
    const ex = await deps.existentes();
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
        r.filas.push(`area:${a.clave}:${ya ? 'existia' : 'creada'}:${id}`);
      } catch (e) {
        falla('areas', a.clave, e);
      }
      avance({ etapa: 'areas', hechas: i + 1, total: nuevasAreas.length });
    }
    // Áreas de la app nombradas directamente en otras pestañas
    for (const x of ex.areas) if (!areaId.has(x.nombre.toUpperCase())) areaId.set(x.nombre.toUpperCase(), x.id);
    const idDeArea = (clave: string) => areaId.get(clave.toUpperCase());
    await registrar('en_curso', { areas: r.creados.areas });

    // ---------- Cuentas: el id sale SOLO de la respuesta del servidor ----------
    const personaId = new Map<string, string>(); // clave → id
    for (const c of plan.cuentas) if (c.estado === 'existente' && c.id) personaId.set(c.clave.toUpperCase(), c.id);
    async function alta(c: Plan['cuentas'][number], cuerpo: Record<string, unknown>) {
      const res = await deps.crearCuenta({
        accion: 'crear', solicitud_id: await solicitudCuenta(c),
        nombre: c.nombre, usuario: c.usuario, rol: c.rol, ...cuerpo,
      });
      const propia = res.fichas.find((f) => f.rol === c.rol);
      const previa = res.ya_creadas?.find((f) => f.rol === c.rol);
      const id = propia?.usuario_id ?? previa?.usuario_id;
      if (!id) throw new Error('No se pudo confirmar la cuenta creada; reintenta la carga.');
      personaId.set(c.clave.toUpperCase(), id);
      r.fichas.push(...res.fichas);
      if (propia) r.creados.cuentas.push(propia.usuario);
      else if (previa) r.recuperadas.push(previa.usuario);
      r.filas.push(`cuenta:${c.clave}:${propia ? 'creada' : 'recuperada'}:${id}`);
    }

    etapa = 'cuentas';
    // ---------- 2. Alumnos y mentores nuevos (con sus áreas) y asignaciones de cuentas existentes ----------
    const nuevas = plan.cuentas.filter((c) => c.estado === 'nueva' && c.rol !== 'tutor');
    for (const [i, c] of nuevas.entries()) {
      try {
        const membresias = c.membresias.map((m) => ({ area_id: idDeArea(m.clave_area), es_lider: m.es_lider }));
        if (membresias.some((m) => !m.area_id)) throw new Error('Falta un área (no se creó en la etapa anterior).');
        await alta(c, { membresias, con_tutor: false });
      } catch (e) {
        falla('cuentas', c.clave, e);
      }
      avance({ etapa: 'cuentas', hechas: i + 1, total: nuevas.length });
    }
    const deNueva = (clave: string) => plan.cuentas.some((c) => c.estado === 'nueva' && c.clave.toUpperCase() === clave.toUpperCase());
    for (const a of plan.asignaciones.filter((x) => (x.estado === 'nueva' || x.estado === 'cambio') && !deNueva(x.clave_persona))) {
      const uid = personaId.get(a.clave_persona.toUpperCase());
      const aid = idDeArea(a.clave_area);
      try {
        if (!uid || !aid) throw new Error('Falta la persona o el área.');
        await deps.asignar(uid, aid, a.es_lider);
        r.creados.asignaciones.push(`${a.clave_persona} → ${a.clave_area}${a.es_lider ? ' (líder)' : ''}`);
        r.filas.push(`asignacion:${a.clave_persona}/${a.clave_area}:${a.estado === 'cambio' ? 'cambiada' : 'creada'}`);
      } catch (e) {
        falla('cuentas', `${a.clave_persona}/${a.clave_area}`, e);
      }
    }
    await registrar('en_curso', { cuentas: r.creados.cuentas, asignaciones: r.creados.asignaciones });

    etapa = 'tutorias';
    // ---------- 3. Tutores (se crean con su primer alumno) y tutorías ----------
    const tutorias = plan.tutorias.filter((t) => t.estado === 'nueva');
    const tutoresNuevos = plan.cuentas.filter((c) => c.estado === 'nueva' && c.rol === 'tutor');
    const vinculados = new Set<string>(); // "tutor|alumno" (claves) ya resueltos al crear al tutor
    for (const [i, t] of tutoresNuevos.entries()) {
      try {
        const primero = tutorias.find((x) => x.clave_tutor.toUpperCase() === t.clave.toUpperCase() && personaId.has(x.clave_alumno.toUpperCase()));
        if (!primero) throw new Error('Su alumno no quedó creado; reintenta la carga.');
        await alta(t, { alumno_id: personaId.get(primero.clave_alumno.toUpperCase()), color: '#5A4335' });
        vinculados.add(`${t.clave}|${primero.clave_alumno}`.toUpperCase());
        r.creados.tutorias.push(`${t.clave} → ${primero.clave_alumno}`);
      } catch (e) {
        falla('tutorias', t.clave, e);
      }
      avance({ etapa: 'tutorias', hechas: i + 1, total: tutoresNuevos.length + tutorias.length });
    }
    // Releer para no repetir vínculos; si falla, se usa lo leído al inicio (vincular es idempotente)
    const ex2 = await deps.existentes().catch(() => ex);
    for (const [i, t] of tutorias.entries()) {
      const tid = personaId.get(t.clave_tutor.toUpperCase());
      const aid = personaId.get(t.clave_alumno.toUpperCase());
      try {
        if (!vinculados.has(`${t.clave_tutor}|${t.clave_alumno}`.toUpperCase())) {
          if (!tid || !aid) throw new Error('Falta el tutor o el alumno.');
          if (!ex2.tutorias.some((x) => x.tutor_id === tid && x.alumno_id === aid)) {
            await deps.vincularTutor(tid, aid);
            r.creados.tutorias.push(`${t.clave_tutor} → ${t.clave_alumno}`);
            r.filas.push(`tutoria:${t.clave_tutor}/${t.clave_alumno}:creada`);
          }
        }
      } catch (e) {
        falla('tutorias', `${t.clave_tutor}/${t.clave_alumno}`, e);
      }
      avance({ etapa: 'tutorias', hechas: tutoresNuevos.length + i + 1, total: tutoresNuevos.length + tutorias.length });
    }
    await registrar('en_curso', { cuentas: r.creados.cuentas, tutorias: r.creados.tutorias });

    etapa = 'tareas';
    // ---------- 4. Tareas ----------
    const tareas = plan.tareas.filter((t) => t.estado === 'nueva');
    for (const [i, t] of tareas.entries()) {
      try {
        const area_id = idDeArea(t.clave_area);
        const responsables = t.responsables.map((c) => personaId.get(c.toUpperCase()));
        if (!area_id) throw new Error('Su área no quedó creada.');
        if (responsables.some((x) => !x)) throw new Error('Algún responsable no quedó creado.');
        await deps.guardarTarea({
          id: t.id, nueva: true, guardado: await idEstable(`guardado|${t.id}`), titulo: t.titulo, para_que_sirve: t.para_que_sirve,
          area_id, meta_id: null, robot: t.robot, fecha_limite: t.fecha_limite, herramienta_url: null, responsables,
          pasos: await Promise.all(t.pasos.map(async (texto, n) => ({ id: await idEstable(`paso|${t.id}|${n}`), texto }))),
        });
        r.creados.tareas.push(t.titulo);
        r.filas.push(`tarea:${t.clave}:creada:${t.id}`);
      } catch (e) {
        falla('tareas', t.clave, e);
      }
      avance({ etapa: 'tareas', hechas: i + 1, total: tareas.length });
    }
  } catch (e) {
    falla(etapa, 'lote', e); // error inesperado: se conserva y se muestra todo lo hecho hasta aquí
  }

  await registrar(r.fallos.length ? 'con_errores' : 'terminado', {
    ...r.creados,
    recuperadas: r.recuperadas,
    filas: r.filas,
    fallos: r.fallos.map((f) => `${f.etapa}:${f.clave}:${codigoError(f.mensaje)}`),
  });
  return r;
}
