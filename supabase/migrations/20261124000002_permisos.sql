-- Tablero Zero · funciones de permiso y Row Level Security
-- Regla: el frontend solo esconde botones; quien decide es la base de datos.

-- ---------- Funciones auxiliares (security definer para no recursar en RLS) ----------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol_global from profiles where id = auth.uid() and activo
$$;

create or replace function public.es_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol_global in ('coach', 'coach_aux') from profiles where id = auth.uid() and activo), false)
$$;

create or replace function public.es_coach_principal() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol_global = 'coach' from profiles where id = auth.uid() and activo), false)
$$;

create or replace function public.es_alumno() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol_global = 'alumno' from profiles where id = auth.uid() and activo), false)
$$;

create or replace function public.mis_areas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.area_id from membresias m join profiles p on p.id = m.usuario_id
  where m.usuario_id = auth.uid() and p.activo
$$;

create or replace function public.es_lider_de(p_area uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membresias m join profiles p on p.id = m.usuario_id
    where m.usuario_id = auth.uid() and m.area_id = p_area and m.es_lider and p.activo)
$$;

create or replace function public.mis_hijos() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ta.alumno_id from tutores_alumnos ta join profiles p on p.id = ta.tutor_id
  where ta.tutor_id = auth.uid() and p.activo and p.rol_global = 'tutor'
$$;

create or replace function public.es_responsable(p_tarea uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tarea_responsables where tarea_id = p_tarea and usuario_id = auth.uid())
$$;

create or replace function public.es_tarea_de_mis_hijos(p_tarea uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tarea_responsables r where r.tarea_id = p_tarea
                 and r.usuario_id in (select public.mis_hijos()))
$$;

create or replace function public.es_del_area_de_la_tarea(p_tarea uuid, p_usuario uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias m join tareas t on t.area_id = m.area_id
                 where t.id = p_tarea and m.usuario_id = p_usuario)
$$;

-- Ver una tarea: coach; alumno de su área; responsable; tutor de un responsable.
create or replace function public.puede_ver_tarea(p_tarea uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_coach()
    or exists (select 1 from tareas t where t.id = p_tarea and public.es_alumno()
               and (t.area_id in (select public.mis_areas()) or public.es_responsable(p_tarea)))
    or exists (select 1 from tarea_responsables r where r.tarea_id = p_tarea
               and r.usuario_id in (select public.mis_hijos()))
$$;

-- Gestionar una tarea (editar, asignar, aprobar): coach o líder del área.
create or replace function public.puede_gestionar_tarea(p_tarea uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_coach()
    or exists (select 1 from tareas t where t.id = p_tarea and public.es_lider_de(t.area_id))
$$;

-- Trabajar una tarea (mover, pasos, evidencia): gestores o responsables.
create or replace function public.puede_trabajar_tarea(p_tarea uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.puede_gestionar_tarea(p_tarea)
    or (public.es_alumno() and public.es_responsable(p_tarea))
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.intentos_login enable row level security; -- sin políticas: solo service role
alter table public.areas enable row level security;
alter table public.membresias enable row level security;
alter table public.tutores_alumnos enable row level security;
alter table public.competencias enable row level security;
alter table public.metas enable row level security;
alter table public.tareas enable row level security;
alter table public.tarea_responsables enable row level security;
alter table public.tarea_pasos enable row level security;
alter table public.evidencias enable row level security;
alter table public.comentarios enable row level security;
alter table public.historial enable row level security;
alter table public.avisos enable row level security;
alter table public.felicitaciones enable row level security;
alter table public.solicitudes_reinicio enable row level security; -- solo coach

-- profiles: uno mismo; coach a todos; alumno a sus compañeros de área y a coaches;
-- tutor a sus hijos y a coaches. Un tutor nunca ve a otros alumnos.
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.es_coach()
  or rol_global in ('coach', 'coach_aux')
  or (public.es_alumno() and exists (
        select 1 from membresias m where m.usuario_id = profiles.id
        and m.area_id in (select public.mis_areas())))
  or id in (select public.mis_hijos())
);
create policy profiles_update_coach on public.profiles for update to authenticated
  using (public.es_coach()) with check (public.es_coach());

-- áreas, competencias y metas: lectura para cualquier sesión; escritura solo coach.
create policy areas_select on public.areas for select to authenticated using (true);
create policy areas_write on public.areas for all to authenticated
  using (public.es_coach()) with check (public.es_coach());
create policy competencias_select on public.competencias for select to authenticated using (true);
create policy competencias_write on public.competencias for all to authenticated
  using (public.es_coach()) with check (public.es_coach());
create policy metas_select on public.metas for select to authenticated using (true);
create policy metas_write on public.metas for all to authenticated
  using (public.es_coach()) with check (public.es_coach());

-- membresías
create policy membresias_select on public.membresias for select to authenticated using (
  public.es_coach()
  or usuario_id = auth.uid()
  or (public.es_alumno() and area_id in (select public.mis_areas()))
  or usuario_id in (select public.mis_hijos())
);
create policy membresias_write on public.membresias for all to authenticated
  using (public.es_coach()) with check (public.es_coach());

-- tutores
create policy tutores_select on public.tutores_alumnos for select to authenticated using (
  public.es_coach() or tutor_id = auth.uid() or alumno_id = auth.uid()
);
create policy tutores_write on public.tutores_alumnos for all to authenticated
  using (public.es_coach()) with check (public.es_coach());

-- tareas
-- Usa las columnas de la fila (no una subconsulta) para que el líder vea la tarea recién creada.
create policy tareas_select on public.tareas for select to authenticated using (
  public.es_coach()
  or (public.es_alumno() and (area_id in (select public.mis_areas()) or public.es_responsable(id)))
  or public.es_tarea_de_mis_hijos(id)
);
create policy tareas_insert on public.tareas for insert to authenticated with check (
  (public.es_coach() or public.es_lider_de(area_id)) and creada_por = auth.uid()
);
create policy tareas_update on public.tareas for update to authenticated
  using (public.puede_trabajar_tarea(id))
  with check (public.es_coach() or public.es_lider_de(area_id) or public.es_responsable(id));
create policy tareas_delete on public.tareas for delete to authenticated
  using (public.puede_gestionar_tarea(id));

-- responsables: el tutor solo ve la fila de su hijo(a), nunca a compañeros.
create policy resp_select on public.tarea_responsables for select to authenticated using (
  public.es_coach()
  or (public.es_alumno() and public.puede_ver_tarea(tarea_id))
  or usuario_id in (select public.mis_hijos())
);
-- Un líder solo asigna a integrantes de su área; el coach a cualquiera.
create policy resp_insert on public.tarea_responsables for insert to authenticated with check (
  public.puede_gestionar_tarea(tarea_id)
  and (public.es_coach() or public.es_del_area_de_la_tarea(tarea_id, usuario_id))
);
create policy resp_delete on public.tarea_responsables for delete to authenticated
  using (public.puede_gestionar_tarea(tarea_id));

-- pasos
create policy pasos_select on public.tarea_pasos for select to authenticated
  using (public.puede_ver_tarea(tarea_id));
create policy pasos_insert on public.tarea_pasos for insert to authenticated
  with check (public.puede_gestionar_tarea(tarea_id));
create policy pasos_update on public.tarea_pasos for update to authenticated
  using (public.puede_trabajar_tarea(tarea_id)) with check (public.puede_trabajar_tarea(tarea_id));
create policy pasos_delete on public.tarea_pasos for delete to authenticated
  using (public.puede_gestionar_tarea(tarea_id));

-- evidencias
create policy evid_select on public.evidencias for select to authenticated
  using (public.puede_ver_tarea(tarea_id));
create policy evid_insert on public.evidencias for insert to authenticated
  with check (public.puede_trabajar_tarea(tarea_id) and subida_por = auth.uid());
create policy evid_delete on public.evidencias for delete to authenticated
  using (subida_por = auth.uid() or public.puede_gestionar_tarea(tarea_id));

-- comentarios: cualquiera que vea la tarea, menos tutores.
create policy com_select on public.comentarios for select to authenticated
  using (public.puede_ver_tarea(tarea_id));
create policy com_insert on public.comentarios for insert to authenticated with check (
  autor_id = auth.uid() and (public.es_coach() or public.es_alumno()) and public.puede_ver_tarea(tarea_id)
);

-- historial: solo lectura (lo escriben los triggers)
create policy hist_select on public.historial for select to authenticated
  using (public.puede_ver_tarea(tarea_id));

-- avisos: cada quien los suyos
create policy avisos_select on public.avisos for select to authenticated using (usuario_id = auth.uid());
create policy avisos_update on public.avisos for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- felicitaciones
create policy fel_select on public.felicitaciones for select to authenticated
  using (public.puede_ver_tarea(tarea_id));
create policy fel_insert on public.felicitaciones for insert to authenticated
  with check (usuario_id = auth.uid() and public.puede_ver_tarea(tarea_id) and public.mi_rol() <> 'tutor');
create policy fel_delete on public.felicitaciones for delete to authenticated using (usuario_id = auth.uid());

-- solicitudes de reinicio: solo el coach las ve y atiende
create policy sol_select on public.solicitudes_reinicio for select to authenticated using (public.es_coach());
create policy sol_update on public.solicitudes_reinicio for update to authenticated
  using (public.es_coach()) with check (public.es_coach());

-- ---------- Storage: fotos de evidencia (bucket privado) ----------
-- Ruta: <tarea_id>/<archivo>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 524288, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create policy evid_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'evidencias' and public.puede_ver_tarea((split_part(name, '/', 1))::uuid)
);
create policy evid_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'evidencias' and public.puede_trabajar_tarea((split_part(name, '/', 1))::uuid)
);
create policy evid_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'evidencias' and (owner = auth.uid() or public.puede_gestionar_tarea((split_part(name, '/', 1))::uuid))
);
