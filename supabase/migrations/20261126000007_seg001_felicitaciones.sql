-- SEG-001 · Felicitaciones: la única vía de escritura es la RPC felicitar().
-- Antes, las políticas fel_insert/fel_delete permitían INSERT/DELETE directo por la API REST
-- con reglas distintas a las de la RPC (por ejemplo, felicitarse a uno mismo o felicitar tareas sin terminar).
--
-- Recuperación: para volver al estado anterior, recrear las políticas fel_insert y fel_delete
-- (ver 20261124000002_permisos.sql) y volver a otorgar INSERT, DELETE a authenticated.

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
