// FUN-003 · alta de cuentas con dependencias simuladas e inyección de fallos (sin red ni Supabase).
import { describe, expect, it } from 'vitest';
import { procesarAlta, type Completar, type Deps, type FichaGuardada } from '../../supabase/functions/_shared/alta-logica';

const AREA = '11111111-1111-4111-8111-111111111111';
const AREA2 = '22222222-2222-4222-8222-222222222222';
const ALUMNO = '33333333-3333-4333-8333-333333333333';
const COACH = { id: 'c0000000-0000-4000-8000-000000000000', rol_global: 'coach' };
const AUX = { id: 'c1000000-0000-4000-8000-000000000000', rol_global: 'coach_aux' };
const SOL = '44444444-4444-4444-8444-444444444444';

type Fallo = 'identidad' | 'identidad_tutor' | 'registrar' | 'completar' | 'borrar' | 'activar' | 'iniciar' | 'existe_una_vez';

/** Backend falso: identidades, perfiles, membresías, vínculos y solicitudes en memoria. */
function backend(fallos: Fallo[] = []) {
  let n = 0;
  const f = new Set(fallos);
  const db = {
    identidades: new Map<string, { usuario: string; bloqueada: boolean; password: string }>([['pre-existente', { usuario: 'ana.l', bloqueada: false, password: 'x' }]]),
    perfiles: new Map<string, { usuario: string; rol: string }>([['pre-existente', { usuario: 'ana.l', rol: 'alumno' }], [ALUMNO, { usuario: 'leo.v', rol: 'alumno' }]]),
    membresias: [] as { usuario_id: string; area_id: string }[],
    vinculos: [] as { tutor_id: string; alumno_id: string }[],
    altas: new Map<string, { coach: string; huella: string; estado: string; creados: string[]; resultado?: FichaGuardada[] }>(),
    borrados: [] as string[],
  };
  const deps: Deps = {
    areasExistentes: async (ids) => ids.filter((i) => i === AREA || i === AREA2),
    esAlumno: async (id) => db.perfiles.get(id)?.rol === 'alumno',
    usuariosOcupados: async (base) => [...db.identidades.values()].map((i) => i.usuario).filter((u) => u.startsWith(base)),
    iniciar: async (sol, coach, huella) => {
      if (f.has('iniciar')) throw new Error('bd');
      const a = db.altas.get(sol);
      if (!a) {
        db.altas.set(sol, { coach, huella, estado: 'en_curso', creados: [] });
        return { previo: null };
      }
      if (a.coach !== coach || a.huella !== huella) return { previo: 'otra' };
      if (a.estado === 'en_curso') return { previo: 'en_curso' };
      if (a.estado === 'completa') return { previo: 'completa', creados: a.creados, resultado: a.resultado! };
      a.estado = 'en_curso';
      return { previo: 'incompleta', creados: [...a.creados] };
    },
    registrarCreado: async (sol, id) => {
      if (f.has('registrar')) throw new Error('bd');
      db.altas.get(sol)!.creados.push(id);
    },
    olvidarCreados: async (sol, ids) => {
      const a = db.altas.get(sol)!;
      a.creados = a.creados.filter((c) => !ids.includes(c));
    },
    marcar: async (sol, estado) => {
      db.altas.get(sol)!.estado = estado;
    },
    crearIdentidad: async (usuario, password) => {
      if (f.has('existe_una_vez')) {
        f.delete('existe_una_vez');
        db.identidades.set(`otra-alta-${usuario}`, { usuario, bloqueada: false, password: 'y' }); // alta concurrente ganó
        return { ok: false, existe: true };
      }
      if (f.has('identidad') || (f.has('identidad_tutor') && usuario.startsWith('tutor.'))) return { ok: false, existe: false };
      if ([...db.identidades.values()].some((i) => i.usuario === usuario)) return { ok: false, existe: true };
      const id = `id-${++n}`;
      db.identidades.set(id, { usuario, bloqueada: true, password });
      return { ok: true, id };
    },
    borrarIdentidad: async (id) => {
      if (f.has('borrar')) return false;
      db.borrados.push(id);
      db.identidades.delete(id);
      return true;
    },
    completar: async (p: Completar) => {
      if (f.has('completar')) throw new Error('membresía');
      for (const x of p.perfiles) db.perfiles.set(x.id, { usuario: x.usuario, rol: x.rol_global });
      db.membresias.push(...p.membresias);
      if (p.vinculo) db.vinculos.push(p.vinculo);
      const a = db.altas.get(p.solicitud)!;
      a.estado = 'completa';
      a.resultado = p.resultado;
    },
    activar: async (id) => {
      if (f.has('activar')) throw new Error('auth');
      db.identidades.get(id)!.bloqueada = false;
    },
    nuevaPassword: async (id, password) => {
      db.identidades.get(id)!.password = password;
    },
    password: () => `cobre-${100 + n}`,
    ahora: () => new Date('2026-11-25T18:00:00Z'),
    uuid: () => SOL,
  };
  return { db, deps, f };
}

const alumnoConTutor = { accion: 'crear', solicitud_id: SOL, nombre: 'Mia Soto', rol: 'alumno', membresias: [{ area_id: AREA, es_lider: false }], con_tutor: true };
const sinPerfilUtilizables = (db: ReturnType<typeof backend>['db']) => [...db.identidades.entries()].filter(([id, i]) => !i.bloqueada && !db.perfiles.has(id));

describe('FUN-003 · alta de cuentas', () => {
  it('alumno con tutor: perfiles, membresía y vínculo; fichas solo al terminar y cuentas activas', async () => {
    const { db, deps } = backend();
    const r = await procesarAlta(alumnoConTutor, COACH, deps);
    expect(r.status).toBe(200);
    const fichas = r.body.fichas as { usuario: string; rol: string; tutor_de?: string }[];
    expect(fichas.map((x) => [x.usuario, x.rol])).toEqual([['mia.s', 'alumno'], ['tutor.mia.s', 'tutor']]);
    expect(fichas[1].tutor_de).toBe('Mia Soto');
    expect(db.membresias).toEqual([{ usuario_id: 'id-1', area_id: AREA, es_lider: false }]);
    expect(db.vinculos).toEqual([{ tutor_id: 'id-2', alumno_id: 'id-1' }]);
    expect(db.identidades.get('id-1')!.bloqueada).toBe(false);
    expect(db.altas.get(SOL)!.estado).toBe('completa');
  });

  it('alumno líder, tutor independiente vinculado y mentor según permisos', async () => {
    const lider = backend();
    expect((await procesarAlta({ nombre: 'Leo Paz', rol: 'alumno', membresias: [{ area_id: AREA2, es_lider: true }] }, COACH, lider.deps)).status).toBe(200);
    expect(lider.db.membresias[0]).toMatchObject({ area_id: AREA2, es_lider: true });

    const tutor = backend();
    const r = await procesarAlta({ nombre: 'Familia de Leo', rol: 'tutor', alumno_id: ALUMNO }, COACH, tutor.deps);
    expect(r.status).toBe(200);
    expect(tutor.db.vinculos).toEqual([{ tutor_id: 'id-1', alumno_id: ALUMNO }]);

    const mentor = backend();
    expect((await procesarAlta({ nombre: 'Rosa Gil', rol: 'coach_aux' }, COACH, mentor.deps)).status).toBe(200);
    const negado = backend();
    expect((await procesarAlta({ nombre: 'Rosa Gil', rol: 'coach_aux' }, AUX, negado.deps)).status).toBe(403);
    expect(negado.db.identidades.size).toBe(1); // nada creado
  });

  it('valida todo antes de crear identidades', async () => {
    for (const [body, st] of [
      [{ nombre: 'X', rol: 'alumno' }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'jefe' }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'alumno', membresias: [{ area_id: 'no-uuid' }] }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'alumno', membresias: [{ area_id: '99999999-9999-4999-8999-999999999999' }] }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'tutor', alumno_id: '99999999-9999-4999-8999-999999999999' }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'tutor', membresias: [{ area_id: AREA }] }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'coach_aux', con_tutor: true }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'alumno', alumno_id: ALUMNO }, 400],
      [{ nombre: 'Ana Ruiz', rol: 'alumno', usuario: 'Ana Ruiz' }, 400],
    ] as const) {
      const { db, deps } = backend();
      expect((await procesarAlta(body as Record<string, unknown>, COACH, deps)).status).toBe(st);
      expect(db.identidades.size).toBe(1);
      expect(db.altas.size).toBe(0);
    }
  });

  it.each([
    ['perfil o membresía (transacción)', 'completar'],
    ['creación del tutor', 'identidad_tutor'],
    ['registro del id creado', 'registrar'],
  ] as const)('fallo en %s: se revierten solo las identidades de esta solicitud y no hay fichas', async (_n, fallo) => {
    const { db, deps } = backend([fallo]);
    const r = await procesarAlta(alumnoConTutor, COACH, deps);
    expect(r.status).toBe(500);
    expect(r.body.estado).toBe('revertida');
    expect(r.body.fichas).toBeUndefined();
    expect([...db.identidades.keys()]).toEqual(['pre-existente']); // la identidad previa sigue
    expect(db.borrados.every((id) => id.startsWith('id-'))).toBe(true);
    expect(db.membresias).toHaveLength(0);
    expect(db.vinculos).toHaveLength(0);
  });

  it('fallo de compensación: el alta queda incompleta y BLOQUEADA; el reintento la limpia y la completa', async () => {
    const b = backend(['completar', 'borrar']);
    const r = await procesarAlta(alumnoConTutor, COACH, b.deps);
    expect(r).toMatchObject({ status: 500, body: { estado: 'incompleta' } });
    expect([...b.db.identidades.entries()].filter(([id]) => id !== 'pre-existente').every(([, i]) => i.bloqueada)).toBe(true);
    expect(b.db.altas.get(SOL)!.estado).toBe('incompleta');
    // se arregla la infraestructura y el coach reintenta la MISMA solicitud
    b.f.clear();
    const r2 = await procesarAlta(alumnoConTutor, COACH, b.deps);
    expect(r2.status).toBe(200);
    expect(b.db.borrados).toEqual(['id-1', 'id-2']); // limpió lo suyo
    const vivos = [...b.db.identidades.entries()].filter(([id]) => id !== 'pre-existente');
    expect(vivos.map(([, i]) => i.usuario).sort()).toEqual(['mia.s', 'tutor.mia.s']); // sin duplicados
    expect(vivos.every(([, i]) => !i.bloqueada)).toBe(true);
  });

  it('reintento tras perder la respuesta: no duplica perfiles ni vínculos; mismas cuentas con contraseña nueva', async () => {
    const { db, deps } = backend();
    const r1 = await procesarAlta(alumnoConTutor, COACH, deps);
    const r2 = await procesarAlta(alumnoConTutor, COACH, deps);
    expect(r2.status).toBe(200);
    expect(r2.body.recuperada).toBe(true);
    const ids = (r: typeof r1) => (r.body.fichas as { usuario_id: string }[]).map((x) => x.usuario_id);
    expect(ids(r2)).toEqual(ids(r1));
    expect(db.identidades.size).toBe(3);
    expect(db.vinculos).toHaveLength(1);
    expect(db.membresias).toHaveLength(1);
  });

  it('la misma solicitud con otros datos o en curso no se procesa dos veces', async () => {
    const { db, deps } = backend();
    db.altas.set(SOL, { coach: COACH.id, huella: 'otra', estado: 'en_curso', creados: [] });
    expect((await procesarAlta(alumnoConTutor, COACH, deps)).status).toBe(409);
    const b2 = backend();
    await b2.deps.iniciar(SOL, COACH.id, (await import('../../supabase/functions/_shared/alta-logica')).huellaDe(
      (await import('../../supabase/functions/_shared/alta-logica')).validar(alumnoConTutor, COACH, () => SOL) as never,
    ));
    const r = await procesarAlta(alumnoConTutor, COACH, b2.deps);
    expect(r).toMatchObject({ status: 409, body: { estado: 'en_curso' } });
    expect(b2.db.identidades.size).toBe(1);
  });

  it('alta concurrente con el mismo usuario: toma el siguiente libre y no toca la cuenta ajena', async () => {
    const { db, deps } = backend(['existe_una_vez']);
    const r = await procesarAlta({ nombre: 'Mia Soto', rol: 'alumno', membresias: [{ area_id: AREA }] }, COACH, deps);
    expect(r.status).toBe(200);
    expect((r.body.fichas as { usuario: string }[])[0].usuario).toBe('mia.s2');
    expect(db.identidades.has('otra-alta-mia.s')).toBe(true);
    expect(db.borrados).toHaveLength(0);
  });

  it('usuario ocupado por una cuenta previa: nunca se reutiliza ni se borra', async () => {
    const { db, deps } = backend(['completar']);
    const r = await procesarAlta({ nombre: 'Ana Luna', usuario: 'ana.l', rol: 'alumno', membresias: [{ area_id: AREA }] }, COACH, deps);
    expect(r.status).toBe(500);
    expect(db.identidades.has('pre-existente')).toBe(true);
    expect(db.borrados).toEqual(['id-1']);
  });

  it('fallo al activar: no se entregan fichas; el reintento activa y entrega', async () => {
    const b = backend(['activar']);
    const r = await procesarAlta(alumnoConTutor, COACH, b.deps);
    expect(r).toMatchObject({ status: 500, body: { estado: 'completa' } });
    expect(r.body.fichas).toBeUndefined();
    expect(b.db.identidades.get('id-1')!.bloqueada).toBe(true);
    b.f.clear();
    const r2 = await procesarAlta(alumnoConTutor, COACH, b.deps);
    expect(r2.status).toBe(200);
    expect(b.db.identidades.get('id-1')!.bloqueada).toBe(false);
    expect(b.db.identidades.size).toBe(3);
  });

  it('error al iniciar: no se crea nada', async () => {
    const { db, deps } = backend(['iniciar']);
    expect((await procesarAlta(alumnoConTutor, COACH, deps)).status).toBe(503);
    expect(db.identidades.size).toBe(1);
  });

  it('identidades sin perfil nunca quedan utilizables', async () => {
    const { db, deps } = backend(['completar', 'borrar']);
    await procesarAlta(alumnoConTutor, COACH, deps);
    expect(db.identidades.size).toBe(3); // quedaron (no se pudieron borrar)…
    expect(sinPerfilUtilizables(db)).toHaveLength(0); // …pero bloqueadas
  });
});
