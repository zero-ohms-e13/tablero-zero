// Materiales del equipo · prueba de integración con Auth, PostgREST, Storage y Edge Functions REALES en un
// proyecto Supabase DE PRUEBAS (seed de demo y migraciones 11, 15 y 16 aplicadas; funciones archivo-material y
// limpiar-materiales desplegadas).
// Uso: VERIFICAR_DESTINO=pruebas ENV_PRUEBAS=<ruta al .env del proyecto de pruebas> npx tsx scripts/verificar-materiales.ts
//      Con LIMPIEZA_BORRAR=si (el mismo secreto puesto en la función del proyecto de pruebas) también prueba el borrado;
//      sin él, comprueba que la función se niega a borrar (modo simulacro).
// No imprime llaves ni contraseñas. Borra todo lo que crea (filas y archivos).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
// @ts-expect-error módulo .mjs sin tipos
import { destino, pg } from './respaldo-comun.mjs';

config({ path: process.env.ENV_PRUEBAS ?? 'supabase/.env' });
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SEED_PASSWORD: PASS, SUPABASE_SERVICE_ROLE_KEY: SRV } = process.env as Record<string, string>;
const PRODUCCION = 'hyghwlmatnnvnkvmhxrt';
if (process.env.VERIFICAR_DESTINO !== 'pruebas' || !URL_ || URL_.includes(PRODUCCION)) {
  console.error('Detenido: este script solo corre contra un proyecto de PRUEBAS (VERIFICAR_DESTINO=pruebas y una URL que no sea producción).');
  process.exit(2);
}
const srv = createClient(URL_, SRV, { auth: { persistSession: false } });
let fallas = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`);
  if (!c) fallas++;
};

const tokens = new Map<SupabaseClient, string>();
async function como(usuario: string): Promise<SupabaseClient> {
  const r = await fetch(`${URL_}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario, password: PASS }) });
  const d = (await r.json()) as { access_token?: string };
  if (r.status !== 200 || !d.access_token) throw new Error(`${usuario} no pudo entrar (${r.status})`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${d.access_token}` } } });
  tokens.set(c, d.access_token);
  return c;
}
/** Igual que la app: el archivo sale por la Edge Function, que revisa el permiso en cada apertura. */
const abrir = (c: SupabaseClient | null, ruta: string, descargar = false) =>
  fetch(`${URL_}/functions/v1/archivo-material`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${c ? tokens.get(c) : ANON}` },
    body: JSON.stringify({ ruta, descargar }),
  });
const limpieza = (c: SupabaseClient, modo: 'simular' | 'borrar') =>
  fetch(`${URL_}/functions/v1/limpiar-materiales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${tokens.get(c)}` }, body: JSON.stringify({ modo }),
  });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
const creados: string[] = [];

async function publicar(c: SupabaseClient, titulo: string, archivos: { ext: string; tipo: string; cuerpo: Blob; nombre: string; clase: string }[], enlaces: string[] = []) {
  const id = (await c.rpc('crear_material', { p_cliente_id: randomUUID(), p_titulo: titulo, p_categoria: 'programacion' })).data as string;
  creados.push(id);
  const rutas: string[] = [];
  for (const a of archivos) {
    const ruta = `${id}/${randomUUID()}.${a.ext}`;
    const up = await c.storage.from('materiales').upload(ruta, a.cuerpo, { contentType: a.tipo });
    if (up.error) throw new Error(`subida: ${up.error.message}`);
    const r = await c.rpc('agregar_adjunto', { p_material: id, p_tipo: 'archivo', p_nombre: a.nombre, p_ruta: ruta, p_clase: a.clase });
    if (r.error) throw new Error(`registro: ${r.error.message}`);
    rutas.push(ruta);
  }
  for (const u of enlaces) await c.rpc('agregar_adjunto', { p_material: id, p_tipo: 'enlace', p_nombre: '', p_url: u });
  const p = await c.rpc('publicar_material', { p_material: id });
  if (p.error) throw new Error(`publicar: ${p.error.message}`);
  return { id, rutas };
}

// PNG de 1x1 válido (datos ficticios)
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function main() {
  const ana = await como('ana.l');
  const sofia = await como('sofia.r'); // otra área
  const coach = await como('jaime.l');
  const tutor = await como('tutor.luis.m');

  // 1. Ana publica código, foto, PDF y enlaces
  const { id, rutas } = await publicar(ana, 'Rutina autónoma (prueba)', [
    { ext: 'txt', tipo: 'text/plain', cuerpo: new Blob(['void setup() {}\n'], { type: 'text/plain' }), nombre: 'autonomo.ino', clase: 'codigo' },
    { ext: 'png', tipo: 'image/png', cuerpo: new Blob([PNG], { type: 'image/png' }), nombre: 'pista.png', clase: 'imagen' },
    { ext: 'pdf', tipo: 'application/pdf', cuerpo: new Blob([PDF], { type: 'application/pdf' }), nombre: 'reglamento.pdf', clase: 'pdf' },
  ], ['https://github.com/zero-ohms-e13/robot/commit/abc123', 'https://drive.google.com/file/d/ficticio/view', 'https://www.youtube.com/watch?v=ficticio']);
  const adj = (await srv.from('material_adjuntos').select('clase').eq('material_id', id).order('orden')).data?.map((a) => a.clase);
  ok(JSON.stringify(adj) === JSON.stringify(['codigo', 'imagen', 'pdf', 'enlace', 'enlace', 'enlace']), 'publicación con código, foto, PDF y 3 enlaces; clases detectadas por el servidor');

  // 2. Otra área del equipo la ve, abre los archivos por la Edge Function y comenta
  const vista = await sofia.from('materiales').select('id, material_adjuntos(id)').eq('id', id).maybeSingle();
  ok(vista.data?.material_adjuntos.length === 6, 'Sofía (otra área) ve la publicación y sus 6 adjuntos');
  const rc = await abrir(sofia, rutas[0]);
  const texto = await rc.text();
  ok(rc.status === 200 && texto.includes('void setup'), 'Sofía abre el código por la Edge Function');
  ok((rc.headers.get('cache-control') ?? '').includes('no-store'), `la respuesta no se guarda en caché (${rc.headers.get('cache-control')})`);
  ok((rc.headers.get('content-type') ?? '').startsWith('text/plain'), 'el código siempre sale como texto plano');
  const rf = await abrir(sofia, rutas[1]);
  ok(rf.status === 200 && (rf.headers.get('content-type') ?? '').startsWith('image/png') && (await rf.arrayBuffer()).byteLength === PNG.length, 'la foto sale completa y con su tipo');
  const rd = await abrir(sofia, rutas[2], true);
  ok(rd.status === 200 && /attachment; filename\*=UTF-8''reglamento\.pdf/.test(rd.headers.get('content-disposition') ?? ''), 'el PDF se descarga con su nombre');
  ok(!!(await sofia.storage.from('materiales').createSignedUrl(rutas[0], 60)).error, 'Sofía ya no puede firmar enlaces (no hay URL que sobreviva a un retiro)');
  ok(!!(await sofia.storage.from('materiales').download(rutas[0])).error, 'Sofía ya no descarga directo de Storage');
  const com = await sofia.rpc('comentar_material', { p_material: id, p_cliente_id: randomUUID(), p_texto: '¿Con qué sensor?' });
  ok(!com.error, 'Sofía comenta');

  // 3. Tutor y anónimo: nada, ni por ruta directa ni por la función
  const tv = await tutor.from('materiales').select('id').eq('id', id);
  ok((tv.data ?? []).length === 0, 'el tutor no ve la publicación');
  ok((await abrir(tutor, rutas[0])).status === 404, 'el tutor no abre el archivo por la función');
  ok(!!(await tutor.storage.from('materiales').download(rutas[0])).error, 'el tutor no descarga el archivo por ruta directa');
  ok(!!(await tutor.storage.from('materiales').createSignedUrl(rutas[0], 60)).error, 'el tutor no puede firmar un enlace al archivo');
  ok((await abrir(null, rutas[0])).status === 401, 'anónimo no abre el archivo por la función');
  ok(!!(await anon.storage.from('materiales').download(rutas[0])).error, 'anónimo no descarga el archivo');
  const pub = await fetch(`${URL_}/storage/v1/object/public/materiales/${rutas[0]}`);
  ok(pub.status >= 400, `el bucket no es público (HTTP ${pub.status})`);
  ok((await abrir(sofia, `${id}/../../otra/cosa.txt`)).status === 400, 'una ruta rara se rechaza');

  // 4. Compañero no modifica lo ajeno
  ok(!!(await sofia.rpc('retirar_material', { p_material: id })).error, 'Sofía no puede retirar lo de Ana');
  ok(!!(await sofia.storage.from('materiales').upload(`${id}/${randomUUID()}.png`, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' })).error, 'Sofía no sube archivos a la publicación de Ana');

  // 5. Archivos inválidos: tipo no permitido (bucket), demasiado grande (RPC), tipo disfrazado (RPC)
  const b = (await ana.rpc('crear_material', { p_cliente_id: randomUUID(), p_titulo: 'Inválidos', p_categoria: 'otro' })).data as string;
  creados.push(b);
  const exe = await ana.storage.from('materiales').upload(`${b}/${randomUUID()}.txt`, new Blob(['MZ'], { type: 'application/x-msdownload' }), { contentType: 'application/x-msdownload' });
  ok(!!exe.error, 'Storage rechaza un tipo no permitido');
  const grande = `${b}/${randomUUID()}.png`;
  await ana.storage.from('materiales').upload(grande, new Blob([new Uint8Array(1_200_000)], { type: 'image/png' }), { contentType: 'image/png' });
  const rg = await ana.rpc('agregar_adjunto', { p_material: b, p_tipo: 'archivo', p_nombre: 'g.png', p_ruta: grande });
  ok(/grande/.test(rg.error?.message ?? ''), 'una foto de más de 1 MB se rechaza al registrarla');
  const disfraz = `${b}/${randomUUID()}.pdf`;
  await ana.storage.from('materiales').upload(disfraz, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  const rdz = await ana.rpc('agregar_adjunto', { p_material: b, p_tipo: 'archivo', p_nombre: 'x.pdf', p_ruta: disfraz });
  ok(/no permitido/.test(rdz.error?.message ?? ''), 'un .pdf que en realidad es imagen se rechaza');
  ok((await abrir(sofia, grande)).status === 404, 'los archivos de un borrador no son accesibles para otros');
  ok((await abrir(ana, grande)).status === 200, 'la autora sí abre los archivos de su borrador');
  ok(((await ana.storage.from('materiales').list(b)).data ?? []).length === 0, 'ni la autora lista su borrador en Storage');
  ok(!!(await ana.storage.from('materiales').createSignedUrl(grande, 60)).error, 'ni la autora puede firmar un enlace de su borrador (no sobreviviría a un retiro)');
  ok(!!(await ana.storage.from('materiales').download(grande)).error, 'ni la autora descarga directo su borrador');

  // 5b. Archivo subido pero nunca registrado: no se vuelve visible al publicar con otro adjunto
  const h = (await ana.rpc('crear_material', { p_cliente_id: randomUUID(), p_titulo: 'Con huérfano', p_categoria: 'otro' })).data as string;
  creados.push(h);
  const bueno = `${h}/${randomUUID()}.png`;
  const huerfano = `${h}/${randomUUID()}.png`;
  await ana.storage.from('materiales').upload(bueno, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  await ana.storage.from('materiales').upload(huerfano, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  await ana.rpc('agregar_adjunto', { p_material: h, p_tipo: 'archivo', p_nombre: 'bueno.png', p_ruta: bueno });
  await ana.rpc('publicar_material', { p_material: h });
  const lista = (await sofia.storage.from('materiales').list(h)).data ?? [];
  ok(lista.length === 0, 'otros ya no listan la carpeta en Storage');
  ok((await abrir(sofia, huerfano)).status === 404 && (await abrir(sofia, bueno)).status === 200, 'el archivo sin registrar no se abre; el registrado sí');

  // 6. Reintento sin duplicados
  const cli = randomUUID();
  const r1 = (await ana.rpc('crear_material', { p_cliente_id: cli, p_titulo: 'Reintento', p_categoria: 'otro' })).data as string;
  const r2 = (await ana.rpc('crear_material', { p_cliente_id: cli, p_titulo: 'Reintento', p_categoria: 'otro' })).data as string;
  creados.push(r1);
  const ruta = `${r1}/${randomUUID()}.png`;
  await ana.storage.from('materiales').upload(ruta, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  const otra = await ana.storage.from('materiales').upload(ruta, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  const a1 = (await ana.rpc('agregar_adjunto', { p_material: r1, p_tipo: 'archivo', p_nombre: 'p.png', p_ruta: ruta })).data;
  const a2 = (await ana.rpc('agregar_adjunto', { p_material: r1, p_tipo: 'archivo', p_nombre: 'p.png', p_ruta: ruta })).data;
  ok(r1 === r2 && a1 === a2 && !!otra.error, 'el reintento reusa el borrador, la ruta y el adjunto (sin duplicados)');

  // 7. Retiro: corte INMEDIATO. Sofía tenía la página abierta y la foto ya cargada: la siguiente apertura se niega.
  ok((await abrir(sofia, rutas[1])).status === 200, 'antes del retiro, Sofía abre la foto');
  const m = await coach.rpc('retirar_material', { p_material: id });
  const tras = await sofia.from('materiales').select('id').eq('id', id);
  ok(!m.error && (tras.data ?? []).length === 0, 'el coach retira; el equipo deja de ver la publicación');
  const t0 = Date.now();
  const cortes = await Promise.all(rutas.map((r) => abrir(sofia, r)));
  ok(cortes.every((r) => r.status === 404), `justo después del retiro ninguna apertura sirve (${Date.now() - t0} ms, sin esperar a que venza nada)`);
  ok((await abrir(coach, rutas[1])).status === 200 && (await abrir(ana, rutas[1])).status === 200, 'el coach y la autora sí la siguen abriendo');

  // 8. Limpieza: solo el coach principal; un borrador abandonado (envejecido 40 días) se simula y se borra
  ok((await limpieza(sofia, 'simular')).status === 403, 'un alumno no puede correr la limpieza');
  const cliViejo = randomUUID();
  const viejo = (await ana.rpc('crear_material', { p_cliente_id: cliViejo, p_titulo: 'Abandonado (prueba)', p_categoria: 'otro' })).data as string;
  creados.push(viejo);
  const fv = `${viejo}/${randomUUID()}.png`;
  await ana.storage.from('materiales').upload(fv, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  const d = destino('pruebas', resolve(process.cwd(), '..'));
  pg(d, 'psql', ['-q', '-c', `update public.materiales set creado_at = now() - interval '40 days' where id = '${viejo}';
    update storage.objects set created_at = now() - interval '40 days' where bucket_id = 'materiales' and name like '${viejo}/%';`]);
  const sim = await (await limpieza(coach, 'simular')).json();
  if (process.env.LIMPIEZA_BORRAR !== 'si') {
    ok(sim.modo === 'simular' && sim.borradores >= 1, `el simulacro encuentra el borrador abandonado (${sim.borradores} borradores, ${sim.archivos} archivos)`);
    const r = await limpieza(coach, 'borrar');
    ok(r.status === 409 && /simulacro/.test((await r.json()).error ?? ''), 'sin habilitarlo, la función se niega a borrar (modo simulacro)');
    ok(!!(await srv.from('materiales').select('id').eq('id', viejo).maybeSingle()).data, 'y el borrador sigue ahí');
    return;
  }
  ok(sim.modo === 'simular' && sim.borradores >= 1 && sim.archivos >= 1, `el simulacro encuentra el borrador abandonado (${sim.borradores} borradores, ${sim.archivos} archivos) y no borra nada`);
  ok(!!(await srv.from('materiales').select('id').eq('id', viejo).maybeSingle()).data, 'tras simular, el borrador sigue ahí');
  const hecho = await (await limpieza(coach, 'borrar')).json();
  ok(hecho.hecho?.borradores >= 1 && !(await srv.from('materiales').select('id').eq('id', viejo).maybeSingle()).data, 'al confirmar, se borra el borrador abandonado');
  ok(((await srv.storage.from('materiales').list(viejo)).data ?? []).length === 0, 'y su archivo también');
  ok(!!(await srv.from('materiales').select('id').eq('id', b).maybeSingle()).data, 'un borrador reciente no se toca');
  // La alumna seguía con el formulario abierto sobre el borrador que se limpió
  const tarde = await ana.storage.from('materiales').upload(`${viejo}/${randomUUID()}.png`, new Blob([PNG], { type: 'image/png' }), { contentType: 'image/png' });
  ok(!!tarde.error, 'una subida que llega después de limpiar el borrador se rechaza (no queda "guardada")');
  const nuevo = (await ana.rpc('crear_material', { p_cliente_id: cliViejo, p_titulo: 'Abandonado (prueba)', p_categoria: 'otro' })).data as string;
  if (nuevo) creados.push(nuevo);
  ok(!!nuevo && nuevo !== viejo, 'al reintentar, la app obtiene un borrador nuevo y vuelve a publicar ahí');
}

async function limpiar() {
  for (const id of creados) {
    const { data } = await srv.storage.from('materiales').list(id);
    if (data?.length) await srv.storage.from('materiales').remove(data.map((f) => `${id}/${f.name}`));
    await srv.from('materiales').delete().eq('id', id);
  }
  const quedan = (await srv.from('materiales').select('id', { count: 'exact', head: true }).in('id', creados.length ? creados : [randomUUID()])).count;
  console.log(`Limpieza: ${creados.length} publicaciones de prueba borradas; quedan ${quedan ?? '?'}.`);
}

main()
  .catch((e) => {
    fallas++;
    console.error('ERROR', (e as Error).message);
  })
  .finally(async () => {
    await limpiar();
    console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo en verde');
    process.exit(fallas ? 1 : 0);
  });
