// Materiales del equipo · prueba de integración con Auth, PostgREST y Storage REALES en un proyecto
// Supabase DE PRUEBAS (con el seed de demo y la migración 20261127000011 aplicada).
// Uso: VERIFICAR_DESTINO=pruebas ENV_PRUEBAS=<ruta al .env del proyecto de pruebas> npx tsx scripts/verificar-materiales.ts
// No imprime llaves ni contraseñas. Borra todo lo que crea (filas y archivos).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

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

async function como(usuario: string): Promise<SupabaseClient> {
  const r = await fetch(`${URL_}/functions/v1/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ usuario, password: PASS }) });
  const d = (await r.json()) as { access_token?: string };
  if (r.status !== 200 || !d.access_token) throw new Error(`${usuario} no pudo entrar (${r.status})`);
  return createClient(URL_, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${d.access_token}` } } });
}
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

  // 2. Otra área del equipo la ve, descarga y comenta
  const vista = await sofia.from('materiales').select('id, material_adjuntos(id)').eq('id', id).maybeSingle();
  ok(vista.data?.material_adjuntos.length === 6, 'Sofía (otra área) ve la publicación y sus 6 adjuntos');
  const firma = await sofia.storage.from('materiales').createSignedUrl(rutas[0], 60);
  const texto = firma.data ? await (await fetch(firma.data.signedUrl)).text() : '';
  ok(texto.includes('void setup'), 'Sofía descarga el código con un enlace firmado');
  const com = await sofia.rpc('comentar_material', { p_material: id, p_cliente_id: randomUUID(), p_texto: '¿Con qué sensor?' });
  ok(!com.error, 'Sofía comenta');

  // 3. Tutor y anónimo: nada, ni por ruta directa
  const tv = await tutor.from('materiales').select('id').eq('id', id);
  ok((tv.data ?? []).length === 0, 'el tutor no ve la publicación');
  const tf = await tutor.storage.from('materiales').download(rutas[0]);
  ok(!!tf.error, 'el tutor no descarga el archivo por ruta directa');
  const ts = await tutor.storage.from('materiales').createSignedUrl(rutas[0], 60);
  ok(!!ts.error, 'el tutor no puede firmar un enlace al archivo');
  const af = await anon.storage.from('materiales').download(rutas[0]);
  ok(!!af.error, 'anónimo no descarga el archivo');
  const pub = await fetch(`${URL_}/storage/v1/object/public/materiales/${rutas[0]}`);
  ok(pub.status >= 400, `el bucket no es público (HTTP ${pub.status})`);

  // 4. Compañero no modifica lo ajeno; coach modera
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
  const rd = await ana.rpc('agregar_adjunto', { p_material: b, p_tipo: 'archivo', p_nombre: 'x.pdf', p_ruta: disfraz });
  ok(/no permitido/.test(rd.error?.message ?? ''), 'un .pdf que en realidad es imagen se rechaza');
  const huerf = (await sofia.storage.from('materiales').createSignedUrl(grande, 60)).error;
  ok(!!huerf, 'los archivos de un borrador no son accesibles para otros');

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

  // 7. Moderación del coach
  const m = await coach.rpc('retirar_material', { p_material: id });
  const tras = await sofia.from('materiales').select('id').eq('id', id);
  const archivoTras = await sofia.storage.from('materiales').createSignedUrl(rutas[0], 60);
  ok(!m.error && (tras.data ?? []).length === 0 && !!archivoTras.error, 'el coach retira; el equipo deja de ver la publicación y sus archivos');
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
