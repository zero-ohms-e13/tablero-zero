// Bitácoras (varias por semana, una por día de taller): lecturas y cambios. La base decide quién ve (autor y coach) y valida todo.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { traducirError } from './datos';
import { claveDia, semanaDe } from './fechas';

export type EstadoBitacora = 'borrador' | 'entregada' | 'devuelta' | 'revisada';
export type EvidenciaBitacora =
  | { tipo: 'tarea'; tarea_id: string }
  | { tipo: 'material'; material_id: string }
  | { tipo: 'enlace'; url: string; nombre?: string | null };
export type Bitacora = {
  id: string; alumno_id: string; fecha: string; semana: string; estado: EstadoBitacora;
  aporte: string; aprendizaje: string; siguiente: string; necesita_ayuda: boolean; texto_libre: string;
  version: number; creado_at: string; actualizado_at: string; primera_entrega_at: string | null; entregada_at: string | null;
  devuelta_at: string | null; retro: string | null; retro_por: string | null; retro_at: string | null;
  bitacora_evidencias: (EvidenciaBitacora & { id: string; orden: number; tarea_id: string | null; material_id: string | null; url: string | null; nombre: string | null })[];
};
export type DatosBitacora = Pick<Bitacora, 'aporte' | 'aprendizaje' | 'siguiente' | 'necesita_ayuda' | 'texto_libre'> & { evidencias: EvidenciaBitacora[] };
export type FilaResumen = {
  alumno_id: string; nombre_visible: string; iniciales: string; color: string; entregadas: number; por_revisar: number;
  estado: 'pendiente' | 'entregada' | 'devuelta' | 'revisada'; tarde: boolean; atrasada: boolean; entregada_at: string | null; necesita_ayuda: boolean; exigible: boolean;
};

export const PREGUNTAS = [
  { campo: 'aporte', titulo: '¿Qué hice o aporté?', ayuda: 'Código, diseño, pruebas, documentación o apoyo a un compañero.' },
  { campo: 'aprendizaje', titulo: '¿Qué aprendí o qué se me dificultó?', ayuda: 'También cuenta un intento que falló si explicas qué descubriste.' },
  { campo: 'siguiente', titulo: '¿Qué voy a hacer después? ¿Necesito ayuda con algo?', ayuda: '' },
] as const;

// ---------- Semana y plazo (mismas reglas que la base: lunes a domingo, vence domingo 20:00 Mérida) ----------
/** Lunes 'YYYY-MM-DD' de la semana de Mérida que contiene `d`. */
export const lunesDe = (d: Date = new Date()) => claveDia(semanaDe(d).inicio);
/** Momento exacto del plazo: domingo 20:00 hora de Mérida (UTC-6) = lunes 02:00 UTC. */
export const venceDe = (lunes: string) => new Date(Date.parse(`${lunes}T00:00:00Z`) + 6 * 86400_000 + 26 * 3600_000);
export const sumarSemanas = (lunes: string, n: number) => new Date(Date.parse(`${lunes}T00:00:00Z`) + n * 7 * 86400_000).toISOString().slice(0, 10);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function rangoSemana(lunes: string) {
  const a = new Date(`${lunes}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86400_000);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MESES[a.getUTCMonth()]} al ${b.getUTCDate()} ${MESES[b.getUTCMonth()]}`;
}
/** Misma regla que la base: de la primera semana exigible (o la actual, si el arranque es posterior) a hoy. */
export const semanaAbierta = (lunes: string, inicio: string | undefined, ahora = new Date()) => {
  const actual = lunesDe(ahora);
  return lunes <= actual && lunes >= (inicio && inicio < actual ? inicio : actual);
};
/** Hoy 'YYYY-MM-DD' en Mérida. */
export const hoyMerida = () => claveDia(new Date());
/** "lunes 24 de nov" para la fecha de una bitácora. */
export function diaBitacora(fecha: string) {
  const d = new Date(`${fecha}T00:00:00Z`);
  return `${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

export const ETIQUETA_ESTADO_BITACORA: Record<FilaResumen['estado'] | 'borrador', string> = {
  pendiente: 'Pendiente', borrador: 'Borrador', entregada: 'Entregada', devuelta: 'Devuelta para corregir', revisada: 'Revisada',
};

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traducirError(r.error.message));
  return r.data as T;
}
const SELECT = '*, bitacora_evidencias(*)';

// ---------- Alumno ----------
const ordenar = (lista: Bitacora[]) => {
  lista.forEach((b) => b.bitacora_evidencias.sort((x, y) => x.orden - y.orden));
  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado_at.localeCompare(b.creado_at));
};

/** Las bitácoras de un alumno en una semana (el alumno ve también sus borradores; el coach, solo lo entregado). */
export const useBitacorasSemana = (alumno: string | undefined, lunes: string) =>
  useQuery({
    queryKey: ['bitacoras_semana', alumno, lunes],
    enabled: !!alumno,
    queryFn: async () => ordenar(ok(await supabase.from('bitacoras').select(SELECT).eq('alumno_id', alumno!).eq('semana', lunes)) as Bitacora[]),
  });

export const useMisBitacoras = (alumno: string | undefined) =>
  useQuery({
    queryKey: ['bitacoras', alumno],
    enabled: !!alumno,
    queryFn: async () =>
      ok(await supabase.from('bitacoras').select('id, semana, estado, primera_entrega_at, retro').eq('alumno_id', alumno!).order('semana', { ascending: false }).limit(20)) as
        Pick<Bitacora, 'id' | 'semana' | 'estado' | 'primera_entrega_at' | 'retro'>[],
  });

export function useGuardarBitacora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; fecha: string; version: number; datos: DatosBitacora }) =>
      ok(await supabase.rpc('guardar_bitacora', { p_id: v.id, p_fecha: v.fecha, p_version: v.version, p_datos: v.datos })) as { id: string; version: number },
    // Marca la copia en memoria como vieja (sin recargar ahora): al volver a esa semana se trae la versión guardada
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitacoras_semana'], refetchType: 'none' });
      qc.invalidateQueries({ queryKey: ['bitacoras'], refetchType: 'none' });
    },
  });
}

export function useEntregarBitacora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; version: number }) => ok(await supabase.rpc('entregar_bitacora', { p_id: v.id, p_version: v.version })) as { id: string; version: number },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitacoras_semana'] });
      qc.invalidateQueries({ queryKey: ['bitacoras'] });
    },
  });
}

// ---------- Coach ----------
export const useResumenBitacoras = (lunes: string, activo = true) =>
  useQuery({
    queryKey: ['resumen_bitacoras', lunes],
    enabled: activo,
    queryFn: async () => ok(await supabase.rpc('resumen_bitacoras', { p_semana: lunes })) as FilaResumen[],
  });



export function useRevisarBitacora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; retro: string; devolver: boolean }) =>
      ok(v.devolver
        ? await supabase.rpc('devolver_bitacora', { p_id: v.id, p_nota: v.retro })
        : await supabase.rpc('revisar_bitacora', { p_id: v.id, p_retro: v.retro })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bitacoras_semana'] });
      qc.invalidateQueries({ queryKey: ['resumen_bitacoras'] });
    },
  });
}

/** Plazo vigente de una semana: el que fijó el coach o el de omisión (domingo 20:00). Lo decide la base. */
export const usePlazoBitacora = (lunes: string) =>
  useQuery({
    queryKey: ['plazo_bitacora', lunes],
    queryFn: async () => new Date(ok(await supabase.rpc('vence_bitacora', { p_semana: lunes })) as string),
    placeholderData: () => venceDe(lunes), // mientras responde, el de omisión
    staleTime: 60_000,
  });

export function useFijarPlazo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { lunes: string; vence: string | null }) => ok(await supabase.rpc('fijar_plazo_bitacora', { p_semana: v.lunes, p_vence: v.vence })),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['plazo_bitacora', v.lunes] });
      qc.invalidateQueries({ queryKey: ['resumen_bitacoras', v.lunes] });
    },
  });
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** "el domingo 29 de nov a las 8:00 p. m." en hora de Mérida. */
export function cuandoVence(v: Date) {
  const m = new Date(v.getTime() - 6 * 3600_000);
  const h = m.getUTCHours();
  const hora = `${h % 12 || 12}:${String(m.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  return `el ${DIAS[m.getUTCDay()]} ${m.getUTCDate()} de ${MESES[m.getUTCMonth()]} a las ${hora}`;
}
export const esOmision = (lunes: string, v: Date) => v.getTime() === venceDe(lunes).getTime();

/** Texto del plazo vigente; después de vencer, la entrega se marca tarde. */
export function plazoTexto(v: Date, ahora = new Date()) {
  if (ahora > v) return { texto: `Venció ${cuandoVence(v)} · se marca como tarde`, tono: 'vencida' as const };
  const horas = (v.getTime() - ahora.getTime()) / 3600_000;
  if (horas < 24) return { texto: `Vence ${cuandoVence(v)} (faltan ${Math.max(1, Math.round(horas))} h)`, tono: 'urgente' as const };
  return { texto: `Vence ${cuandoVence(v)}`, tono: 'normal' as const };
}

/** Primera semana exigible (antes de ella no se marcan atrasos). */
export const useInicioBitacoras = () =>
  useQuery({ queryKey: ['inicio_bitacoras'], queryFn: async () => ok(await supabase.rpc('inicio_bitacoras')) as string, staleTime: 300_000 });

export function useFijarInicio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lunes: string) => ok(await supabase.rpc('fijar_inicio_bitacoras', { p_semana: lunes })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inicio_bitacoras'] });
      qc.invalidateQueries({ queryKey: ['resumen_bitacoras'] });
    },
  });
}
