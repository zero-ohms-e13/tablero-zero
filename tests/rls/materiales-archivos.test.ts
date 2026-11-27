// Materiales · corte inmediato al retirar y limpieza de borradores (migración 15). PGlite, datos ficticios.
// Los archivos ya no se leen ni se firman desde el navegador: la Edge Function pregunta a archivo_material()
// en cada apertura. La limpieza solo la corre el servidor (service_role).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
const uid = (pref: string, n: number) => `00000000-0000-0000-0000-${pref}${String(n).padStart(12 - pref.length, '0')}`;
const uno = async <R,>(quien: string | null, sql: string) => (await b.como<{ r: R }>(quien, `select ${sql} as r`))[0].r;
const srv = async <R,>(sql: string) => b.comoServicio<R>(sql);
const crear = (quien: string, cliente: string, titulo: string) => uno<string>(quien, `public.crear_material('${cliente}', '${titulo}', 'programacion', null)`);
const subir = (quien: string, ruta: string) =>
  b.falla(quien, `insert into storage.objects (bucket_id, name, owner, metadata) values ('materiales', '${ruta}', '${quien}', '{"size": 1000, "mimetype": "image/jpeg"}')`);
const adjuntar = (quien: string, m: string, ruta: string) => uno<string>(quien, `public.agregar_adjunto('${m}', 'archivo', 'foto.jpg', '${ruta}')`);
const puede = async (quien: string, ruta: string) => (await srv(`select * from public.archivo_material('${quien}', '${ruta}')`)).length === 1;
const envejecer = async (m: string, dias: number) => {
  await b.db.query(`update materiales set creado_at = now() - interval '${dias} days', editado_at = null where id = '${m}'`);
  await b.db.query(`update material_adjuntos set creado_at = now() - interval '${dias} days' where material_id = '${m}'`);
  await b.db.query(`update storage.objects set created_at = now() - interval '${dias} days' where name like '${m}/%'`);
};

let PUB = '';
let FOTO = '';
beforeAll(async () => {
  b = await crearBase();
  PUB = await crear(U.ana, uid('d1', 1), 'Cableado');
  FOTO = `${PUB}/${uid('e1', 1)}.jpg`;
  expect(await subir(U.ana, FOTO)).toBeNull();
  await adjuntar(U.ana, PUB, FOTO);
  await uno(U.ana, `public.publicar_material('${PUB}')`);
}, 60_000);

describe('Materiales · archivos sin URL firmadas', () => {
  it('publicada: la abren alumnos, coach y mentor; un tutor no; nadie lee ni firma el objeto directo', async () => {
    for (const quien of [U.ana, U.marco, U.sofia, U.coach, U.aux]) expect(await puede(quien, FOTO), quien).toBe(true);
    expect(await puede(U.tutorAna, FOTO)).toBe(false);
    for (const quien of [U.ana, U.marco, U.coach]) {
      expect(await b.como(quien, `select 1 from storage.objects where name = '${FOTO}'`), quien).toHaveLength(0);
    }
  });

  it('al retirarla se corta en la siguiente apertura; el coach, el mentor y la autora la siguen abriendo', async () => {
    await uno(U.coach, `public.retirar_material('${PUB}')`);
    for (const quien of [U.marco, U.sofia]) expect(await puede(quien, FOTO), quien).toBe(false);
    for (const quien of [U.coach, U.aux, U.ana]) expect(await puede(quien, FOTO), quien).toBe(true);
  });

  it('una cuenta desactivada no abre nada, ni lo suyo', async () => {
    const m = await crear(U.marco, uid('d1', 2), 'Sensor');
    const r = `${m}/${uid('e1', 2)}.jpg`;
    expect(await subir(U.marco, r)).toBeNull();
    await adjuntar(U.marco, m, r);
    await uno(U.marco, `public.publicar_material('${m}')`);
    expect(await puede(U.marco, r)).toBe(true);
    await b.db.query(`update profiles set activo = false where id = '${U.marco}'`);
    expect(await puede(U.marco, r)).toBe(false);
    await b.db.query(`update profiles set activo = true where id = '${U.marco}'`);
  });

  it('el borrador: solo su autor lo lee en Storage (para poder quitar archivos mientras edita)', async () => {
    const m = await crear(U.sofia, uid('d1', 3), 'Borrador de Sofía');
    const r = `${m}/${uid('e1', 3)}.jpg`;
    expect(await subir(U.sofia, r)).toBeNull();
    expect(await b.como(U.sofia, `select 1 from storage.objects where name = '${r}'`)).toHaveLength(1);
    for (const quien of [U.ana, U.coach]) expect(await b.como(quien, `select 1 from storage.objects where name = '${r}'`), quien).toHaveLength(0);
    expect(await puede(U.ana, r)).toBe(false);
    expect(await puede(U.sofia, r)).toBe(true);
  });

  it('archivo_material y la limpieza no se pueden llamar desde el navegador', async () => {
    for (const sql of [`public.archivo_material('${U.ana}', '${FOTO}')`, 'public.materiales_por_limpiar(30)', `public.borrar_borrador_vencido('${PUB}', 30)`, `public.sigue_huerfano('${FOTO}')`]) {
      expect(await b.falla(U.coach, `select * from ${sql}`), sql).toMatch(/permission denied/);
      expect(await b.falla(null, `select * from ${sql}`), sql).toMatch(/permission denied/);
    }
  });
});

describe('Materiales · limpieza de borradores (30 días)', () => {
  it('encuentra el borrador abandonado y el archivo suelto; deja el borrador reciente y lo publicado', async () => {
    const viejo = await crear(U.luis, uid('d2', 1), 'Abandonado');
    const reciente = await crear(U.luis, uid('d2', 2), 'En proceso');
    const pub = await crear(U.luis, uid('d2', 3), 'Publicado');
    const fv = `${viejo}/${uid('e2', 1)}.jpg`;
    const fr = `${reciente}/${uid('e2', 2)}.jpg`;
    const fp = `${pub}/${uid('e2', 3)}.jpg`;
    const suelto = `${pub}/${uid('e2', 4)}.jpg`; // subido a la publicación pero nunca registrado
    for (const r of [fv, fr, fp, suelto]) expect(await subir(U.luis, r)).toBeNull();
    await adjuntar(U.luis, pub, fp);
    await uno(U.luis, `public.publicar_material('${pub}')`);
    await envejecer(viejo, 40);
    await envejecer(pub, 40);
    await envejecer(reciente, 10);

    const filas = await srv<{ tipo: string; material_id: string; rutas: string[]; bytes: number }>(`select * from public.materiales_por_limpiar(30)`);
    const mios = filas.filter((f) => [viejo, reciente, pub].includes(f.material_id));
    expect(mios.map((f) => `${f.tipo}:${f.material_id === viejo ? 'viejo' : f.material_id === pub ? 'pub' : 'reciente'}`).sort()).toEqual(['borrador:viejo', 'huerfano:pub']);
    expect(mios.find((f) => f.tipo === 'borrador')!.rutas).toEqual([fv]);
    expect(mios.find((f) => f.tipo === 'huerfano')!.rutas).toEqual([suelto]);
    expect(Number(mios.find((f) => f.tipo === 'borrador')!.bytes)).toBe(1000);
    // Con 60 días no sale nada de esto
    expect((await srv<{ material_id: string }>(`select * from public.materiales_por_limpiar(60)`)).filter((f) => [viejo, pub].includes(f.material_id))).toHaveLength(0);

    // Borrar revalida en el momento
    expect((await srv<{ r: boolean }>(`select public.borrar_borrador_vencido('${reciente}', 30) as r`))[0].r).toBe(false);
    expect((await srv<{ r: boolean }>(`select public.borrar_borrador_vencido('${pub}', 30) as r`))[0].r).toBe(false);
    expect((await srv<{ r: boolean }>(`select public.sigue_huerfano('${fp}') as r`))[0].r).toBe(false);
    expect((await srv<{ r: boolean }>(`select public.sigue_huerfano('${suelto}') as r`))[0].r).toBe(true);
    expect((await srv<{ r: boolean }>(`select public.borrar_borrador_vencido('${viejo}', 30) as r`))[0].r).toBe(true);
    expect(await b.db.query(`select 1 from materiales where id = '${viejo}'`).then((x) => x.rows)).toHaveLength(0);
    expect(await b.db.query(`select 1 from materiales where id in ('${reciente}', '${pub}')`).then((x) => x.rows)).toHaveLength(2);
    // Su archivo queda como huérfano hasta que la función lo quite (y la siguiente revisión lo encuentra)
    const despues = await srv<{ tipo: string; rutas: string[] }>(`select * from public.materiales_por_limpiar(30)`);
    expect(despues.some((f) => f.tipo === 'huerfano' && f.rutas[0] === fv)).toBe(true);
  });

  it('si el borrador vuelve a tener actividad justo antes de borrar, no se borra', async () => {
    const m = await crear(U.luis, uid('d2', 5), 'Casi abandonado');
    await envejecer(m, 45);
    expect((await srv<{ material_id: string }>(`select * from public.materiales_por_limpiar(30)`)).some((f) => f.material_id === m)).toBe(true);
    expect(await subir(U.luis, `${m}/${uid('e2', 5)}.jpg`)).toBeNull(); // el autor subió una foto nueva
    expect((await srv<{ r: boolean }>(`select public.borrar_borrador_vencido('${m}', 30) as r`))[0].r).toBe(false);
  });
});
