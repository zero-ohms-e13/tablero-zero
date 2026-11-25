// Muestra qué hay en la base (sin contraseñas ni llaves). Uso: npx tsx scripts/inventario.ts
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: 'supabase/.env' });
const srv = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: perfiles } = await srv.from('profiles').select('usuario, nombre_visible, rol_global, activo').order('rol_global');
console.log('Cuentas:');
for (const p of perfiles ?? []) console.log(`  ${p.usuario.padEnd(18)} ${p.rol_global.padEnd(10)} ${p.nombre_visible}${p.activo ? '' : ' (desactivada)'}`);
for (const t of ['tareas', 'metas', 'competencias', 'evidencias', 'comentarios', 'avisos', 'solicitudes_reinicio', 'suscripciones_push']) {
  const { count } = await srv.from(t).select('*', { count: 'exact', head: true });
  console.log(`${t}: ${count}`);
}
const { data: comp } = await srv.from('competencias').select('nombre, fecha_inicio');
console.log('Competencias:', comp?.map((c) => `${c.nombre} (${c.fecha_inicio})`).join(', '));
const { data: fotos } = await srv.storage.from('evidencias').list('', { limit: 1000 });
console.log('Carpetas de fotos en Storage:', fotos?.length ?? 0);
