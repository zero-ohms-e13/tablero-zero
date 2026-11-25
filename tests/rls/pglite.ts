// Postgres en memoria (PGlite) con un "mini Supabase": roles, auth.uid() y storage.
// Corre las migraciones reales de supabase/migrations y siembra datos de prueba.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRACIONES = join(process.cwd(), 'supabase', 'migrations');

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
-- Como Supabase: las funciones nuevas nacen ejecutables por anon/authenticated (un revoke posterior sí cuenta)
alter default privileges in schema public grant execute on functions to anon, authenticated;
-- Como Supabase: las tablas nuevas nacen con todos los privilegios para anon/authenticated/service_role;
-- la RLS y los revoke de las migraciones son los que realmente restringen.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const GRANTS = `
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- Solo para pruebas: ejecuta SQL y devuelve el mensaje de error (o null si pasó).
create function public.tz_probar(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end $$;
grant execute on function public.tz_probar(text) to anon, authenticated;
`;

export const U = {
  coach: '00000000-0000-0000-0000-0000000000c1',
  aux: '00000000-0000-0000-0000-0000000000c2',
  ana: '00000000-0000-0000-0000-00000000a001',
  marco: '00000000-0000-0000-0000-00000000a002',
  diego: '00000000-0000-0000-0000-00000000a003',
  luis: '00000000-0000-0000-0000-00000000a004',
  karla: '00000000-0000-0000-0000-00000000a005',
  sofia: '00000000-0000-0000-0000-00000000a006',
  tutorAna: '00000000-0000-0000-0000-00000000f001',
  tutorLuis: '00000000-0000-0000-0000-00000000f002',
} as const;

export const T = {
  odometria: '00000000-0000-0000-0000-0000000e0001', // Prog · Ana+Diego · en_proceso
  garra: '00000000-0000-0000-0000-0000000e0002', // Prog · Ana · en_revision
  cableado: '00000000-0000-0000-0000-0000000e0003', // Meca · Diego · en_proceso
  torre: '00000000-0000-0000-0000-0000000e0004', // Meca · Luis · en_revision
  post: '00000000-0000-0000-0000-0000000e0005', // Logi · Sofía · en_revision
  pits: '00000000-0000-0000-0000-0000000e0006', // Fem · Karla · por_hacer
} as const;

const SEED = `
insert into auth.users (id) values ${Object.values(U).map((id) => `('${id}')`).join(',')};
insert into profiles (id, usuario, nombre_visible, iniciales, rol_global, debe_cambiar_password) values
 ('${U.coach}','jaime.l','Coach Jaime Lugo','JL','coach',false),
 ('${U.aux}','laura.o','Laura Ortiz','LO','coach_aux',false),
 ('${U.ana}','ana.l','Ana López','AL','alumno',false),
 ('${U.marco}','marco.r','Marco Ruiz','MR','alumno',false),
 ('${U.diego}','diego.p','Diego Pérez','DP','alumno',false),
 ('${U.luis}','luis.m','Luis Medina','LM','alumno',false),
 ('${U.karla}','karla.t','Karla Torres','KT','alumno',false),
 ('${U.sofia}','sofia.r','Sofía Ramos','SR','alumno',false),
 ('${U.tutorAna}','tutor.ana.l','Familia de Ana','FA','tutor',true),
 ('${U.tutorLuis}','tutor.luis.m','Familia de Luis','FL','tutor',false);
insert into membresias (usuario_id, area_id, es_lider)
select u, (select id from areas where nombre = a), l from (values
 ('${U.ana}'::uuid,'Programación',false), ('${U.ana}'::uuid,'Rama femenil',false),
 ('${U.marco}'::uuid,'Programación',true),
 ('${U.diego}'::uuid,'Programación',false), ('${U.diego}'::uuid,'Mecánica',false),
 ('${U.luis}'::uuid,'Mecánica',true), ('${U.karla}'::uuid,'Mecánica',true), ('${U.karla}'::uuid,'Rama femenil',false),
 ('${U.sofia}'::uuid,'Logística',true)) v(u,a,l);
insert into tutores_alumnos values ('${U.tutorAna}','${U.ana}'), ('${U.tutorLuis}','${U.luis}');
insert into metas (id, titulo, robot) values ('00000000-0000-0000-0000-00000000e7a1','Autonomous de 15 s probado en la cancha','FTC');
insert into tareas (id, titulo, area_id, robot, estado, creada_por, meta_id, fecha_limite) values
 ('${T.odometria}','Calibrar la odometría',(select id from areas where nombre='Programación'),'FTC','en_proceso','${U.marco}','00000000-0000-0000-0000-00000000e7a1', now() - interval '1 day'),
 ('${T.garra}','Clase Garra con límites',(select id from areas where nombre='Programación'),'FTC','en_revision','${U.marco}','00000000-0000-0000-0000-00000000e7a1', now() + interval '1 day'),
 ('${T.cableado}','Montar batería y cableado',(select id from areas where nombre='Mecánica'),'VEX','en_proceso','${U.luis}',null, now()),
 ('${T.torre}','Ensamblar la torre del DR4B',(select id from areas where nombre='Mecánica'),'VEX','en_revision','${U.karla}',null, now()),
 ('${T.post}','Post: presentación del robot',(select id from areas where nombre='Logística'),'Ambos','en_revision','${U.sofia}',null, now()),
 ('${T.pits}','Checklist de pits',(select id from areas where nombre='Rama femenil'),'VEX','por_hacer','${U.coach}',null, now());
insert into tarea_responsables values
 ('${T.odometria}','${U.ana}'), ('${T.odometria}','${U.diego}'), ('${T.garra}','${U.ana}'),
 ('${T.cableado}','${U.diego}'), ('${T.torre}','${U.luis}'), ('${T.post}','${U.sofia}'), ('${T.pits}','${U.karla}');
insert into tarea_pasos (tarea_id, orden, texto) values ('${T.odometria}',1,'Medir ruedas'), ('${T.garra}',1,'Probar límite');
`;

export function migraciones() {
  return readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql') && !f.includes('solo_supabase')).sort();
}

export async function aplicar(db: PGlite, archivos: string[]) {
  for (const f of archivos) {
    const sql = readFileSync(join(MIGRACIONES, f), 'utf8').replace(/create extension if not exists pgcrypto;/g, '');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migración ${f} falló: ${(e as Error).message}`);
    }
  }
}

/** Base con todas las migraciones. Con `antesDe`, siembra sobre el esquema ANTERIOR a esa migración,
 *  ejecuta `entre` (datos sintéticos del esquema viejo) y luego aplica el resto (prueba de actualización). */
export async function crearBase(op: { antesDe?: string; entre?: (db: PGlite) => Promise<void> } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  const todas = migraciones();
  const corte = op.antesDe ? todas.findIndex((f) => f >= op.antesDe!) : -1;
  const viejas = corte >= 0 ? todas.slice(0, corte) : todas;
  await aplicar(db, viejas);
  await db.exec(GRANTS);
  await db.exec(SEED);
  if (corte >= 0) {
    await op.entre?.(db);
    await aplicar(db, todas.slice(corte));
  }

  // Ejecuta SQL como un usuario (o anónimo si id = null), igual que PostgREST.
  // Cada llamada va en su propia transacción, como una petición de PostgREST.
  async function como<R = Record<string, unknown>>(id: string | null, sql: string) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${id ?? ''}', true);`);
      const res = await tx.exec(sql);
      return res[res.length - 1].rows as R[];
    });
  }
  // Devuelve el mensaje de error si la sentencia fue rechazada; null si pasó.
  async function falla(id: string | null, sql: string): Promise<string | null> {
    const [r] = await como<{ e: string | null }>(id, `select public.tz_probar($q$${sql}$q$) as e`);
    return r.e;
  }
  // Como la Edge Function (service_role)
  async function comoServicio<R = Record<string, unknown>>(sql: string) {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role service_role;`);
      const res = await tx.exec(sql);
      return res[res.length - 1].rows as R[];
    });
  }
  return { db, como, falla, comoServicio };
}
