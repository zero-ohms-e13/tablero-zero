// Configura los avisos push UNA vez: genera llaves VAPID y un secreto, los guarda como
// secretos de la Edge Function y registra la URL de la función en config_privada.
// Uso: node scripts/configurar-push.mjs   (lee supabase/.env; no imprime secretos)
import webpush from 'web-push';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: 'supabase/.env' });
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const secreto = randomBytes(32).toString('hex');

const dir = mkdtempSync(join(tmpdir(), 'tz-push-'));
const archivo = join(dir, 'push.env');
try {
  writeFileSync(archivo, `VAPID_PUBLICA=${publicKey}\nVAPID_PRIVADA=${privateKey}\nPUSH_SECRETO=${secreto}\n`);
  execFileSync('npx', ['-y', 'supabase@2.26.9', 'secrets', 'set', '--env-file', archivo, '--project-ref', ref], { stdio: 'ignore', shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const srv = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await srv.from('config_privada').upsert([
  { clave: 'push_url', valor: `${SUPABASE_URL}/functions/v1/push` },
  { clave: 'push_secreto', valor: secreto },
]);
if (error) {
  console.error('No se pudo guardar config_privada:', error.message);
  process.exit(1);
}
console.log('Push configurado. Llave pública VAPID:', publicKey.slice(0, 12) + '…');
