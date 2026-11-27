// Restaura un respaldo de scripts/respaldo.mjs en un proyecto que YA tiene el esquema (las mismas migraciones):
// reemplaza TODOS los datos de public y las cuentas de Auth, y deja Storage igual que en el respaldo.
// Uso:  node scripts/restaurar.mjs pruebas respaldos/<carpeta>
//       node scripts/restaurar.mjs produccion respaldos/<carpeta> --confirmo-produccion   (solo con OK de Jaime)
// Proyecto nuevo: créalo, aplica las migraciones (supabase db push), despliega las funciones (entrar,
// admin-accounts) con sus secretos y luego corre este script. Ver docs/RESPALDO.md.
// No imprime llaves ni contraseñas.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKETS, descifrar, desempaquetar, destino, listarBucket, pg, validar } from './respaldo-comun.mjs';

const TZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [nombre, carpeta, ...banderas] = process.argv.slice(2);
if (nombre === 'produccion' && !banderas.includes('--confirmo-produccion')) {
  console.error('Detenido: restaurar en PRODUCCIÓN reemplaza todos los datos. Requiere --confirmo-produccion (y el OK de Jaime).');
  process.exit(2);
}
const d = destino(nombre, resolve(TZ, '..'));
validar(d);
const dir = resolve(TZ, carpeta ?? '');
const inicio = Date.now();
const man = JSON.parse(readFileSync(join(dir, 'manifiesto.json'), 'utf8'));
const sql = descifrar(readFileSync(join(dir, 'datos.sql.enc')), d.clave);
const archivos = desempaquetar(descifrar(readFileSync(join(dir, 'archivos.bin.enc')), d.clave));
const q = (s) => String(pg(d, 'psql', ['-At', '-c', s])).trim();

// 1. El esquema del destino debe tener las mismas migraciones que la base respaldada
const enDestino = new Set(q(`select string_agg(version, ',') from supabase_migrations.schema_migrations`).split(','));
const faltan = man.migraciones.filter((m) => !enDestino.has(m));
if (faltan.length) throw new Error(`Al destino le faltan migraciones: ${faltan.join(', ')}. Aplica primero supabase db push.`);
const sobran = [...enDestino].filter((m) => !man.migraciones.includes(m));
if (sobran.length) console.log(`AVISO el destino tiene migraciones más nuevas que el respaldo (${sobran.join(', ')}); se restaura igual.`);

// 2. Datos: en UNA transacción, se vacían public y las cuentas de Auth y se cargan las del respaldo.
//    session_replication_role = replica: sin disparadores ni revisión de llaves foráneas durante la carga.
const guion = Buffer.concat([
  Buffer.from(`\\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;
do $$ declare t text; begin
  select string_agg(format('%I.%I', table_schema, table_name), ', ') into t
  from information_schema.tables where table_type = 'BASE TABLE' and table_schema = 'public';
  execute 'truncate table ' || t || ', auth.identities, auth.users cascade';
end $$;
`),
  sql,
  Buffer.from('\nset session_replication_role = origin;\ncommit;\n'),
]);
pg(d, 'psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: guion });

// 3. Storage: sube los archivos del respaldo y quita los que no estaban
const srv = createClient(d.url, d.srv, { auth: { persistSession: false } });
const delRespaldo = new Set(archivos.map((a) => a.ruta));
for (const a of archivos) {
  const [bucket, ...resto] = a.ruta.split('/');
  const { error } = await srv.storage.from(bucket).upload(resto.join('/'), a.datos, { upsert: true, contentType: a.tipo || undefined });
  if (error) throw new Error(`No se pudo subir ${a.ruta}: ${error.message}`);
}
let quitados = 0;
for (const b of BUCKETS) {
  const extra = (await listarBucket(srv, b)).map((o) => o.ruta).filter((r) => !delRespaldo.has(`${b}/${r}`));
  for (let i = 0; i < extra.length; i += 100) {
    const { error } = await srv.storage.from(b).remove(extra.slice(i, i + 100));
    if (error) throw new Error(`No se pudieron quitar archivos de ${b}: ${error.message}`);
  }
  quitados += extra.length;
}

// 4. Comprobación: los conteos deben coincidir con el manifiesto
let distintas = 0;
for (const [t, n] of Object.entries(man.conteos)) {
  const ahora = Number(q(`select count(*) from ${t}`));
  if (ahora !== n) {
    console.log(`FALLA ${t}: respaldo ${n}, restaurado ${ahora}`);
    distintas++;
  }
}
console.log(`Restaurado en ${d.nombre} el respaldo de ${man.destino} del ${man.creado}: ${Object.keys(man.conteos).length} tablas, ${archivos.length} archivos (${quitados} sobrantes quitados), ${Math.round((Date.now() - inicio) / 1000)} s.`);
if (distintas) {
  console.log(`${distintas} tablas no coinciden`);
  process.exit(1);
}
console.log('Conteos idénticos al respaldo. Las sesiones abiertas se cerraron: cada quien vuelve a entrar con su contraseña.');
