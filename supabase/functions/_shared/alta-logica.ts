// FUN-003 · Lógica de alta de cuentas sin Deno ni red: se prueba con Vitest inyectando dependencias
// (incluidos fallos de perfil, membresía, tutor, vínculo y compensación).
//
// Orden: validar TODO → reclamar la solicitud → crear identidades BLOQUEADAS (registrando cada id en la
// solicitud) → escribir perfiles+membresías+vínculo en UNA transacción → activar → devolver fichas.
// Si algo falla, se compensan solo las identidades creadas por esta solicitud. Si la compensación
// falla, el alta queda incompleta y bloqueada; reintentar con la misma solicitud la recupera.
import { inicialesDe, usuarioDesdeNombre, USUARIO_RE } from './texto.ts';

export const VIGENCIA_DIAS = 7;
const COLORES = ['#2F5D8A', '#7A3E06', '#2E5A36', '#8A3B6B', '#590202', '#5A4335'];
const TEMPORAL_RE = /^[a-z]{2,10}-\d{3}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Ficha = { usuario_id: string; usuario: string; password: string; nombre: string; rol: string; vence: string; tutor_de?: string };
export type FichaGuardada = Omit<Ficha, 'password' | 'vence'>;
export type Inicio =
  | { previo: null }
  | { previo: 'otra' | 'en_curso' }
  | { previo: 'completa'; creados: string[]; resultado: FichaGuardada[] }
  | { previo: 'incompleta'; creados: string[] };

export type PerfilNuevo = { id: string; usuario: string; nombre_visible: string; iniciales: string; color: string; rol_global: string; vence: string };
export type Completar = {
  solicitud: string;
  perfiles: PerfilNuevo[];
  membresias: { usuario_id: string; area_id: string; es_lider: boolean }[];
  vinculo: { tutor_id: string; alumno_id: string } | null;
  resultado: FichaGuardada[];
};

export type Deps = {
  areasExistentes(ids: string[]): Promise<string[]>;
  esAlumno(id: string): Promise<boolean>;
  usuariosOcupados(base: string): Promise<string[]>;
  iniciar(solicitud: string, coachId: string, huella: string): Promise<Inicio>;
  registrarCreado(solicitud: string, id: string): Promise<void>;
  olvidarCreados(solicitud: string, ids: string[]): Promise<void>;
  marcar(solicitud: string, estado: 'incompleta', error: string): Promise<void>;
  /** Crea la identidad BLOQUEADA y marcada con la solicitud (app_metadata). existe=true si el usuario ya estaba tomado. */
  crearIdentidad(usuario: string, password: string, solicitud: string): Promise<{ ok: true; id: string } | { ok: false; existe: boolean }>;
  /** Si el usuario tomado es una identidad de ESTA solicitud (creada pero sin registrar: respuesta perdida), su id. */
  identidadDeSolicitud(usuario: string, solicitud: string): Promise<string | null>;
  /** Vuelve a bloquear (activación parcial). */
  bloquear(id: string): Promise<void>;
  /** Fija la contraseña temporal de una identidad adoptada de esta misma solicitud. */
  fijarPassword(id: string, password: string): Promise<void>;
  /** true si la identidad quedó borrada (o ya no existía). */
  borrarIdentidad(id: string): Promise<boolean>;
  completar(p: Completar): Promise<void>;
  activar(id: string): Promise<void>;
  password(): string;
  ahora(): Date;
  uuid(): string;
};

export type Coach = { id: string; rol_global: string };
export type Respuesta = { status: number; body: Record<string, unknown> };

type Pedido = {
  solicitud: string;
  nombre: string;
  rol: 'alumno' | 'tutor' | 'coach_aux';
  usuarioPedido: string;
  password?: string;
  membresias: { area_id: string; es_lider: boolean }[];
  conTutor: boolean;
  alumnoId: string | null;
  color: string;
};

const error = (status: number, mensaje: string, extra: Record<string, unknown> = {}): Respuesta => ({ status, body: { error: mensaje, ...extra } });

/** Validación síncrona de la forma de la solicitud. Devuelve el pedido normalizado o una respuesta de error. */
export function validar(body: Record<string, unknown>, coach: Coach, uuid: () => string): Pedido | Respuesta {
  const nombre = String(body.nombre ?? '').trim().replace(/\s+/g, ' ');
  const rol = String(body.rol ?? 'alumno');
  if (nombre.length < 2 || nombre.length > 40) return error(400, 'Escribe un nombre de 2 a 40 letras.');
  if (rol !== 'alumno' && rol !== 'tutor' && rol !== 'coach_aux') return error(400, 'Rol no válido.');
  if (rol === 'coach_aux' && coach.rol_global !== 'coach') return error(403, 'Solo el coach principal crea mentores.');

  let usuarioPedido = String(body.usuario ?? '').trim().toLowerCase();
  if (usuarioPedido && (!USUARIO_RE.test(usuarioPedido) || usuarioPedido.length > 40)) return error(400, 'El usuario solo lleva minúsculas, números y puntos.');
  if (!usuarioPedido) usuarioPedido = usuarioDesdeNombre(nombre);
  if (rol === 'tutor' && !usuarioPedido.startsWith('tutor.')) usuarioPedido = `tutor.${usuarioPedido}`;

  const crudas = body.membresias ?? [];
  if (!Array.isArray(crudas)) return error(400, 'Áreas no válidas.');
  const membresias: Pedido['membresias'] = [];
  for (const m of crudas as Record<string, unknown>[]) {
    if (!m || typeof m.area_id !== 'string' || !UUID_RE.test(m.area_id)) return error(400, 'Áreas no válidas.');
    if (!membresias.some((x) => x.area_id === m.area_id)) membresias.push({ area_id: m.area_id, es_lider: m.es_lider === true });
  }
  if (rol !== 'alumno' && membresias.length) return error(400, 'Solo los alumnos pertenecen a áreas.');
  if (rol !== 'alumno' && body.con_tutor) return error(400, 'Solo un alumno puede llevar tutor.');

  let alumnoId: string | null = null;
  if (body.alumno_id !== undefined && body.alumno_id !== null && body.alumno_id !== '') {
    if (rol !== 'tutor') return error(400, 'Solo un tutor se vincula a un alumno.');
    if (typeof body.alumno_id !== 'string' || !UUID_RE.test(body.alumno_id)) return error(400, 'Alumno no válido.');
    alumnoId = body.alumno_id;
  }

  const sol = typeof body.solicitud_id === 'string' && UUID_RE.test(body.solicitud_id) ? body.solicitud_id : uuid();
  const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : COLORES[nombre.length % COLORES.length];
  const password = typeof body.password === 'string' && TEMPORAL_RE.test(body.password) ? body.password : undefined;
  return { solicitud: sol, nombre, rol, usuarioPedido, password, membresias, conTutor: rol === 'alumno' && !!body.con_tutor, alumnoId, color };
}

/** Resumen estable de lo pedido (sin contraseña) para detectar reuso de una solicitud con otros datos. */
export function huellaDe(p: Pedido): string {
  return JSON.stringify([p.nombre, p.rol, p.usuarioPedido, p.membresias.map((m) => [m.area_id, m.es_lider]).sort(), p.conTutor, p.alumnoId, p.color]);
}

function limpiarUsuario(base: string) {
  return base.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '') || 'usuario';
}

async function elegirUsuario(deps: Deps, base: string, excluir: Set<string>): Promise<string> {
  const limpio = limpiarUsuario(base);
  const usados = new Set([...(await deps.usuariosOcupados(limpio)), ...excluir]);
  if (!usados.has(limpio)) return limpio;
  for (let i = 2; i < 100; i++) if (!usados.has(`${limpio}${i}`)) return `${limpio}${i}`;
  throw new Error('sin_usuario_libre');
}

/** Compensa: borra solo las identidades de esta solicitud. Devuelve true si no quedó ninguna. */
async function compensar(deps: Deps, solicitud: string, ids: string[]): Promise<boolean> {
  const borrados: string[] = [];
  for (const id of ids) {
    const ok = await deps.borrarIdentidad(id).catch(() => false);
    if (ok) borrados.push(id);
  }
  if (borrados.length) await deps.olvidarCreados(solicitud, borrados).catch(() => {});
  return borrados.length === ids.length;
}

export async function procesarAlta(body: Record<string, unknown>, coach: Coach, deps: Deps): Promise<Respuesta> {
  const v = validar(body, coach, deps.uuid);
  if ('status' in v) return v;
  const p = v;

  // Validación contra la base ANTES de crear identidades
  try {
    if (p.membresias.length) {
      const existen = new Set(await deps.areasExistentes(p.membresias.map((m) => m.area_id)));
      if (p.membresias.some((m) => !existen.has(m.area_id))) return error(400, 'Alguna de las áreas no existe.');
    }
    if (p.alumnoId && !(await deps.esAlumno(p.alumnoId))) return error(400, 'Ese alumno no existe.');
  } catch {
    return error(503, 'No se pudo revisar los datos. Intenta de nuevo.');
  }

  const vence = new Date(deps.ahora().getTime() + VIGENCIA_DIAS * 86_400_000).toISOString();

  let inicio: Inicio;
  try {
    inicio = await deps.iniciar(p.solicitud, coach.id, huellaDe(p));
  } catch {
    return error(503, 'No se pudo iniciar el alta. Intenta de nuevo.');
  }
  if (inicio.previo === 'otra') return error(409, 'Esa solicitud ya se usó con otros datos. Recarga e intenta de nuevo.');
  if (inicio.previo === 'en_curso') return error(409, 'Esta alta ya se está procesando. Espera unos segundos.', { estado: 'en_curso' });

  // Reintento de un alta que ya terminó (se perdió la respuesta): NO se cambian contraseñas (una ficha ya
  // entregada sigue valiendo y una cuenta en uso no se altera). Se informa el estado; para una ficha nueva
  // el coach usa "Reiniciar contraseña" (acción explícita).
  if (inicio.previo === 'completa') {
    try {
      for (const f of inicio.resultado) await deps.activar(f.usuario_id); // por si la activación había fallado
    } catch {
      return error(500, 'Las cuentas existen pero no se pudieron activar. Vuelve a intentar.', { estado: 'completa' });
    }
    return {
      status: 200,
      body: {
        fichas: [],
        ya_creadas: inicio.resultado.map((f) => ({ usuario_id: f.usuario_id, usuario: f.usuario, nombre: f.nombre, rol: f.rol })),
        mensaje: 'Estas cuentas ya se habían creado. Si no tienes la ficha, usa "Reiniciar contraseña".',
      },
    };
  }

  // Alta interrumpida antes: se limpia lo que esa misma solicitud creó y se empieza de nuevo
  if (inicio.previo === 'incompleta' && inicio.creados.length) {
    if (!(await compensar(deps, p.solicitud, inicio.creados))) {
      await deps.marcar(p.solicitud, 'incompleta', 'compensacion').catch(() => {});
      return error(500, 'Quedó un alta incompleta (bloqueada) que no se pudo limpiar. Vuelve a intentar más tarde.', { estado: 'incompleta' });
    }
  }

  const creados: string[] = [];
  const excluir = new Set<string>();
  async function nuevaIdentidad(base: string, password: string): Promise<{ id: string; usuario: string }> {
    for (let intento = 0; intento < 5; intento++) {
      const usuario = await elegirUsuario(deps, base, excluir);
      const r = await deps.crearIdentidad(usuario, password, p.solicitud);
      if (r.ok) {
        creados.push(r.id);
        await deps.registrarCreado(p.solicitud, r.id);
        return { id: r.id, usuario };
      }
      if (!r.existe) throw new Error('identidad');
      // ¿Es nuestra? (Auth la creó pero la respuesta se perdió antes de registrarla): se adopta con su id
      // para que la compensación o la recuperación la alcancen. Su contraseña se reemplaza al activarla.
      const propia = await deps.identidadDeSolicitud(usuario, p.solicitud);
      if (propia) {
        creados.push(propia);
        await deps.registrarCreado(p.solicitud, propia);
        await deps.fijarPassword(propia, password);
        return { id: propia, usuario };
      }
      excluir.add(usuario); // alta concurrente tomó ese usuario: probamos el siguiente
    }
    throw new Error('identidad');
  }

  const fichas: Ficha[] = [];
  try {
    const password = p.rol === 'alumno' && p.password ? p.password : deps.password();
    const cuenta = await nuevaIdentidad(p.usuarioPedido, password);
    excluir.add(cuenta.usuario);
    fichas.push({ usuario_id: cuenta.id, usuario: cuenta.usuario, password, nombre: p.nombre, rol: p.rol, vence });
    const perfiles: PerfilNuevo[] = [
      { id: cuenta.id, usuario: cuenta.usuario, nombre_visible: p.nombre, iniciales: inicialesDe(p.nombre), color: p.color, rol_global: p.rol, vence },
    ];
    let vinculo: Completar['vinculo'] = p.alumnoId ? { tutor_id: cuenta.id, alumno_id: p.alumnoId } : null;

    if (p.conTutor) {
      const nombreTutor = `Familia de ${p.nombre.split(' ')[0]}`;
      const pt = deps.password();
      const tutor = await nuevaIdentidad(`tutor.${cuenta.usuario}`, pt);
      fichas.push({ usuario_id: tutor.id, usuario: tutor.usuario, password: pt, nombre: nombreTutor, rol: 'tutor', vence, tutor_de: p.nombre });
      perfiles.push({ id: tutor.id, usuario: tutor.usuario, nombre_visible: nombreTutor, iniciales: inicialesDe(nombreTutor), color: '#5A4335', rol_global: 'tutor', vence });
      vinculo = { tutor_id: tutor.id, alumno_id: cuenta.id };
    }

    await deps.completar({
      solicitud: p.solicitud,
      perfiles,
      membresias: p.membresias.map((m) => ({ usuario_id: cuenta.id, ...m })),
      vinculo,
      resultado: fichas.map((f): FichaGuardada => ({ usuario_id: f.usuario_id, usuario: f.usuario, nombre: f.nombre, rol: f.rol, ...(f.tutor_de ? { tutor_de: f.tutor_de } : {}) })),
    });
  } catch {
    // Compensación limitada a esta solicitud
    const limpio = await compensar(deps, p.solicitud, creados);
    await deps.marcar(p.solicitud, 'incompleta', limpio ? 'revertida' : 'compensacion').catch(() => {});
    return limpio
      ? error(500, 'No se pudo crear la cuenta. No quedó nada a medias; intenta de nuevo.', { estado: 'revertida' })
      : error(500, 'El alta quedó incompleta y bloqueada. Vuelve a intentar para recuperarla.', { estado: 'incompleta' });
  }

  // Activación: solo al terminar y para TODAS o ninguna. Si una falla, se vuelven a bloquear las ya activadas
  // (el par alumno–tutor no queda a medias); reintentar la misma solicitud las activa.
  const activadas: string[] = [];
  try {
    for (const f of fichas) {
      await deps.activar(f.usuario_id);
      activadas.push(f.usuario_id);
    }
  } catch {
    for (const id of activadas) await deps.bloquear(id).catch(() => {});
    return error(500, 'Las cuentas se crearon pero no se pudieron activar. Vuelve a intentar para activarlas; después usa "Reiniciar contraseña" para entregar las fichas.', { estado: 'completa' });
  }
  return { status: 200, body: { fichas } };
}
