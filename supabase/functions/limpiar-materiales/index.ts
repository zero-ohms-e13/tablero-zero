// POST /functions/v1/limpiar-materiales  { modo: 'simular' | 'borrar', dias?: number }
// Quién: el coach principal (con su sesión) o una tarea programada con la llave de servicio.
// Limpia borradores de Materiales sin actividad por N días (30 por omisión) y archivos huérfanos.
// Primero se simula; borrar es un paso aparte. Ver _shared/limpieza-logica.ts.
import { clienteServicio, cors, json } from '../_shared/comun.ts';
import { DIAS, limpiar, type Pendiente } from '../_shared/limpieza-logica.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido.' }, 405);
  const srv = clienteServicio();
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'Inicia sesión.' }, 401);
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const { data: quien } = await srv.auth.getUser(token);
    if (!quien.user) return json(req, { error: 'Inicia sesión.' }, 401);
    const { data: p } = await srv.from('profiles').select('rol_global, activo').eq('id', quien.user.id).maybeSingle();
    if (!p || !p.activo || p.rol_global !== 'coach') return json(req, { error: 'Solo el coach principal limpia Materiales.' }, 403);
  }
  const body = (await req.json().catch(() => ({}))) as { modo?: string; dias?: number };
  const modo = body.modo === 'borrar' ? 'borrar' : 'simular';

  const informe = await limpiar(modo, Number(body.dias ?? DIAS), {
    porLimpiar: async (dias) => {
      const { data, error } = await srv.rpc('materiales_por_limpiar', { p_dias: dias });
      if (error) throw error;
      return (data ?? []) as Pendiente[];
    },
    borrarBorrador: async (material, dias) => {
      const { data, error } = await srv.rpc('borrar_borrador_vencido', { p_material: material, p_dias: dias });
      if (error) throw error;
      return data === true;
    },
    sigueHuerfano: async (ruta) => {
      const { data, error } = await srv.rpc('sigue_huerfano', { p_ruta: ruta });
      if (error) throw error;
      return data === true;
    },
    quitarArchivos: async (rutas) => {
      const { error } = await srv.storage.from('materiales').remove(rutas);
      if (error) throw error;
    },
  }).catch(() => null);
  if (!informe) return json(req, { error: 'No se pudo revisar Materiales. Intenta de nuevo.' }, 503);
  return json(req, informe);
});
