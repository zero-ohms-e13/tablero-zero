// Prueba de integración de FUN-003 (alta de cuentas) contra un proyecto Supabase DE PRUEBAS con Auth real.
// Uso: VERIFICAR_DESTINO=pruebas npx tsx scripts/verificar-altas.ts
//      (lee supabase/.env; requiere el seed de demo; no imprime llaves ni contraseñas; borra lo que crea)
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config({ path: 'supabase/.env' });
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SEED_PASSWORD: PASS, SUPABASE_SERVICE_ROLE_KEY: SRV } = process.env as Record<string, string>;
if (process.env.VERIFICAR_DESTINO !== 'pruebas') {
  console.error('Detenido: confirma que supabase/.env apunta a un proyecto de PRUEBAS con VERIFICAR_DESTINO=pruebas.');
  process.exit(2);
}
const srv = createClient(URL_, SRV, { auth: { persistSession: false } });
type Ficha = { usuario_id: string; usuario: string; password: string; rol: string; tutor_de?: string };
let fallas = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`);
  if (!c) fallas++;
};

async function entrar(usuario: string, password: string) {
  const r = await fetch(`${URL_}/functions/v1/entrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ usuario, password }),
  });
  return { status: r.status, data: (await r.json()) as Record<string, string> };
}

const creados = new Set<string>();
async function main() {
  const c = await entrar('jaime.l', PASS);
  if (c.status !== 200) throw new Error(`el coach demo no pudo entrar: ${c.status}`);
  const admin = async (body: Record<string, unknown>) => {
    const r = await fetch(`${URL_}/functions/v1/admin-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${c.data.access_token}` },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: (await r.json()) as { fichas?: Ficha[]; ya_creadas?: { usuario: string }[]; error?: string } };
  };
  const { data: area } = await srv.from('areas').select('id').eq('nombre', 'Mecánica').single();

  // 1. Alta nueva de alumno con tutor
  const sol = randomUUID();
  const pedido = { accion: 'crear', solicitud_id: sol, nombre: 'Prueba Integración', rol: 'alumno', membresias: [{ area_id: area!.id, es_lider: false }], con_tutor: true };
  const a = await admin(pedido);
  const fichas = a.data.fichas ?? [];
  fichas.forEach((f) => creados.add(f.usuario_id));
  ok(a.status === 200 && fichas.length === 2, `alta nueva: 200 con 2 fichas (${a.status}, ${fichas.length})`);
  const alumno = fichas.find((f) => f.rol === 'alumno')!;
  const tutor = fichas.find((f) => f.rol === 'tutor')!;

  // 2. Estado en Auth y en la base
  const { data: au } = await srv.auth.admin.getUserById(alumno.usuario_id);
  ok(au.user?.app_metadata?.alta === sol, 'la identidad lleva app_metadata.alta = solicitud');
  const banHasta = au.user?.banned_until ? new Date(au.user.banned_until).getTime() : 0;
  ok(banHasta <= Date.now(), 'al completar, la identidad queda activa (sin ban vigente)');
  const { data: m } = await srv.from('membresias').select('area_id').eq('usuario_id', alumno.usuario_id);
  ok(m?.length === 1 && m[0].area_id === area!.id, 'membresía escrita');
  const { data: v } = await srv.from('tutores_alumnos').select('alumno_id').eq('tutor_id', tutor.usuario_id);
  ok(v?.length === 1 && v[0].alumno_id === alumno.usuario_id, 'vínculo tutor→alumno escrito');
  const { data: reg } = await srv.from('altas_cuentas').select('estado, creados').eq('solicitud_id', sol).single();
  ok(reg?.estado === 'completa' && reg.creados.length === 2, 'altas_cuentas: completa con 2 identidades');

  // 3. La cuenta nueva entra con su ficha
  ok((await entrar(alumno.usuario, alumno.password)).status === 200, 'el alumno nuevo entra con la contraseña de su ficha');

  // 4. Reintento idempotente: no crea ni cambia contraseñas
  const b = await admin(pedido);
  ok(b.status === 200 && (b.data.fichas ?? []).length === 0 && (b.data.ya_creadas ?? []).length === 2, 'reintento: 200 sin fichas y con ya_creadas');
  ok((await entrar(alumno.usuario, alumno.password)).status === 200, 'tras el reintento la contraseña original sigue sirviendo');
  const { count } = await srv.from('profiles').select('id', { count: 'exact', head: true }).ilike('usuario', `${alumno.usuario.replace(/\d+$/, '')}%`).eq('rol_global', 'alumno');
  ok(count === 1, `no hay perfiles duplicados (${count})`);

  // 5. Misma solicitud con otros datos
  ok((await admin({ ...pedido, nombre: 'Otra Persona' })).status === 409, 'reusar la solicitud con otros datos da 409');

  // 6. Usuario ya ocupado → se elige otro
  const c2 = await admin({ accion: 'crear', solicitud_id: randomUUID(), nombre: 'Ana López', usuario: 'ana.l', rol: 'alumno', membresias: [] });
  (c2.data.fichas ?? []).forEach((f) => creados.add(f.usuario_id));
  const u2 = c2.data.fichas?.[0]?.usuario;
  ok(c2.status === 200 && !!u2 && u2 !== 'ana.l', `usuario ocupado: se asigna otro (${u2})`);

  // 6b. Identidad huérfana en Auth (sin perfil, de otra solicitud): Auth responde "ya existe" y se elige otro usuario
  const { data: h } = await srv.auth.admin.createUser({ email: 'huerfano.q@zeroohms.local', password: randomUUID(), email_confirm: true });
  if (h.user) creados.add(h.user.id);
  const c3 = await admin({ accion: 'crear', solicitud_id: randomUUID(), nombre: 'Huerfano Q', usuario: 'huerfano.q', rol: 'alumno', membresias: [] });
  (c3.data.fichas ?? []).forEach((f) => creados.add(f.usuario_id));
  const u3 = c3.data.fichas?.[0]?.usuario;
  ok(c3.status === 200 && !!u3 && u3 !== 'huerfano.q', `identidad ajena ya en Auth: se detecta "existe" y se asigna otro (${u3})`);

  // 7. Ban real: una identidad bloqueada no entra
  await srv.auth.admin.updateUserById(alumno.usuario_id, { ban_duration: '876000h' });
  const e = await entrar(alumno.usuario, alumno.password);
  ok(e.status !== 200, `una identidad bloqueada no entra (${e.status})`);

  // 8. Riesgo documentado: ¿un token emitido antes del ban sigue sirviendo?
  await srv.auth.admin.updateUserById(alumno.usuario_id, { ban_duration: 'none' });
  const s = await entrar(alumno.usuario, alumno.password);
  await srv.auth.admin.updateUserById(alumno.usuario_id, { ban_duration: '876000h' });
  const cli = createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.data.access_token}` } } });
  const { data: t, error: te } = await cli.from('profiles').select('id').eq('id', alumno.usuario_id);
  console.log(`INFO  token emitido antes del ban: ${te ? 'rechazado' : (t?.length ? 'SIGUE leyendo datos hasta vencer' : 'sin datos')}`);
  const { error: re } = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.refreshSession({ refresh_token: s.data.refresh_token });
  ok(!!re, 'el refresh token de una identidad bloqueada se rechaza');
}

main()
  .catch((e) => {
    console.error('Error:', e instanceof Error ? e.message : e);
    fallas++;
  })
  .finally(async () => {
    for (const id of creados) await srv.auth.admin.deleteUser(id);
    console.log(`\nLimpieza: ${creados.size} cuentas de prueba borradas.`);
    console.log(fallas ? `${fallas} fallas` : 'Todo OK');
    process.exit(fallas ? 1 : 0);
  });
