-- Tablero Zero · Registro de cargas de datos (importar desde una hoja)
--
-- Cada lote (una hoja cargada desde la pantalla Importar del coach) deja constancia de qué creó en cada
-- etapa (áreas, cuentas, asignaciones, tutorías y tareas), para poder revisarlo o corregirlo sin tocar
-- registros previos. NUNCA guarda contraseñas: solo nombres, usuarios, claves de la hoja e ids.
-- Solo el coach principal lo ve y lo escribe. Escritura solo por RPC. Aditiva.

create table if not exists public.importaciones (
  id uuid primary key,                         -- estable por hoja: repetir la carga del mismo archivo reusa el lote
  coach_id uuid references public.profiles(id) on delete set null default auth.uid(),
  archivo text not null check (char_length(archivo) between 1 and 200),
  etapa text not null default 'revisado' check (etapa in ('revisado', 'en_curso', 'terminado', 'con_errores')),
  resumen jsonb not null default '{}'::jsonb,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
alter table public.importaciones enable row level security;
revoke insert, update, delete on public.importaciones from anon, authenticated;
revoke all on public.importaciones from anon;
drop policy if exists imp_select on public.importaciones;
create policy imp_select on public.importaciones for select to authenticated using (public.es_coach_principal());

-- Crea o actualiza el registro de un lote. p_resumen se MEZCLA con lo ya registrado (cada etapa agrega lo suyo).
create or replace function public.registrar_importacion(p_id uuid, p_archivo text, p_etapa text, p_resumen jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_coach_principal() then
    raise exception 'Solo el coach principal registra cargas de datos.' using errcode = '42501';
  end if;
  if p_resumen::text ~* 'password|contraseña' then
    raise exception 'El registro de una carga no guarda contraseñas.' using errcode = '22023';
  end if;
  insert into importaciones (id, coach_id, archivo, etapa, resumen)
  values (p_id, auth.uid(), left(coalesce(nullif(btrim(p_archivo), ''), 'hoja'), 200), p_etapa, coalesce(p_resumen, '{}'::jsonb))
  on conflict (id) do update set etapa = excluded.etapa, resumen = importaciones.resumen || excluded.resumen, actualizado_at = now();
end $$;
revoke execute on function public.registrar_importacion(uuid, text, text, jsonb) from anon, public;
grant execute on function public.registrar_importacion(uuid, text, text, jsonb) to authenticated;
