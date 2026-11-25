// Fechas en hora de Mérida (America/Merida, UTC-6 todo el año).
// La semana va de lunes a domingo.
const TZ = 'America/Merida';
const OFFSET_MS = -6 * 3600_000;

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_TITULO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const LETRAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fecha "de pared" en Mérida representada como Date en UTC (usar getUTC*). */
export function enMerida(d: Date | string | number = new Date()): Date {
  return new Date(new Date(d).getTime() + OFFSET_MS);
}

export function claveDia(d: Date | string): string {
  return enMerida(d).toISOString().slice(0, 10);
}

/** Semana actual de Mérida que contiene a `d`: lunes 00:00 (incluido) a lunes siguiente 00:00 (excluido).
 *  `fin` es el último milisegundo del domingo (compatibilidad); úsese `finExclusivo` para comparar.
 *  No depende de la zona del dispositivo (solo aritmética UTC con el desfase fijo de Mérida). */
export function semanaDe(d: Date = new Date()): { inicio: Date; fin: Date; finExclusivo: Date; dias: Date[] } {
  const m = enMerida(d);
  const dow = (m.getUTCDay() + 6) % 7; // 0 = lunes
  const lunesPared = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate() - dow);
  const inicio = new Date(lunesPared - OFFSET_MS);
  const finExclusivo = new Date(inicio.getTime() + 7 * 86400_000);
  const fin = new Date(finExclusivo.getTime() - 1);
  const dias = Array.from({ length: 7 }, (_, i) => new Date(inicio.getTime() + i * 86400_000));
  return { inicio, fin, finExclusivo, dias };
}

export function enSemana(fecha: string | null, d: Date = new Date()) {
  if (!fecha) return false;
  const { inicio, finExclusivo } = semanaDe(d);
  const t = new Date(fecha).getTime();
  return t >= inicio.getTime() && t < finExclusivo.getTime();
}

type ConFecha = { fecha_limite: string | null; estado: string };

/** FUN-001 · Una sola definición de semana para la pestaña Semana y la batería.
 *  - semana: TODAS las tareas con fecha en la semana actual (numerador = hechas, denominador = total).
 *  - pendientes: las de la semana sin terminar (pestaña Semana).
 *  - vencidas: sin terminar con fecha de semanas anteriores.
 *  - proximas: sin terminar con fecha de semanas siguientes.
 *  - sinFecha: sin terminar y sin fecha. Las hechas siguen en la pestaña Hecho. */
export function agruparSemana<T extends ConFecha>(tareas: T[], ahora: Date = new Date()) {
  const { inicio, finExclusivo } = semanaDe(ahora);
  const ini = inicio.getTime();
  const fin = finExclusivo.getTime();
  const semana: T[] = [];
  const pendientes: T[] = [];
  const vencidas: T[] = [];
  const proximas: T[] = [];
  const sinFecha: T[] = [];
  for (const t of tareas) {
    const hecha = t.estado === 'hecha';
    if (!t.fecha_limite) {
      if (!hecha) sinFecha.push(t);
      continue;
    }
    const f = new Date(t.fecha_limite).getTime();
    if (f >= ini && f < fin) {
      semana.push(t);
      if (!hecha) pendientes.push(t);
    } else if (!hecha) (f < ini ? vencidas : proximas).push(t);
  }
  const porFecha = (a: T, b: T) => (a.fecha_limite ?? '9').localeCompare(b.fecha_limite ?? '9');
  [pendientes, vencidas, proximas].forEach((l) => l.sort(porFecha));
  return { inicio, finExclusivo, semana, hechas: semana.length - pendientes.length, pendientes, vencidas, proximas, sinFecha };
}

export function esHoy(fecha: string | null) {
  return !!fecha && claveDia(fecha) === claveDia(new Date());
}

export function vencida(fecha: string | null) {
  return !!fecha && new Date(fecha).getTime() < Date.now();
}

function hora(d: Date) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: false }).format(d);
}

export type TonoFecha = 'urgente' | 'atiempo' | 'vencida' | 'neutro';

/** Texto y tono del chip de fecha: "Hoy 18:00", "Vie 27", "venció lun 23". */
export function chipFecha(fecha: string | null, hecha = false): { texto: string; tono: TonoFecha } {
  if (!fecha) return { texto: 'Sin fecha', tono: 'neutro' };
  const d = new Date(fecha);
  const m = enMerida(d);
  const dia = `${DIAS_TITULO[m.getUTCDay()]} ${m.getUTCDate()}`;
  if (hecha) return { texto: dia, tono: 'neutro' };
  if (vencida(fecha) && !esHoy(fecha)) return { texto: `venció ${DIAS_CORTOS[m.getUTCDay()]} ${m.getUTCDate()}`, tono: 'vencida' };
  if (esHoy(fecha)) return { texto: `Hoy ${hora(d)}`, tono: vencida(fecha) ? 'vencida' : 'urgente' };
  const manana = claveDia(new Date(Date.now() + 86400_000)) === claveDia(fecha);
  return { texto: manana ? `Mañana ${hora(d)}` : dia, tono: manana ? 'urgente' : 'atiempo' };
}

export function fechaCorta(fecha: string) {
  const m = enMerida(fecha);
  return `${DIAS_TITULO[m.getUTCDay()]} ${m.getUTCDate()}`;
}

export function fechaLarga(fecha: string) {
  const m = enMerida(fecha);
  return `${m.getUTCDate()} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][m.getUTCMonth()]} de ${m.getUTCFullYear()}`;
}

/** "hoy 9:12", "ayer 17:40", "lun 23". */
export function haceCuanto(fecha: string) {
  const d = new Date(fecha);
  const k = claveDia(d);
  if (k === claveDia(new Date())) return `hoy ${hora(d)}`;
  if (k === claveDia(new Date(Date.now() - 86400_000))) return `ayer ${hora(d)}`;
  const m = enMerida(d);
  return `${DIAS_CORTOS[m.getUTCDay()]} ${m.getUTCDate()}`;
}

export function diaMes(fecha: string) {
  const m = enMerida(fecha);
  return `${m.getUTCDate()} ${MESES[m.getUTCMonth()]}`;
}

/** Días que faltan (en calendario de Mérida) hasta una fecha 'YYYY-MM-DD'. */
export function diasHasta(fechaISO: string) {
  const hoy = claveDia(new Date());
  return Math.round((Date.parse(fechaISO.slice(0, 10)) - Date.parse(hoy)) / 86400_000);
}

/** Valor para <input type="datetime-local"> en hora de Mérida. */
export function aInputLocal(fecha: string | null) {
  if (!fecha) return '';
  return enMerida(fecha).toISOString().slice(0, 16);
}
export function deInputLocal(v: string) {
  if (!v) return null;
  return new Date(Date.parse(v + ':00Z') - OFFSET_MS).toISOString();
}
