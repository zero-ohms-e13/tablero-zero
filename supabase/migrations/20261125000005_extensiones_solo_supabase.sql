-- Tablero Zero · extensiones que solo existen en Supabase (las pruebas locales con PGlite saltan este archivo)
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 8:00 en Mérida = 14:00 UTC, todos los días
select cron.unschedule(jobid) from cron.job where jobname = 'recordar-vencen-hoy';
select cron.schedule('recordar-vencen-hoy', '0 14 * * *', $$select public.recordar_vencen_hoy()$$);
