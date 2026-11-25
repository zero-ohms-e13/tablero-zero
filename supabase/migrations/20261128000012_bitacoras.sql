-- Tablero Zero · Bitácora personal semanal (v1)
--
-- Una bitácora por alumno y semana de Mérida (lunes a domingo). Tres preguntas guía obligatorias para
-- entregar y un texto libre opcional ("Mi bitácora completa"). Evidencias opcionales: una tarea, una
-- publicación de Materiales o un enlace HTTPS, siempre algo que el alumno YA puede ver.
--
-- Privacidad: solo la ve su autor y el coach (coach y mentor, igual que el resto de la app). Tutores,
-- compañeros y anónimos, no.
-- Plazo: por omisión domingo 20:00 hora de Mérida (decisión de Jaime); el coach puede cambiarlo para
-- cualquier semana (bitacora_plazos) y volver al de omisión. Entregar después del plazo vigente queda
-- marcado como tarde (si el coach extiende el plazo, la marca se recalcula).
-- El coach puede marcarla revisada con retroalimentación o devolverla para corregir (con nota).
-- Estados: borrador → entregada → (revisada | devuelta → entregada …)
--
-- Escritura SOLO por RPC. Recuperación: migración aditiva; basta ocultar el módulo en el frontend.

-- ---------- Semana y plazo (una sola fuente de verdad) ----------
create or replace function public.semana_merida(p_momento timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', p_momento at time zone 'America/Merida')::date
$$;

-- Plazo por omisión: domingo 20:00 de Mérida.
create or replace function public.vence_bitacora_omision(p_semana date) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((p_semana + 6) + time '20:00') at time zone 'America/Merida'
$$;

-- Plazos que el coach cambió para una semana concreta.
create table if not exists public.bitacora_plazos (
  semana date primary key check (extract(isodow from semana) = 1),
  vence_at timestamptz not null,
  cambiado_por uuid references public.profiles(id) on delete set null,
  cambiado_at timestamptz not null default now()
);
alter table public.bitacora_plazos enable row level security;
revoke insert, update, delete on public.bitacora_plazos from anon, authenticated;
revoke all on public.bitacora_plazos from anon;
drop policy if exists bitplazo_select on public.bitacora_plazos;
create policy bitplazo_select on public.bitacora_plazos for select to authenticated using (public.es_coach() or public.es_alumno());

-- Plazo vigente de una semana (el que cambió el coach, o el de omisión). Lo usan la base y la app.
create or replace function public.vence_bitacora(p_semana date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((select vence_at from bitacora_plazos where semana = p_semana), public.vence_bitacora_omision(p_semana))
$$;

-- El coach cambia el plazo de una semana (p_vence = null vuelve al domingo 20:00). Avisa a los alumnos.
create or replace function public.fijar_plazo_bitacora(p_semana date, p_vence timestamptz) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if not public.es_coach() then
    raise exception 'Solo el coach cambia la fecha de entrega.' using errcode = '42501';
  end if;
  if p_semana is null or extract(isodow from p_semana) <> 1 then
    raise exception 'Semana no válida.' using errcode = '22023';
  end if;
  if p_vence is null then
    delete from bitacora_plazos where semana = p_semana;
  else
    -- Dentro de la semana o hasta 4 semanas después de que empieza (para extender sin perderse)
    if p_vence <= (p_semana::timestamp at time zone 'America/Merida') or p_vence > ((p_semana + 35)::timestamp at time zone 'America/Merida') then
      raise exception 'La fecha de entrega debe caer entre el inicio de esa semana y 5 semanas después.' using errcode = '22023';
    end if;
    insert into bitacora_plazos (semana, vence_at, cambiado_por) values (p_semana, p_vence, auth.uid())
    on conflict (semana) do update set vence_at = excluded.vence_at, cambiado_por = excluded.cambiado_por, cambiado_at = now();
  end if;
  v := public.vence_bitacora(p_semana);
  insert into avisos (usuario_id, tipo, titulo, detalle)
  select p.id, 'bitacora', 'Cambió la fecha de entrega de la bitácora',
         'Semana del ' || to_char(p_semana, 'DD/MM') || ': ahora vence el ' ||
         to_char(v at time zone 'America/Merida', 'DD/MM') || ' a las ' || to_char(v at time zone 'America/Merida', 'HH24:MI') || ' h'
  from profiles p where p.rol_global = 'alumno' and p.activo;
  return v;
end $$;
revoke execute on function public.fijar_plazo_bitacora(date, timestamptz) from anon, public;
grant execute on function public.fijar_plazo_bitacora(date, timestamptz) to authenticated;

-- ---------- Tablas ----------
create table if not exists public.bitacoras (
  id uuid primary key default gen_random_uuid(),
  alumno_id uuid not null references public.profiles(id) on delete cascade,
  semana date not null check (extract(isodow from semana) = 1),
  estado text not null default 'borrador' check (estado in ('borrador', 'entregada', 'devuelta', 'revisada')),
  aporte text not null default '' check (char_length(aporte) <= 2000),
  aprendizaje text not null default '' check (char_length(aprendizaje) <= 2000),
  siguiente text not null default '' check (char_length(siguiente) <= 2000),
  necesita_ayuda boolean not null default false,
  texto_libre text not null default '' check (char_length(texto_libre) <= 50000),
  version int not null default 1,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  primera_entrega_at timestamptz,
  entregada_at timestamptz,
  devuelta_at timestamptz,
  retro text check (retro is null or char_length(retro) <= 4000),
  retro_por uuid references public.profiles(id) on delete set null,
  retro_at timestamptz,
  unique (alumno_id, semana)
);
create index if not exists bitacoras_semana on public.bitacoras (semana);

create table if not exists public.bitacora_evidencias (
  id uuid primary key default gen_random_uuid(),
  bitacora_id uuid not null references public.bitacoras(id) on delete cascade,
  tipo text not null check (tipo in ('tarea', 'material', 'enlace')),
  tarea_id uuid references public.tareas(id) on delete set null,
  material_id uuid references public.materiales(id) on delete set null,
  url text check (url is null or (url ~* '^https://' and char_length(url) <= 2000)),
  nombre text check (nombre is null or char_length(nombre) <= 160),
  orden int not null default 0
);

alter table public.bitacoras enable row level security;
alter table public.bitacora_evidencias enable row level security;
revoke insert, update, delete on public.bitacoras, public.bitacora_evidencias from anon, authenticated;
revoke all on public.bitacoras, public.bitacora_evidencias from anon;

-- Ver: el autor (alumno activo) siempre; el coach/mentor solo lo ENTREGADO (un borrador es privado del
-- alumno hasta que lo entrega; el seguimiento solo dice que está pendiente). Nadie más.
create or replace function public.puede_ver_bitacora(p_alumno uuid, p_estado text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.es_coach() and p_estado <> 'borrador') or (p_alumno = auth.uid() and public.es_alumno())
$$;

drop policy if exists bit_select on public.bitacoras;
create policy bit_select on public.bitacoras for select to authenticated using (public.puede_ver_bitacora(alumno_id, estado));
drop policy if exists bitev_select on public.bitacora_evidencias;
create policy bitev_select on public.bitacora_evidencias for select to authenticated using (
  exists (select 1 from public.bitacoras b where b.id = bitacora_id and public.puede_ver_bitacora(b.alumno_id, b.estado))
);

-- ---------- RPC del alumno ----------
-- Guarda el borrador de la semana (crea o actualiza). p_version = la que tiene el cliente (0 si es nueva):
-- si no coincide, otra pestaña guardó antes → 409 y el cliente conserva lo escrito.
-- p_datos: { aporte, aprendizaje, siguiente, necesita_ayuda, texto_libre, evidencias: [{tipo, tarea_id|material_id|url, nombre}] }
create or replace function public.guardar_bitacora(p_semana date, p_version int, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  v_b bitacoras%rowtype;
  v_actual date := public.semana_merida();
  e jsonb;
  n int := 0;
begin
  if v_yo is null or not public.es_alumno() then
    raise exception 'Solo los alumnos escriben bitácora.' using errcode = '42501';
  end if;
  if p_semana is null or extract(isodow from p_semana) <> 1 or p_semana > v_actual or p_semana < v_actual - 28 then
    raise exception 'Esa semana no está abierta para escribir.' using errcode = '22023';
  end if;

  select * into v_b from bitacoras where alumno_id = v_yo and semana = p_semana for update;
  if found then
    if v_b.estado in ('entregada', 'revisada') then
      raise exception 'conflicto: esta bitácora ya se entregó.' using errcode = 'PT409';
    end if;
    if v_b.version <> coalesce(p_version, -1) then
      raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
    end if;
    update bitacoras set
      aporte = coalesce(p_datos ->> 'aporte', ''), aprendizaje = coalesce(p_datos ->> 'aprendizaje', ''),
      siguiente = coalesce(p_datos ->> 'siguiente', ''), necesita_ayuda = coalesce((p_datos ->> 'necesita_ayuda')::boolean, false),
      texto_libre = coalesce(p_datos ->> 'texto_libre', ''), version = version + 1, actualizado_at = now()
    where id = v_b.id returning * into v_b;
  else
    if coalesce(p_version, 0) <> 0 then
      raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
    end if;
    insert into bitacoras (alumno_id, semana, aporte, aprendizaje, siguiente, necesita_ayuda, texto_libre)
    values (v_yo, p_semana, coalesce(p_datos ->> 'aporte', ''), coalesce(p_datos ->> 'aprendizaje', ''),
            coalesce(p_datos ->> 'siguiente', ''), coalesce((p_datos ->> 'necesita_ayuda')::boolean, false),
            coalesce(p_datos ->> 'texto_libre', ''))
    returning * into v_b;
  end if;

  -- Evidencias: se reemplazan; cada una debe ser algo que el alumno ya puede ver (no amplía permisos)
  delete from bitacora_evidencias where bitacora_id = v_b.id;
  for e in select * from jsonb_array_elements(coalesce(p_datos -> 'evidencias', '[]'::jsonb)) loop
    n := n + 1;
    if n > 10 then
      raise exception 'Una bitácora admite hasta 10 evidencias.' using errcode = '22023';
    end if;
    if e ->> 'tipo' = 'tarea' then
      if not public.puede_ver_tarea((e ->> 'tarea_id')::uuid) then
        raise exception 'No puedes vincular esa tarea.' using errcode = '42501';
      end if;
      insert into bitacora_evidencias (bitacora_id, tipo, tarea_id, orden) values (v_b.id, 'tarea', (e ->> 'tarea_id')::uuid, n);
    elsif e ->> 'tipo' = 'material' then
      if not exists (select 1 from materiales m where m.id = (e ->> 'material_id')::uuid and m.estado = 'publicada' and m.retirado_at is null)
         or not public.puede_ver_material((e ->> 'material_id')::uuid) then
        raise exception 'No puedes vincular esa publicación.' using errcode = '42501';
      end if;
      insert into bitacora_evidencias (bitacora_id, tipo, material_id, orden) values (v_b.id, 'material', (e ->> 'material_id')::uuid, n);
    elsif e ->> 'tipo' = 'enlace' then
      if coalesce(e ->> 'url', '') !~* '^https://[^\s/]+\.[^\s]+$' then
        raise exception 'El enlace debe empezar con https://' using errcode = '22023';
      end if;
      insert into bitacora_evidencias (bitacora_id, tipo, url, nombre, orden)
      values (v_b.id, 'enlace', e ->> 'url', left(nullif(btrim(coalesce(e ->> 'nombre', '')), ''), 160), n);
    else
      raise exception 'Evidencia no válida.' using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('id', v_b.id, 'version', v_b.version);
end $$;

create or replace function public.entregar_bitacora(p_id uuid, p_version int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_b bitacoras%rowtype;
begin
  select * into v_b from bitacoras where id = p_id for update;
  if not found or v_b.alumno_id <> auth.uid() or not public.es_alumno() then
    raise exception 'No tienes permiso para entregar esa bitácora.' using errcode = '42501';
  end if;
  if v_b.estado in ('entregada', 'revisada') then
    return jsonb_build_object('id', v_b.id, 'version', v_b.version); -- reintento tras una respuesta perdida
  end if;
  if v_b.version <> coalesce(p_version, -1) then
    raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
  end if;
  if btrim(v_b.aporte) = '' or btrim(v_b.aprendizaje) = '' or btrim(v_b.siguiente) = '' then
    raise exception 'Responde las tres preguntas antes de entregar.' using errcode = '22023';
  end if;
  update bitacoras set estado = 'entregada', entregada_at = now(), primera_entrega_at = coalesce(primera_entrega_at, now()),
         version = version + 1, actualizado_at = now()
   where id = p_id returning * into v_b;
  return jsonb_build_object('id', v_b.id, 'version', v_b.version);
end $$;

-- ---------- RPC del coach ----------
create or replace function public.revisar_bitacora(p_id uuid, p_retro text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_coach() then
    raise exception 'Solo el coach revisa bitácoras.' using errcode = '42501';
  end if;
  update bitacoras set estado = 'revisada', retro = nullif(btrim(coalesce(p_retro, '')), ''), retro_por = auth.uid(),
         retro_at = now(), version = version + 1, actualizado_at = now()
   where id = p_id and estado in ('entregada', 'revisada');
  if not found then
    raise exception 'conflicto: solo se revisa una bitácora entregada.' using errcode = 'PT409';
  end if;
end $$;

create or replace function public.devolver_bitacora(p_id uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare v_alumno uuid; v_semana date;
begin
  if not public.es_coach() then
    raise exception 'Solo el coach devuelve bitácoras.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nota, '')) = '' then
    raise exception 'Escribe qué hay que corregir.' using errcode = '22023';
  end if;
  update bitacoras set estado = 'devuelta', retro = btrim(p_nota), retro_por = auth.uid(), retro_at = now(),
         devuelta_at = now(), version = version + 1, actualizado_at = now()
   where id = p_id and estado in ('entregada', 'revisada')
   returning alumno_id, semana into v_alumno, v_semana;
  if not found then
    raise exception 'conflicto: solo se devuelve una bitácora entregada.' using errcode = 'PT409';
  end if;
  insert into avisos (usuario_id, tipo, titulo, detalle)
  values (v_alumno, 'bitacora', 'Tu bitácora volvió para corregir', 'Semana del ' || to_char(v_semana, 'DD/MM') || ': ' || left(btrim(p_nota), 120));
end $$;

-- Seguimiento de una semana: todos los alumnos activos, con o sin bitácora.
-- estado 'pendiente' = sin bitácora o solo borrador; atrasada = pendiente o devuelta después del plazo.
create or replace function public.resumen_bitacoras(p_semana date)
returns table (alumno_id uuid, nombre_visible text, iniciales text, color text, bitacora_id uuid, estado text,
               tarde boolean, atrasada boolean, entregada_at timestamptz, necesita_ayuda boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_coach() then
    raise exception 'Solo el coach ve el seguimiento.' using errcode = '42501';
  end if;
  return query
  select p.id, p.nombre_visible, p.iniciales, p.color, b.id,
         case when b.id is null or b.estado = 'borrador' then 'pendiente' else b.estado end,
         coalesce(b.primera_entrega_at > public.vence_bitacora(p_semana), false),
         (b.id is null or b.estado in ('borrador', 'devuelta')) and now() > public.vence_bitacora(p_semana),
         b.entregada_at, coalesce(b.necesita_ayuda and b.estado <> 'borrador', false)
  from profiles p
  left join bitacoras b on b.alumno_id = p.id and b.semana = p_semana
  where p.rol_global = 'alumno' and p.activo
  order by p.nombre_visible;
end $$;

revoke execute on function public.guardar_bitacora(date, int, jsonb), public.entregar_bitacora(uuid, int),
  public.revisar_bitacora(uuid, text), public.devolver_bitacora(uuid, text), public.resumen_bitacoras(date),
  public.puede_ver_bitacora(uuid, text), public.vence_bitacora(date) from anon, public;
grant execute on function public.guardar_bitacora(date, int, jsonb), public.entregar_bitacora(uuid, int),
  public.revisar_bitacora(uuid, text), public.devolver_bitacora(uuid, text), public.resumen_bitacoras(date),
  public.puede_ver_bitacora(uuid, text), public.vence_bitacora(date) to authenticated;
