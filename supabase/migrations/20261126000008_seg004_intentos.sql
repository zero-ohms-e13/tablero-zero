-- SEG-004 · Limitación de intentos de inicio de sesión sin bloqueo global previo.
--
-- Antes: un contador por nombre de usuario (leer → escribir por separado) bloqueaba al usuario
-- ANTES de autenticar, así que cualquiera podía dejar fuera a un alumno escribiendo mal su contraseña.
--
-- Ahora: ADMISIÓN atómica antes de llamar a Auth (revisión de ChatGPT, punto de control 0): cada intento
-- reserva un lugar en tres contadores con ventana de 15 min; si alguno ya está en su límite, el intento
-- se rechaza sin llegar a Auth. Así una ráfaga concurrente no puede rebasar el límite.
--   'ui:<usuario>|<ip>'   5 intentos → 10 min (mismo usuario desde el mismo origen)
--   'ip:<ip>'            60 intentos → 10 min (un origen probando muchas cuentas; 60 por la red escolar
--                                              compartida — valor a calibrar, decisión abierta para Jaime)
--   'u:<usuario>'        30 intentos → 10 min (tope contra ataque distribuido desde muchos orígenes)
-- Sin IP verificada ('sin-ip') NO se usa el contador por origen: no hay un cupo único compartido.
-- Entrada correcta: borra 'ui' y devuelve la reserva a 'ip' y 'u'. Error de infraestructura: devuelve
-- la reserva en los tres (no cuenta como contraseña incorrecta).
--
-- Solo la Edge Function (service_role) usa estas funciones.
-- Recuperación: la tabla intentos_login anterior se conserva sin uso; volver a la versión previa de
-- la función entrar la reactiva. Esta migración es aditiva.

create table if not exists public.intentos_acceso (
  clave text primary key,
  fallidos int not null default 0,
  ventana_inicio timestamptz not null default now(),
  bloqueado_hasta timestamptz
);
alter table public.intentos_acceso enable row level security; -- sin políticas: solo service_role
revoke all on public.intentos_acceso from anon, authenticated;

-- Límites (una sola fuente de verdad)
create or replace function public.limite_acceso(p_clave text) returns int
language sql immutable set search_path = '' as $$
  select case when p_clave like 'ui:%' then 5 when p_clave like 'ip:%' then 60 else 30 end
$$;

-- Claves que aplican a un intento (ordenadas: se bloquean siempre en el mismo orden)
create or replace function public.claves_acceso(p_usuario text, p_ip text) returns text[]
language sql immutable set search_path = '' as $$
  select array(select k from unnest(array[
    'ui:' || p_usuario || '|' || p_ip,
    case when p_ip <> 'sin-ip' then 'ip:' || p_ip end,
    'u:' || p_usuario]) k where k is not null order by k)
$$;

-- ¿Está bloqueado este intento? Devuelve hasta cuándo (o null). Solo lectura (panel / diagnóstico).
create or replace function public.acceso_bloqueado(p_usuario text, p_ip text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(bloqueado_hasta) from public.intentos_acceso
  where clave = any(public.claves_acceso(p_usuario, p_ip)) and bloqueado_hasta > now()
$$;

-- Admisión atómica: si algún contador está bloqueado, rechaza sin contar; si no, reserva el intento
-- en todos. Devuelve {permitido, hasta}: hasta = bloqueo vigente (si se rechazó) o el que este intento
-- activaría si resulta fallido (llegó al límite).
create or replace function public.reservar_intento(p_usuario text, p_ip text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ks text[] := public.claves_acceso(p_usuario, p_ip);
  k text;
  vigente timestamptz;
  llega timestamptz;
begin
  foreach k in array ks loop
    perform pg_advisory_xact_lock(hashtextextended(k, 0));
  end loop;
  -- Ventanas vencidas se reinician
  update public.intentos_acceso set fallidos = 0, ventana_inicio = now(), bloqueado_hasta = null
  where clave = any(ks) and ventana_inicio < now() - interval '15 minutes'
    and (bloqueado_hasta is null or bloqueado_hasta <= now());
  select max(bloqueado_hasta) into vigente from public.intentos_acceso
  where clave = any(ks) and bloqueado_hasta > now();
  if vigente is not null then
    return jsonb_build_object('permitido', false, 'hasta', vigente);
  end if;
  foreach k in array ks loop
    insert into public.intentos_acceso as i (clave, fallidos, ventana_inicio) values (k, 1, now())
    on conflict (clave) do update set fallidos = i.fallidos + 1;
  end loop;
  -- Si este intento alcanza un límite, queda bloqueado de forma tentativa: lo confirma un fallo
  -- y lo retira una entrada correcta o un error de infraestructura.
  update public.intentos_acceso set bloqueado_hasta = now() + interval '10 minutes'
  where clave = any(ks) and fallidos >= public.limite_acceso(clave);
  select max(bloqueado_hasta) into llega from public.intentos_acceso
  where clave = any(ks) and bloqueado_hasta > now();
  return jsonb_build_object('permitido', true, 'hasta', llega);
end $$;

-- Devuelve la reserva (error de infraestructura o entrada correcta en 'ip'/'u').
create or replace function public.liberar_intento(p_usuario text, p_ip text, p_solo_globales boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  ks text[] := public.claves_acceso(p_usuario, p_ip);
  k text;
begin
  foreach k in array ks loop
    perform pg_advisory_xact_lock(hashtextextended(k, 0));
  end loop;
  update public.intentos_acceso set
    fallidos = greatest(fallidos - 1, 0),
    bloqueado_hasta = case when greatest(fallidos - 1, 0) < public.limite_acceso(clave) then null else bloqueado_hasta end
  where clave = any(ks) and (not p_solo_globales or clave not like 'ui:%');
end $$;

-- Entrada correcta: limpia el contador de ese usuario desde ese origen y devuelve la reserva global.
create or replace function public.acceso_correcto(p_usuario text, p_ip text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.liberar_intento(p_usuario, p_ip, true);
  delete from public.intentos_acceso where clave = 'ui:' || p_usuario || '|' || p_ip;
end $$;

-- Recuperación (reinicio de contraseña por el coach): quita los bloqueos de ese usuario en todos los orígenes.
create or replace function public.desbloquear_usuario(p_usuario text) returns void
language sql security definer set search_path = '' as $$
  delete from public.intentos_acceso where clave = 'u:' || p_usuario or clave like 'ui:' || p_usuario || '|%';
  delete from public.intentos_login where usuario = p_usuario;
$$;

-- Usuarios con bloqueo activo (panel del coach).
create or replace function public.usuarios_bloqueados() returns table (usuario text, bloqueado_hasta timestamptz)
language sql stable security definer set search_path = '' as $$
  select split_part(regexp_replace(clave, '^(ui|u):', ''), '|', 1), max(bloqueado_hasta)
  from public.intentos_acceso
  where (clave like 'ui:%' or clave like 'u:%') and bloqueado_hasta > now()
  group by 1
$$;

-- Limpieza de filas viejas (las llama la Edge Function de vez en cuando; también sirve a mano).
create or replace function public.purgar_intentos() returns void
language sql security definer set search_path = '' as $$
  delete from public.intentos_acceso
  where ventana_inicio < now() - interval '1 day' and (bloqueado_hasta is null or bloqueado_hasta < now());
$$;

do $$
declare f text;
begin
  foreach f in array array['acceso_bloqueado(text,text)', 'reservar_intento(text,text)', 'liberar_intento(text,text,boolean)',
                           'acceso_correcto(text,text)', 'desbloquear_usuario(text)', 'usuarios_bloqueados()',
                           'purgar_intentos()', 'limite_acceso(text)', 'claves_acceso(text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
