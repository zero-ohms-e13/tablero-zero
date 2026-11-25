-- SEG-004 · Limitación de intentos de inicio de sesión sin bloqueo global previo.
--
-- Antes: un contador por nombre de usuario (leer → escribir por separado) bloqueaba al usuario
-- ANTES de autenticar, así que cualquiera podía dejar fuera a un alumno escribiendo mal su contraseña.
--
-- Ahora (con las revisiones de ChatGPT en los puntos de control 0 y 1):
--  * Admisión atómica antes de Auth: cada intento crea una RESERVA con identidad y vencimiento;
--    se liquida una sola vez (idempotente) como 'fallo', 'correcto' o 'infra'.
--  * Solo NIEGA el contador del par usuario+origen verificado:
--      'ui:<usuario>|<ip>'  5 intentos / 15 min → 10 min.
--  * Los contadores por origen y por usuario son SEÑALES DE ALERTA (no niegan acceso):
--      'ip:<ip>'    60 intentos / 15 min → alerta (umbral provisional a medir en la red escolar)
--      'u:<usuario>' 30 intentos / 15 min → alerta (posible ataque distribuido)
--    Así las credenciales válidas desde otro origen siempre pueden entrar.
--  * Sin IP verificada ('sin-ip') no hay contador que niegue ni cupo común compartido;
--    solo cuenta la alerta por usuario. Riesgo abierto hasta verificar cómo el gateway fija la IP.
--  * Error de infraestructura devuelve la reserva; una liquidación tardía después de que la ventana
--    se reinició no descuenta de la ventana nueva.
--
-- Solo la Edge Function (service_role) usa estas funciones.
-- Recuperación: la tabla intentos_login anterior se conserva sin uso; volver a la versión previa de
-- la función entrar la reactiva. Esta migración es aditiva.

create table if not exists public.intentos_acceso (
  clave text primary key,
  fallidos int not null default 0,
  ventana_inicio timestamptz not null default now(),
  bloqueado_hasta timestamptz, -- solo claves 'ui:'
  alerta_desde timestamptz     -- claves 'ip:' y 'u:' que superaron su umbral en la ventana
);
alter table public.intentos_acceso enable row level security; -- sin políticas: solo service_role
revoke all on public.intentos_acceso from anon, authenticated;

create table if not exists public.intentos_reservas (
  id uuid primary key default gen_random_uuid(),
  claves text[] not null,
  ventanas timestamptz[] not null, -- ventana_inicio de cada clave al reservar
  creada timestamptz not null default now()
);
alter table public.intentos_reservas enable row level security;
revoke all on public.intentos_reservas from anon, authenticated;

-- Umbrales (una sola fuente de verdad)
create or replace function public.limite_acceso(p_clave text) returns int
language sql immutable set search_path = '' as $$
  select case when p_clave like 'ui:%' then 5 when p_clave like 'ip:%' then 60 else 30 end
$$;

-- Claves de un intento, ordenadas (los candados se toman siempre en el mismo orden)
create or replace function public.claves_acceso(p_usuario text, p_ip text) returns text[]
language sql immutable set search_path = '' as $$
  select array(select k from unnest(array[
    case when p_ip <> 'sin-ip' then 'ui:' || p_usuario || '|' || p_ip end,
    case when p_ip <> 'sin-ip' then 'ip:' || p_ip end,
    'u:' || p_usuario]) k where k is not null order by k)
$$;

create or replace function public.bloquear_claves(p_claves text[]) returns void
language plpgsql set search_path = '' as $$
declare k text;
begin
  foreach k in array p_claves loop
    perform pg_advisory_xact_lock(hashtextextended(k, 0));
  end loop;
end $$;

-- ¿Está bloqueado este intento? (solo el par usuario+origen puede bloquear)
create or replace function public.acceso_bloqueado(p_usuario text, p_ip text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(bloqueado_hasta) from public.intentos_acceso
  where clave = any(public.claves_acceso(p_usuario, p_ip)) and clave like 'ui:%' and bloqueado_hasta > now()
$$;

-- Admisión atómica. Devuelve {permitido, hasta, reserva}:
--   permitido=false → bloqueo vigente del par (no se cuenta ni se llama a Auth);
--   hasta → bloqueo que quedaría si este intento resulta fallido (llegó al límite).
create or replace function public.reservar_intento(p_usuario text, p_ip text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ks text[] := public.claves_acceso(p_usuario, p_ip);
  vigente timestamptz;
  llega timestamptz;
  vs timestamptz[];
  rid uuid;
  k text;
begin
  perform public.bloquear_claves(ks);
  -- Ventanas vencidas se reinician (un bloqueo vigente se respeta hasta que vence)
  update public.intentos_acceso set fallidos = 0, ventana_inicio = now(), bloqueado_hasta = null, alerta_desde = null
  where clave = any(ks) and ventana_inicio < now() - interval '15 minutes'
    and (bloqueado_hasta is null or bloqueado_hasta <= now());
  select max(bloqueado_hasta) into vigente from public.intentos_acceso
  where clave = any(ks) and clave like 'ui:%' and bloqueado_hasta > now();
  if vigente is not null then
    return jsonb_build_object('permitido', false, 'hasta', vigente, 'reserva', null);
  end if;
  foreach k in array ks loop
    insert into public.intentos_acceso as i (clave, fallidos, ventana_inicio) values (k, 1, now())
    on conflict (clave) do update set fallidos = i.fallidos + 1;
  end loop;
  update public.intentos_acceso set bloqueado_hasta = now() + interval '10 minutes'
  where clave = any(ks) and clave like 'ui:%' and fallidos >= public.limite_acceso(clave);
  update public.intentos_acceso set alerta_desde = coalesce(alerta_desde, now())
  where clave = any(ks) and clave not like 'ui:%' and fallidos >= public.limite_acceso(clave);
  select max(bloqueado_hasta) into llega from public.intentos_acceso
  where clave = any(ks) and clave like 'ui:%' and bloqueado_hasta > now();
  select array_agg(ventana_inicio order by clave) into vs from public.intentos_acceso where clave = any(ks);
  insert into public.intentos_reservas (claves, ventanas) values (ks, vs) returning id into rid;
  return jsonb_build_object('permitido', true, 'hasta', llega, 'reserva', rid);
end $$;

-- Liquidación idempotente de una reserva:
--   'fallo'    → el intento queda contado (y el bloqueo tentativo, confirmado);
--   'correcto' → se borra el par usuario+origen y se devuelve la reserva en origen/usuario;
--   'infra'    → se devuelve la reserva en todas las claves.
-- Solo descuenta de la MISMA ventana en la que se reservó. Una segunda llamada no hace nada.
create or replace function public.liquidar_intento(p_reserva uuid, p_resultado text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  r public.intentos_reservas;
  i int;
begin
  if p_resultado not in ('fallo', 'correcto', 'infra') then raise exception 'resultado inválido'; end if;
  delete from public.intentos_reservas where id = p_reserva returning * into r;
  if r.id is null then return false; end if; -- ya liquidada o vencida
  if p_resultado = 'fallo' then return true; end if;
  perform public.bloquear_claves(r.claves);
  for i in 1 .. array_length(r.claves, 1) loop
    if p_resultado = 'correcto' and r.claves[i] like 'ui:%' then
      delete from public.intentos_acceso where clave = r.claves[i] and ventana_inicio = r.ventanas[i];
    else
      update public.intentos_acceso set
        fallidos = greatest(fallidos - 1, 0),
        bloqueado_hasta = case when greatest(fallidos - 1, 0) < public.limite_acceso(clave) then null else bloqueado_hasta end,
        alerta_desde = case when greatest(fallidos - 1, 0) < public.limite_acceso(clave) then null else alerta_desde end
      where clave = r.claves[i] and ventana_inicio = r.ventanas[i];
    end if;
  end loop;
  return true;
end $$;

-- Recuperación (reinicio de contraseña por el coach): quita los bloqueos y alertas de ese usuario.
create or replace function public.desbloquear_usuario(p_usuario text) returns void
language sql security definer set search_path = '' as $$
  delete from public.intentos_acceso where clave = 'u:' || p_usuario or clave like 'ui:' || p_usuario || '|%';
  delete from public.intentos_login where usuario = p_usuario;
$$;

-- Usuarios con bloqueo activo de algún par usuario+origen (panel del coach).
create or replace function public.usuarios_bloqueados() returns table (usuario text, bloqueado_hasta timestamptz)
language sql stable security definer set search_path = '' as $$
  select split_part(substr(clave, 4), '|', 1), max(bloqueado_hasta)
  from public.intentos_acceso
  where clave like 'ui:%' and bloqueado_hasta > now()
  group by 1
$$;

-- Señales de alerta vigentes (origen o usuario por encima de su umbral en la ventana actual).
create or replace function public.alertas_acceso() returns table (clave text, intentos int, desde timestamptz)
language sql stable security definer set search_path = '' as $$
  select clave, fallidos, alerta_desde from public.intentos_acceso
  where alerta_desde is not null and ventana_inicio >= now() - interval '15 minutes'
$$;

-- Limpieza: contadores viejos y reservas vencidas (una reserva sin liquidar queda contada como fallo).
create or replace function public.purgar_intentos() returns void
language sql security definer set search_path = '' as $$
  delete from public.intentos_acceso
  where ventana_inicio < now() - interval '1 day' and (bloqueado_hasta is null or bloqueado_hasta < now());
  delete from public.intentos_reservas where creada < now() - interval '2 minutes';
$$;

do $$
declare f text;
begin
  foreach f in array array['acceso_bloqueado(text,text)', 'reservar_intento(text,text)', 'liquidar_intento(uuid,text)',
                           'desbloquear_usuario(text)', 'usuarios_bloqueados()', 'alertas_acceso()',
                           'purgar_intentos()', 'limite_acceso(text)', 'claves_acceso(text,text)', 'bloquear_claves(text[])'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
