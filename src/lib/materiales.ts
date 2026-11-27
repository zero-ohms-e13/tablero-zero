// Materiales del equipo: lecturas y cambios. La base decide qué se ve (RLS) y valida cada archivo.
// Toda escritura pasa por RPC; el cliente solo sube los archivos a Storage y luego los registra.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { FUNCIONES, supabase } from './supabase';
import { traducirError } from './datos';
import type { AdjuntoMaterial, AutorMaterial, CategoriaMaterial, ComentarioMaterial, Material } from './tipos';

const BUCKET = 'materiales';
export const MAX_ADJUNTOS = 10;
export const LIMITES = { imagen: 1024 * 1024, pdf: 10 * 1024 * 1024, codigo: 1024 * 1024 } as const;
export const EXT_CODIGO = ['ino', 'cpp', 'c', 'h', 'hpp', 'py', 'java', 'js', 'ts', 'json', 'md', 'txt', 'csv', 'yaml', 'yml'];

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traducirError(r.error.message));
  return r.data as T;
}

// ---------- Lecturas ----------
export type Feed = { materiales: Material[]; autores: Record<string, AutorMaterial> };

export const useMateriales = () =>
  useQuery({
    queryKey: ['materiales'],
    queryFn: async (): Promise<Feed> => {
      const [m, a] = await Promise.all([
        supabase
          .from('materiales')
          .select('*, material_adjuntos(*), material_comentarios(count)')
          .eq('estado', 'publicada')
          .order('publicado_at', { ascending: false })
          .limit(100),
        supabase.rpc('autores_materiales'),
      ]);
      const materiales = (ok(m) as Material[]).map((x) => ({ ...x, material_adjuntos: [...x.material_adjuntos].sort((p, q) => p.orden - q.orden) }));
      const autores = Object.fromEntries((ok(a) as AutorMaterial[]).map((p) => [p.id, p]));
      return { materiales, autores };
    },
    staleTime: 60_000,
  });

export const useComentariosMaterial = (material: string, activo: boolean) =>
  useQuery({
    queryKey: ['material_comentarios', material],
    enabled: activo,
    queryFn: async () =>
      ok(await supabase.from('material_comentarios').select('*').eq('material_id', material).order('creado_at')) as ComentarioMaterial[],
  });

/**
 * Pide un archivo a la Edge Function archivo-material, que revisa el permiso en CADA apertura y responde sin
 * caché: si la publicación se retiró, ya no sale. No hay URL firmadas que sigan sirviendo después.
 */
export async function pedirArchivo(ruta: string, descargar = false): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  let r: Response;
  try {
    r = await fetch(`${FUNCIONES}/archivo-material`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify({ ruta, descargar }),
    });
  } catch {
    throw new Error('Sin internet. Intenta cuando vuelva la conexión.');
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error ?? 'No se pudo abrir el archivo.');
  }
  return r.blob();
}

/** Abre (o descarga con su nombre) un archivo. La pestaña se abre antes de pedirlo para que el navegador no la bloquee. */
export async function abrirArchivo(a: AdjuntoMaterial, descargar = false) {
  const ventana = descargar ? null : window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await pedirArchivo(a.ruta!, descargar));
    if (descargar) {
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = a.nombre;
      enlace.click();
    } else if (ventana) {
      ventana.opener = null;
      ventana.location.href = url;
    } else {
      window.location.assign(url);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

/** Foto privada para mostrar en la tarjeta. Se vuelve a pedir al recargar el feed (sin caché persistente). */
export const useFotoMaterial = (ruta: string | null) =>
  useQuery({
    queryKey: ['foto-material', ruta],
    enabled: !!ruta,
    queryFn: () => pedirArchivo(ruta!),
    staleTime: 60_000,
    gcTime: 60_000,
    retry: 1,
  });

// ---------- Limpieza de borradores abandonados (solo coach principal) ----------
export type InformeLimpieza = {
  modo: 'simular' | 'borrar'; dias: number; borradores: number; huerfanos: number; archivos: number; bytes: number; quedan: boolean;
  hecho?: { borradores: number; archivos: number; bytes: number; omitidos: number; errores: number };
};
export async function limpiarMateriales(modo: 'simular' | 'borrar'): Promise<InformeLimpieza> {
  const { data } = await supabase.auth.getSession();
  let r: Response;
  try {
    r = await fetch(`${FUNCIONES}/limpiar-materiales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '' },
      body: JSON.stringify({ modo }),
    });
  } catch {
    throw new Error('Sin internet. Intenta cuando vuelva la conexión.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'No se pudo revisar la limpieza.');
  return j as InformeLimpieza;
}

/** Texto de un archivo de código para mostrarlo (nunca se ejecuta). No va a la caché persistente. */
export async function leerCodigo(a: AdjuntoMaterial) {
  return (await pedirArchivo(a.ruta!)).text();
}

// ---------- Preparar archivos (en el teléfono, antes de subir) ----------
export type ClaseArchivo = 'imagen' | 'pdf' | 'codigo';
export function claseDe(f: File): ClaseArchivo | null {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (f.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'imagen';
  if (f.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (EXT_CODIGO.includes(ext)) return 'codigo';
  return null;
}

export function validarArchivo(f: File): string | null {
  const c = claseDe(f);
  if (!c) return `«${f.name}» no es un tipo permitido. Sube fotos, PDF o archivos de código (.ino, .cpp, .py…).`;
  if (c === 'pdf' && f.size > LIMITES.pdf) return `«${f.name}» pesa más de 10 MB.`;
  if (c === 'codigo' && f.size > LIMITES.codigo) return `«${f.name}» pesa más de 1 MB.`;
  if (c === 'imagen' && f.size > 25 * 1024 * 1024) return `«${f.name}» es demasiado grande para comprimirla.`;
  return null;
}

/** Devuelve el contenido listo para Storage: foto comprimida a JPEG, PDF tal cual, código como texto plano. */
async function preparar(f: File, clase: ClaseArchivo): Promise<{ cuerpo: Blob; ext: 'jpg' | 'pdf' | 'txt'; tipo: string }> {
  if (clase === 'imagen') {
    const c = await imageCompression(f, { maxSizeMB: 0.9, maxWidthOrHeight: 2000, useWebWorker: true, fileType: 'image/jpeg', initialQuality: 0.82 });
    return { cuerpo: c, ext: 'jpg', tipo: 'image/jpeg' };
  }
  if (clase === 'pdf') return { cuerpo: f, ext: 'pdf', tipo: 'application/pdf' };
  return { cuerpo: new Blob([await f.text()], { type: 'text/plain' }), ext: 'txt', tipo: 'text/plain' };
}

// ---------- Publicar (resistente a fallos y reintentos) ----------
/** Un archivo del formulario. `uid` fija su ruta en Storage para que un reintento no lo duplique. */
export type ArchivoPendiente = { uid: string; archivo: File; clase: ClaseArchivo; registrado?: string };
export type Borrador = {
  clienteId: string; // un intento de publicación = un borrador en el servidor
  titulo: string; nota: string; categoria: CategoriaMaterial; area: string | null; tarea: string | null;
  archivos: ArchivoPendiente[]; enlaces: string[];
};

export function usePublicarMaterial() {
  const qc = useQueryClient();
  return useMutation({
    /** `avance` informa cada archivo ya registrado para no repetirlo si el siguiente intento continúa. */
    mutationFn: async ({ b, avance }: { b: Borrador; avance: (uid: string, adjunto: string) => void }) => {
      const id = ok(await supabase.rpc('crear_material', {
        p_cliente_id: b.clienteId, p_titulo: b.titulo, p_categoria: b.categoria, p_nota: b.nota || null, p_area: b.area, p_tarea: b.tarea,
      })) as string;
      // Si es un reintento, el borrador ya existía: sincroniza lo que se haya corregido en el formulario
      ok(await supabase.rpc('editar_material', { p_material: id, p_titulo: b.titulo, p_nota: b.nota || null, p_categoria: b.categoria }));
      for (const a of b.archivos) {
        if (a.registrado) continue;
        const { cuerpo, ext, tipo } = await preparar(a.archivo, a.clase);
        const ruta = `${id}/${a.uid}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(ruta, cuerpo, { contentType: tipo, upsert: false });
        // "ya existe" = subida anterior que llegó aunque se perdió la respuesta: se registra igual
        if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(traducirError(up.error.message));
        const adj = ok(await supabase.rpc('agregar_adjunto', { p_material: id, p_tipo: 'archivo', p_nombre: a.archivo.name, p_ruta: ruta, p_clase: a.clase })) as string;
        avance(a.uid, adj);
      }
      for (const url of b.enlaces) ok(await supabase.rpc('agregar_adjunto', { p_material: id, p_tipo: 'enlace', p_nombre: '', p_url: url }));
      ok(await supabase.rpc('publicar_material', { p_material: id }));
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materiales'] }),
  });
}

/** Quitar del formulario un archivo que ya se había registrado en un intento fallido. */
export async function quitarRegistrado(adjunto: string) {
  ok(await supabase.rpc('quitar_adjunto', { p_adjunto: adjunto }));
}

export function useEditarMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; titulo: string; nota: string; categoria: CategoriaMaterial }) =>
      ok(await supabase.rpc('editar_material', { p_material: v.id, p_titulo: v.titulo, p_nota: v.nota || null, p_categoria: v.categoria })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materiales'] }),
  });
}

export function useRetirarMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => ok(await supabase.rpc('retirar_material', { p_material: id })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['materiales'] }),
  });
}

export function useComentarMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { material: string; clienteId: string; texto: string }) =>
      ok(await supabase.rpc('comentar_material', { p_material: v.material, p_cliente_id: v.clienteId, p_texto: v.texto })),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['material_comentarios', v.material] });
      qc.invalidateQueries({ queryKey: ['materiales'] });
    },
  });
}

export function useRetirarComentario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; material: string }) => ok(await supabase.rpc('retirar_comentario_material', { p_comentario: v.id })),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['material_comentarios', v.material] });
      qc.invalidateQueries({ queryKey: ['materiales'] });
    },
  });
}

/** Etiqueta amigable para un enlace según su sitio. */
export function sitioDe(url: string): { texto: string; icono: string } {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h === 'github.com' || h.endsWith('.github.com')) return { texto: /\/commit\//.test(url) ? 'Commit en GitHub' : 'GitHub', icono: 'codigo' };
    if (h.endsWith('drive.google.com') || h.endsWith('docs.google.com')) return { texto: 'Google Drive', icono: 'documento' };
    if (h.endsWith('youtube.com') || h === 'youtu.be' || h.endsWith('vimeo.com')) return { texto: 'Video', icono: 'camara' };
    return { texto: h, icono: 'enlace' };
  } catch {
    return { texto: 'Enlace', icono: 'enlace' };
  }
}
