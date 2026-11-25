// Materiales del equipo: lecturas y cambios. La base decide qué se ve (RLS) y valida cada archivo.
// Toda escritura pasa por RPC; el cliente solo sube los archivos a Storage y luego los registra.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';
import { traducirError } from './datos';
import type { AdjuntoMaterial, AutorMaterial, CategoriaMaterial, ComentarioMaterial, Material } from './tipos';

const BUCKET = 'materiales';
/** Vigencia de los enlaces firmados de fotos y descargas (la RLS se revisa al firmar). */
export const VIGENCIA_FIRMA = 30 * 60;
export const MAX_ADJUNTOS = 10;
export const LIMITES = { imagen: 1024 * 1024, pdf: 10 * 1024 * 1024, codigo: 1024 * 1024 } as const;
export const EXT_CODIGO = ['ino', 'cpp', 'c', 'h', 'hpp', 'py', 'java', 'js', 'ts', 'json', 'md', 'txt', 'csv', 'yaml', 'yml'];

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traducirError(r.error.message));
  return r.data as T;
}

// ---------- Lecturas ----------
export type Feed = { materiales: Material[]; autores: Record<string, AutorMaterial>; fotos: Record<string, string> };

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
      // Fotos privadas: URL firmada (Storage vuelve a revisar el permiso al firmar)
      const rutas = materiales.flatMap((x) => x.material_adjuntos).filter((j) => j.clase === 'imagen' && j.ruta).map((j) => j.ruta!);
      const fotos: Record<string, string> = {};
      if (rutas.length) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrls(rutas, VIGENCIA_FIRMA);
        data?.forEach((d, i) => d.signedUrl && (fotos[rutas[i]] = d.signedUrl));
      }
      return { materiales, autores, fotos };
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

/** Enlace firmado para abrir o descargar un archivo (con su nombre original al descargar). */
export async function enlaceArchivo(a: AdjuntoMaterial, descargar = false) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.ruta!, VIGENCIA_FIRMA, descargar ? { download: a.nombre } : undefined);
  if (error || !data) throw new Error(traducirError(error?.message ?? 'No se pudo abrir el archivo.'));
  return data.signedUrl;
}

/** Texto de un archivo de código para mostrarlo (nunca se ejecuta). No va a la caché persistente. */
export async function leerCodigo(a: AdjuntoMaterial) {
  const r = await fetch(await enlaceArchivo(a));
  if (!r.ok) throw new Error('No se pudo leer el archivo.');
  return r.text();
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
