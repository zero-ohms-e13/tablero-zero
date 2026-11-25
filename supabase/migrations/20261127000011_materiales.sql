-- Tablero Zero · Materiales del equipo (v1): publicaciones con archivos o enlaces y comentarios.
--
-- Alcance: un solo feed para TODO el equipo (decisión de Jaime). Leen, publican y comentan los
-- alumnos activos; el coach y el mentor (coach_aux) también, y además moderan. Tutores, cuentas
-- inactivas y anónimos quedan fuera.
--
-- Escritura SOLO por RPC (security definer): autoría y estado se fijan en el servidor y la tabla no
-- acepta insert/update/delete directos. Flujo de una publicación:
--   1. crear_material(cliente_id, …)  → borrador (idempotente por autor + cliente_id)
--   2. el cliente sube cada archivo a storage 'materiales/<material_id>/<adjunto_id>.<ext>'
--   3. agregar_adjunto(…)              → registra archivo (verifica el objeto real) o enlace HTTPS
--   4. publicar_material(id)           → exige ≥1 adjunto y que cada archivo exista; pasa a publicada
-- Un borrador (publicación incompleta o abandonada) solo lo ve su autor, igual que sus archivos.
--
-- Recuperación: migración aditiva. Para retirar el módulo basta ocultarlo en el frontend; las tablas
-- y el bucket pueden quedarse sin uso. No borra ni modifica datos existentes.

-- ---------- Tablas ----------
create table if not exists public.materiales (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references public.profiles(id) on delete cascade,
  cliente_id uuid not null,                       -- idempotencia: el mismo intento no crea dos borradores
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  nota text check (nota is null or char_length(nota) <= 2000),
  categoria text not null check (categoria in ('programacion', 'diseno', 'documentacion', 'pruebas', 'otro')),
  area_id uuid references public.areas(id) on delete set null,
  tarea_id uuid references public.tareas(id) on delete set null,
  estado text not null default 'borrador' check (estado in ('borrador', 'publicada')),
  creado_at timestamptz not null default now(),
  publicado_at timestamptz,
  editado_at timestamptz,
  retirado_at timestamptz,                        -- retirada por su autor o moderada por el coach
  retirado_por uuid references public.profiles(id) on delete set null,
  unique (autor_id, cliente_id)
);
create index if not exists materiales_feed on public.materiales (publicado_at desc) where estado = 'publicada' and retirado_at is null;

create table if not exists public.material_adjuntos (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiales(id) on delete cascade,
  tipo text not null check (tipo in ('archivo', 'enlace')),
  clase text not null check (clase in ('imagen', 'pdf', 'codigo', 'enlace')),
  ruta text,       -- archivo: ruta dentro del bucket 'materiales'
  url text,        -- enlace: solo https
  nombre text not null check (char_length(nombre) between 1 and 160),
  tamano bigint,
  orden int not null default 0,
  creado_at timestamptz not null default now(),
  check ((tipo = 'archivo' and ruta is not null and url is null) or (tipo = 'enlace' and url is not null and ruta is null)),
  unique (material_id, ruta)
);

create table if not exists public.material_comentarios (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materiales(id) on delete cascade,
  autor_id uuid not null references public.profiles(id) on delete cascade,
  cliente_id uuid not null,
  texto text not null check (char_length(btrim(texto)) between 1 and 2000),
  creado_at timestamptz not null default now(),
  editado_at timestamptz,
  retirado_at timestamptz,
  retirado_por uuid references public.profiles(id) on delete set null,
  unique (autor_id, cliente_id)
);
create index if not exists material_comentarios_hilo on public.material_comentarios (material_id, creado_at);

-- ---------- Permisos ----------
-- Quién entra al espacio: alumno o coach/mentor activos (mi_rol() ya exige activo).
create or replace function public.puede_ver_materiales() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_rol() in ('alumno', 'coach', 'coach_aux'), false)
$$;

-- Ver una publicación: publicada y no retirada; el autor ve sus borradores; el coach ve también las retiradas.
create or replace function public.puede_ver_material(p_material uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.puede_ver_materiales() and exists (
    select 1 from materiales m where m.id = p_material and (
      (m.estado = 'publicada' and m.retirado_at is null)
      or m.autor_id = auth.uid()
      or (public.es_coach() and m.estado = 'publicada')))
$$;

-- Ruta de storage → id del material (null si la ruta no tiene la forma esperada; nunca truena).
create or replace function public.material_de_ruta(p_ruta text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_ruta, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_ruta, '/', 1)::uuid end
$$;

-- Límites por clase de archivo (una sola fuente de verdad; el bucket aplica el máximo general).
create or replace function public.limite_material(p_clase text) returns bigint
language sql immutable set search_path = '' as $$
  select case p_clase when 'imagen' then 1048576 when 'pdf' then 10485760 when 'codigo' then 1048576 else 0 end
$$;

alter table public.materiales enable row level security;
alter table public.material_adjuntos enable row level security;
alter table public.material_comentarios enable row level security;

-- Solo lectura directa; toda escritura pasa por las RPC de abajo.
revoke insert, update, delete on public.materiales, public.material_adjuntos, public.material_comentarios from anon, authenticated;
revoke all on public.materiales, public.material_adjuntos, public.material_comentarios from anon;

drop policy if exists mat_select on public.materiales;
create policy mat_select on public.materiales for select to authenticated using (public.puede_ver_material(id));
drop policy if exists matadj_select on public.material_adjuntos;
create policy matadj_select on public.material_adjuntos for select to authenticated using (public.puede_ver_material(material_id));
drop policy if exists matcom_select on public.material_comentarios;
create policy matcom_select on public.material_comentarios for select to authenticated using (
  public.puede_ver_material(material_id)
  and (retirado_at is null or autor_id = auth.uid() or public.es_coach())
  and exists (select 1 from materiales m where m.id = material_id and m.estado = 'publicada')
);

-- Autoría visible sin ampliar profiles: un alumno solo ve perfiles de sus áreas, pero el feed es de
-- todo el equipo. Esto expone SOLO nombre visible, iniciales y color de quien publicó o comentó algo
-- que el usuario ya puede ver.
create or replace function public.autores_materiales()
returns table (id uuid, nombre_visible text, iniciales text, color text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre_visible, p.iniciales, p.color from profiles p
  where public.puede_ver_materiales() and (
    exists (select 1 from materiales m where m.autor_id = p.id and public.puede_ver_material(m.id))
    or exists (select 1 from material_comentarios c where c.autor_id = p.id and c.retirado_at is null
               and public.puede_ver_material(c.material_id)))
$$;
revoke execute on function public.autores_materiales() from anon, public;
grant execute on function public.autores_materiales() to authenticated;

-- ---------- RPC ----------
create or replace function public.crear_material(
  p_cliente_id uuid, p_titulo text, p_categoria text, p_nota text default null,
  p_area uuid default null, p_tarea uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_yo uuid := auth.uid();
begin
  if v_yo is null or not public.puede_ver_materiales() then
    raise exception 'No tienes permiso para publicar materiales.' using errcode = '42501';
  end if;
  -- Reintento del mismo intento: devuelve el borrador que ya existe (no duplica)
  select id into v_id from materiales where autor_id = v_yo and cliente_id = p_cliente_id;
  if v_id is not null then return v_id; end if;
  -- Vincular una tarea no amplía permisos: solo se puede vincular una tarea que ya puedes ver
  if p_tarea is not null and not public.puede_ver_tarea(p_tarea) then
    raise exception 'No tienes permiso para vincular esa tarea.' using errcode = '42501';
  end if;
  insert into materiales (autor_id, cliente_id, titulo, nota, categoria, area_id, tarea_id)
  values (v_yo, p_cliente_id, btrim(p_titulo), nullif(btrim(coalesce(p_nota, '')), ''), p_categoria, p_area, p_tarea)
  on conflict (autor_id, cliente_id) do nothing
  returning id into v_id;
  if v_id is null then -- carrera entre dos reintentos simultáneos
    select id into v_id from materiales where autor_id = v_yo and cliente_id = p_cliente_id;
  end if;
  return v_id;
end $$;

create or replace function public.agregar_adjunto(
  p_material uuid, p_tipo text, p_nombre text, p_ruta text default null, p_url text default null, p_clase text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m materiales%rowtype; v_obj record; v_id uuid; v_clase text;
begin
  select * into v_m from materiales where id = p_material for update;
  if not found or v_m.autor_id <> auth.uid() or not public.puede_ver_materiales() then
    raise exception 'No tienes permiso para modificar esa publicación.' using errcode = '42501';
  end if;
  if v_m.estado <> 'borrador' then
    raise exception 'conflicto: la publicación ya se envió.' using errcode = 'PT409';
  end if;
  if (select count(*) from material_adjuntos where material_id = p_material) >= 10 then
    raise exception 'Una publicación admite hasta 10 archivos o enlaces.' using errcode = '22023';
  end if;

  if p_tipo = 'enlace' then
    if p_url is null or p_url !~* '^https://[^\s/]+\.[^\s]+$' or char_length(p_url) > 2000 then
      raise exception 'El enlace debe empezar con https://' using errcode = '22023';
    end if;
    select id into v_id from material_adjuntos where material_id = p_material and url = p_url;
    if v_id is not null then return v_id; end if; -- reintento
    insert into material_adjuntos (material_id, tipo, clase, url, nombre, orden)
    values (p_material, 'enlace', 'enlace', p_url, left(coalesce(nullif(btrim(p_nombre), ''), p_url), 160),
            (select count(*) from material_adjuntos where material_id = p_material))
    returning id into v_id;
    return v_id;
  end if;

  if p_tipo <> 'archivo' or p_ruta is null or public.material_de_ruta(p_ruta) is distinct from p_material
     or p_ruta !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf|txt)$' then
    raise exception 'Archivo no válido.' using errcode = '22023';
  end if;
  select id into v_id from material_adjuntos where material_id = p_material and ruta = p_ruta;
  if v_id is not null then return v_id; end if; -- reintento
  -- El objeto debe existir de verdad, ser del autor, y su tipo y tamaño se validan aquí (no en el cliente)
  select o.owner, (o.metadata ->> 'size')::bigint as tamano, o.metadata ->> 'mimetype' as mime
    into v_obj from storage.objects o where o.bucket_id = 'materiales' and o.name = p_ruta;
  if not found or v_obj.owner is distinct from auth.uid() then
    raise exception 'El archivo no terminó de subirse. Vuelve a intentar.' using errcode = '22023';
  end if;
  v_clase := case
    when v_obj.mime in ('image/jpeg', 'image/png', 'image/webp') and p_ruta ~ '\.(jpg|png|webp)$' then 'imagen'
    when v_obj.mime = 'application/pdf' and p_ruta ~ '\.pdf$' then 'pdf'
    when v_obj.mime like 'text/plain%' and p_ruta ~ '\.txt$' then 'codigo'
  end;
  if v_clase is null or (p_clase is not null and p_clase <> v_clase) then
    raise exception 'Tipo de archivo no permitido.' using errcode = '22023';
  end if;
  if v_obj.tamano is null or v_obj.tamano > public.limite_material(v_clase) then
    raise exception 'El archivo es demasiado grande.' using errcode = '22023';
  end if;
  insert into material_adjuntos (material_id, tipo, clase, ruta, nombre, tamano, orden)
  values (p_material, 'archivo', v_clase, p_ruta, left(btrim(p_nombre), 160), v_obj.tamano,
          (select count(*) from material_adjuntos where material_id = p_material))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.quitar_adjunto(p_adjunto uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m materiales%rowtype;
begin
  select m.* into v_m from materiales m join material_adjuntos a on a.material_id = m.id where a.id = p_adjunto for update of m;
  if not found or v_m.autor_id <> auth.uid() then
    raise exception 'No tienes permiso para modificar esa publicación.' using errcode = '42501';
  end if;
  if v_m.estado <> 'borrador' then
    raise exception 'conflicto: la publicación ya se envió.' using errcode = 'PT409';
  end if;
  delete from material_adjuntos where id = p_adjunto;
end $$;

create or replace function public.publicar_material(p_material uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m materiales%rowtype;
begin
  select * into v_m from materiales where id = p_material for update;
  if not found or v_m.autor_id <> auth.uid() or not public.puede_ver_materiales() then
    raise exception 'No tienes permiso para publicar eso.' using errcode = '42501';
  end if;
  if v_m.estado = 'publicada' then return; end if; -- reintento tras una respuesta perdida
  if not exists (select 1 from material_adjuntos where material_id = p_material) then
    raise exception 'Agrega al menos un archivo o enlace.' using errcode = '22023';
  end if;
  if exists (select 1 from material_adjuntos a where a.material_id = p_material and a.tipo = 'archivo'
             and not exists (select 1 from storage.objects o where o.bucket_id = 'materiales' and o.name = a.ruta)) then
    raise exception 'Falta subir un archivo. Vuelve a intentar.' using errcode = '22023';
  end if;
  update materiales set estado = 'publicada', publicado_at = now() where id = p_material;
end $$;

create or replace function public.editar_material(p_material uuid, p_titulo text, p_nota text, p_categoria text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update materiales
     set titulo = btrim(p_titulo), nota = nullif(btrim(coalesce(p_nota, '')), ''), categoria = p_categoria,
         editado_at = case when estado = 'publicada' then now() end
   where id = p_material and autor_id = auth.uid() and retirado_at is null and public.puede_ver_materiales();
  if not found then
    raise exception 'No tienes permiso para editar esa publicación.' using errcode = '42501';
  end if;
end $$;

-- Retirar: el autor la suya; el coach/mentor cualquiera (moderación). No se borra: queda registro.
create or replace function public.retirar_material(p_material uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update materiales set retirado_at = now(), retirado_por = auth.uid()
   where id = p_material and retirado_at is null and public.puede_ver_materiales()
     and (autor_id = auth.uid() or public.es_coach());
  if not found then
    raise exception 'No tienes permiso para retirar esa publicación.' using errcode = '42501';
  end if;
end $$;

create or replace function public.comentar_material(p_material uuid, p_cliente_id uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_yo uuid := auth.uid();
begin
  select id into v_id from material_comentarios where autor_id = v_yo and cliente_id = p_cliente_id;
  if v_id is not null then return v_id; end if; -- reintento
  if v_yo is null or not exists (
    select 1 from materiales m where m.id = p_material and m.estado = 'publicada' and m.retirado_at is null)
    or not public.puede_ver_material(p_material) then
    raise exception 'No tienes permiso para comentar ahí.' using errcode = '42501';
  end if;
  insert into material_comentarios (material_id, autor_id, cliente_id, texto)
  values (p_material, v_yo, p_cliente_id, btrim(p_texto))
  on conflict (autor_id, cliente_id) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from material_comentarios where autor_id = v_yo and cliente_id = p_cliente_id; end if;
  return v_id;
end $$;

create or replace function public.editar_comentario_material(p_comentario uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update material_comentarios set texto = btrim(p_texto), editado_at = now()
   where id = p_comentario and autor_id = auth.uid() and retirado_at is null and public.puede_ver_materiales();
  if not found then
    raise exception 'No tienes permiso para editar ese comentario.' using errcode = '42501';
  end if;
end $$;

create or replace function public.retirar_comentario_material(p_comentario uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update material_comentarios set retirado_at = now(), retirado_por = auth.uid()
   where id = p_comentario and retirado_at is null and public.puede_ver_materiales()
     and (autor_id = auth.uid() or public.es_coach());
  if not found then
    raise exception 'No tienes permiso para retirar ese comentario.' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.crear_material(uuid, text, text, text, uuid, uuid), public.agregar_adjunto(uuid, text, text, text, text, text),
  public.quitar_adjunto(uuid), public.publicar_material(uuid), public.editar_material(uuid, text, text, text),
  public.retirar_material(uuid), public.comentar_material(uuid, uuid, text), public.editar_comentario_material(uuid, text),
  public.retirar_comentario_material(uuid) from anon, public;
grant execute on function public.crear_material(uuid, text, text, text, uuid, uuid), public.agregar_adjunto(uuid, text, text, text, text, text),
  public.quitar_adjunto(uuid), public.publicar_material(uuid), public.editar_material(uuid, text, text, text),
  public.retirar_material(uuid), public.comentar_material(uuid, uuid, text), public.editar_comentario_material(uuid, text),
  public.retirar_comentario_material(uuid) to authenticated;

-- ---------- Storage: bucket privado 'materiales' ----------
-- Ruta: <material_id>/<adjunto_uuid>.<jpg|png|webp|pdf|txt>. El código se guarda como texto plano
-- (.txt, text/plain) con su nombre original en material_adjuntos: se muestra como texto, nunca se ejecuta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materiales', 'materiales', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;

-- Descargar: quien puede ver la publicación (el borrador, solo su autor). Un enlace directo sin
-- permiso no sirve: Storage evalúa esta política en cada descarga y al firmar URLs.
drop policy if exists mat_storage_select on storage.objects;
-- Además, para los demás el archivo debe estar REGISTRADO como adjunto: un archivo que quedó a medias
-- o que el autor quitó del borrador no se vuelve visible cuando la publicación sale con otros adjuntos.
-- El autor sí ve todo lo que subió a sus propias publicaciones (para retomar o limpiar un borrador).
create policy mat_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'materiales' and (
    exists (select 1 from public.materiales m where m.id = public.material_de_ruta(name)
              and m.autor_id = auth.uid() and public.puede_ver_materiales())
    or exists (select 1 from public.material_adjuntos a where a.ruta = name and a.tipo = 'archivo'
                 and a.material_id = public.material_de_ruta(name) and public.puede_ver_material(a.material_id)))
);
-- Subir: solo el autor, y solo mientras su publicación es borrador.
drop policy if exists mat_storage_insert on storage.objects;
create policy mat_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'materiales' and exists (
    select 1 from public.materiales m where m.id = public.material_de_ruta(name)
      and m.autor_id = auth.uid() and m.estado = 'borrador' and public.puede_ver_materiales())
);
-- Borrar: el autor mientras es borrador (archivo que ya no usará).
drop policy if exists mat_storage_delete on storage.objects;
create policy mat_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'materiales' and exists (
    select 1 from public.materiales m where m.id = public.material_de_ruta(name)
      and m.autor_id = auth.uid() and m.estado = 'borrador')
);
