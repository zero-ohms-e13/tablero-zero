// Materiales del equipo · permisos, archivos e idempotencia (PGlite, datos ficticios).
// Storage se simula con storage.objects y las políticas reales de la migración; la prueba con
// Storage de Supabase real va aparte (scripts/verificar-materiales.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, T, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;

const uid = (pref: string, n: number) => `00000000-0000-0000-0000-${pref}${String(n).padStart(12 - pref.length, '0')}`;
const q = async <R,>(sql: string) => (await b.db.query<R>(sql)).rows;
const uno = async <R,>(quien: string | null, sql: string) => (await b.como<{ r: R }>(quien, `select ${sql} as r`))[0].r;
const ver = (quien: string | null) => b.como<{ id: string; titulo: string }>(quien, `select id, titulo from materiales order by creado_at`);

const crear = (quien: string, cliente: string, titulo = 'Rutina autónoma', extra = '') =>
  uno<string>(quien, `public.crear_material('${cliente}', '${titulo}', 'programacion', 'Probar en la cancha'${extra})`);
// Simula la subida a Storage como ese usuario (pasa por la política de insert del bucket)
const subir = (quien: string, ruta: string, mime: string, tamano: number) =>
  b.falla(quien, `insert into storage.objects (bucket_id, name, owner, metadata) values ('materiales', '${ruta}', '${quien}', '{"size": ${tamano}, "mimetype": "${mime}"}')`);
const adjuntar = (quien: string, m: string, ruta: string, nombre: string) =>
  uno<string>(quien, `public.agregar_adjunto('${m}', 'archivo', '${nombre}', '${ruta}')`);
const enlace = (quien: string, m: string, url: string) => uno<string>(quien, `public.agregar_adjunto('${m}', 'enlace', '', null, '${url}')`);

let PUB = ''; // publicación completa de Ana
const R = { codigo: '', foto: '', pdf: '' };

beforeAll(async () => {
  b = await crearBase();
  // Ana publica código, foto, PDF y enlaces a GitHub, Drive y video
  PUB = await crear(U.ana, uid('c1', 1));
  R.codigo = `${PUB}/${uid('f1', 1)}.txt`;
  R.foto = `${PUB}/${uid('f1', 2)}.jpg`;
  R.pdf = `${PUB}/${uid('f1', 3)}.pdf`;
  expect(await subir(U.ana, R.codigo, 'text/plain', 2048)).toBeNull();
  expect(await subir(U.ana, R.foto, 'image/jpeg', 280_000)).toBeNull();
  expect(await subir(U.ana, R.pdf, 'application/pdf', 3_000_000)).toBeNull();
  await adjuntar(U.ana, PUB, R.codigo, 'autonomo.ino');
  await adjuntar(U.ana, PUB, R.foto, 'cableado.jpg');
  await adjuntar(U.ana, PUB, R.pdf, 'reglamento.pdf');
  await enlace(U.ana, PUB, 'https://github.com/zero-ohms-e13/robot/commit/abc123');
  await enlace(U.ana, PUB, 'https://drive.google.com/file/d/ficticio/view');
  await enlace(U.ana, PUB, 'https://www.youtube.com/watch?v=ficticio');
  await uno(U.ana, `public.publicar_material('${PUB}')`);
}, 60_000);

describe('Materiales · publicar y encontrar', () => {
  it('la publicación completa queda en el feed con sus 6 adjuntos y clases detectadas en el servidor', async () => {
    const adj = await q<{ clase: string; nombre: string }>(`select clase, nombre from material_adjuntos where material_id = '${PUB}' order by orden`);
    expect(adj.map((a) => a.clase)).toEqual(['codigo', 'imagen', 'pdf', 'enlace', 'enlace', 'enlace']);
    expect(adj[0].nombre).toBe('autonomo.ino');
  });

  it('todo el equipo la ve (otra área incluida), el coach y el mentor también', async () => {
    for (const quien of [U.marco, U.luis, U.sofia, U.coach, U.aux]) {
      expect((await ver(quien)).map((m) => m.id), quien).toContain(PUB);
      expect(await b.como(quien, `select 1 from material_adjuntos where material_id = '${PUB}'`), quien).toHaveLength(6);
    }
  });

  it('la autoría se ve en todo el equipo sin abrir perfiles ajenos (solo nombre, iniciales y color)', async () => {
    // Sofía (Logística) no ve el perfil de Ana (Programación) en profiles…
    expect(await b.como(U.sofia, `select 1 from profiles where id = '${U.ana}'`)).toHaveLength(0);
    // …pero sí su nombre como autora de lo que publicó
    const autores = await b.como<{ id: string; nombre_visible: string }>(U.sofia, `select * from public.autores_materiales()`);
    expect(autores.find((a) => a.id === U.ana)?.nombre_visible).toBe('Ana López');
    expect(Object.keys(autores[0]).sort()).toEqual(['color', 'id', 'iniciales', 'nombre_visible']);
    // Quien no publicó ni comentó no aparece; el tutor no recibe nada
    expect(autores.map((a) => a.id)).not.toContain(U.karla);
    expect(await b.como(U.tutorAna, `select * from public.autores_materiales()`)).toHaveLength(0);
  });

  it('un compañero filtra por categoría y comenta; el reintento con el mismo cliente_id no duplica', async () => {
    const prog = await b.como(U.luis, `select id from materiales where categoria = 'programacion'`);
    expect(prog.map((x) => x.id)).toContain(PUB);
    const c1 = await uno<string>(U.luis, `public.comentar_material('${PUB}', '${uid('c2', 1)}', '¿Con qué sensor lo probaste?')`);
    const c2 = await uno<string>(U.luis, `public.comentar_material('${PUB}', '${uid('c2', 1)}', '¿Con qué sensor lo probaste?')`);
    expect(c2).toBe(c1);
    expect(await b.como(U.ana, `select texto from material_comentarios where material_id = '${PUB}'`)).toEqual([{ texto: '¿Con qué sensor lo probaste?' }]);
  });
});

describe('Materiales · quién queda fuera', () => {
  it('tutor y anónimo no leen publicaciones, adjuntos, comentarios ni archivos', async () => {
    for (const quien of [U.tutorAna, U.tutorLuis]) {
      expect(await ver(quien)).toHaveLength(0);
      expect(await b.como(quien, `select 1 from material_adjuntos`)).toHaveLength(0);
      expect(await b.como(quien, `select 1 from material_comentarios`)).toHaveLength(0);
      expect(await b.como(quien, `select 1 from storage.objects where bucket_id = 'materiales'`)).toHaveLength(0);
    }
    expect(await b.falla(null, `select 1 from materiales`)).toMatch(/permission denied/);
    // Anónimo: o no tiene acceso a la tabla (simulador) o la RLS no le devuelve nada (Supabase); nunca filas
    const anon = await b.falla(null, `select 1 / (select count(*) from storage.objects where bucket_id = 'materiales')::int`);
    expect(anon).toMatch(/permission denied|division by zero/);
  });

  it('tutor y anónimo no pueden publicar ni comentar', async () => {
    expect(await b.falla(U.tutorAna, `select public.crear_material('${uid('c3', 1)}', 'x', 'otro')`)).toMatch(/permiso/);
    expect(await b.falla(U.tutorAna, `select public.comentar_material('${PUB}', '${uid('c3', 2)}', 'hola')`)).toMatch(/permiso/);
    expect(await b.falla(null, `select public.crear_material('${uid('c3', 3)}', 'x', 'otro')`)).toMatch(/permission denied/);
  });

  it('una cuenta desactivada pierde el acceso al momento', async () => {
    await b.db.exec(`update profiles set activo = false where id = '${U.karla}'`);
    expect(await ver(U.karla)).toHaveLength(0);
    expect(await b.como(U.karla, `select 1 from storage.objects where bucket_id = 'materiales'`)).toHaveLength(0);
    expect(await b.falla(U.karla, `select public.crear_material('${uid('c3', 4)}', 'x', 'otro')`)).toMatch(/permiso/);
    await b.db.exec(`update profiles set activo = true where id = '${U.karla}'`);
  });

  it('nadie escribe directo en las tablas: todo pasa por las RPC', async () => {
    expect(await b.falla(U.ana, `insert into materiales (autor_id, cliente_id, titulo, categoria, estado) values ('${U.ana}', '${uid('c3', 5)}', 'x', 'otro', 'publicada')`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `update materiales set titulo = 'cambiado' where id = '${PUB}'`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `delete from material_comentarios`)).toMatch(/permission denied/);
  });
});

describe('Materiales · borradores y archivos', () => {
  it('un borrador solo lo ve su autor, igual que sus archivos (incluso por ruta directa)', async () => {
    const m = await crear(U.diego, uid('c4', 1), 'Diagrama a medias');
    const ruta = `${m}/${uid('f4', 1)}.jpg`;
    expect(await subir(U.diego, ruta, 'image/jpeg', 100_000)).toBeNull();
    expect((await ver(U.diego)).map((x) => x.id)).toContain(m);
    for (const quien of [U.ana, U.marco, U.coach]) {
      expect((await ver(quien)).map((x) => x.id), quien).not.toContain(m);
      expect(await b.como(quien, `select 1 from storage.objects where name = '${ruta}'`), quien).toHaveLength(0);
    }
    expect(await b.como(U.diego, `select 1 from storage.objects where name = '${ruta}'`)).toHaveLength(1);
  });

  it('nadie sube archivos a la publicación de otro ni a una ya publicada', async () => {
    expect(await subir(U.marco, `${PUB}/${uid('f5', 1)}.jpg`, 'image/jpeg', 1000)).toMatch(/row-level security/);
    expect(await subir(U.ana, `${PUB}/${uid('f5', 2)}.jpg`, 'image/jpeg', 1000)).toMatch(/row-level security/);
    expect(await subir(U.ana, `no-es-uuid/${uid('f5', 3)}.jpg`, 'image/jpeg', 1000)).toMatch(/row-level security/);
  });

  it('rechaza archivo demasiado grande, de otro tipo, que no se subió o de otra publicación', async () => {
    const m = await crear(U.marco, uid('c5', 1));
    const grande = `${m}/${uid('f6', 1)}.jpg`;
    const disfrazado = `${m}/${uid('f6', 2)}.pdf`;
    await subir(U.marco, grande, 'image/jpeg', 2_000_000);
    await subir(U.marco, disfrazado, 'image/jpeg', 1000); // extensión .pdf con contenido de imagen
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'archivo', 'foto.jpg', '${grande}')`)).toMatch(/demasiado grande/);
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'archivo', 'doc.pdf', '${disfrazado}')`)).toMatch(/no permitido/);
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'archivo', 'x.jpg', '${m}/${uid('f6', 3)}.jpg')`)).toMatch(/no terminó de subirse/);
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'archivo', 'x.jpg', '${R.foto}')`)).toMatch(/no válido/);
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'enlace', '', null, 'http://inseguro.com/x')`)).toMatch(/https/);
    expect(await b.falla(U.marco, `select public.agregar_adjunto('${m}', 'enlace', '', null, 'javascript:alert(1)')`)).toMatch(/https/);
    expect(await b.falla(U.marco, `select public.publicar_material('${m}')`)).toMatch(/al menos un archivo/);
  });

  it('una carga fallida no deja nada visible y el reintento completa sin duplicar', async () => {
    const cliente = uid('c6', 1);
    const m1 = await crear(U.sofia, cliente, 'Fotos del stand');
    const ruta = `${m1}/${uid('f7', 1)}.jpg`;
    // 1.er intento: el archivo nunca llegó a Storage → el registro falla y nada aparece en el feed
    expect(await b.falla(U.sofia, `select public.agregar_adjunto('${m1}', 'archivo', 'stand.jpg', '${ruta}')`)).toMatch(/no terminó/);
    expect((await ver(U.marco)).map((x) => x.id)).not.toContain(m1);
    // Reintento: mismo cliente_id → mismo borrador; la subida y el registro repetidos no duplican
    expect(await crear(U.sofia, cliente, 'Fotos del stand')).toBe(m1);
    await subir(U.sofia, ruta, 'image/jpeg', 200_000);
    const a1 = await adjuntar(U.sofia, m1, ruta, 'stand.jpg');
    expect(await adjuntar(U.sofia, m1, ruta, 'stand.jpg')).toBe(a1);
    await uno(U.sofia, `public.publicar_material('${m1}')`);
    await uno(U.sofia, `public.publicar_material('${m1}')`); // respuesta perdida: publicar otra vez no truena
    expect((await q<{ n: number }>(`select count(*)::int as n from material_adjuntos where material_id = '${m1}'`))[0].n).toBe(1);
    expect((await q<{ n: number }>(`select count(*)::int as n from materiales where autor_id = '${U.sofia}'`))[0].n).toBe(1);
    expect((await ver(U.marco)).map((x) => x.id)).toContain(m1);
  });
});

describe('Materiales · autoría, moderación y tareas', () => {
  it('un compañero no edita ni retira lo ajeno; el autor sí edita lo suyo', async () => {
    expect(await b.falla(U.marco, `select public.editar_material('${PUB}', 'Hackeado', null, 'otro')`)).toMatch(/permiso/);
    expect(await b.falla(U.marco, `select public.retirar_material('${PUB}')`)).toMatch(/permiso/);
    const [c] = await q<{ id: string }>(`select id from material_comentarios where material_id = '${PUB}' limit 1`);
    expect(await b.falla(U.ana, `select public.editar_comentario_material('${c.id}', 'cambiado')`)).toMatch(/permiso/);
    await uno(U.ana, `public.editar_material('${PUB}', 'Rutina autónoma v2', 'Ya probada', 'programacion')`);
    expect((await ver(U.marco)).find((m) => m.id === PUB)?.titulo).toBe('Rutina autónoma v2');
  });

  it('el coach modera: retira una publicación; el equipo deja de verla y sus archivos; el coach la sigue viendo', async () => {
    const m = await crear(U.luis, uid('c7', 1), 'Meme fuera de lugar');
    await enlace(U.luis, m, 'https://example.com/meme');
    await uno(U.luis, `public.publicar_material('${m}')`);
    await uno(U.coach, `public.retirar_material('${m}')`);
    expect((await ver(U.ana)).map((x) => x.id)).not.toContain(m);
    expect((await ver(U.coach)).map((x) => x.id)).toContain(m);
    expect(await b.falla(U.ana, `select public.comentar_material('${m}', '${uid('c7', 2)}', 'jaja')`)).toMatch(/permiso/);
    const [r] = await q<{ por: string }>(`select retirado_por as por from materiales where id = '${m}'`);
    expect(r.por).toBe(U.coach);
  });

  it('el coach retira un comentario ajeno; el autor de otro comentario no puede', async () => {
    const c = await uno<string>(U.marco, `public.comentar_material('${PUB}', '${uid('c8', 1)}', 'Comentario por moderar')`);
    expect(await b.falla(U.luis, `select public.retirar_comentario_material('${c}')`)).toMatch(/permiso/);
    await uno(U.aux, `public.retirar_comentario_material('${c}')`);
    expect(await b.como(U.luis, `select 1 from material_comentarios where id = '${c}'`)).toHaveLength(0);
    expect(await b.como(U.coach, `select 1 from material_comentarios where id = '${c}'`)).toHaveLength(1);
  });

  it('vincular una tarea no amplía permisos: solo se vincula lo que ya ves, y verla sigue dependiendo de la tarea', async () => {
    // Sofía (Logística) no ve la tarea de Programación → no puede vincularla
    expect(await b.falla(U.sofia, `select public.crear_material('${uid('c9', 1)}', 'x', 'otro', null, null, '${T.odometria}')`)).toMatch(/vincular/);
    // Ana vincula su tarea; Sofía ve la publicación (es del equipo) pero NO la tarea
    const m = await crear(U.ana, uid('c9', 2), 'Avance garra', `, null, '${T.garra}'`);
    await enlace(U.ana, m, 'https://github.com/zero-ohms-e13/robot');
    await uno(U.ana, `public.publicar_material('${m}')`);
    expect((await ver(U.sofia)).map((x) => x.id)).toContain(m);
    expect(await b.como(U.sofia, `select 1 from tareas where id = '${T.garra}'`)).toHaveLength(0);
  });
});
