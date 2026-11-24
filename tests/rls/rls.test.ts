// Pruebas de permisos (RLS). Corren las migraciones reales en Postgres en memoria.
// npm test
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, T, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let como: Base['como'];
let falla: Base['falla'];
beforeAll(async () => {
  ({ como, falla } = await crearBase());
}, 60_000);

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const PROG = `(select id from areas where nombre='Programación')`;
const MECA = `(select id from areas where nombre='Mecánica')`;

describe('Tutor', () => {
  it('solo ve las tareas de su hijo(a)', async () => {
    const r = await como<{ id: string }>(U.tutorAna, 'select id from tareas');
    expect(ids(r)).toEqual([T.odometria, T.garra].sort());
  });

  it('no ve nombres de otros alumnos', async () => {
    const r = await como<{ usuario: string }>(U.tutorAna, `select usuario from profiles where rol_global = 'alumno'`);
    expect(r.map((x) => x.usuario)).toEqual(['ana.l']);
  });

  it('en tareas compartidas solo ve a su hijo(a) como responsable', async () => {
    const r = await como<{ usuario_id: string }>(U.tutorAna, `select usuario_id from tarea_responsables where tarea_id = '${T.odometria}'`);
    expect(r.map((x) => x.usuario_id)).toEqual([U.ana]);
  });

  it('no puede editar, comentar ni marcar pasos', async () => {
    expect(await como(U.tutorAna, `update tareas set titulo = 'xxx' where id = '${T.odometria}' returning id`)).toHaveLength(0);
    expect(await falla(U.tutorAna, `insert into comentarios (tarea_id, autor_id, texto) values ('${T.odometria}', '${U.tutorAna}', 'hola')`)).not.toBeNull();
    expect(await como(U.tutorAna, `update tarea_pasos set hecho = true returning id`)).toHaveLength(0);
  });

  it('ve el avance por área solo como totales', async () => {
    const r = await como<Record<string, unknown>>(U.tutorAna, 'select * from avance_areas()');
    expect(r).toHaveLength(4);
    expect(Object.keys(r[0]).some((k) => k.includes('usuario') || k.includes('nombre_visible'))).toBe(false);
  });

  it('el tutor de Luis no ve nada de Ana', async () => {
    const r = await como<{ id: string }>(U.tutorLuis, 'select id from tareas');
    expect(ids(r)).toEqual([T.torre]);
  });
});

describe('Integrante', () => {
  it('ve las tareas de sus áreas y no las de otras', async () => {
    const r = await como<{ id: string }>(U.ana, 'select id from tareas');
    expect(ids(r)).toEqual([T.odometria, T.garra, T.pits].sort()); // Programación + Rama femenil
  });

  it('no ve perfiles de alumnos de otras áreas', async () => {
    expect(await como(U.ana, `select usuario from profiles where usuario = 'sofia.r'`)).toHaveLength(0);
  });

  it('puede mandar su tarea a revisión y pedir ayuda', async () => {
    const r = await como(U.ana, `update tareas set estado = 'en_revision', pide_ayuda = true, mensaje_ayuda = 'ayuda' where id = '${T.odometria}' returning estado`);
    expect(r).toEqual([{ estado: 'en_revision' }]);
    await como(U.ana, `update tareas set estado = 'en_proceso', pide_ayuda = false where id = '${T.odometria}'`);
  });

  it('no puede aprobarse sola ni editar el título', async () => {
    expect(await falla(U.ana, `update tareas set estado = 'hecha' where id = '${T.garra}'`)).toMatch(/líder o el coach/);
    expect(await falla(U.ana, `update tareas set titulo = 'Otra cosa' where id = '${T.garra}'`)).toMatch(/líder o el coach/);
  });

  it('no puede crear tareas', async () => {
    expect(await falla(U.ana, `insert into tareas (titulo, area_id, robot) values ('Nueva', ${PROG}, 'FTC')`)).not.toBeNull();
  });

  it('no puede editar una tarea ajena de su área', async () => {
    expect(await como(U.diego, `update tareas set estado = 'en_revision' where id = '${T.garra}' returning id`)).toHaveLength(0);
  });

  it('marca pasos de su tarea y queda en el historial', async () => {
    await como(U.ana, `update tarea_pasos set hecho = true where tarea_id = '${T.odometria}'`);
    const h = await como<{ detalle: string }>(U.ana, `select detalle from historial where tarea_id = '${T.odometria}' and accion = 'paso_hecho'`);
    expect(h[0].detalle).toMatch(/Ana López marcó como hecho/);
  });
});

describe('Líder', () => {
  it('crea una tarea en su área y asigna a un integrante', async () => {
    const [t] = await como<{ id: string }>(U.marco, `insert into tareas (titulo, area_id, robot) values ('Probar giroscopio', ${PROG}, 'FTC') returning id`);
    expect(await como(U.marco, `insert into tarea_responsables values ('${t.id}', '${U.diego}') returning tarea_id`)).toHaveLength(1);
    const avisos = await como(U.diego, `select titulo from avisos where tipo = 'asignada' and tarea_id = '${t.id}'`);
    expect(avisos).toHaveLength(1);
  });

  it('no puede crear tareas en otra área', async () => {
    expect(await falla(U.marco, `insert into tareas (titulo, area_id, robot) values ('Intruso', ${MECA}, 'VEX')`)).toMatch(/row-level security/);
  });

  it('no puede asignar a alguien que no es de su área', async () => {
    expect(await falla(U.marco, `insert into tarea_responsables values ('${T.garra}', '${U.sofia}')`)).toMatch(/row-level security/);
  });

  it('regresar con nota exige la nota', async () => {
    expect(await falla(U.marco, `select regresar_tarea('${T.garra}', '   ')`)).toMatch(/qué le falta/);
  });

  it('aprueba: pasa a hecha, firma y avisa al integrante', async () => {
    await como(U.marco, `select aprobar_tarea('${T.garra}')`);
    const [t] = await como<{ estado: string; aprobada_por: string }>(U.ana, `select estado, aprobada_por from tareas where id = '${T.garra}'`);
    expect(t).toEqual({ estado: 'hecha', aprobada_por: U.marco });
    expect(await como(U.ana, `select titulo from avisos where tipo = 'aprobada'`)).toHaveLength(1);
  });

  it('regresar con nota deja la tarea en proceso y guarda la nota', async () => {
    await como(U.luis, `select regresar_tarea('${T.torre}', 'Falta el video de la prueba')`);
    const [t] = await como<{ estado: string }>(U.luis, `select estado from tareas where id = '${T.torre}'`);
    expect(t.estado).toBe('en_proceso');
    expect(await como(U.luis, `select texto from comentarios where tarea_id = '${T.torre}'`)).toEqual([{ texto: 'Falta el video de la prueba' }]);
  });

  it('no puede aprobar tareas de otra área', async () => {
    expect(await falla(U.marco, `select aprobar_tarea('${T.post}')`)).toMatch(/aprobar/);
  });
});

describe('Cuentas y coach', () => {
  it('el coach ve todo', async () => {
    expect((await como(U.coach, 'select id from tareas')).length).toBeGreaterThanOrEqual(6);
  });

  it('nadie cambia su rol desde el navegador', async () => {
    expect(await falla(U.aux, `update profiles set rol_global = 'coach' where id = '${U.aux}'`)).toMatch(/Cuentas/);
  });

  it('el coach puede cambiar su nombre visible', async () => {
    const r = await como(U.coach, `update profiles set nombre_visible = 'Coach Jaime' where id = '${U.coach}' returning nombre_visible`);
    expect(r).toEqual([{ nombre_visible: 'Coach Jaime' }]);
  });

  it('un mentor no edita el perfil del coach principal', async () => {
    expect(await falla(U.aux, `update profiles set nombre_visible = 'X' where id = '${U.coach}'`)).toMatch(/coach principal/);
  });

  it('un anónimo solo puede pedir reinicio, no leer datos', async () => {
    await como(null, `select solicitar_reinicio('ana.l')`);
    expect(await falla(null, 'select id from tareas')).toMatch(/permission denied/);
    expect(await como(U.coach, 'select usuario from solicitudes_reinicio')).toEqual([{ usuario: 'ana.l' }]);
    expect(await como(U.ana, 'select usuario from solicitudes_reinicio')).toHaveLength(0);
  });

  it('primer ingreso del tutor exige aceptar el aviso', async () => {
    expect(await falla(U.tutorAna, 'select completar_primer_ingreso(false)')).toMatch(/aviso/);
    await como(U.tutorAna, 'select completar_primer_ingreso(true)');
    const [p] = await como<{ debe_cambiar_password: boolean }>(U.tutorAna, `select debe_cambiar_password from profiles where id = '${U.tutorAna}'`);
    expect(p.debe_cambiar_password).toBe(false);
  });

  it('nadie lee los intentos de login', async () => {
    expect(await como(U.coach, 'select * from intentos_login')).toHaveLength(0);
  });
});
