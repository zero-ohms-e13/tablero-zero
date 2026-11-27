// POST /functions/v1/archivo-material  { ruta, descargar? }   (Authorization: Bearer <sesión>)
// Única puerta para abrir archivos de Materiales. En CADA solicitud revisa en la base si esa persona puede
// verlo (archivo_material) y responde sin caché: al retirar una publicación, la siguiente apertura se niega.
// El navegador ya no puede firmar URLs de esos archivos (ver migración 20261201000015).
import { clienteServicio, cors, json } from '../_shared/comun.ts';

const RUTA_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]{1,200}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido.' }, 405);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const body = (await req.json().catch(() => ({}))) as { ruta?: unknown; descargar?: unknown };
  const ruta = typeof body.ruta === 'string' ? body.ruta : '';
  if (!token) return json(req, { error: 'Inicia sesión.' }, 401);
  if (!RUTA_RE.test(ruta)) return json(req, { error: 'Archivo no válido.' }, 400);

  const srv = clienteServicio();
  const { data: quien } = await srv.auth.getUser(token);
  if (!quien.user) return json(req, { error: 'Inicia sesión.' }, 401);
  const { data: permiso, error: ep } = await srv.rpc('archivo_material', { p_usuario: quien.user.id, p_ruta: ruta });
  if (ep) return json(req, { error: 'No se pudo revisar el permiso. Intenta de nuevo.' }, 503);
  const fila = (permiso as { nombre: string; clase: string }[] | null)?.[0];
  if (!fila) return json(req, { error: 'Ese archivo ya no está disponible o no tienes acceso.' }, 404);

  const { data: archivo, error: ed } = await srv.storage.from('materiales').download(ruta);
  if (ed || !archivo) return json(req, { error: 'Ese archivo ya no está disponible.' }, 404);
  // El código siempre como texto plano (nunca se interpreta); fotos y PDF con su tipo.
  const tipo = fila.clase === 'codigo' || !/^(image\/(jpeg|png|webp)|application\/pdf|text\/plain)/.test(archivo.type)
    ? 'text/plain; charset=utf-8'
    : archivo.type;
  const modo = body.descargar === true ? 'attachment' : 'inline';
  return new Response(archivo, {
    status: 200,
    headers: {
      ...cors(req),
      'Content-Type': tipo,
      'Content-Disposition': `${modo}; filename*=UTF-8''${encodeURIComponent(fila.nombre)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    },
  });
});
