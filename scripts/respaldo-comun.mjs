// Piezas compartidas por scripts/respaldo.mjs y scripts/restaurar.mjs. No imprime llaves ni contraseñas.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const PRODUCCION = 'hyghwlmatnnvnkvmhxrt';
export const PRUEBAS = 'kwzzytdphhghwhoktavw';
export const BUCKETS = ['evidencias', 'materiales'];
// Datos de Auth que NO se respaldan: sesiones, tokens y bitácoras internas (tras restaurar, cada quien vuelve a entrar).
export const AUTH_EFIMERO = ['schema_migrations', 'sessions', 'refresh_tokens', 'one_time_tokens', 'flow_state', 'mfa_challenges', 'mfa_amr_claims', 'audit_log_entries', 'oauth_authorizations', 'oauth_consents'];

export function leerEnv(ruta) {
  if (!existsSync(ruta)) throw new Error(`No existe ${ruta}`);
  return Object.fromEntries(
    readFileSync(ruta, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

/** Configuración del destino. Las contraseñas solo viajan en variables de entorno de los procesos hijos. */
export function destino(nombre, raiz) {
  const tz = join(raiz, 'tablero-zero');
  if (nombre === 'pruebas') {
    const e = { ...leerEnv(join(raiz, 'tz-candidata/supabase/.env')), ...leerEnv(join(raiz, 'tz-candidata/.env.pruebas')) };
    const r = leerEnv(join(tz, '.env.respaldo.pruebas'));
    return { nombre, ref: PRUEBAS, url: e.SUPABASE_URL, srv: e.SUPABASE_SERVICE_ROLE_KEY, dbPass: e.PRUEBAS_DB_PASSWORD, pooler: r.POOLER_HOST, clave: r.RESPALDO_CLAVE };
  }
  if (nombre === 'produccion') {
    const e = leerEnv(join(tz, 'supabase/.env'));
    const r = leerEnv(join(tz, '.env.respaldo')); // lo llena Jaime: PROD_DB_PASSWORD y RESPALDO_CLAVE
    const pooler = new URL(readFileSync(join(tz, 'supabase/.temp/pooler-url'), 'utf8').trim()).hostname;
    return { nombre, ref: PRODUCCION, url: e.SUPABASE_URL, srv: e.SUPABASE_SERVICE_ROLE_KEY, dbPass: r.PROD_DB_PASSWORD, pooler, clave: r.RESPALDO_CLAVE };
  }
  throw new Error('Destino: pruebas o produccion');
}

export function validar(d) {
  for (const k of ['url', 'srv', 'dbPass', 'pooler', 'clave']) if (!d[k]) throw new Error(`Falta ${k} para ${d.nombre} (revisa el archivo .env.respaldo correspondiente).`);
  if (!d.url.includes(d.ref)) throw new Error(`La URL no corresponde al proyecto ${d.ref}.`);
  if (d.clave.length < 12) throw new Error('RESPALDO_CLAVE debe tener al menos 12 caracteres.');
}

const PG = process.env.PG_BIN ?? 'C:/Users/jaime/herramientas/pgsql-17.12/pgsql/bin';

/** Ejecuta pg_dump/psql contra el pooler en modo sesión (5432). La contraseña va en PGPASSWORD, nunca en la línea de comandos. */
export function pg(d, programa, args, opciones = {}) {
  const r = spawnSync(join(PG, `${programa}.exe`), ['-h', d.pooler, '-p', '5432', '-U', `postgres.${d.ref}`, '-d', 'postgres', ...args], {
    env: { ...process.env, PGPASSWORD: d.dbPass, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '20' },
    maxBuffer: 1024 * 1024 * 1024,
    input: opciones.input,
  });
  if (r.status !== 0) throw new Error(`${programa} falló: ${String(r.stderr).replace(/password[^\n]*/gi, '[oculto]').slice(0, 800)}`);
  return r.stdout;
}

// ---------- Cifrado: AES-256-GCM con llave derivada (scrypt) de RESPALDO_CLAVE ----------
const MAGIA = Buffer.from('TZR1');
export function cifrar(datos, clave) {
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(clave, sal, 32), iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([MAGIA, sal, iv, c.getAuthTag(), cuerpo]);
}
export function descifrar(buf, clave) {
  if (!buf.subarray(0, 4).equals(MAGIA)) throw new Error('No es un respaldo de Tablero Zero.');
  const sal = buf.subarray(4, 20);
  const iv = buf.subarray(20, 32);
  const tag = buf.subarray(32, 48);
  const d = createDecipheriv('aes-256-gcm', scryptSync(clave, sal, 32), iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(48)), d.final()]);
  } catch {
    throw new Error('Clave incorrecta o respaldo dañado.');
  }
}

// ---------- Paquete simple de archivos: [largo ruta u32][ruta][largo u32][tipo][tamaño u64][bytes] ----------
export function empaquetar(archivos) {
  const partes = [];
  for (const a of archivos) {
    const ruta = Buffer.from(a.ruta);
    const tipo = Buffer.from(a.tipo ?? '');
    const h = Buffer.alloc(16);
    h.writeUInt32LE(ruta.length, 0);
    h.writeUInt32LE(tipo.length, 4);
    h.writeBigUInt64LE(BigInt(a.datos.length), 8);
    partes.push(h, ruta, tipo, a.datos);
  }
  return Buffer.concat(partes);
}
export function desempaquetar(buf) {
  const out = [];
  for (let i = 0; i < buf.length; ) {
    const lr = buf.readUInt32LE(i);
    const lt = buf.readUInt32LE(i + 4);
    const n = Number(buf.readBigUInt64LE(i + 8));
    i += 16;
    const ruta = buf.subarray(i, i + lr).toString();
    i += lr;
    const tipo = buf.subarray(i, i + lt).toString();
    i += lt;
    out.push({ ruta, tipo, datos: buf.subarray(i, i + n) });
    i += n;
  }
  return out;
}

/** Todos los objetos de un bucket (recorre carpetas). */
export async function listarBucket(srv, bucket, prefijo = '') {
  const res = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await srv.storage.from(bucket).list(prefijo, { limit: 1000, offset: desde });
    if (error) throw new Error(`${bucket}/${prefijo}: ${error.message}`);
    for (const x of data) {
      const ruta = prefijo ? `${prefijo}/${x.name}` : x.name;
      if (x.id === null) res.push(...(await listarBucket(srv, bucket, ruta))); // carpeta
      else res.push({ ruta, tipo: x.metadata?.mimetype ?? '' });
    }
    if (data.length < 1000) return res;
  }
}
