-- Tablero Zero · reglas de negocio, bitácora (historial) y avisos

-- ---------- Guardia de tareas ----------
-- Un responsable que no es líder ni coach solo puede mover su tarea entre
-- por_hacer / en_proceso / en_revision y pedir ayuda. No puede aprobarse a sí mismo.
create or replace function public.tareas_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  gestor boolean := auth.uid() is null or public.puede_gestionar_tarea(old.id);
begin
  if not gestor then
    if new.titulo is distinct from old.titulo
      or new.para_que_sirve is distinct from old.para_que_sirve
      or new.area_id is distinct from old.area_id
      or new.meta_id is distinct from old.meta_id
      or new.robot is distinct from old.robot
      or new.fecha_limite is distinct from old.fecha_limite
      or new.herramienta_url is distinct from old.herramienta_url
      or new.creada_por is distinct from old.creada_por
      or new.aprobada_por is distinct from old.aprobada_por
      or new.aprobada_at is distinct from old.aprobada_at then
      raise exception 'Solo tu líder o el coach pueden editar esta tarea.' using errcode = '42501';
    end if;
    if new.estado = 'hecha' or old.estado = 'hecha' then
      raise exception 'Solo tu líder o el coach pueden aprobar la tarea.' using errcode = '42501';
    end if;
  end if;

  if new.estado = 'hecha' and old.estado <> 'hecha' then
    new.aprobada_por := coalesce(auth.uid(), new.aprobada_por);
    new.aprobada_at := coalesce(new.aprobada_at, now());
    new.pide_ayuda := false;
  elsif new.estado <> 'hecha' and old.estado = 'hecha' then
    new.aprobada_por := null;
    new.aprobada_at := null;
  end if;
  if not new.pide_ayuda then new.mensaje_ayuda := null; end if;
  new.actualizada_at := now();
  return new;
end $$;

create trigger tareas_guardia before update on public.tareas
  for each row execute function public.tareas_guardia();

-- Un líder no puede mover una tarea a otra área.
create or replace function public.tareas_area_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_coach()
     and new.area_id is distinct from old.area_id and not public.es_lider_de(new.area_id) then
    raise exception 'No puedes pasar tareas a un área que no lideras.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tareas_area_guardia before update of area_id on public.tareas
  for each row execute function public.tareas_area_guardia();

-- ---------- Historial (bitácora para el Engineering Notebook) ----------
create or replace function public.nombre_de(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nombre_visible from profiles where id = p), 'Alguien')
$$;

create or replace function public.etiqueta_estado(e text) returns text
language sql immutable as $$
  select case e when 'por_hacer' then 'Por hacer' when 'en_proceso' then 'En proceso'
                when 'en_revision' then 'En revisión' when 'hecha' then 'Hecho' else e end
$$;

create or replace function public.hist_tareas() returns trigger
language plpgsql security definer set search_path = public as $$
declare yo text := public.nombre_de(auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into historial (tarea_id, actor_id, accion, detalle)
    values (new.id, auth.uid(), 'creo', yo || ' creó la tarea');
  else
    if new.estado is distinct from old.estado then
      insert into historial (tarea_id, actor_id, accion, detalle) values (new.id, auth.uid(),
        case when new.estado = 'hecha' then 'aprobo' else 'movio' end,
        case when new.estado = 'hecha' then yo || ' aprobó la tarea'
             else yo || ' movió la tarea a ' || public.etiqueta_estado(new.estado) end);
    end if;
    if new.pide_ayuda and not old.pide_ayuda then
      insert into historial (tarea_id, actor_id, accion, detalle)
      values (new.id, auth.uid(), 'pidio_ayuda', yo || ' pidió ayuda');
    end if;
    if (new.titulo, new.para_que_sirve, new.fecha_limite, new.meta_id, new.robot)
       is distinct from (old.titulo, old.para_que_sirve, old.fecha_limite, old.meta_id, old.robot) then
      insert into historial (tarea_id, actor_id, accion, detalle)
      values (new.id, auth.uid(), 'edito', yo || ' editó la tarea');
    end if;
  end if;
  return new;
end $$;
create trigger hist_tareas after insert or update on public.tareas
  for each row execute function public.hist_tareas();

create or replace function public.hist_responsables() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historial (tarea_id, actor_id, accion, detalle) values (new.tarea_id, auth.uid(), 'asigno',
    public.nombre_de(auth.uid()) || ' se la asignó a ' || public.nombre_de(new.usuario_id));
  if new.usuario_id is distinct from auth.uid() then
    insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
    select new.usuario_id, 'asignada', 'Te asignaron una tarea', t.titulo, t.id from tareas t where t.id = new.tarea_id;
  end if;
  return new;
end $$;
create trigger hist_responsables after insert on public.tarea_responsables
  for each row execute function public.hist_responsables();

create or replace function public.hist_pasos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hecho is distinct from old.hecho then
    insert into historial (tarea_id, actor_id, accion, detalle) values (new.tarea_id, auth.uid(),
      case when new.hecho then 'paso_hecho' else 'paso_pendiente' end,
      public.nombre_de(auth.uid()) || case when new.hecho then ' marcó como hecho: ' else ' desmarcó: ' end || new.texto);
  end if;
  return new;
end $$;
create trigger hist_pasos after update on public.tarea_pasos
  for each row execute function public.hist_pasos();

create or replace function public.hist_evidencias() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historial (tarea_id, actor_id, accion, detalle) values (new.tarea_id, auth.uid(), 'evidencia',
    public.nombre_de(auth.uid()) || case when new.tipo = 'foto' then ' subió una foto' else ' agregó un enlace' end);
  return new;
end $$;
create trigger hist_evidencias after insert on public.evidencias
  for each row execute function public.hist_evidencias();

create or replace function public.hist_comentarios() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into historial (tarea_id, actor_id, accion, detalle)
  values (new.tarea_id, new.autor_id, 'comento', public.nombre_de(new.autor_id) || ' comentó');
  insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
  select r.usuario_id, 'comentario', public.nombre_de(new.autor_id) || ' comentó en ' || t.titulo,
         left(new.texto, 120), t.id
  from tarea_responsables r join tareas t on t.id = r.tarea_id
  where r.tarea_id = new.tarea_id and r.usuario_id is distinct from new.autor_id;
  return new;
end $$;
create trigger hist_comentarios after insert on public.comentarios
  for each row execute function public.hist_comentarios();

-- Avisos al aprobar
create or replace function public.avisos_tareas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'hecha' and old.estado <> 'hecha' then
    insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
    select r.usuario_id, 'aprobada', public.nombre_de(auth.uid()) || ' aprobó tu tarea', new.titulo, new.id
    from tarea_responsables r where r.tarea_id = new.id;
  end if;
  return new;
end $$;
create trigger avisos_tareas after update of estado on public.tareas
  for each row execute function public.avisos_tareas();

-- ---------- Acciones (RPC) ----------
create or replace function public.aprobar_tarea(p_tarea uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_gestionar_tarea(p_tarea) then
    raise exception 'Solo el líder del área o el coach pueden aprobar.' using errcode = '42501';
  end if;
  update tareas set estado = 'hecha' where id = p_tarea;
end $$;

-- "Regresar con nota": la nota es obligatoria y la tarea vuelve a En proceso.
create or replace function public.regresar_tarea(p_tarea uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_gestionar_tarea(p_tarea) then
    raise exception 'Solo el líder del área o el coach pueden regresar tareas.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_nota), '') = '' then
    raise exception 'Escribe qué le falta antes de regresarla.' using errcode = '22023';
  end if;
  update tareas set estado = 'en_proceso' where id = p_tarea;
  insert into comentarios (tarea_id, autor_id, texto) values (p_tarea, auth.uid(), btrim(p_nota));
  insert into historial (tarea_id, actor_id, accion, detalle)
  values (p_tarea, auth.uid(), 'regreso', public.nombre_de(auth.uid()) || ' la regresó con nota');
  insert into avisos (usuario_id, tipo, titulo, detalle, tarea_id)
  select r.usuario_id, 'regresada', 'Te regresaron una tarea con nota', btrim(p_nota), p_tarea
  from tarea_responsables r where r.tarea_id = p_tarea;
end $$;

-- Primer ingreso: después de cambiar la contraseña con auth.updateUser.
create or replace function public.completar_primer_ingreso(p_acepta_privacidad boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r text := public.mi_rol();
begin
  if r is null then raise exception 'Sesión no válida.' using errcode = '42501'; end if;
  if r = 'tutor' and not p_acepta_privacidad then
    raise exception 'Acepta el aviso de privacidad para entrar.' using errcode = '22023';
  end if;
  perform set_config('tz.primer_ingreso', 'si', true);
  update profiles set debe_cambiar_password = false, password_temporal_vence = null,
    acepto_privacidad_at = case when p_acepta_privacidad then coalesce(acepto_privacidad_at, now()) else acepto_privacidad_at end
  where id = auth.uid();
end $$;

-- "Olvidé mi contraseña": no manda correo, avisa al coach. No revela si el usuario existe.
create or replace function public.solicitar_reinicio(p_usuario text) returns void
language plpgsql security definer set search_path = public as $$
declare u text := lower(btrim(p_usuario));
begin
  if u !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' or char_length(u) > 40 then return; end if;
  if exists (select 1 from solicitudes_reinicio where usuario = u and not atendida) then return; end if;
  if (select count(*) from solicitudes_reinicio where creado_at > now() - interval '1 hour') > 30 then return; end if;
  insert into solicitudes_reinicio (usuario) values (u);
end $$;
grant execute on function public.solicitar_reinicio(text) to anon, authenticated;

-- Avance por área (solo totales, sin nombres): lo ven todos, incluidos tutores.
create or replace function public.avance_areas()
returns table (area_id uuid, nombre text, color text, color_claro text, hechas int, total int,
               por_revisar int, piden_ayuda int, vencidas int)
language sql stable security definer set search_path = public as $$
  select a.id, a.nombre, a.color, a.color_claro,
    count(t.id) filter (where t.estado = 'hecha')::int,
    count(t.id)::int,
    count(t.id) filter (where t.estado = 'en_revision')::int,
    count(t.id) filter (where t.pide_ayuda and t.estado <> 'hecha')::int,
    count(t.id) filter (where t.estado <> 'hecha' and t.fecha_limite < now())::int
  from areas a left join tareas t on t.area_id = a.id
  where auth.uid() is not null
  group by a.id order by a.orden
$$;

-- Avance de cada meta = tareas hechas / tareas de la meta (sin nombres).
create or replace function public.avance_metas()
returns table (meta_id uuid, hechas int, total int)
language sql stable security definer set search_path = public as $$
  select m.id, count(t.id) filter (where t.estado = 'hecha')::int, count(t.id)::int
  from metas m left join tareas t on t.meta_id = m.id
  where auth.uid() is not null
  group by m.id
$$;

revoke execute on function public.avance_areas() from anon;
revoke execute on function public.avance_metas() from anon;

-- ---------- Guardia de perfiles ----------
-- Desde el navegador el coach solo puede cambiar nombre, iniciales y color.
-- Rol, usuario, estado y contraseña temporal solo cambian desde la Edge Function.
create or replace function public.profiles_guardia() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is not null then
    if (new.id, new.usuario, new.rol_global, new.activo, new.debe_cambiar_password,
        new.password_temporal_vence, new.acepto_privacidad_at, new.creado_at)
       is distinct from
       (old.id, old.usuario, old.rol_global, old.activo, old.debe_cambiar_password,
        old.password_temporal_vence, old.acepto_privacidad_at, old.creado_at)
       and current_setting('tz.primer_ingreso', true) is distinct from 'si' then
      raise exception 'Ese cambio solo se hace desde Cuentas.' using errcode = '42501';
    end if;
    if old.rol_global = 'coach' and old.id <> auth.uid() then
      raise exception 'Solo el coach principal edita su perfil.' using errcode = '42501';
    end if;
  end if;
  return new;
end $f$;
create trigger profiles_guardia before update on public.profiles
  for each row execute function public.profiles_guardia();
