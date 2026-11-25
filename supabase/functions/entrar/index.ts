// POST /functions/v1/entrar  { usuario, password }
// Inicio de sesión con usuario (sin correo). La lógica vive en _shared/entrar-logica.ts (probada con Vitest).
// SEG-004: limitación por usuario+origen, por origen y tope global por usuario, con admisión atómica en SQL antes de Auth;
// sin bloqueo global previo. Cuenta inactiva y temporal vencida se conservan.
import { clienteAnonimo, clienteServicio, correoDe, cors, json } from '../_shared/comun.ts';
import { ipCliente, procesarEntrada, type Deps } from '../_shared/entrar-logica.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { codigo: 'metodo' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { codigo: 'incorrecta' }, 401);
  }

  const srv = clienteServicio();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await srv.rpc(fn, args);
    if (error) throw error;
    return data;
  };

  const deps: Deps = {
    reservar: (u, ip) => rpc('reservar_intento', { p_usuario: u, p_ip: ip }),
    liquidar: async (reserva, resultado) => {
      await rpc('liquidar_intento', { p_reserva: reserva, p_resultado: resultado });
    },
    autenticar: async (u, password) => {
      const { data, error } = await clienteAnonimo().auth.signInWithPassword({ email: correoDe(u), password });
      if (!error && data.session) {
        return { tipo: 'ok', userId: data.user.id, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
      }
      // 400 con credenciales inválidas (o usuario baneado = desactivado) cuenta como intento; lo demás es infraestructura
      const status = (error as { status?: number } | null)?.status ?? 0;
      return status === 400 ? { tipo: 'credenciales' } : { tipo: 'infra' };
    },
    perfil: async (id) => {
      const { data, error } = await srv.from('profiles').select('activo, debe_cambiar_password, password_temporal_vence').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    cerrarSesion: async (token) => {
      await srv.auth.admin.signOut(token);
    },
    ahora: () => new Date(),
  };

  const r = await procesarEntrada(body, ipCliente((n) => req.headers.get(n)), deps);
  // Limpieza ocasional de contadores viejos (no afecta la respuesta)
  if (Math.random() < 0.02) srv.rpc('purgar_intentos').then(() => {}, () => {});
  return json(req, r.body, r.status);
});
