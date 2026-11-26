// Importar datos reales desde una hoja (Excel / Google Sheets exportado a .xlsx).
// Este módulo es PURO (sin red): normaliza la hoja, la cruza con lo que ya existe y produce un plan con
// el estado de cada fila (nueva, existente, conflicto o inválida). Nada se escribe aquí: la pantalla de
// importación ejecuta el plan por etapas (áreas → cuentas y asignaciones → tareas) con los mismos
// caminos de la app (admin-accounts, RLS del coach y guardar_tarea).
import { usuarioDesdeNombre } from './cuentas';

export type Fila = Record<string, string>;
export type Hoja = { areas: Fila[]; cuentas: Fila[]; asignaciones: Fila[]; tutorias: Fila[]; tareas: Fila[] };
export type Existentes = {
  areas: { id: string; nombre: string }[];
  perfiles: { id: string; usuario: string; nombre_visible: string; rol_global: string; activo: boolean }[];
  membresias: { usuario_id: string; area_id: string; es_lider: boolean }[];
  tutorias: { tutor_id: string; alumno_id: string }[];
  tareas: { id: string; titulo: string; area_id: string; fecha_limite?: string | null; robot?: string }[];
};
export type EstadoFila = 'nueva' | 'existente' | 'cambio' | 'conflicto' | 'invalida';
export type Problema = { hoja: NombreHoja; fila: number; mensaje: string; grave: boolean };
export type NombreHoja = 'Áreas' | 'Cuentas' | 'Asignaciones' | 'Tutorías' | 'Tareas';
export type RolCuenta = 'alumno' | 'tutor' | 'coach_aux';
/** Cuenta que admin-accounts ya creó con esa solicitud (respuesta guardada en el servidor, sin contraseña). */
export type AltaPrevia = { usuario_id: string; usuario: string; rol: string };
export type OpcionesRevision = {
  coachPrincipal: boolean;
  /** Busca altas ya completadas por solicitud (para reanudar una carga cuya respuesta se perdió). */
  altasPrevias?: (solicitudes: string[]) => Promise<Record<string, AltaPrevia[]>>;
};

export type AreaPlan = { fila: number; clave: string; nombre: string; estado: EstadoFila; id?: string };
export type CuentaPlan = {
  fila: number; clave: string; nombre: string; usuario: string; rol: RolCuenta; estado: EstadoFila; id?: string;
  membresias: { clave_area: string; es_lider: boolean }[]; // para alumnos (nuevos o existentes)
  /** creada en una carga anterior (se reconoció por su solicitud): el registro lo anota como recuperada */
  recuperada?: { usuario: string };
};
/** Alumno ↔ área. 'nueva' en una cuenta nueva se crea junto con la cuenta; 'cambio' = cambia líder/integrante. */
export type AsignacionPlan = { fila: number; clave_persona: string; clave_area: string; es_lider: boolean; estado: EstadoFila };
export type TutoriaPlan = { fila: number; clave_tutor: string; clave_alumno: string; estado: EstadoFila };
export type TareaPlan = {
  fila: number; clave: string; titulo: string; clave_area: string; robot: 'VEX' | 'FTC' | 'Ambos'; responsables: string[];
  fecha_limite: string | null; para_que_sirve: string; pasos: string[]; estado: EstadoFila;
  /** id estable de importación (clave, título y área): repetir la fila no la duplica */
  id: string;
};
export type Plan = {
  areas: AreaPlan[]; cuentas: CuentaPlan[]; asignaciones: AsignacionPlan[]; tutorias: TutoriaPlan[]; tareas: TareaPlan[];
  problemas: Problema[];
  /** true si hay algún problema grave: no se puede cargar hasta corregir la hoja */
  bloquea: boolean;
};

// ---------- Hoja: nombres de pestañas y columnas tolerantes ----------
const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const PESTANAS: Record<keyof Hoja, NombreHoja> = { areas: 'Áreas', cuentas: 'Cuentas', asignaciones: 'Asignaciones', tutorias: 'Tutorías', tareas: 'Tareas' };
const ALIAS_PESTANA: Record<string, keyof Hoja> = { areas: 'areas', area: 'areas', cuentas: 'cuentas', personas: 'cuentas', asignaciones: 'asignaciones', tutorias: 'tutorias', tutores: 'tutorias', tareas: 'tareas' };
/** Columnas esperadas por pestaña (las del formato acordado con ChatGPT y Jaime). */
export const COLUMNAS: Record<keyof Hoja, string[]> = {
  areas: ['clave_area', 'nombre', 'descripcion_opcional'],
  cuentas: ['clave_persona', 'nombre_visible', 'usuario_deseado', 'rol'],
  asignaciones: ['clave_persona', 'clave_area', 'rol_en_area'],
  tutorias: ['clave_tutor', 'clave_alumno'],
  tareas: ['clave_tarea', 'titulo', 'clave_area', 'responsables', 'fecha_limite', 'robot', 'descripcion_opcional', 'pasos'],
};
const ALIAS_COLUMNA: Record<string, string> = {
  rol_en_area_si_aplica: 'rol_en_area', descripcion: 'descripcion_opcional', usuario: 'usuario_deseado', nombre: 'nombre',
  fecha: 'fecha_limite', para_que_sirve: 'descripcion_opcional',
};

export function pestanaDe(nombre: string): keyof Hoja | null {
  return ALIAS_PESTANA[clave(nombre)] ?? null;
}

/** Convierte filas crudas (primera fila = encabezados) en objetos con columnas normalizadas. */
export function filasDe(crudas: unknown[][]): Fila[] {
  if (!crudas.length) return [];
  const enc = crudas[0].map((c) => {
    const k = clave(String(c ?? ''));
    return ALIAS_COLUMNA[k] ?? k;
  });
  return crudas
    .slice(1)
    .map((r) => {
      const fila: Fila = Object.fromEntries(enc.map((k, i) => [k, celda(r[i])]));
      // Celda de fecha a medianoche: no se distingue "sin hora" de "00:00", así que se marca para avisar
      enc.forEach((k, i) => {
        const v = r[i];
        if (v instanceof Date && v.toISOString().slice(11, 16) === '00:00') fila[`_fecha_celda_${k}`] = '1';
      });
      return fila;
    })
    .filter((f) => Object.entries(f).some(([k, v]) => !k.startsWith('_') && v !== ''));
}

function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel guarda un día sin hora como medianoche: se lee como el día (y vence a las 23:59 de Mérida)
    const iso = v.toISOString();
    return iso.slice(11, 16) === '00:00' ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  return String(v).trim();
}

// ---------- Reglas ----------
const USUARIO_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const CLAVE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/;
const ROLES: Record<string, RolCuenta> = { alumno: 'alumno', alumna: 'alumno', estudiante: 'alumno', tutor: 'tutor', tutora: 'tutor', mentor: 'coach_aux', mentora: 'coach_aux', coach_aux: 'coach_aux' };
const ROBOTS: Record<string, TareaPlan['robot']> = { vex: 'VEX', ftc: 'FTC', ambos: 'Ambos', '': 'Ambos' };
const normal = (s: string) => clave(s).replace(/_/g, ' ');

/** "2026-12-05" o "2026-12-05 18:30" (hora de Mérida, UTC-6) → ISO. Sin hora: 23:59 de ese día. */
export function fechaLimite(v: string): string | null | 'invalida' {
  const t = v.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
  if (!m) return 'invalida';
  const [a, mes, d, h, mi] = [m[1], m[2], m[3], m[4] ?? '23', m[5] ?? '59'].map(Number);
  const dia = new Date(Date.UTC(a, mes - 1, d));
  if (dia.getUTCFullYear() !== a || dia.getUTCMonth() !== mes - 1 || dia.getUTCDate() !== d || h > 23 || mi > 59) return 'invalida';
  return new Date(Date.UTC(a, mes - 1, d, h + 6, mi)).toISOString(); // Mérida = UTC-6
}

/** Id estable de la solicitud de alta de una fila de Cuentas (el mismo en la revisión y en la carga). */
export const solicitudCuenta = (c: { clave: string; usuario: string; nombre: string }) => idEstable(`cuenta|${c.clave.toUpperCase()}|${c.usuario}|${c.nombre}`);

export async function revisar(hoja: Hoja, ex: Existentes, opciones: OpcionesRevision = { coachPrincipal: true }): Promise<Plan> {
  let problemas: Problema[] = [];
  const mal = (h: NombreHoja, fila: number, mensaje: string, grave = true) => {
    const p = { hoja: h, fila, mensaje, grave };
    problemas.push(p);
    return p;
  };
  const deIdentidad = new Map<CuentaPlan, Problema[]>(); // problemas que se resuelven si la solicitud ya se completó
  const nFila = (i: number) => i + 2; // fila de la hoja (1 = encabezados)

  // --- Áreas ---
  const areas: AreaPlan[] = [];
  const porClaveArea = new Map<string, AreaPlan>();
  const nombresArea = new Set<string>();
  hoja.areas.forEach((f, i) => {
    const fila = nFila(i);
    const c = f.clave_area ?? '';
    const nombre = (f.nombre ?? '').replace(/\s+/g, ' ');
    let estado: EstadoFila = 'nueva';
    if (!CLAVE_RE.test(c)) {
      mal('Áreas', fila, `Clave «${c || '(vacía)'}» no válida: usa letras, números, guion o punto (ej. PROG).`);
      estado = 'invalida';
    } else if (porClaveArea.has(c.toUpperCase())) {
      mal('Áreas', fila, `La clave ${c} está repetida (también en la fila ${porClaveArea.get(c.toUpperCase())!.fila}).`);
      estado = 'conflicto';
    }
    if (nombre.length < 2 || nombre.length > 40) {
      mal('Áreas', fila, 'El nombre debe tener de 2 a 40 letras.');
      estado = 'invalida';
    } else if (nombresArea.has(normal(nombre))) {
      mal('Áreas', fila, `El área «${nombre}» está dos veces en la hoja.`);
      estado = 'conflicto';
    }
    nombresArea.add(normal(nombre));
    const ya = ex.areas.find((a) => normal(a.nombre) === normal(nombre));
    const plan: AreaPlan = { fila, clave: c, nombre, estado: estado === 'nueva' && ya ? 'existente' : estado, id: ya?.id };
    areas.push(plan);
    if (CLAVE_RE.test(c) && !porClaveArea.has(c.toUpperCase())) porClaveArea.set(c.toUpperCase(), plan);
  });
  const areaValida = (c: string) => {
    const a = porClaveArea.get(c.toUpperCase());
    if (a && (a.estado === 'nueva' || a.estado === 'existente')) return a;
    // También se acepta el nombre de un área que ya existe en la app (sin tenerla en la pestaña Áreas)
    const ya = ex.areas.find((x) => normal(x.nombre) === normal(c));
    return ya ? ({ fila: 0, clave: c, nombre: ya.nombre, estado: 'existente', id: ya.id } as AreaPlan) : null;
  };

  // --- Cuentas ---
  const cuentas: CuentaPlan[] = [];
  const porClavePersona = new Map<string, CuentaPlan>();
  const usuarios = new Map<string, number>();
  hoja.cuentas.forEach((f, i) => {
    const fila = nFila(i);
    const c = f.clave_persona ?? '';
    const nombre = (f.nombre_visible ?? '').replace(/\s+/g, ' ');
    const rolTxt = clave(f.rol ?? '');
    const rol = ROLES[rolTxt];
    let estado: EstadoFila = 'nueva';
    if (!CLAVE_RE.test(c)) {
      mal('Cuentas', fila, `Clave «${c || '(vacía)'}» no válida (ej. ALU-01).`);
      estado = 'invalida';
    } else if (porClavePersona.has(c.toUpperCase())) {
      mal('Cuentas', fila, `La clave ${c} está repetida (también en la fila ${porClavePersona.get(c.toUpperCase())!.fila}).`);
      estado = 'conflicto';
    }
    if (nombre.length < 2 || nombre.length > 40) {
      mal('Cuentas', fila, 'El nombre visible debe tener de 2 a 40 letras (nombre e inicial está bien).');
      estado = 'invalida';
    }
    if (!rol) {
      mal('Cuentas', fila, `Rol «${f.rol || '(vacío)'}» no válido: usa alumno, tutor o mentor.`);
      estado = 'invalida';
    } else if (rol === 'coach_aux' && !opciones.coachPrincipal) {
      mal('Cuentas', fila, 'Solo el coach principal da de alta mentores.');
      estado = 'invalida';
    }
    const identidad: Problema[] = [];
    let usuario = (f.usuario_deseado ?? '').toLowerCase();
    if (!usuario && nombre.length >= 2) usuario = usuarioDesdeNombre(nombre);
    if (rol === 'tutor' && usuario && !usuario.startsWith('tutor.')) usuario = `tutor.${usuario}`;
    if (usuario && (!USUARIO_RE.test(usuario) || usuario.length > 40)) {
      mal('Cuentas', fila, `Usuario «${usuario}» no válido: solo minúsculas, números y puntos (ej. ana.l).`);
      estado = 'invalida';
    } else if (usuario && usuarios.has(usuario)) {
      mal('Cuentas', fila, `El usuario ${usuario} se repite (fila ${usuarios.get(usuario)}). Ponle a una el usuario_deseado distinto.`);
      estado = 'conflicto';
    }
    if (usuario) usuarios.set(usuario, fila);
    const ya = ex.perfiles.find((p) => p.usuario === usuario);
    if (ya && estado === 'nueva') {
      if (ya.rol_global !== rol) {
        identidad.push(mal('Cuentas', fila, `Ya existe la cuenta ${usuario} pero con rol ${ya.rol_global}; aquí dice ${f.rol}. Si es otra persona, ponle otro usuario_deseado.`));
        estado = 'conflicto';
      } else if (normal(ya.nombre_visible) !== normal(nombre)) {
        // Mismo usuario y rol pero otro nombre: puede ser otra persona. No se vincula sin que el coach lo decida.
        identidad.push(mal('Cuentas', fila, `El usuario ${usuario} ya es de «${ya.nombre_visible}». Si es la misma persona, copia ese nombre tal cual; si es otra, ponle otro usuario_deseado.`));
        estado = 'conflicto';
      } else {
        estado = 'existente';
        identidad.push(mal('Cuentas', fila, `Se usará la cuenta que ya existe: ${usuario} (${ya.nombre_visible}).`, false));
        if (!ya.activo) mal('Cuentas', fila, `La cuenta ${usuario} está desactivada; actívala en Cuentas si sigue en el equipo.`, false);
      }
    } else if (!ya && estado === 'nueva') {
      // Mismo nombre y rol con otro usuario: probablemente la misma persona (evita cuentas duplicadas)
      const homonimo = ex.perfiles.find((p) => p.rol_global === rol && normal(p.nombre_visible) === normal(nombre));
      if (homonimo) {
        identidad.push(mal('Cuentas', fila, `Ya hay una cuenta de ${rol === 'coach_aux' ? 'mentor' : rol} llamada «${homonimo.nombre_visible}» (${homonimo.usuario}). Si es la misma persona, pon usuario_deseado ${homonimo.usuario}; si es otra, distingue el nombre visible.`));
        estado = 'conflicto';
      }
    }
    const plan: CuentaPlan = { fila, clave: c, nombre, usuario, rol: rol ?? 'alumno', estado, id: estado === 'existente' ? ya?.id : undefined, membresias: [] };
    cuentas.push(plan);
    deIdentidad.set(plan, identidad);
    if (CLAVE_RE.test(c) && !porClavePersona.has(c.toUpperCase())) porClavePersona.set(c.toUpperCase(), plan);
  });
  // Reanudar: si la solicitud de esta fila ya se completó (aunque la respuesta se haya perdido o el servidor
  // haya ajustado el usuario), la cuenta es ESA, por su id. Esto manda sobre usuario y nombre.
  if (opciones.altasPrevias) {
    const candidatas = cuentas.filter((p) => p.rol && p.usuario && CLAVE_RE.test(p.clave) && p.estado !== 'invalida');
    const ids = await Promise.all(candidatas.map((p) => solicitudCuenta(p)));
    const previas = ids.length ? await opciones.altasPrevias(ids) : {};
    candidatas.forEach((p, i) => {
      const alta = previas[ids[i]]?.find((x) => x.rol === p.rol);
      if (!alta) return;
      const quitar = new Set(deIdentidad.get(p));
      problemas = problemas.filter((x) => !quitar.has(x));
      p.estado = 'existente';
      p.id = alta.usuario_id;
      p.recuperada = { usuario: alta.usuario };
      mal('Cuentas', p.fila, `Ya se creó en una carga anterior como ${alta.usuario}: se usa esa cuenta.`, false);
    });
  }

  const persona = (c: string) => {
    const p = porClavePersona.get(c.toUpperCase());
    return p && (p.estado === 'nueva' || p.estado === 'existente') ? p : null;
  };

  // --- Asignaciones (alumno ↔ área) ---
  const asignaciones: AsignacionPlan[] = [];
  const parAsig = new Set<string>();
  hoja.asignaciones.forEach((f, i) => {
    const fila = nFila(i);
    const p = persona(f.clave_persona ?? '');
    const a = areaValida(f.clave_area ?? '');
    const rolArea = clave(f.rol_en_area ?? '');
    if (!p) return mal('Asignaciones', fila, `La persona ${f.clave_persona || '(vacía)'} no está (bien) en la pestaña Cuentas.`);
    if (!a) return mal('Asignaciones', fila, `El área ${f.clave_area || '(vacía)'} no está en la pestaña Áreas ni en la app.`);
    if (p.rol !== 'alumno') return mal('Asignaciones', fila, `${p.clave} es ${p.rol === 'tutor' ? 'tutor' : 'mentor'}: solo los alumnos pertenecen a áreas.`);
    if (rolArea && !['lider', 'integrante', 'miembro'].includes(rolArea)) return mal('Asignaciones', fila, `rol_en_area «${f.rol_en_area}» no válido: deja vacío, integrante o lider.`);
    const k = `${p.clave}|${a.clave}`.toUpperCase();
    if (parAsig.has(k)) return mal('Asignaciones', fila, `${p.clave} ya está asignado a ${a.clave} en otra fila; se toma una sola vez.`, false);
    parAsig.add(k);
    const es_lider = rolArea === 'lider';
    p.membresias.push({ clave_area: a.clave, es_lider });
    let estado: EstadoFila = 'nueva';
    const ya = p.id && a.id ? ex.membresias.find((m) => m.usuario_id === p.id && m.area_id === a.id) : undefined;
    if (ya && ya.es_lider === es_lider) estado = 'existente';
    else if (ya) {
      estado = 'cambio';
      mal('Asignaciones', fila, `${p.clave} pasa de ${ya.es_lider ? 'líder' : 'integrante'} a ${es_lider ? 'líder' : 'integrante'} en ${a.nombre}.`, false);
    }
    asignaciones.push({ fila, clave_persona: p.clave, clave_area: a.clave, es_lider, estado });
  });
  for (const p of cuentas) {
    if (p.rol === 'alumno' && p.estado === 'nueva' && p.membresias.length === 0) {
      mal('Cuentas', p.fila, `${p.clave} (${p.nombre}) no tiene ningún área en la pestaña Asignaciones.`);
      p.estado = 'invalida';
    }
  }

  // --- Tutorías ---
  const tutorias: TutoriaPlan[] = [];
  const parTut = new Set<string>();
  hoja.tutorias.forEach((f, i) => {
    const fila = nFila(i);
    const t = persona(f.clave_tutor ?? '');
    const al = persona(f.clave_alumno ?? '');
    let estado: EstadoFila = 'nueva';
    if (!t || t.rol !== 'tutor') {
      mal('Tutorías', fila, `${f.clave_tutor || '(vacía)'} no es un tutor de la pestaña Cuentas.`);
      estado = 'invalida';
    }
    if (!al || al.rol !== 'alumno') {
      mal('Tutorías', fila, `${f.clave_alumno || '(vacía)'} no es un alumno de la pestaña Cuentas.`);
      estado = 'invalida';
    }
    if (estado === 'nueva' && t && al) {
      const k = `${t.clave}|${al.clave}`.toUpperCase();
      if (parTut.has(k)) {
        mal('Tutorías', fila, 'Vínculo repetido; se toma una sola vez.', false);
        return;
      }
      parTut.add(k);
      if (t.id && al.id && ex.tutorias.some((x) => x.tutor_id === t.id && x.alumno_id === al.id)) estado = 'existente';
    }
    tutorias.push({ fila, clave_tutor: f.clave_tutor ?? '', clave_alumno: f.clave_alumno ?? '', estado });
  });
  for (const p of cuentas) {
    if (p.rol === 'tutor' && p.estado === 'nueva' && !tutorias.some((t) => t.estado === 'nueva' && t.clave_tutor.toUpperCase() === p.clave.toUpperCase())) {
      mal('Cuentas', p.fila, `El tutor ${p.clave} no tiene alumno en la pestaña Tutorías.`);
      p.estado = 'invalida';
    }
  }

  // --- Tareas ---
  const tareas: TareaPlan[] = [];
  const clavesTarea = new Map<string, number>();
  for (const [i, f] of hoja.tareas.entries()) {
    const fila = nFila(i);
    const c = f.clave_tarea ?? '';
    const titulo = (f.titulo ?? '').replace(/\s+/g, ' ');
    let estado: EstadoFila = 'nueva';
    if (!CLAVE_RE.test(c)) {
      mal('Tareas', fila, `Clave «${c || '(vacía)'}» no válida (ej. TAR-01).`);
      estado = 'invalida';
    } else if (clavesTarea.has(c.toUpperCase())) {
      mal('Tareas', fila, `La clave ${c} está repetida (también en la fila ${clavesTarea.get(c.toUpperCase())}).`);
      estado = 'conflicto';
    } else clavesTarea.set(c.toUpperCase(), fila);
    if (titulo.length < 3 || titulo.length > 120) {
      mal('Tareas', fila, 'El título debe tener de 3 a 120 letras.');
      estado = 'invalida';
    }
    const a = areaValida(f.clave_area ?? '');
    if (!a) {
      mal('Tareas', fila, `El área ${f.clave_area || '(vacía)'} no está en la pestaña Áreas ni en la app.`);
      estado = 'invalida';
    }
    const robot = ROBOTS[clave(f.robot ?? '')];
    if (!robot) {
      mal('Tareas', fila, `Robot «${f.robot}» no válido: VEX, FTC o Ambos (vacío = Ambos).`);
      estado = 'invalida';
    }
    const fecha = fechaLimite(f.fecha_limite ?? '');
    if (fecha === 'invalida') {
      mal('Tareas', fila, `Fecha «${f.fecha_limite}» no válida: escribe AAAA-MM-DD (ej. 2026-12-05) y si quieres la hora, AAAA-MM-DD HH:MM.`);
      estado = 'invalida';
    }
    const resp = (f.responsables ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    for (const r of resp) {
      const p = persona(r);
      if (!p) {
        mal('Tareas', fila, `El responsable ${r} no está (bien) en la pestaña Cuentas.`);
        estado = 'invalida';
      } else if (p.rol !== 'alumno') {
        mal('Tareas', fila, `El responsable ${r} no es alumno.`);
        estado = 'invalida';
      } else if (a && !p.membresias.some((m) => m.clave_area.toUpperCase() === a.clave.toUpperCase()) && !(p.id && a.id && ex.membresias.some((m) => m.usuario_id === p.id && m.area_id === a.id))) {
        mal('Tareas', fila, `${r} no pertenece al área ${a.clave}; igual se le puede asignar, pero revisa que sea correcto.`, false);
      }
    }
    if (f._fecha_celda_fecha_limite && fecha) {
      mal('Tareas', fila, 'La fecha venía como celda de fecha sin hora: vence a las 23:59. Si quieres otra hora, escríbela como texto (ej. 2026-12-05 18:30).', false);
    }
    const id = await idEstable(`tarea|${c.toUpperCase()}|${normal(titulo)}|${(a?.clave ?? f.clave_area ?? '').toUpperCase()}`);
    const yaId = ex.tareas.find((t) => t.id === id);
    if (estado === 'nueva' && yaId) {
      estado = 'existente';
      const fechaHoja = fecha && fecha !== 'invalida' ? Date.parse(fecha) : null;
      const fechaYa = yaId.fecha_limite ? Date.parse(yaId.fecha_limite) : null;
      const cambia = (yaId.fecha_limite !== undefined && fechaYa !== fechaHoja) || (yaId.robot !== undefined && yaId.robot !== robot);
      if (cambia) mal('Tareas', fila, 'Esta tarea ya se cargó antes: la hoja no cambia su fecha, robot, responsables ni pasos. Edítala en la app.', false);
    } else if (estado === 'nueva' && a?.id && ex.tareas.some((t) => t.area_id === a.id && normal(t.titulo) === normal(titulo))) {
      mal('Tareas', fila, `Ya hay una tarea «${titulo}» en ${a.nombre} que no viene de esta fila. Si es la misma, quítala de la hoja; si es otra, cambia el título.`);
      estado = 'conflicto';
    }
    tareas.push({ id,
      fila, clave: c, titulo, clave_area: a?.clave ?? (f.clave_area ?? ''), robot: robot ?? 'Ambos', responsables: resp,
      fecha_limite: fecha === 'invalida' ? null : fecha, para_que_sirve: f.descripcion_opcional ?? '',
      pasos: (f.pasos ?? '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 20), estado,
    });
  }

  return { areas, cuentas, asignaciones, tutorias, tareas, problemas, bloquea: problemas.some((p) => p.grave) };
}

/** Cuántas filas hay de cada estado, por pestaña. */
export function conteo(plan: Plan) {
  const de = (xs: { estado: EstadoFila }[]) => ({
    nueva: xs.filter((x) => x.estado === 'nueva').length,
    existente: xs.filter((x) => x.estado === 'existente').length,
    cambio: xs.filter((x) => x.estado === 'cambio').length,
    error: xs.filter((x) => x.estado === 'conflicto' || x.estado === 'invalida').length,
  });
  // Las asignaciones de cuentas nuevas se crean junto con la cuenta: aquí solo cuentan las de cuentas existentes
  const asig = plan.asignaciones.filter((x) => !plan.cuentas.some((c) => c.estado === 'nueva' && c.clave.toUpperCase() === x.clave_persona.toUpperCase()));
  return { areas: de(plan.areas), cuentas: de(plan.cuentas), asignaciones: de(asig), tutorias: de(plan.tutorias), tareas: de(plan.tareas) };
}

/** Id estable a partir de un texto (para que repetir la carga del mismo lote no duplique): UUID con forma v4. */
export async function idEstable(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tablero-zero/importar/${texto}`)));
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
