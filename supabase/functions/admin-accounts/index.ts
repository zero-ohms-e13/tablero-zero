// POST /functions/v1/admin-accounts  (Authorization: Bearer <sesión del coach>)
// Única puerta para crear cuentas, reiniciar contraseñas y borrar datos.
// Acciones: crear | reiniciar | estado | borrar
import { clienteServicio, correoDe, cors, json, passwordTemporal } from '../_shared/comun.ts';
import { procesarAlta, type Deps } from '../_shared/alta-logica.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.50.0';

const VIGENCIA_DIAS = 7;
const BLOQUEO = '876000h';

type Ficha = { usuario_id: string; usuario: string; password: string; nombre: string; rol: string; vence: string; tutor_de?: string };

const vence = () => new Date(Date.now() + VIGENCIA_DIAS * 86_400_000).toISOString();

// FUN-003: dependencias reales de la lógica de alta (alta-logica.ts, probada con Vitest).
function depsAlta(srv: SupabaseClient): Deps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await srv.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  return {
    areasExistentes: async (ids) => {
      const { data, error } = await srv.from('areas').select('id').in('id', ids);
      if (error) throw error;
      return (data ?? []).map((r) => r.id);
    },
    esAlumno: async (id) => {
      const { data, error } = await srv.from('profiles').select('id').eq('id', id).eq('rol_global', 'alumno').maybeSingle();
      if (error) throw error;
      return !!data;
    },
    usuariosOcupados: async (base) => {
      const { data, error } = await srv.from('profiles').select('usuario').like('usuario', `${base}%`);
      if (error) throw error;
      return (data ?? []).map((r) => r.usuario);
    },
    iniciar: (sol, coach, huella) => rpc('iniciar_alta', { p_solicitud: sol, p_coach: coach, p_huella: huella }),
    registrarCreado: async (sol, id) => {
      await rpc('registrar_creado_alta', { p_solicitud: sol, p_id: id });
    },
    olvidarCreados: async (sol, ids) => {
      await rpc('olvidar_creados_alta', { p_solicitud: sol, p_ids: ids });
    },
    marcar: async (sol, estado, err) => {
      await rpc('marcar_alta', { p_solicitud: sol, p_estado: estado, p_error: err });
    },
    crearIdentidad: async (usuario, password, solicitud) => {
      const { data, error } = await srv.auth.admin.createUser({
        email: correoDe(usuario), password, email_confirm: true, user_metadata: {}, app_metadata: { alta: solicitud }, ban_duration: BLOQUEO,
      });
      if (!error && data.user) return { ok: true, id: data.user.id };
      const e = error as { status?: number; code?: string } | null;
      return { ok: false, existe: e?.status === 422 || e?.code === 'email_exists' || e?.code === 'user_already_exists' };
    },
    borrarIdentidad: async (id) => {
      const { error } = await srv.auth.admin.deleteUser(id);
      return !error || (error as { status?: number }).status === 404;
    },
    completar: async (p) => {
      await rpc('completar_alta', { p });
    },
    identidadDeSolicitud: async (usuario, solicitud) => {
      // Busca la identidad por correo entre las páginas del listado de Auth (equipos pequeños: pocas páginas)
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await srv.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const u = data.users.find((x) => x.email === correoDe(usuario));
        if (u) return u.app_metadata?.alta === solicitud ? u.id : null;
        if (data.users.length < 200) return null;
      }
      return null;
    },
    activar: async (id) => {
      const { error } = await srv.auth.admin.updateUserById(id, { ban_duration: 'none' });
      if (error) throw error;
    },
    bloquear: async (id) => {
      const { error } = await srv.auth.admin.updateUserById(id, { ban_duration: BLOQUEO });
      if (error) throw error;
    },
    fijarPassword: async (id, password) => {
      const { error } = await srv.auth.admin.updateUserById(id, { password });
      if (error) throw error;
    },
    password: passwordTemporal,
    ahora: () => new Date(),
    uuid: () => crypto.randomUUID(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido' }, 405);

  const srv = clienteServicio();
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: quien } = await srv.auth.getUser(token);
  if (!quien?.user) return json(req, { error: 'Tu sesión terminó. Vuelve a entrar.' }, 401);

  const { data: yo } = await srv.from('profiles').select('id, rol_global, activo').eq('id', quien.user.id).maybeSingle();
  if (!yo?.activo || !['coach', 'coach_aux'].includes(yo.rol_global)) {
    return json(req, { error: 'Solo el coach maneja cuentas.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Datos no válidos.' }, 400);
  }

  try {
    switch (body.accion) {
      // Crea alumno (y opcionalmente su tutor), tutor suelto o mentor. FUN-003: validación previa,
      // escrituras en una transacción, compensación limitada a esta solicitud y reintento idempotente.
      case 'crear': {
        const r = await procesarAlta(body, { id: yo.id, rol_global: yo.rol_global }, depsAlta(srv));
        if (r.status >= 500) console.error('alta', r.body.estado ?? '');
        return json(req, r.body, r.status);
      }

      // Reinicia sin mostrar la anterior: genera otra temporal con 7 días de vigencia.
      case 'reiniciar': {
        const id = String(body.usuario_id ?? '');
        const { data: p } = await srv.from('profiles').select('id, usuario, nombre_visible, rol_global').eq('id', id).maybeSingle();
        if (!p) return json(req, { error: 'No encontramos esa cuenta.' }, 404);
        if (p.rol_global === 'coach' && p.id !== yo.id) return json(req, { error: 'No puedes reiniciar al coach principal.' }, 403);
        const password = passwordTemporal();
        const { error } = await srv.auth.admin.updateUserById(id, { password });
        if (error) throw new Error(error.message);
        const v = vence();
        await srv.from('profiles').update({ debe_cambiar_password: true, password_temporal_vence: v }).eq('id', id);
        await srv.rpc('desbloquear_usuario', { p_usuario: p.usuario }); // SEG-004: quita bloqueos en todos los orígenes
        await srv.from('solicitudes_reinicio').update({ atendida: true }).eq('usuario', p.usuario).eq('atendida', false);
        const ficha: Ficha = { usuario_id: id, usuario: p.usuario, password, nombre: p.nombre_visible, rol: p.rol_global, vence: v };
        return json(req, { fichas: [ficha] });
      }

      // Activa o desactiva (egresados). Desactivar corta la sesión.
      case 'estado': {
        const id = String(body.usuario_id ?? '');
        const activo = !!body.activo;
        if (id === yo.id) return json(req, { error: 'No puedes desactivar tu propia cuenta.' }, 400);
        const { data: p } = await srv.from('profiles').select('rol_global').eq('id', id).maybeSingle();
        if (p?.rol_global === 'coach') return json(req, { error: 'No puedes desactivar al coach principal.' }, 403);
        await srv.from('profiles').update({ activo }).eq('id', id);
        await srv.auth.admin.updateUserById(id, { ban_duration: activo ? 'none' : '876000h' });
        return json(req, { ok: true });
      }

      // Borra la cuenta y sus datos personales (cierre de ciclo). Solo el coach principal.
      case 'borrar': {
        if (yo.rol_global !== 'coach') return json(req, { error: 'Solo el coach principal borra cuentas.' }, 403);
        const id = String(body.usuario_id ?? '');
        if (id === yo.id) return json(req, { error: 'No puedes borrar tu propia cuenta.' }, 400);
        const { data: fotos } = await srv.from('evidencias').select('url').eq('subida_por', id).eq('tipo', 'foto');
        if (fotos?.length) await srv.storage.from('evidencias').remove(fotos.map((f) => f.url));
        await srv.from('evidencias').delete().eq('subida_por', id);
        await srv.from('comentarios').delete().eq('autor_id', id);
        const { error } = await srv.auth.admin.deleteUser(id); // profiles y relaciones caen en cascada
        if (error) throw new Error(error.message);
        return json(req, { ok: true });
      }

      // Usuarios bloqueados ahora por intentos fallidos (para mostrar "Bloqueada").
      case 'bloqueos': {
        const { data, error } = await srv.rpc('usuarios_bloqueados');
        if (error) throw new Error(error.message);
        return json(req, { bloqueos: data ?? [] });
      }

      default:
        return json(req, { error: 'Acción no válida.' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json(req, { error: 'No se pudo completar. Intenta de nuevo.' }, 500);
  }
});
