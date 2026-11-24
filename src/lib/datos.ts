// Consultas y cambios con TanStack Query. La RLS decide qué devuelve cada consulta.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { FUNCIONES, supabase } from './supabase';
import type {
  Area, AvanceArea, AvanceMeta, Comentario, Competencia, Estado, Evidencia, Historial, Membresia, Meta, Paso, Perfil, Robot, Tarea,
} from './tipos';

const SELECT_TAREA = '*, tarea_responsables(usuario_id), tarea_pasos(*), evidencias(id, tipo)';

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traducirError(r.error.message));
  return r.data as T;
}

export function traducirError(m: string) {
  if (/row-level security|permission denied|42501/i.test(m)) return 'No tienes permiso para hacer eso.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin internet. Intenta cuando vuelva la conexión.';
  return m;
}

// ---------- Lecturas ----------
export const useAreas = () =>
  useQuery({ queryKey: ['areas'], queryFn: async () => ok(await supabase.from('areas').select('*').order('orden')) as Area[], staleTime: 3600_000 });

export const usePerfiles = () =>
  useQuery({ queryKey: ['perfiles'], queryFn: async () => ok(await supabase.from('profiles').select('*').order('nombre_visible')) as Perfil[] });

export const useMembresias = () =>
  useQuery({ queryKey: ['membresias'], queryFn: async () => ok(await supabase.from('membresias').select('*')) as Membresia[] });

export const useTutores = (activo = true) =>
  useQuery({
    queryKey: ['tutores_alumnos'],
    enabled: activo,
    queryFn: async () => ok(await supabase.from('tutores_alumnos').select('*')) as { tutor_id: string; alumno_id: string }[],
  });

export const useTareas = () =>
  useQuery({
    queryKey: ['tareas'],
    queryFn: async () => ok(await supabase.from('tareas').select(SELECT_TAREA).order('fecha_limite', { ascending: true, nullsFirst: false })) as Tarea[],
  });

export const useMetas = () =>
  useQuery({ queryKey: ['metas'], queryFn: async () => ok(await supabase.from('metas').select('*').order('fecha')) as Meta[] });

export const useCompetencias = () =>
  useQuery({ queryKey: ['competencias'], queryFn: async () => ok(await supabase.from('competencias').select('*').order('fecha_inicio')) as Competencia[] });

export const useAvanceMetas = () =>
  useQuery({ queryKey: ['avance_metas'], queryFn: async () => ok(await supabase.rpc('avance_metas')) as AvanceMeta[] });

export const useAvanceAreas = () =>
  useQuery({ queryKey: ['avance_areas'], queryFn: async () => ok(await supabase.rpc('avance_areas')) as AvanceArea[] });

export const useSolicitudes = (activo: boolean) =>
  useQuery({
    queryKey: ['solicitudes'],
    enabled: activo,
    queryFn: async () => ok(await supabase.from('solicitudes_reinicio').select('*').eq('atendida', false).order('creado_at')) as { id: string; usuario: string; creado_at: string }[],
  });

export function useTareaDetalle(id: string | undefined) {
  return useQuery({
    queryKey: ['tarea', id],
    enabled: !!id,
    queryFn: async () => {
      const [t, ev, co, hi] = await Promise.all([
        supabase.from('tareas').select(SELECT_TAREA).eq('id', id!).maybeSingle(),
        supabase.from('evidencias').select('*').eq('tarea_id', id!).order('creado_at'),
        supabase.from('comentarios').select('*').eq('tarea_id', id!).order('creado_at'),
        supabase.from('historial').select('*').eq('tarea_id', id!).order('creado_at', { ascending: false }),
      ]);
      const tarea = ok(t) as Tarea | null;
      if (tarea) tarea.tarea_pasos.sort((a, b) => a.orden - b.orden);
      const evidencias = ok(ev) as Evidencia[];
      // URLs firmadas para fotos privadas (1 hora)
      const fotos = evidencias.filter((e) => e.tipo === 'foto');
      const firmadas: Record<string, string> = {};
      if (fotos.length) {
        const { data } = await supabase.storage.from('evidencias').createSignedUrls(fotos.map((f) => f.url), 3600);
        data?.forEach((d, i) => d.signedUrl && (firmadas[fotos[i].id] = d.signedUrl));
      }
      return { tarea, evidencias, firmadas, comentarios: ok(co) as Comentario[], historial: ok(hi) as Historial[] };
    },
  });
}

// ---------- Cambios ----------
function useInvalidar() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['tareas'] });
    qc.invalidateQueries({ queryKey: ['avance_metas'] });
    qc.invalidateQueries({ queryKey: ['avance_areas'] });
    if (id) qc.invalidateQueries({ queryKey: ['tarea', id] });
  };
}

export function useMoverEstado() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: Estado }) => ok(await supabase.from('tareas').update({ estado }).eq('id', id).select('id')),
    onSuccess: (_d, v) => inv(v.id),
  });
}

export function usePedirAyuda() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, pide, mensaje }: { id: string; pide: boolean; mensaje?: string }) =>
      ok(await supabase.from('tareas').update({ pide_ayuda: pide, mensaje_ayuda: pide ? mensaje?.trim() || null : null }).eq('id', id).select('id')),
    onSuccess: (_d, v) => inv(v.id),
  });
}

export function useMarcarPaso() {
  const inv = useInvalidar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Pick<Paso, 'id' | 'tarea_id' | 'hecho'>) => ok(await supabase.from('tarea_pasos').update({ hecho: p.hecho }).eq('id', p.id).select('id')),
    onMutate: async (p) => {
      // Respuesta inmediata en pantalla
      qc.setQueryData(['tarea', p.tarea_id], (old: { tarea: Tarea } | undefined) =>
        old?.tarea ? { ...old, tarea: { ...old.tarea, tarea_pasos: old.tarea.tarea_pasos.map((x) => (x.id === p.id ? { ...x, hecho: p.hecho } : x)) } } : old,
      );
    },
    onSettled: (_d, _e, p) => inv(p.tarea_id),
  });
}

export function useComentar() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ tarea_id, texto, autor_id }: { tarea_id: string; texto: string; autor_id: string }) =>
      ok(await supabase.from('comentarios').insert({ tarea_id, texto: texto.trim(), autor_id }).select('id')),
    onSuccess: (_d, v) => inv(v.tarea_id),
  });
}

export function useAgregarEnlace() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ tarea_id, url, subida_por }: { tarea_id: string; url: string; subida_por: string }) => {
      const limpio = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
      new URL(limpio); // lanza si no es válida
      return ok(await supabase.from('evidencias').insert({ tarea_id, tipo: 'enlace', url: limpio, subida_por }).select('id'));
    },
    onSuccess: (_d, v) => inv(v.tarea_id),
  });
}

/** Comprime la foto en el navegador a menos de 300 KB y la sube al bucket privado. */
export function useSubirFoto() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ tarea_id, archivo, subida_por }: { tarea_id: string; archivo: File; subida_por: string }) => {
      const comprimida = await imageCompression(archivo, { maxSizeMB: 0.28, maxWidthOrHeight: 1600, useWebWorker: true, fileType: 'image/jpeg', initialQuality: 0.8 });
      const ruta = `${tarea_id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('evidencias').upload(ruta, comprimida, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(traducirError(up.error.message));
      return ok(await supabase.from('evidencias').insert({ tarea_id, tipo: 'foto', url: ruta, subida_por }).select('id'));
    },
    onSuccess: (_d, v) => inv(v.tarea_id),
  });
}

export function useAprobar() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => ok(await supabase.rpc('aprobar_tarea', { p_tarea: id })),
    onSuccess: (_d, id) => inv(id),
  });
}

export function useRegresar() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, nota }: { id: string; nota: string }) => ok(await supabase.rpc('regresar_tarea', { p_tarea: id, p_nota: nota })),
    onSuccess: (_d, v) => inv(v.id),
  });
}

export type TareaForm = {
  id?: string;
  titulo: string;
  para_que_sirve: string;
  area_id: string;
  meta_id: string | null;
  robot: Robot;
  fecha_limite: string | null;
  herramienta_url: string | null;
  responsables: string[];
  pasos: { id?: string; texto: string; hecho?: boolean }[];
};

export function useGuardarTarea() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (f: TareaForm) => {
      const datos = {
        titulo: f.titulo.trim(), para_que_sirve: f.para_que_sirve.trim(), area_id: f.area_id, meta_id: f.meta_id,
        robot: f.robot, fecha_limite: f.fecha_limite, herramienta_url: f.herramienta_url?.trim() || null,
      };
      let id = f.id;
      if (id) {
        ok(await supabase.from('tareas').update(datos).eq('id', id).select('id'));
      } else {
        const r = ok(await supabase.from('tareas').insert(datos).select('id').single()) as { id: string };
        id = r.id;
      }
      // Responsables: agrega los nuevos, quita los que ya no están
      const { data: actuales } = await supabase.from('tarea_responsables').select('usuario_id').eq('tarea_id', id);
      const ya = new Set((actuales ?? []).map((r) => r.usuario_id));
      const nuevos = f.responsables.filter((u) => !ya.has(u));
      const fuera = [...ya].filter((u) => !f.responsables.includes(u));
      if (nuevos.length) ok(await supabase.from('tarea_responsables').insert(nuevos.map((usuario_id) => ({ tarea_id: id, usuario_id }))).select('tarea_id'));
      if (fuera.length) ok(await supabase.from('tarea_responsables').delete().eq('tarea_id', id).in('usuario_id', fuera).select('tarea_id'));
      // Pasos: se reescriben en orden conservando lo hecho
      const pasos = f.pasos.filter((p) => p.texto.trim());
      const { data: viejos } = await supabase.from('tarea_pasos').select('id').eq('tarea_id', id);
      const conservar = new Set(pasos.filter((p) => p.id).map((p) => p.id));
      const borrar = (viejos ?? []).map((p) => p.id).filter((x) => !conservar.has(x));
      if (borrar.length) ok(await supabase.from('tarea_pasos').delete().in('id', borrar).select('id'));
      for (const [i, p] of pasos.entries()) {
        if (p.id) ok(await supabase.from('tarea_pasos').update({ orden: i + 1, texto: p.texto.trim() }).eq('id', p.id).select('id'));
        else ok(await supabase.from('tarea_pasos').insert({ tarea_id: id, orden: i + 1, texto: p.texto.trim() }).select('id'));
      }
      return id!;
    },
    onSuccess: (id) => inv(id),
  });
}

// ---------- Cuentas (Edge Function admin-accounts) ----------
export type Ficha = { usuario_id: string; usuario: string; password: string; nombre: string; rol: string; vence: string; tutor_de?: string };

export async function admin<T = { fichas: Ficha[] }>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  let r: Response;
  try {
    r = await fetch(`${FUNCIONES}/admin-accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new Error('Sin internet. Intenta cuando vuelva la conexión.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'No se pudo completar. Intenta de nuevo.');
  return j as T;
}

// ---------- Cálculos de negocio ----------
export const esMia = (t: Tarea, uid?: string) => !!uid && t.tarea_responsables.some((r) => r.usuario_id === uid);

/** Carga = tareas activas por persona. Verde 1–3, ámbar 4–5, vino 6+, punteado 0. */
export function cargaPorPersona(tareas: Tarea[]) {
  const c: Record<string, number> = {};
  for (const t of tareas) if (t.estado !== 'hecha') for (const r of t.tarea_responsables) c[r.usuario_id] = (c[r.usuario_id] ?? 0) + 1;
  return c;
}

export function tonoCarga(n: number): { fondo: string; texto: string; borde: string; nombre: string } {
  if (n === 0) return { fondo: '#fff', texto: '#6B5444', borde: '2px dashed #E0CCA8', nombre: 'sin tareas' };
  if (n <= 3) return { fondo: '#E3EEDF', texto: '#2E5A36', borde: '2px solid #2E5A36', nombre: 'carga ligera' };
  if (n <= 5) return { fondo: '#FCE7D6', texto: '#7A3E06', borde: '2px solid #E9A84F', nombre: 'carga media' };
  return { fondo: '#590202', texto: '#F3E2C1', borde: '2px solid #590202', nombre: 'carga alta' };
}
