// Lógica de inicio de sesión sin dependencias de Deno ni de red: se prueba con Vitest
// inyectando dependencias controladas (SEG-004).

export const USUARIO_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

export type ResultadoAuth =
  | { tipo: 'ok'; userId: string; access_token: string; refresh_token: string }
  | { tipo: 'credenciales' } // usuario o contraseña incorrectos
  | { tipo: 'infra' }; // Auth no respondió bien: no cuenta como intento fallido

export type Perfil = { activo: boolean; debe_cambiar_password: boolean; password_temporal_vence: string | null } | null;

export type Reserva = { permitido: boolean; hasta: string | null; reserva: string | null };
export type Liquidacion = 'fallo' | 'correcto' | 'infra';

export type Deps = {
  /** Admisión atómica antes de Auth: reserva el intento o lo rechaza si hay bloqueo vigente. */
  reservar(usuario: string, ip: string): Promise<Reserva>;
  /** Liquida la reserva una sola vez (idempotente en la base). 'infra' la devuelve: no cuenta como fallo. */
  liquidar(reserva: string, resultado: Liquidacion): Promise<void>;
  autenticar(usuario: string, password: string): Promise<ResultadoAuth>;
  perfil(userId: string): Promise<Perfil>;
  cerrarSesion(accessToken: string): Promise<void>;
  ahora(): Date;
};

export type Respuesta = { status: number; body: Record<string, unknown> };

/** IP del cliente, verificada en el gateway de Supabase (proyecto de pruebas, 2026-11-25):
 *  - `sb-forwarded-for` la fija el gateway con la IP real e ignora el valor que mande el cliente.
 *  - `cf-connecting-ip` la fija Cloudflare; una petición que intenta falsificarla se rechaza (error 1000).
 *  - El ÚLTIMO valor de X-Forwarded-For es un nodo de Cloudflare que cambia en cada petición: no sirve.
 *  Sin ninguna de las dos (o con un valor no válido) → 'sin-ip', que no comparte cupo ni bloqueo. */
export function ipCliente(cabecera: (nombre: string) => string | null | undefined): string {
  for (const nombre of ['sb-forwarded-for', 'cf-connecting-ip']) {
    const v = (cabecera(nombre) ?? '').trim();
    if (/^[0-9a-fA-F:.]{2,45}$/.test(v)) return v;
  }
  return 'sin-ip';
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
  const liquidar = (r: Liquidacion) => (reserva.reserva ? deps.liquidar(reserva.reserva, r).catch(() => {}) : Promise.resolve());
  if (auth.tipo === 'infra') {
    await liquidar('infra');
    return { status: 503, body: { codigo: 'servicio' } };
  }
  if (auth.tipo === 'credenciales') {
    // El intento ya quedó contado en la reserva; si llegó al límite, el bloqueo queda confirmado
    await liquidar('fallo');
    return reserva.hasta ? { status: 423, body: { codigo: 'bloqueada', hasta: reserva.hasta } } : { status: 401, body: { codigo: 'incorrecta' } };
  }

  // La contraseña fue correcta: el contador de este origen se limpia aunque la cuenta no pueda entrar
  await liquidar('correcto');

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
