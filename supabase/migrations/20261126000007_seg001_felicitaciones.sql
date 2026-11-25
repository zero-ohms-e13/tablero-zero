-- SEG-001 · Felicitaciones: la única vía de escritura es la RPC felicitar().
-- Antes, las políticas fel_insert/fel_delete permitían INSERT/DELETE directo por la API REST
-- con reglas distintas a las de la RPC (por ejemplo, felicitarse a uno mismo o felicitar tareas sin terminar).
--
-- Compatibilidad: el frontend anterior y el nuevo escriben SOLO con la RPC felicitar (Logros.tsx),
-- así que ambos funcionan con esta migración. La RPC conserva su firma felicitar(p_tarea uuid).
-- Recuperación (reversión completa; recrear las políticas NO basta, también hay que devolver privilegios):
--   grant insert, delete on public.felicitaciones to authenticated;
--   create policy fel_insert ... y create policy fel_delete ... (texto en 20261124000002_permisos.sql)
--   grant execute on function public.felicitar(uuid) to anon;   -- solo si se quiere el estado previo exacto
-- La versión de felicitar() de esta migración puede quedarse: funciona con ambos frontends.

drop policy if exists fel_insert on public.felicitaciones;
drop policy if exists fel_delete on public.felicitaciones;

-- Sin políticas de escritura la RLS ya niega, pero quitamos también el privilegio de tabla
-- (defensa en profundidad: ningún cambio futuro de políticas reabre el canal por accidente).
revoke insert, update, delete on public.felicitaciones from anon, authenticated;

-- La lectura autorizada se mantiene (política fel_select: quien puede ver la tarea).

-- La RPC sigue siendo security definer, con search_path fijo; solo usuarios autenticados la ejecutan.
alter function public.felicitar(uuid) set search_path = public;
revoke execute on function public.felicitar(uuid) from public, anon;
grant execute on function public.felicitar(uuid) to authenticated;

-- Las lecturas de logros tampoco son para anónimos.
revoke execute on function public.logros_equipo(int, uuid, boolean) from public, anon;
grant execute on function public.logros_equipo(int, uuid, boolean) to authenticated;
revoke execute on function public.total_logros() from public, anon;
grant execute on function public.total_logros() to authenticated;

-- Revisión (ChatGPT, punto de control 0): en la función privilegiada, search_path vacío y objetos calificados.
create or replace function public.felicitar(p_tarea uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  yo uuid := auth.uid();
  r text := public.mi_rol();
begin
  if yo is null or r is null or r = 'tutor' then
    raise exception 'Solo el equipo puede felicitar.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tareas where id = p_tarea and estado = 'hecha') then
    raise exception 'Solo se felicitan tareas terminadas.' using errcode = '22023';
  end if;
  if exists (select 1 from public.tarea_responsables where tarea_id = p_tarea and usuario_id = yo) then
    raise exception 'No puedes felicitarte a ti mismo.' using errcode = '22023';
  end if;
  if exists (select 1 from public.felicitaciones where tarea_id = p_tarea and usuario_id = yo) then
    delete from public.felicitaciones where tarea_id = p_tarea and usuario_id = yo;
    return false;
  end if;
  insert into public.felicitaciones (tarea_id, usuario_id) values (p_tarea, yo);
  -- El aviso solo se emite tras una felicitación válida (todas las validaciones anteriores pasaron)
  insert into public.avisos (usuario_id, tipo, titulo, detalle, tarea_id)
  select r2.usuario_id, 'felicitacion', public.nombre_de(yo) || ' te felicitó', t.titulo, t.id
  from public.tarea_responsables r2 join public.tareas t on t.id = r2.tarea_id
  where r2.tarea_id = p_tarea and r2.usuario_id <> yo;
  return true;
end $$;
revoke execute on function public.felicitar(uuid) from public, anon;
grant execute on function public.felicitar(uuid) to authenticated;
