-- Tablero Zero · Registro de cargas de datos (importar desde una hoja)
--
-- Cada lote (una hoja cargada desde la pantalla Importar del coach) deja constancia de qué creó en cada
-- etapa (áreas, cuentas, asignaciones, tutorías y tareas), para poder revisarlo o corregirlo sin tocar
-- registros previos. NUNCA guarda contraseñas: solo nombres, usuarios, claves de la hoja, ids y códigos de error.
-- Incluye altas_previas(), para reanudar una carga cuya respuesta se perdió reconociendo la cuenta por su solicitud.
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

-- Crea o actualiza el registro de un lote. Cada lista de p_resumen se UNE con la ya registrada (sin repetir):
-- un reintento que solo agrega una asignación no borra lo que el lote creó antes.
create or replace function public.registrar_importacion(p_id uuid, p_archivo text, p_etapa text, p_resumen jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_nuevo jsonb := coalesce(p_resumen, '{}'::jsonb);
  v_previo jsonb;
  v_unido jsonb;
begin
  if not public.es_coach_principal() then
    raise exception 'Solo el coach principal registra cargas de datos.' using errcode = '42501';
  end if;
  if v_nuevo::text ~* 'password|contraseña' then
    raise exception 'El registro de una carga no guarda contraseñas.' using errcode = '22023';
  end if;
  -- Forma cerrada: solo estas claves, cada una una lista de textos cortos (nombres, usuarios, claves de fila,
  -- ids y códigos de error). Nada de objetos libres ni mensajes largos donde pudiera colarse un dato sensible.
  if jsonb_typeof(v_nuevo) <> 'object' then
    raise exception 'Registro de carga con un formato no permitido.' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_each(v_nuevo) e
       where e.key not in ('areas', 'cuentas', 'asignaciones', 'tutorias', 'tareas', 'recuperadas', 'fallos', 'filas')
          or jsonb_typeof(e.value) <> 'array'
          or jsonb_array_length(e.value) > 500
          or exists (select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 160)
     ) then
    raise exception 'Registro de carga con un formato no permitido.' using errcode = '22023';
  end if;
  select resumen into v_previo from importaciones where id = p_id for update;
  select coalesce(jsonb_object_agg(k.clave, (
           select coalesce(jsonb_agg(distinct u.v), '[]'::jsonb)
           from (select jsonb_array_elements(coalesce(v_previo -> k.clave, '[]'::jsonb)) v
                 union select jsonb_array_elements(coalesce(v_nuevo -> k.clave, '[]'::jsonb))) u)), '{}'::jsonb)
    into v_unido
    from (select jsonb_object_keys(coalesce(v_previo, '{}'::jsonb)) clave union select jsonb_object_keys(v_nuevo)) k;
  insert into importaciones (id, coach_id, archivo, etapa, resumen)
  values (p_id, auth.uid(), left(coalesce(nullif(btrim(p_archivo), ''), 'hoja'), 200), p_etapa, v_unido)
  on conflict (id) do update set etapa = excluded.etapa, resumen = excluded.resumen, actualizado_at = now();
end $$;
revoke execute on function public.registrar_importacion(uuid, text, text, jsonb) from anon, public;
grant execute on function public.registrar_importacion(uuid, text, text, jsonb) to authenticated;

-- Altas que ESTE coach ya completó con esas solicitudes (ids estables de la hoja). Sirve para reanudar una
-- carga cuya respuesta se perdió (cerró la app, sin red): la revisión reconoce la cuenta por su solicitud y no
-- por usuario o nombre. Devuelve solo el resultado guardado (usuario_id, usuario, nombre, rol), sin contraseñas.
create or replace function public.altas_previas(p_solicitudes uuid[]) returns table (solicitud_id uuid, resultado jsonb)
language sql stable security definer set search_path = public as $$
  select a.solicitud_id, a.resultado
  from public.altas_cuentas a
  where public.es_coach_principal()
    and a.coach_id = auth.uid()
    and a.estado = 'completa'
    and a.solicitud_id = any ((coalesce(p_solicitudes, '{}'::uuid[]))[1:1000]);
$$;
revoke execute on function public.altas_previas(uuid[]) from anon, public;
grant execute on function public.altas_previas(uuid[]) to authenticated;
