-- Tablero Zero · Fases 2 y 3: push, mensajes al coach, logros con felicitaciones y recordatorios

-- ---------- Avisos push ----------
create table if not exists public.suscripciones_push (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado_at timestamptz not null default now()
);
alter table public.suscripciones_push enable row level security;
create policy push_select on public.suscripciones_push for select to authenticated using (usuario_id = auth.uid());
create policy push_insert on public.suscripciones_push for insert to authenticated with check (usuario_id = auth.uid());
create policy push_update on public.suscripciones_push for update to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy push_delete on public.suscripciones_push for delete to authenticated using (usuario_id = auth.uid());

-- Configuración privada del servidor (URL de la función push y su secreto). Sin políticas: nadie la lee desde el navegador.
create table if not exists public.config_privada (clave text primary key, valor text not null);
alter table public.config_privada enable row level security;

-- Al crear un aviso, pide a la Edge Function `push` que lo mande a los celulares del usuario.
-- Usa pg_net (asíncrono): si falla el envío, el aviso igual queda guardado.
create or replace function public.enviar_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u text := (select valor from config_privada where clave = 'push_url');
  s text := (select valor from config_privada where clave = 'push_secreto');
begin
  if u is null or s is null then return new; end if;
  if not exists (select 1 from suscripciones_push where usuario_id = new.usuario_id) then return new; end if;
  begin
    perform net.http_post(
      url := u,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secreto', s),
      body := jsonb_build_object('usuario_id', new.usuario_id, 'titulo', new.titulo, 'detalle', new.detalle, 'tarea_id', new.tarea_id)
    );
  exception when others then
    -- pg_net no disponible (por ejemplo en pruebas locales): no bloquear el aviso
    null;
  end;
  return new;
end $$;
drop trigger if exists enviar_push on public.avisos;
create trigger enviar_push after insert on public.avisos for each row execute function public.enviar_push();

-- ---------- Tutor: "Escribir al coach" ----------
create or replace function public.escribir_al_coach(p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare yo profiles;
begin
  select * into yo from profiles where id = auth.uid() and activo;
  if yo.id is null or yo.rol_global not in ('tutor', 'alumno') then
    raise exception 'Solo tutores y alumnos escriben al coach por aquí.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_texto), '') = '' or char_length(p_texto) > 600 then
    raise exception 'Escribe un mensaje de hasta 600 letras.' using errcode = '22023';
  end if;
  insert into avisos (usuario_id, tipo, titulo, detalle)
  select p.id, 'mensaje', 'Mensaje de ' || yo.nombre_visible || ' (' || yo.usuario || ')', btrim(p_texto)
  from profiles p where p.rol_global in ('coach', 'coach_aux') and p.activo;
end $$;

-- ---------- Logros del equipo ----------
-- Tareas aprobadas de todo el equipo. Alumnos y coaches ven el nombre corto de quién la terminó;
-- un tutor solo ve nombres de sus hijos (los demás salen como "Alguien del equipo").
create or replace function public.logros_equipo(p_limite int default 40, p_area uuid default null, p_solo_mios boolean default false)
returns table (tarea_id uuid, titulo text, robot text, area_id uuid, aprobada_at timestamptz,
               quien text, iniciales text, color text, felicitaciones int, yo_felicite boolean)
language sql stable security definer set search_path = public as $$
  with yo as (select id, rol_global from profiles where id = auth.uid() and activo)
  select t.id, t.titulo, t.robot, t.area_id, t.aprobada_at,
    case when (select rol_global from yo) = 'tutor'
              and not exists (select 1 from tarea_responsables r2 where r2.tarea_id = t.id and r2.usuario_id in (select public.mis_hijos()))
         then 'Alguien del equipo'
         else split_part(p.nombre_visible, ' ', 1) end,
    case when (select rol_global from yo) = 'tutor'
              and not exists (select 1 from tarea_responsables r2 where r2.tarea_id = t.id and r2.usuario_id in (select public.mis_hijos()))
         then 'ZO' else p.iniciales end,
    case when (select rol_global from yo) = 'tutor'
              and not exists (select 1 from tarea_responsables r2 where r2.tarea_id = t.id and r2.usuario_id in (select public.mis_hijos()))
         then '#5A4335' else p.color end,
    (select count(*)::int from felicitaciones f where f.tarea_id = t.id),
    exists (select 1 from felicitaciones f where f.tarea_id = t.id and f.usuario_id = auth.uid())
  from tareas t
  left join lateral (
    select pr.* from tarea_responsables r join profiles pr on pr.id = r.usuario_id
    where r.tarea_id = t.id order by pr.nombre_visible limit 1
  ) p on true
  where exists (select 1 from yo)
    and t.estado = 'hecha' and t.aprobada_at is not null
    and (p_area is null or t.area_id = p_area)
    and (not p_solo_mios or exists (select 1 from tarea_responsables r3 where r3.tarea_id = t.id and r3.usuario_id = auth.uid()))
  order by t.aprobada_at desc
  limit least(greatest(p_limite, 1), 200)
$$;

create or replace function public.total_logros() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from tareas where estado = 'hecha' and auth.uid() is not null
$$;

-- Felicitar (o quitar la felicitación) una tarea terminada de cualquier área. Tutores no.
create or replace function public.felicitar(p_tarea uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r text := public.mi_rol();
begin
  if r is null or r = 'tutor' then raise exception 'Solo el equipo puede felicitar.' using errcode = '42501'; end if;
  if not exists (select 1 from tareas where id = p_tarea and estado = 'hecha') then
    raise exception 'Solo se felicitan tareas terminadas.' using errcode = '22023';
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

-- Batería llena: aviso al aprobar la última tarea de la semana de alguien.
create or replace function public.aviso_bateria_llena() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ini timestamptz;
  fin timestamptz;
  r record;
begin
  if new.estado <> 'hecha' or old.estado = 'hecha' or new.fecha_limite is null then return new; end if;
  -- Semana lunes-domingo en hora de Mérida
  ini := (date_trunc('week', new.fecha_limite at time zone 'America/Merida')) at time zone 'America/Merida';
  fin := ini + interval '7 days';
  for r in select usuario_id from tarea_responsables where tarea_id = new.id loop
    if not exists (
      select 1 from tareas t join tarea_responsables tr on tr.tarea_id = t.id
      where tr.usuario_id = r.usuario_id and t.fecha_limite >= ini and t.fecha_limite < fin and t.estado <> 'hecha'
    ) then
      insert into avisos (usuario_id, tipo, titulo, detalle)
      values (r.usuario_id, 'bateria', 'Tu batería quedó llena',
              'Semana del ' || to_char(ini at time zone 'America/Merida', 'DD') || ' al ' || to_char((fin - interval '1 day') at time zone 'America/Merida', 'DD') || '. ¡Buen trabajo!');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists aviso_bateria_llena on public.tareas;
create trigger aviso_bateria_llena after update of estado on public.tareas
  for each row execute function public.aviso_bateria_llena();

-- Recordatorio diario: tareas que vencen hoy (lo agenda pg_cron a las 8:00 de Mérida).
create or replace function public.recordar_vencen_hoy() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
  select r.usuario_id, 'vence', t.titulo || ' vence hoy',
         'a las ' || to_char(t.fecha_limite at time zone 'America/Merida', 'HH24:MI'), t.id
  from tareas t join tarea_responsables r on r.tarea_id = t.id
  where t.estado in ('por_hacer', 'en_proceso')
    and (t.fecha_limite at time zone 'America/Merida')::date = (now() at time zone 'America/Merida')::date;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.recordar_vencen_hoy() from public, anon, authenticated;
revoke execute on function public.enviar_push() from public, anon, authenticated;
