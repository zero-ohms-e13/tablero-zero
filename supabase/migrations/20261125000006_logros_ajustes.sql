-- Tablero Zero · ajustes de logros tras la revisión:
-- 1) Las tareas compartidas muestran a todos sus responsables ("Ana y Karla").
-- 2) Nadie se felicita a sí mismo (es_mio para la pantalla y bloqueo en felicitar).

drop function if exists public.logros_equipo(int, uuid, boolean);
create function public.logros_equipo(p_limite int default 40, p_area uuid default null, p_solo_mios boolean default false)
returns table (tarea_id uuid, titulo text, robot text, area_id uuid, aprobada_at timestamptz,
               quien text, iniciales text, color text, felicitaciones int, yo_felicite boolean, es_mio boolean)
language sql stable security definer set search_path = public as $$
  with yo as (select id, rol_global from profiles where id = auth.uid() and activo),
  base as (
    select t.*,
      (select rol_global from yo) = 'tutor'
        and not exists (select 1 from tarea_responsables r2 where r2.tarea_id = t.id and r2.usuario_id in (select public.mis_hijos())) as oculto
    from tareas t
    where exists (select 1 from yo)
      and t.estado = 'hecha' and t.aprobada_at is not null
      and (p_area is null or t.area_id = p_area)
      and (not p_solo_mios or exists (select 1 from tarea_responsables r3 where r3.tarea_id = t.id and r3.usuario_id = auth.uid()))
  )
  select b.id, b.titulo, b.robot, b.area_id, b.aprobada_at,
    case when b.oculto then 'Alguien del equipo'
         else coalesce((select regexp_replace(string_agg(split_part(pr.nombre_visible, ' ', 1), ', ' order by pr.nombre_visible), ', ([^,]*)$', ' y \1')
                        from tarea_responsables r join profiles pr on pr.id = r.usuario_id where r.tarea_id = b.id), 'El equipo') end,
    case when b.oculto then 'ZO'
         else coalesce((select pr.iniciales from tarea_responsables r join profiles pr on pr.id = r.usuario_id where r.tarea_id = b.id order by pr.nombre_visible limit 1), 'ZO') end,
    case when b.oculto then '#5A4335'
         else coalesce((select pr.color from tarea_responsables r join profiles pr on pr.id = r.usuario_id where r.tarea_id = b.id order by pr.nombre_visible limit 1), '#5A4335') end,
    (select count(*)::int from felicitaciones f where f.tarea_id = b.id),
    exists (select 1 from felicitaciones f where f.tarea_id = b.id and f.usuario_id = auth.uid()),
    exists (select 1 from tarea_responsables r where r.tarea_id = b.id and r.usuario_id = auth.uid())
  from base b
  order by b.aprobada_at desc
  limit least(greatest(p_limite, 1), 200)
$$;

create or replace function public.felicitar(p_tarea uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text := public.mi_rol();
begin
  if r is null or r = 'tutor' then raise exception 'Solo el equipo puede felicitar.' using errcode = '42501'; end if;
  if not exists (select 1 from tareas where id = p_tarea and estado = 'hecha') then
    raise exception 'Solo se felicitan tareas terminadas.' using errcode = '22023';
  end if;
  if exists (select 1 from tarea_responsables where tarea_id = p_tarea and usuario_id = auth.uid()) then
    raise exception 'No puedes felicitarte a ti mismo.' using errcode = '22023';
  end if;
  if exists (select 1 from felicitaciones where tarea_id = p_tarea and usuario_id = auth.uid()) then
    delete from felicitaciones where tarea_id = p_tarea and usuario_id = auth.uid();
    return false;
  end if;
  insert into felicitaciones (tarea_id, usuario_id) values (p_tarea, auth.uid());
  insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
  select r2.usuario_id, 'felicitacion', public.nombre_de(auth.uid()) || ' te felicitó', t.titulo, t.id
  from tarea_responsables r2 join tareas t on t.id = r2.tarea_id
  where r2.tarea_id = p_tarea and r2.usuario_id <> auth.uid();
  return true;
end $$;
