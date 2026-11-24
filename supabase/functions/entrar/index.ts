// POST /functions/v1/entrar  { usuario, password }
// Inicia sesión con usuario (sin correo) y aplica:
// - bloqueo de 10 minutos tras 5 intentos fallidos
// - cuentas desactivadas
// - vigencia de 7 días de la contraseña temporal
import { clienteAnonimo, clienteServicio, correoDe, json, cors, USUARIO_RE } from '../_shared/comun.ts';

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { codigo: 'metodo' }, 405);

  let usuario = '';
  let password = '';
  try {
    const body = await req.json();
    usuario = String(body.usuario ?? '').trim().toLowerCase();
    password = String(body.password ?? '');
  } catch {
    return json(req, { codigo: 'datos' }, 400);
  }
  if (!USUARIO_RE.test(usuario) || usuario.length > 40 || password.length === 0 || password.length > 72) {
    return json(req, { codigo: 'incorrecta' }, 401);
  }

  const srv = clienteServicio();
  const ahora = new Date();

  const { data: intento } = await srv.from('intentos_login').select('*').eq('usuario', usuario).maybeSingle();
  if (intento?.bloqueado_hasta && new Date(intento.bloqueado_hasta) > ahora) {
    return json(req, { codigo: 'bloqueada', hasta: intento.bloqueado_hasta }, 423);
  }

  const { data: sesion, error } = await clienteAnonimo().auth.signInWithPassword({
    email: correoDe(usuario),
    password,
  });

  if (error || !sesion.session) {
    const fallidos = (intento?.bloqueado_hasta ? 0 : intento?.fallidos ?? 0) + 1;
    const bloquear = fallidos >= MAX_INTENTOS;
    const hasta = bloquear ? new Date(ahora.getTime() + BLOQUEO_MIN * 60_000).toISOString() : null;
    await srv.from('intentos_login').upsert({
      usuario,
      fallidos: bloquear ? 0 : fallidos,
      bloqueado_hasta: hasta,
      actualizado_at: ahora.toISOString(),
    });
    if (bloquear) return json(req, { codigo: 'bloqueada', hasta }, 423);
    return json(req, { codigo: 'incorrecta', restantes: MAX_INTENTOS - fallidos }, 401);
  }

  const { data: perfil } = await srv
    .from('profiles')
    .select('activo, debe_cambiar_password, password_temporal_vence')
    .eq('id', sesion.user.id)
    .maybeSingle();

  const rechazar = async (codigo: string, status: number) => {
    await srv.auth.admin.signOut(sesion.session!.access_token).catch(() => {});
    return json(req, { codigo }, status);
  };

  if (!perfil || !perfil.activo) return rechazar('inactiva', 403);
  if (perfil.debe_cambiar_password && perfil.password_temporal_vence && new Date(perfil.password_temporal_vence) < ahora) {
    return rechazar('temporal_vencida', 403);
  }

  await srv.from('intentos_login').delete().eq('usuario', usuario);

  return json(req, {
    access_token: sesion.session.access_token,
    refresh_token: sesion.session.refresh_token,
  });
});
