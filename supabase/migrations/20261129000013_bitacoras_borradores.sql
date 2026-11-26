-- Tablero Zero · Bitácoras: un borrador ya empezado siempre se puede retomar
--
-- Revisión de ChatGPT: si el coach mueve hacia adelante la primera semana exigible, los borradores de
-- semanas anteriores quedaban guardados pero sin poder editarse. Decisión (pedido de Jaime: que no se
-- pierda nada): un borrador o una devuelta que ya existe se retoma y se entrega siempre, en su semana
-- original. Las bitácoras NUEVAS siguen limitadas a la ventana (desde el arranque hasta hoy).
-- Solo reemplaza guardar_bitacora; aditiva.

create or replace function public.guardar_bitacora(p_id uuid, p_fecha date, p_version int, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_yo uuid := auth.uid();
  v_b bitacoras%rowtype;
  v_semana date := date_trunc('week', p_fecha)::date;
  v_guardado jsonb;
  e jsonb;
  n int := 0;
begin
  if v_yo is null or not public.es_alumno() then
    raise exception 'Solo los alumnos escriben bitácora.' using errcode = '42501';
  end if;
  if p_id is null or p_fecha is null or p_fecha > (now() at time zone 'America/Merida')::date then
    raise exception 'La fecha de la bitácora no puede ser futura.' using errcode = '22023';
  end if;

  -- Dos solicitudes con el mismo id (reintento, doble toque) se atienden una tras otra: la segunda ya
  -- encuentra la fila y sigue la ruta de reintento en lugar de chocar con la clave duplicada.
  perform pg_advisory_xact_lock(hashtextextended('bitacora:' || p_id, 0));
  select * into v_b from bitacoras where id = p_id for update;
  if found and v_b.alumno_id <> v_yo then
    raise exception 'No tienes permiso para modificar esa bitácora.' using errcode = '42501';
  end if;
  -- Ventana: una bitácora que YA existe (borrador o devuelta) se retoma siempre, en su semana original,
  -- aunque el coach haya movido el arranque; las nuevas, dentro de la ventana.
  if found and v_b.estado in ('borrador', 'devuelta') and (v_b.estado = 'devuelta' or not public.semana_abierta_bitacora(date_trunc('week', p_fecha)::date)) then
    v_semana := v_b.semana;
    p_fecha := v_b.fecha;
  elsif not public.semana_abierta_bitacora(v_semana) then
    raise exception 'Esa semana no está abierta para escribir.' using errcode = '22023';
  end if;

  if found then
    if v_b.estado in ('entregada', 'revisada') then
      raise exception 'conflicto: esta bitácora ya se entregó.' using errcode = 'PT409';
    end if;
    -- Versión 0 contra 1: el mismo cliente reintentando una creación cuya respuesta se perdió. Solo se acepta
    -- si el contenido es idéntico (se devuelve la fila tal cual); si cambió, es conflicto y no se pisa nada.
    if coalesce(p_version, 0) = 0 and v_b.version = 1 then
      select public.contenido_bitacora(v_b.fecha, jsonb_build_object(
               'aporte', v_b.aporte, 'aprendizaje', v_b.aprendizaje, 'siguiente', v_b.siguiente,
               'necesita_ayuda', v_b.necesita_ayuda, 'texto_libre', v_b.texto_libre,
               'evidencias', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'tarea_id', x.tarea_id, 'material_id', x.material_id, 'url', x.url, 'nombre', x.nombre) order by x.orden)
                                       from bitacora_evidencias x where x.bitacora_id = v_b.id), '[]'::jsonb)))
        into v_guardado;
      if v_guardado = public.contenido_bitacora(p_fecha, p_datos) then
        return jsonb_build_object('id', v_b.id, 'version', v_b.version);
      end if;
      raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
    end if;
    if v_b.version <> coalesce(p_version, -1) then
      raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
    end if;
    -- Mover un borrador a otra semana respeta el límite de esa semana (bajo el mismo candado)
    if v_semana <> v_b.semana then
      perform pg_advisory_xact_lock(hashtextextended('bitacoras:' || v_yo || ':' || v_semana, 0));
      if (select count(*) from bitacoras where alumno_id = v_yo and semana = v_semana) >= 10 then
        raise exception 'Esa semana ya tiene el máximo de 10 bitácoras.' using errcode = '22023';
      end if;
    end if;
    update bitacoras set
      fecha = p_fecha, semana = v_semana,
      aporte = coalesce(p_datos ->> 'aporte', ''), aprendizaje = coalesce(p_datos ->> 'aprendizaje', ''),
      siguiente = coalesce(p_datos ->> 'siguiente', ''), necesita_ayuda = coalesce((p_datos ->> 'necesita_ayuda')::boolean, false),
      texto_libre = coalesce(p_datos ->> 'texto_libre', ''), version = version + 1, actualizado_at = now()
    where id = v_b.id returning * into v_b;
  else
    if coalesce(p_version, 0) <> 0 then
      raise exception 'conflicto: la bitácora cambió en otra pestaña o dispositivo. Recarga para ver la versión guardada.' using errcode = 'PT409';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('bitacoras:' || v_yo || ':' || v_semana, 0));
    if (select count(*) from bitacoras where alumno_id = v_yo and semana = v_semana) >= 10 then
      raise exception 'Llegaste al máximo de 10 bitácoras en una semana.' using errcode = '22023';
    end if;
    insert into bitacoras (id, alumno_id, fecha, semana, aporte, aprendizaje, siguiente, necesita_ayuda, texto_libre)
    values (p_id, v_yo, p_fecha, v_semana, coalesce(p_datos ->> 'aporte', ''), coalesce(p_datos ->> 'aprendizaje', ''),
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
