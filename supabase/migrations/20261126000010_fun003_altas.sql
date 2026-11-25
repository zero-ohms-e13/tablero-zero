-- FUN-003 · Alta de cuentas verificable, idempotente y con recuperación.
--
-- Antes: la Edge Function creaba la identidad, luego el perfil (con compensación), luego membresías
-- y vínculos de tutor sin revisar todos los resultados. Un fallo a medias dejaba cuentas utilizables
-- incompletas, y un reintento duplicaba cuentas.
--
-- Ahora:
--  * altas_cuentas registra cada solicitud (id generado por el cliente) y los ids de identidad que
--    ESA solicitud creó. La compensación solo toca esos ids.
--  * completar_alta escribe perfiles, membresías y vínculo de tutor en UNA transacción.
--  * Las identidades se crean bloqueadas (ban) y se activan solo al completar; un alta incompleta
--    queda bloqueada y un reintento con la misma solicitud la recupera.
--  * Las contraseñas temporales nunca se guardan aquí.
-- Solo la Edge Function (service_role) usa estas funciones.
-- Recuperación: aditiva. Para revertir, volver a la función admin-accounts previa; esta tabla queda sin uso.

create table if not exists public.altas_cuentas (
  solicitud_id uuid primary key,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  huella text not null,                         -- resumen de los datos pedidos (detecta reuso con otros datos)
  estado text not null default 'en_curso' check (estado in ('en_curso', 'completa', 'incompleta')),
  creados uuid[] not null default '{}',         -- identidades creadas por ESTA solicitud
  resultado jsonb,                               -- fichas sin contraseña (usuario_id, usuario, nombre, rol, tutor_de)
  error text,
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now()
);
alter table public.altas_cuentas enable row level security; -- sin políticas: solo service_role
revoke all on public.altas_cuentas from anon, authenticated;

-- Reclama la solicitud. Devuelve el registro (nuevo o existente) con 'previo' = estado anterior:
--   null → nueva; 'en_curso' (reciente) → otra petición la está procesando; 'completa'; 'incompleta'.
-- Una solicitud 'en_curso' de más de 2 minutos se considera interrumpida (incompleta).
create or replace function public.iniciar_alta(p_solicitud uuid, p_coach uuid, p_huella text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.altas_cuentas;
begin
  insert into public.altas_cuentas (solicitud_id, coach_id, huella) values (p_solicitud, p_coach, p_huella)
  on conflict (solicitud_id) do nothing;
  if found then
    return jsonb_build_object('previo', null, 'creados', '[]'::jsonb);
  end if;
  select * into r from public.altas_cuentas where solicitud_id = p_solicitud for update;
  if r.coach_id <> p_coach or r.huella <> p_huella then
    return jsonb_build_object('previo', 'otra');
  end if;
  if r.estado = 'en_curso' and r.actualizada > now() - interval '2 minutes' then
    return jsonb_build_object('previo', 'en_curso');
  end if;
  if r.estado = 'completa' then
    return jsonb_build_object('previo', 'completa', 'creados', to_jsonb(r.creados), 'resultado', r.resultado);
  end if;
  -- incompleta o en_curso abandonada: se retoma
  update public.altas_cuentas set estado = 'en_curso', actualizada = now() where solicitud_id = p_solicitud;
  return jsonb_build_object('previo', 'incompleta', 'creados', to_jsonb(r.creados));
end $$;

create or replace function public.registrar_creado_alta(p_solicitud uuid, p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.altas_cuentas set creados = array_append(creados, p_id), actualizada = now()
  where solicitud_id = p_solicitud and not (p_id = any (creados));
$$;

-- Tras compensar: quita de la lista solo los ids que se confirmaron borrados.
create or replace function public.olvidar_creados_alta(p_solicitud uuid, p_ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  update public.altas_cuentas set creados = array(select c from unnest(creados) c where c <> all (p_ids)), actualizada = now()
  where solicitud_id = p_solicitud;
$$;

create or replace function public.marcar_alta(p_solicitud uuid, p_estado text, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.altas_cuentas set estado = p_estado, error = p_error, actualizada = now() where solicitud_id = p_solicitud;
$$;

-- Escribe perfiles + membresías + vínculo de tutor en una transacción y marca la solicitud completa.
-- p: { solicitud, perfiles: [{id, usuario, nombre_visible, iniciales, color, rol_global, vence}],
--      membresias: [{usuario_id, area_id, es_lider}], vinculo: {tutor_id, alumno_id} | null, resultado: [...] }
create or replace function public.completar_alta(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sol uuid := (p ->> 'solicitud')::uuid;
  v_creados uuid[];
begin
  select creados into v_creados from public.altas_cuentas where solicitud_id = v_sol and estado = 'en_curso' for update;
  if v_creados is null then raise exception 'Solicitud no está en curso'; end if;
  -- Solo perfiles de identidades creadas por esta solicitud
  if exists (select 1 from jsonb_array_elements(p -> 'perfiles') x where (x ->> 'id')::uuid <> all (v_creados)) then
    raise exception 'Perfil ajeno a la solicitud';
  end if;

  insert into public.profiles (id, usuario, nombre_visible, iniciales, color, rol_global, debe_cambiar_password, password_temporal_vence)
  select (x ->> 'id')::uuid, x ->> 'usuario', x ->> 'nombre_visible', x ->> 'iniciales', x ->> 'color', x ->> 'rol_global',
         true, (x ->> 'vence')::timestamptz
  from jsonb_array_elements(p -> 'perfiles') x
  on conflict (id) do update set
    usuario = excluded.usuario, nombre_visible = excluded.nombre_visible, iniciales = excluded.iniciales,
    color = excluded.color, rol_global = excluded.rol_global,
    debe_cambiar_password = true, password_temporal_vence = excluded.password_temporal_vence;

  insert into public.membresias (usuario_id, area_id, es_lider)
  select (x ->> 'usuario_id')::uuid, (x ->> 'area_id')::uuid, coalesce((x ->> 'es_lider')::boolean, false)
  from jsonb_array_elements(coalesce(p -> 'membresias', '[]'::jsonb)) x
  on conflict do nothing;

  if jsonb_typeof(p -> 'vinculo') = 'object' then
    if not exists (select 1 from public.profiles where id = (p -> 'vinculo' ->> 'alumno_id')::uuid and rol_global = 'alumno') then
      raise exception 'El alumno del vínculo no existe';
    end if;
    insert into public.tutores_alumnos (tutor_id, alumno_id)
    values ((p -> 'vinculo' ->> 'tutor_id')::uuid, (p -> 'vinculo' ->> 'alumno_id')::uuid)
    on conflict do nothing;
  end if;

  update public.altas_cuentas set estado = 'completa', resultado = p -> 'resultado', error = null, actualizada = now()
  where solicitud_id = v_sol;
end $$;

-- Altas que quedaron incompletas (para el panel del coach / recuperación manual).
create or replace function public.altas_incompletas() returns table (solicitud_id uuid, creados uuid[], error text, actualizada timestamptz)
language sql stable security definer set search_path = '' as $$
  select solicitud_id, creados, error, actualizada from public.altas_cuentas
  where estado = 'incompleta' or (estado = 'en_curso' and actualizada < now() - interval '2 minutes')
$$;

do $$
declare f text;
begin
  foreach f in array array['iniciar_alta(uuid,uuid,text)', 'registrar_creado_alta(uuid,uuid)', 'olvidar_creados_alta(uuid,uuid[])',
                           'marcar_alta(uuid,text,text)', 'completar_alta(jsonb)', 'altas_incompletas()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
