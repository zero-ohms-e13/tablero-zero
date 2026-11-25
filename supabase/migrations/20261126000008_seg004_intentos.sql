-- SEG-004 · Limitación de intentos de inicio de sesión sin bloqueo global previo.
--
-- Antes: un contador por nombre de usuario (leer → escribir por separado) bloqueaba al usuario
-- ANTES de autenticar, así que cualquiera podía dejar fuera a un alumno escribiendo mal su contraseña.
--
-- Ahora: contadores atómicos con ventana de 15 min en tres claves:
--   'ui:<usuario>|<ip>'  5 fallos  → 10 min (mismo usuario desde el mismo origen)
--   'ip:<ip>'           30 fallos  → 10 min (un origen probando muchas cuentas)
--   'u:<usuario>'       30 fallos  → 10 min (tope contra ataque distribuido desde muchos orígenes)
-- Una persona con la contraseña correcta desde otro origen no se ve afectada por los dos primeros.
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
  select case when p_clave like 'ui:%' then 5 when p_clave like 'ip:%' then 30 else 30 end
$$;

-- ¿Está bloqueado este intento? Devuelve hasta cuándo (o null).
create or replace function public.acceso_bloqueado(p_usuario text, p_ip text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(bloqueado_hasta) from public.intentos_acceso
  where clave in ('ui:' || p_usuario || '|' || p_ip, 'ip:' || p_ip, 'u:' || p_usuario)
    and bloqueado_hasta > now()
$$;

-- Registra un fallo de contraseña de forma atómica (una sentencia por clave: no se pierden incrementos
-- aunque lleguen solicitudes concurrentes). Devuelve el bloqueo resultante (o null).
create or replace function public.registrar_fallo_acceso(p_usuario text, p_ip text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  hasta timestamptz;
begin
  foreach k in array array['ui:' || p_usuario || '|' || p_ip, 'ip:' || p_ip, 'u:' || p_usuario] loop
    insert into public.intentos_acceso as i (clave, fallidos, ventana_inicio)
    values (k, 1, now())
    on conflict (clave) do update set
      fallidos = case when i.ventana_inicio < now() - interval '15 minutes' then 1 else i.fallidos + 1 end,
      ventana_inicio = case when i.ventana_inicio < now() - interval '15 minutes' then now() else i.ventana_inicio end,
      bloqueado_hasta = case
        when (case when i.ventana_inicio < now() - interval '15 minutes' then 1 else i.fallidos + 1 end) >= public.limite_acceso(k)
          then now() + interval '10 minutes'
        when i.bloqueado_hasta > now() then i.bloqueado_hasta
        else null end;
  end loop;
  -- Primer fallo que alcanza el límite (caso límite = 1 no existe; se cubre con la consulta)
  update public.intentos_acceso set bloqueado_hasta = now() + interval '10 minutes'
  where clave in ('ui:' || p_usuario || '|' || p_ip, 'ip:' || p_ip, 'u:' || p_usuario)
    and fallidos >= public.limite_acceso(clave) and bloqueado_hasta is null;
  select public.acceso_bloqueado(p_usuario, p_ip) into hasta;
  return hasta;
end $$;

-- Entrada correcta: limpia el contador de ese usuario desde ese origen.
create or replace function public.acceso_correcto(p_usuario text, p_ip text) returns void
language sql security definer set search_path = '' as $$
  delete from public.intentos_acceso where clave = 'ui:' || p_usuario || '|' || p_ip
$$;

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
  foreach f in array array['acceso_bloqueado(text,text)', 'registrar_fallo_acceso(text,text)', 'acceso_correcto(text,text)',
                           'desbloquear_usuario(text)', 'usuarios_bloqueados()', 'purgar_intentos()', 'limite_acceso(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
