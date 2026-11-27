-- Tablero Zero · Materiales: corte inmediato al retirar y limpieza de borradores abandonados
--
-- 1) Archivos sin URL firmadas. Hasta ahora el navegador pedía enlaces firmados de 30 minutos. Un enlace
--    ya entregado seguía sirviendo aunque la publicación se retirara después. Ahora los archivos de
--    publicaciones solo salen por la Edge Function archivo-material, que en CADA apertura pregunta aquí
--    si esa persona puede verlo y responde sin caché (no-store). Por eso el navegador ya no puede leer ni
--    firmar esos objetos: solo el autor, y solo los de su BORRADOR, para poder quitarlos mientras edita.
--    Las URL firmadas que ya existían vencen solas a más tardar 30 minutos después de aplicar esto.
-- 2) Limpieza: borradores sin actividad por N días (30, decisión de Jaime) y archivos huérfanos (subidos y
--    nunca registrados). La Edge Function limpiar-materiales primero simula y solo borra con el OK del coach
--    principal. El registro se borra antes que los archivos: si se corta a la mitad, lo que quede son
--    huérfanos y la siguiente corrida los quita.
-- Aditiva: no cambia tablas.

-- ---------- 1. ¿Puede esta persona abrir este archivo? (solo para Edge Functions) ----------
-- Mismas reglas que tenía la política de Storage: el autor ve lo que subió a SUS publicaciones; los demás
-- solo archivos REGISTRADOS de publicaciones visibles (publicada y no retirada; el coach o mentor también
-- las retiradas). La cuenta debe estar activa y ser alumno, coach o mentor.
create or replace function public.archivo_material(p_usuario uuid, p_ruta text)
returns table (nombre text, clase text)
language sql stable security definer set search_path = public as $$
  select coalesce(a.nombre, nullif(split_part(p_ruta, '/', 2), ''), 'archivo'), coalesce(a.clase, '')
  from materiales m
  join profiles p on p.id = p_usuario and p.activo and p.rol_global in ('alumno', 'coach', 'coach_aux')
  left join material_adjuntos a on a.material_id = m.id and a.ruta = p_ruta and a.tipo = 'archivo'
  where m.id = public.material_de_ruta(p_ruta)
    and (m.autor_id = p_usuario
         or (a.id is not null and m.estado = 'publicada'
             and (m.retirado_at is null or p.rol_global in ('coach', 'coach_aux'))))
  limit 1
$$;
revoke execute on function public.archivo_material(uuid, text) from anon, authenticated, public;
grant execute on function public.archivo_material(uuid, text) to service_role;

-- El navegador ya no lee ni firma archivos de publicaciones: solo el autor, de su propio borrador
-- (Storage exige leer para poder borrar).
drop policy if exists mat_storage_select on storage.objects;
create policy mat_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'materiales' and exists (
    select 1 from public.materiales m where m.id = public.material_de_ruta(name)
      and m.autor_id = auth.uid() and m.estado = 'borrador' and public.puede_ver_materiales())
);

-- ---------- 2. Limpieza ----------
-- Última actividad de un borrador: creación, edición, adjuntos registrados y archivos subidos.
create or replace function public.actividad_material(p_material uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    (select greatest(m.creado_at, coalesce(m.editado_at, m.creado_at)) from materiales m where m.id = p_material),
    (select max(a.creado_at) from material_adjuntos a where a.material_id = p_material),
    (select max(o.created_at) from storage.objects o where o.bucket_id = 'materiales' and public.material_de_ruta(o.name) = p_material))
$$;
revoke execute on function public.actividad_material(uuid) from anon, authenticated, public;
grant execute on function public.actividad_material(uuid) to service_role;

-- Qué se limpiaría hoy (no borra nada).
--   tipo 'borrador': el borrador completo; rutas = todos sus archivos.
--   tipo 'huerfano': un archivo de una publicación (o de una carpeta sin publicación) que nunca se
--                    registró como adjunto. Un borrador activo conserva sus archivos sin registrar.
create or replace function public.materiales_por_limpiar(p_dias int default 30)
returns table (tipo text, material_id uuid, rutas text[], bytes bigint, actividad timestamptz)
language sql stable security definer set search_path = public as $$
  with vencidos as (
    select m.id, public.actividad_material(m.id) as act from materiales m where m.estado = 'borrador'
  )
  select 'borrador', v.id,
         coalesce((select array_agg(o.name order by o.name) from storage.objects o
                    where o.bucket_id = 'materiales' and public.material_de_ruta(o.name) = v.id), '{}'),
         coalesce((select sum((o.metadata ->> 'size')::bigint) from storage.objects o
                    where o.bucket_id = 'materiales' and public.material_de_ruta(o.name) = v.id), 0)::bigint,
         v.act
  from vencidos v
  where v.act < now() - make_interval(days => greatest(p_dias, 1))
  union all
  select 'huerfano', public.material_de_ruta(o.name), array[o.name], coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at
  from storage.objects o
  left join materiales m on m.id = public.material_de_ruta(o.name)
  where o.bucket_id = 'materiales'
    and o.created_at < now() - make_interval(days => greatest(p_dias, 1))
    and (m.id is null or m.estado = 'publicada')
    and not exists (select 1 from material_adjuntos a where a.ruta = o.name and a.tipo = 'archivo')
$$;
revoke execute on function public.materiales_por_limpiar(int) from anon, authenticated, public;
grant execute on function public.materiales_por_limpiar(int) to service_role;

-- Borra el registro de un borrador SOLO si sigue siendo borrador y sigue inactivo (se revisa en el momento,
-- con candado). Devuelve true si lo borró. Sus archivos los quita después la Edge Function.
create or replace function public.borrar_borrador_vencido(p_material uuid, p_dias int default 30) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from materiales where id = p_material and estado = 'borrador' for update;
  if not found then
    return false;
  end if;
  if public.actividad_material(p_material) >= now() - make_interval(days => greatest(p_dias, 1)) then
    return false;
  end if;
  delete from materiales where id = p_material and estado = 'borrador';
  return found;
end $$;
revoke execute on function public.borrar_borrador_vencido(uuid, int) from anon, authenticated, public;
grant execute on function public.borrar_borrador_vencido(uuid, int) to service_role;

-- Un archivo huérfano sigue huérfano en este momento (no se registró mientras tanto).
create or replace function public.sigue_huerfano(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from material_adjuntos a where a.ruta = p_ruta and a.tipo = 'archivo')
     and not exists (select 1 from materiales m where m.id = public.material_de_ruta(p_ruta) and m.estado = 'borrador')
$$;
revoke execute on function public.sigue_huerfano(text) from anon, authenticated, public;
grant execute on function public.sigue_huerfano(text) to service_role;
