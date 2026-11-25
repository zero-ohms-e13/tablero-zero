// Lógica de inicio de sesión sin dependencias de Deno ni de red: se prueba con Vitest
// inyectando dependencias controladas (SEG-004).

export const USUARIO_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

export type ResultadoAuth =
  | { tipo: 'ok'; userId: string; access_token: string; refresh_token: string }
  | { tipo: 'credenciales' } // usuario o contraseña incorrectos
  | { tipo: 'infra' }; // Auth no respondió bien: no cuenta como intento fallido

export type Perfil = { activo: boolean; debe_cambiar_password: boolean; password_temporal_vence: string | null } | null;

export type Reserva = { permitido: boolean; hasta: string | null };

export type Deps = {
  /** Admisión atómica antes de Auth: reserva el intento o lo rechaza si hay bloqueo vigente. */
  reservar(usuario: string, ip: string): Promise<Reserva>;
  /** Devuelve la reserva (error de infraestructura: no cuenta como contraseña incorrecta). */
  liberar(usuario: string, ip: string): Promise<void>;
  accesoCorrecto(usuario: string, ip: string): Promise<void>;
  autenticar(usuario: string, password: string): Promise<ResultadoAuth>;
  perfil(userId: string): Promise<Perfil>;
  cerrarSesion(accessToken: string): Promise<void>;
  ahora(): Date;
};

export type Respuesta = { status: number; body: Record<string, unknown> };

/** IP del cliente: el ÚLTIMO valor de X-Forwarded-For es el que agrega el proxy de confianza;
 *  los anteriores los puede inventar el cliente. Sin cabecera, un cubo común. */
export function ipCliente(xff: string | null | undefined): string {
  const partes = (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = partes[partes.length - 1] ?? '';
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : 'sin-ip';
}

export async function procesarEntrada(entrada: { usuario?: unknown; password?: unknown }, ip: string, deps: Deps): Promise<Respuesta> {
  const usuario = String(entrada.usuario ?? '').trim().toLowerCase();
  const password = String(entrada.password ?? '');
  // Respuesta genérica para datos mal formados: no revela si el usuario existe
  if (!USUARIO_RE.test(usuario) || usuario.length > 40 || password.length === 0 || password.length > 72) {
    return { status: 401, body: { codigo: 'incorrecta' } };
  }

  // 1) Admisión atómica (par usuario+origen, origen verificado y tope global del usuario)
  let reserva: Reserva;
  try {
    reserva = await deps.reservar(usuario, ip);
  } catch {
    return { status: 503, body: { codigo: 'servicio' } };
  }
  if (!reserva.permitido) return { status: 423, body: { codigo: 'bloqueada', hasta: reserva.hasta } };

  // 2) Autenticación
  const auth = await deps.autenticar(usuario, password).catch((): ResultadoAuth => ({ tipo: 'infra' }));
  if (auth.tipo === 'infra') {
    await deps.liberar(usuario, ip).catch(() => {});
    return { status: 503, body: { codigo: 'servicio' } };
  }
  if (auth.tipo === 'credenciales') {
    // El intento ya quedó contado en la reserva; si llegó al límite, el bloqueo queda confirmado
    return reserva.hasta ? { status: 423, body: { codigo: 'bloqueada', hasta: reserva.hasta } } : { status: 401, body: { codigo: 'incorrecta' } };
  }

  // La contraseña fue correcta: el contador de este origen se limpia aunque la cuenta no pueda entrar
  await deps.accesoCorrecto(usuario, ip).catch(() => {});

  // 3) Reglas de cuenta: inactiva y contraseña temporal vencida (se cierra la sesión recién creada)
  const p = await deps.perfil(auth.userId).catch(() => undefined);
  if (p === undefined) {
    await deps.cerrarSesion(auth.access_token).catch(() => {});
    return { status: 503, body: { codigo: 'servicio' } };
  }
  if (!p || !p.activo) {
    await deps.cerrarSesion(auth.access_token).catch(() => {});
    return { status: 403, body: { codigo: 'inactiva' } };
  }
  if (p.debe_cambiar_password && p.password_temporal_vence && new Date(p.password_temporal_vence) < deps.ahora()) {
    await deps.cerrarSesion(auth.access_token).catch(() => {});
    return { status: 403, body: { codigo: 'temporal_vencida' } };
  }

  return { status: 200, body: { access_token: auth.access_token, refresh_token: auth.refresh_token } };
}
