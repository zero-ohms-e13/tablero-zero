// POST /functions/v1/admin-accounts  (Authorization: Bearer <sesión del coach>)
// Única puerta para crear cuentas, reiniciar contraseñas y borrar datos.
// Acciones: crear | reiniciar | estado | borrar
import {
  clienteServicio, correoDe, cors, inicialesDe, json, passwordTemporal, usuarioDesdeNombre, USUARIO_RE,
} from '../_shared/comun.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.50.0';

const VIGENCIA_DIAS = 7;
const COLORES = ['#2F5D8A', '#7A3E06', '#2E5A36', '#8A3B6B', '#590202', '#5A4335'];

type Membresia = { area_id: string; es_lider?: boolean };
type Ficha = { usuario_id: string; usuario: string; password: string; nombre: string; rol: string; vence: string; tutor_de?: string };

const vence = () => new Date(Date.now() + VIGENCIA_DIAS * 86_400_000).toISOString();

async function usuarioLibre(srv: SupabaseClient, base: string): Promise<string> {
  const limpio = base.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '') || 'usuario';
  const { data } = await srv.from('profiles').select('usuario').like('usuario', `${limpio}%`);
  const usados = new Set((data ?? []).map((r) => r.usuario));
  if (!usados.has(limpio)) return limpio;
  for (let i = 2; i < 100; i++) if (!usados.has(`${limpio}${i}`)) return `${limpio}${i}`;
  throw new Error('No hay usuario libre');
}

// Acepta la temporal que el coach ve en pantalla solo si sigue el formato palabra-número.
const TEMPORAL_RE = /^[a-z]{2,10}-\d{3}$/;

async function crearCuenta(
  srv: SupabaseClient,
  d: { nombre: string; usuario: string; rol: string; color: string; password?: string },
): Promise<Ficha> {
  const password = d.password && TEMPORAL_RE.test(d.password) ? d.password : passwordTemporal();
  const { data, error } = await srv.auth.admin.createUser({
    email: correoDe(d.usuario),
    password,
    email_confirm: true,
    user_metadata: {},
  });
  if (error || !data.user) throw new Error(error?.message ?? 'No se pudo crear la cuenta');
  const v = vence();
  const { error: e2 } = await srv.from('profiles').insert({
    id: data.user.id,
    usuario: d.usuario,
    nombre_visible: d.nombre,
    iniciales: inicialesDe(d.nombre),
    color: d.color,
    rol_global: d.rol,
    debe_cambiar_password: true,
    password_temporal_vence: v,
  });
  if (e2) {
    await srv.auth.admin.deleteUser(data.user.id);
    throw new Error(e2.message);
  }
  return { usuario_id: data.user.id, usuario: d.usuario, password, nombre: d.nombre, rol: d.rol, vence: v };
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
      // Crea alumno (y opcionalmente su tutor) o una cuenta de coach auxiliar / tutor suelto.
      case 'crear': {
        const nombre = String(body.nombre ?? '').trim().replace(/\s+/g, ' ');
        const rol = String(body.rol ?? 'alumno');
        if (nombre.length < 2 || nombre.length > 40) return json(req, { error: 'Escribe un nombre de 2 a 40 letras.' }, 400);
        if (!['alumno', 'tutor', 'coach_aux'].includes(rol)) return json(req, { error: 'Rol no válido.' }, 400);
        if (rol === 'coach_aux' && yo.rol_global !== 'coach') return json(req, { error: 'Solo el coach principal crea mentores.' }, 403);

        let usuarioPedido = String(body.usuario ?? '').trim().toLowerCase();
        if (usuarioPedido && !USUARIO_RE.test(usuarioPedido)) {
          return json(req, { error: 'El usuario solo lleva minúsculas, números y puntos.' }, 400);
        }
        if (!usuarioPedido) usuarioPedido = usuarioDesdeNombre(nombre);
        if (rol === 'tutor' && !usuarioPedido.startsWith('tutor.')) usuarioPedido = `tutor.${usuarioPedido}`;
        const usuario = await usuarioLibre(srv, usuarioPedido);

        const membresias = (Array.isArray(body.membresias) ? body.membresias : []) as Membresia[];
        const color = String(body.color ?? COLORES[Math.floor(Math.random() * COLORES.length)]);
        const fichas: Ficha[] = [];

        const cuenta = await crearCuenta(srv, { nombre, usuario, rol, color, password: typeof body.password === 'string' ? body.password : undefined });
        fichas.push(cuenta);

        if (rol === 'alumno' && membresias.length) {
          const { error } = await srv.from('membresias').insert(
            membresias.map((m) => ({ usuario_id: cuenta.usuario_id, area_id: m.area_id, es_lider: !!m.es_lider })),
          );
          if (error) throw new Error(error.message);
        }

        // Tutor en el mismo paso
        if (rol === 'alumno' && body.con_tutor) {
          const tutorUsuario = await usuarioLibre(srv, `tutor.${usuario}`);
          const tutor = await crearCuenta(srv, {
            nombre: `Familia de ${nombre.split(' ')[0]}`,
            usuario: tutorUsuario,
            rol: 'tutor',
            color: '#5A4335',
          });
          tutor.tutor_de = nombre;
          await srv.from('tutores_alumnos').insert({ tutor_id: tutor.usuario_id, alumno_id: cuenta.usuario_id });
          fichas.push(tutor);
        }

        // Tutor suelto vinculado a un alumno ya existente
        if (rol === 'tutor' && typeof body.alumno_id === 'string') {
          await srv.from('tutores_alumnos').insert({ tutor_id: cuenta.usuario_id, alumno_id: body.alumno_id });
        }
        return json(req, { fichas });
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
        await srv.from('intentos_login').delete().eq('usuario', p.usuario);
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
        const { data } = await srv.from('intentos_login').select('usuario, bloqueado_hasta').gt('bloqueado_hasta', new Date().toISOString());
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
