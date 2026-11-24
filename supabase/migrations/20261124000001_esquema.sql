-- Tablero Zero · esquema base
-- Usuarios sin correo: Auth usa <usuario>@zeroohms.local, que nunca se muestra.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique check (usuario ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  nombre_visible text not null check (char_length(nombre_visible) between 1 and 40),
  iniciales text not null check (char_length(iniciales) between 1 and 3),
  color text not null default '#590202',
  rol_global text not null check (rol_global in ('coach', 'coach_aux', 'alumno', 'tutor')),
  activo boolean not null default true,
  debe_cambiar_password boolean not null default true,
  password_temporal_vence timestamptz,
  acepto_privacidad_at timestamptz,
  creado_at timestamptz not null default now()
);

-- Bloqueo de 10 minutos tras 5 intentos fallidos. Solo la Edge Function la toca.
create table public.intentos_login (
  usuario text primary key,
  fallidos int not null default 0,
  bloqueado_hasta timestamptz,
  actualizado_at timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color text not null,
  color_claro text not null,
  icono text not null default 'engrane',
  orden int not null default 0
);

create table public.membresias (
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete cascade,
  es_lider boolean not null default false,
  primary key (usuario_id, area_id)
);

create table public.tutores_alumnos (
  tutor_id uuid not null references public.profiles(id) on delete cascade,
  alumno_id uuid not null references public.profiles(id) on delete cascade,
  primary key (tutor_id, alumno_id)
);

create table public.competencias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  equipo text
);

create table public.metas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  robot text not null check (robot in ('VEX', 'FTC', 'Ambos')),
  competencia_id uuid references public.competencias(id) on delete set null,
  fecha date,
  areas uuid[] not null default '{}',
  creado_at timestamptz not null default now()
);

create table public.tareas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (char_length(titulo) between 3 and 120),
  para_que_sirve text not null default '',
  area_id uuid not null references public.areas(id),
  meta_id uuid references public.metas(id) on delete set null,
  robot text not null check (robot in ('VEX', 'FTC', 'Ambos')),
  estado text not null default 'por_hacer'
    check (estado in ('por_hacer', 'en_proceso', 'en_revision', 'hecha')),
  pide_ayuda boolean not null default false,
  mensaje_ayuda text,
  herramienta_url text,
  fecha_limite timestamptz,
  creada_por uuid default auth.uid() references public.profiles(id) on delete set null,
  creada_at timestamptz not null default now(),
  aprobada_por uuid references public.profiles(id) on delete set null,
  aprobada_at timestamptz,
  actualizada_at timestamptz not null default now()
);
create index on public.tareas (area_id, estado);
create index on public.tareas (meta_id);
create index on public.tareas (fecha_limite);

create table public.tarea_responsables (
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  primary key (tarea_id, usuario_id)
);
create index on public.tarea_responsables (usuario_id);

create table public.tarea_pasos (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  orden int not null,
  texto text not null check (char_length(texto) between 1 and 200),
  hecho boolean not null default false
);
create index on public.tarea_pasos (tarea_id, orden);

create table public.evidencias (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  tipo text not null check (tipo in ('foto', 'enlace')),
  url text not null,
  subida_por uuid references public.profiles(id) on delete set null,
  creado_at timestamptz not null default now()
);

create table public.comentarios (
  id uuid primary key default gen_random_uuid(),
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  texto text not null check (char_length(texto) between 1 and 1000),
  creado_at timestamptz not null default now()
);

create table public.historial (
  id bigint generated always as identity primary key,
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  accion text not null,
  detalle text,
  creado_at timestamptz not null default now()
);
create index on public.historial (tarea_id, creado_at);

create table public.avisos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  detalle text,
  tarea_id uuid references public.tareas(id) on delete cascade,
  leido boolean not null default false,
  creado_at timestamptz not null default now()
);
create index on public.avisos (usuario_id, leido);

create table public.felicitaciones (
  tarea_id uuid not null references public.tareas(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  creado_at timestamptz not null default now(),
  primary key (tarea_id, usuario_id)
);

create table public.solicitudes_reinicio (
  id uuid primary key default gen_random_uuid(),
  usuario text not null,
  creado_at timestamptz not null default now(),
  atendida boolean not null default false
);

-- Semilla de áreas (colores de la guía visual)
insert into public.areas (nombre, color, color_claro, icono, orden) values
  ('Programación', '#2F5D8A', '#E2EAF3', 'codigo', 1),
  ('Mecánica', '#7A3E06', '#F6E3CC', 'engrane', 2),
  ('Logística', '#2E5A36', '#E1ECE2', 'camara', 3),
  ('Rama femenil', '#8A3B6B', '#F1E0EA', 'estrella', 4);
