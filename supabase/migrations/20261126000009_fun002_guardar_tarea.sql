-- FUN-002 · Alta y edición de tarea (datos + responsables + pasos) en UNA transacción.
--
-- Antes: el cliente hacía 4-8 peticiones separadas; un fallo a medias dejaba la tarea sin
-- responsables o con pasos incompletos, y un reintento podía duplicar pasos.
--
-- guardar_tarea(p jsonb) corre como el usuario (SECURITY INVOKER): las políticas RLS y los triggers
-- vigentes (guardia de tareas, área, historial, avisos de asignación) aplican igual que antes, así que
-- los permisos legítimos no cambian. Si cualquier paso falla, Postgres revierte todo.
--
-- Entrada:
--   { "id": uuid,                 -- obligatorio; en altas lo genera el cliente (reintento idempotente)
--     "nueva": bool,              -- true en alta
--     "version": timestamptz,     -- en edición: actualizada_at que vio el formulario
--     "guardado": uuid,           -- token de este intento de guardado (mismo en reintentos)
--     "titulo", "para_que_sirve", "area_id", "meta_id", "robot", "fecha_limite", "herramienta_url",
--     "responsables": [uuid],
--     "pasos": [{ "id": uuid, "texto": text }] }  -- ids generados por el cliente para pasos nuevos
-- Salida: { "id": uuid, "version": timestamptz }
--
-- Concurrencia: si la tarea cambió desde que se abrió el formulario → error 'conflicto' (PT409 → HTTP 409). No usar 40001: PostgREST reintenta
-- las fallas de serialización y la llamada se queda colgada (verificado en el proyecto de pruebas).
-- Reintento de un alta cuya respuesta se perdió: misma id + mismo autor → se aplica como edición
-- idempotente (no duplica tarea, responsables, pasos ni avisos).
-- Reintento de una EDICIÓN confirmada cuya respuesta se perdió: mismo token 'guardado' que el último
-- aplicado → se reconoce como ya guardada (no es conflicto, no repite avisos ni historial).
-- Los pasos existentes conservan su id y su estado "hecho"; solo cambian orden y texto.
--
-- Recuperación: la función es nueva; el cliente anterior sigue funcionando con las tablas.
-- Para revertir: drop function public.guardar_tarea(jsonb) y volver al cliente previo.

-- Token del último guardado aplicado (idempotencia de ediciones cuya respuesta se perdió). Aditivo.
alter table public.tareas add column if not exists ultimo_guardado uuid;

create or replace function public.guardar_tarea(p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_nueva boolean := coalesce((p ->> 'nueva')::boolean, false);
  v_version timestamptz := (p ->> 'version')::timestamptz;
  v_guardado uuid := nullif(p ->> 'guardado', '')::uuid;
  v_resp uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'responsables', '[]'::jsonb))::uuid), '{}');
  v_pasos jsonb := coalesce(p -> 'pasos', '[]'::jsonb);
  t public.tareas;
  paso jsonb;
  i int := 0;
  ajenos int;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode = '42501'; end if;
  if v_id is null then raise exception 'Falta el identificador de la tarea.' using errcode = '22023'; end if;
  if jsonb_typeof(v_pasos) <> 'array' then raise exception 'Pasos inválidos.' using errcode = '22023'; end if;
  if cardinality(v_resp) = 0 then raise exception 'Elige al menos a una persona responsable.' using errcode = '22023'; end if;

  -- Meta coherente con el área (misma regla que el formulario: meta sin áreas o que incluye el área).
  -- Se respeta una meta ya guardada aunque no cumpla (datos previos), si no cambia.
  if nullif(p ->> 'meta_id', '') is not null and not exists (
    select 1 from public.metas m where m.id = (p ->> 'meta_id')::uuid
      and (cardinality(m.areas) = 0 or (p ->> 'area_id')::uuid = any (m.areas))
  ) and not exists (
    select 1 from public.tareas x where x.id = v_id and x.meta_id = (p ->> 'meta_id')::uuid and x.area_id = (p ->> 'area_id')::uuid
  ) then
    raise exception 'Esa meta no corresponde al área de la tarea.' using errcode = '22023';
  end if;

  select * into t from public.tareas where id = v_id for update;

  if t.id is null then
    if not v_nueva then
      raise exception 'La tarea ya no existe o no puedes editarla.' using errcode = 'P0002';
    end if;
    -- Alta (RLS tareas_insert: coach o líder del área, creada_por = yo)
    insert into public.tareas (id, titulo, para_que_sirve, area_id, meta_id, robot, fecha_limite, herramienta_url, creada_por, ultimo_guardado)
    values (v_id, trim(p ->> 'titulo'), coalesce(trim(p ->> 'para_que_sirve'), ''), (p ->> 'area_id')::uuid,
            nullif(p ->> 'meta_id', '')::uuid, p ->> 'robot', nullif(p ->> 'fecha_limite', '')::timestamptz,
            nullif(trim(p ->> 'herramienta_url'), ''), auth.uid(), v_guardado);
  else
    if v_nueva and t.creada_por is distinct from auth.uid() then
      raise exception 'conflicto: ese identificador ya existe.' using errcode = 'PT409';
    end if;
    if v_guardado is not null and t.ultimo_guardado = v_guardado then
      if not public.puede_gestionar_tarea(v_id) then
        raise exception 'Solo tu líder o el coach pueden editar esta tarea.' using errcode = '42501';
      end if;
      return jsonb_build_object('id', v_id, 'version', t.actualizada_at, 'repetido', true);
    end if;
    if not v_nueva and (v_version is null or t.actualizada_at <> v_version) then
      raise exception 'conflicto: alguien más cambió esta tarea. Recarga para ver los cambios.' using errcode = 'PT409';
    end if;
    if not public.puede_gestionar_tarea(v_id) then
      raise exception 'Solo tu líder o el coach pueden editar esta tarea.' using errcode = '42501';
    end if;
    -- Edición (RLS tareas_update + guardias de tarea y de área)
    update public.tareas set
      titulo = trim(p ->> 'titulo'),
      para_que_sirve = coalesce(trim(p ->> 'para_que_sirve'), ''),
      area_id = (p ->> 'area_id')::uuid,
      meta_id = nullif(p ->> 'meta_id', '')::uuid,
      robot = p ->> 'robot',
      fecha_limite = nullif(p ->> 'fecha_limite', '')::timestamptz,
      herramienta_url = nullif(trim(p ->> 'herramienta_url'), ''),
      ultimo_guardado = v_guardado
    where id = v_id;
    if not found then raise exception 'No tienes permiso para editar esta tarea.' using errcode = '42501'; end if;
  end if;

  -- Responsables (RLS: el líder solo asigna a integrantes del área de la tarea)
  delete from public.tarea_responsables where tarea_id = v_id and usuario_id <> all (v_resp);
  insert into public.tarea_responsables (tarea_id, usuario_id)
  select v_id, u from unnest(v_resp) u
  on conflict do nothing;
  if (select count(*) from public.tarea_responsables where tarea_id = v_id) <> (select count(distinct u) from unnest(v_resp) u) then
    raise exception 'No se pudo asignar a todas las personas elegidas.' using errcode = '42501';
  end if;

  -- Pasos: ninguno puede pertenecer a otra tarea
  select count(*) into ajenos from jsonb_array_elements(v_pasos) x
  join public.tarea_pasos tp on tp.id = (x ->> 'id')::uuid
  where tp.tarea_id <> v_id;
  if ajenos > 0 then raise exception 'Hay pasos que no son de esta tarea.' using errcode = '42501'; end if;
  if exists (select 1 from jsonb_array_elements(v_pasos) x where (x ->> 'id') is null) then
    raise exception 'Cada paso necesita identificador.' using errcode = '22023';
  end if;

  delete from public.tarea_pasos
  where tarea_id = v_id and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_pasos) x);
  for paso in select * from jsonb_array_elements(v_pasos) loop
    i := i + 1;
    insert into public.tarea_pasos as tp (id, tarea_id, orden, texto)
    values ((paso ->> 'id')::uuid, v_id, i, trim(paso ->> 'texto'))
    on conflict (id) do update set orden = excluded.orden, texto = excluded.texto
      where (tp.orden, tp.texto) is distinct from (excluded.orden, excluded.texto);
  end loop;

  select * into t from public.tareas where id = v_id;
  return jsonb_build_object('id', v_id, 'version', t.actualizada_at);
end $$;

revoke execute on function public.guardar_tarea(jsonb) from public, anon;
grant execute on function public.guardar_tarea(jsonb) to authenticated;
