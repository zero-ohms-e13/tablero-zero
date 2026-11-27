// Respaldo RESTAURABLE de Tablero Zero: datos de la base (public + Auth con contraseñas cifradas por Supabase)
// y archivos de Storage (evidencias, materiales), todo cifrado con RESPALDO_CLAVE. El esquema NO se respalda:
// se reconstruye con las migraciones del repo (el respaldo anota cuáles tenía la base).
// Uso:  node scripts/respaldo.mjs pruebas|produccion
// Deja la carpeta respaldos/<destino>-<fecha>/ (ignorada por git) con:
//   datos.sql.enc, archivos.bin.enc y manifiesto.json (conteos y migraciones, sin datos personales).
// Copia esa carpeta a un lugar fuera de esta PC (Drive o USB). Conserva 14 días (borra los de más de 14 días,
// dejando siempre los 3 más recientes). No imprime llaves ni contraseñas.
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_EFIMERO, BUCKETS, cifrar, destino, empaquetar, listarBucket, pg, validar } from './respaldo-comun.mjs';

const TZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d = destino(process.argv[2], resolve(TZ, '..'));
validar(d);
const inicio = Date.now();
const fecha = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(TZ, 'respaldos', `${d.nombre}-${fecha}`);
mkdirSync(dir, { recursive: true });
const srv = createClient(d.url, d.srv, { auth: { persistSession: false } });

// 1. Datos (solo datos; el esquema lo ponen las migraciones)
const excluir = AUTH_EFIMERO.flatMap((t) => [`--exclude-table-data=auth.${t}`]);
const sql = pg(d, 'pg_dump', ['--data-only', '--no-owner', '--no-privileges', '-n', 'public', '-n', 'auth', ...excluir]);
writeFileSync(join(dir, 'datos.sql.enc'), cifrar(sql, d.clave));

// 2. Conteos y migraciones (para comprobar la restauración)
const q = (s) => String(pg(d, 'psql', ['-At', '-c', s])).trim();
const tablas = q(`select string_agg(table_schema||'.'||table_name, ',' order by 1) from information_schema.tables
  where table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema = 'auth' and table_name in ('users','identities')))`).split(',');
const conteos = Object.fromEntries(tablas.map((t) => [t, Number(q(`select count(*) from ${t}`))]));
const migraciones = q(`select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations`).split(',');

// 3. Archivos de Storage
const archivos = [];
for (const b of BUCKETS) {
  for (const o of await listarBucket(srv, b)) {
    const { data, error } = await srv.storage.from(b).download(o.ruta);
    if (error) throw new Error(`No se pudo bajar ${b}/${o.ruta}: ${error.message}`);
    archivos.push({ ruta: `${b}/${o.ruta}`, tipo: o.tipo, datos: Buffer.from(await data.arrayBuffer()) });
  }
}
writeFileSync(join(dir, 'archivos.bin.enc'), cifrar(empaquetar(archivos), d.clave));

let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: TZ }).toString().trim();
} catch {}
const manifiesto = {
  proyecto: d.ref, destino: d.nombre, creado: new Date().toISOString(), commit, migraciones, conteos,
  archivos: archivos.length, bytes_archivos: archivos.reduce((s, a) => s + a.datos.length, 0), segundos: Math.round((Date.now() - inicio) / 1000),
};
writeFileSync(join(dir, 'manifiesto.json'), JSON.stringify(manifiesto, null, 1));

// 4. Retención: 14 días, dejando siempre los 3 más recientes de este destino
const mios = readdirSync(join(TZ, 'respaldos')).filter((x) => x.startsWith(`${d.nombre}-`)).sort().reverse();
for (const x of mios.slice(3)) {
  const p = join(TZ, 'respaldos', x);
  if (Date.now() - statSync(p).mtimeMs > 14 * 864e5) rmSync(p, { recursive: true, force: true });
}

console.log(`Respaldo listo: respaldos/${d.nombre}-${fecha}`);
console.log(`  ${Object.values(conteos).reduce((a, b) => a + b, 0)} filas en ${tablas.length} tablas, ${conteos['auth.users'] ?? 0} cuentas, ${archivos.length} archivos (${Math.round(manifiesto.bytes_archivos / 1024)} KB), ${manifiesto.segundos} s.`);
