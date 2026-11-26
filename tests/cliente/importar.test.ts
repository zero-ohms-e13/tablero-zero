// Importar datos · revisor de la hoja (puro, sin red, datos ficticios).
import { describe, expect, it } from 'vitest';
import { conteo, fechaLimite, filasDe, idEstable, pestanaDe, revisar, type Existentes, type Hoja } from '../../src/lib/importar';

const vacio: Existentes = { areas: [], perfiles: [], membresias: [], tutorias: [], tareas: [] };
const conApp: Existentes = {
  areas: [{ id: 'a-prog', nombre: 'Programación' }],
  perfiles: [{ id: 'p-ana', usuario: 'ana.l', nombre_visible: 'Ana López', rol_global: 'alumno', activo: true }],
  membresias: [{ usuario_id: 'p-ana', area_id: 'a-prog', es_lider: false }],
  tutorias: [],
  tareas: [{ id: 't-1', titulo: 'Calibrar sensor', area_id: 'a-prog' }],
};
const hoja = (o: Partial<Hoja> = {}): Hoja => ({
  areas: [{ clave_area: 'MEC', nombre: 'Mecánica' }],
  cuentas: [
    { clave_persona: 'ALU-01', nombre_visible: 'Diego Pérez', usuario_deseado: '', rol: 'alumno' },
    { clave_persona: 'TUT-01', nombre_visible: 'Familia de Diego', usuario_deseado: 'diego.p', rol: 'Tutor' },
  ],
  asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: 'líder' }],
  tutorias: [{ clave_tutor: 'TUT-01', clave_alumno: 'ALU-01' }],
  tareas: [{ clave_tarea: 'TAR-01', titulo: 'Armar el chasis', clave_area: 'MEC', responsables: 'ALU-01', fecha_limite: '2026-12-05', robot: 'vex', descripcion_opcional: '', pasos: 'Cortar; Atornillar' }],
  ...o,
});

describe('Importar · lectura de la hoja', async () => {
  it('reconoce pestañas y columnas aunque cambien acentos, mayúsculas o nombres cercanos', async () => {
    expect(pestanaDe('Áreas')).toBe('areas');
    expect(pestanaDe('TUTORÍAS')).toBe('tutorias');
    expect(pestanaDe('Otra cosa')).toBeNull();
    const f = filasDe([['Clave persona', 'Nombre visible', 'Usuario', 'Rol'], ['ALU-01', ' Ana  López ', '', 'Alumna'], ['', '', '', '']]);
    expect(f).toEqual([{ clave_persona: 'ALU-01', nombre_visible: 'Ana  López', usuario_deseado: '', rol: 'Alumna' }]);
  });

  it('fechas: AAAA-MM-DD (23:59 Mérida) o con hora; las imposibles se rechazan', async () => {
    expect(fechaLimite('2026-12-05')).toBe('2026-12-06T05:59:00.000Z');
    expect(fechaLimite('2026-12-05 18:30')).toBe('2026-12-06T00:30:00.000Z');
    expect(fechaLimite('')).toBeNull();
    for (const mala of ['05/12/2026', '2026-02-30', '2026-12-05 25:00', 'mañana']) expect(fechaLimite(mala), mala).toBe('invalida');
  });

  it('el id estable es igual para el mismo texto y distinto para otro', async () => {
    const a = await idEstable('cuenta|ALU-01');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await idEstable('cuenta|ALU-01')).toBe(a);
    expect(await idEstable('cuenta|ALU-02')).not.toBe(a);
  });
});

describe('Importar · revisor', async () => {
  it('una hoja correcta queda lista: todo nuevo y sin problemas', async () => {
    const p = await revisar(hoja(), vacio);
    expect(p.bloquea).toBe(false);
    expect(p.problemas).toEqual([]);
    const c0 = { existente: 0, cambio: 0, error: 0 };
    expect(conteo(p)).toEqual({ areas: { ...c0, nueva: 1 }, cuentas: { ...c0, nueva: 2 }, asignaciones: { ...c0, nueva: 0 }, tutorias: { ...c0, nueva: 1 }, tareas: { ...c0, nueva: 1 } });
    const diego = p.cuentas[0];
    expect(diego).toMatchObject({ usuario: 'diego.p', rol: 'alumno', membresias: [{ clave_area: 'MEC', es_lider: true }] });
    expect(p.cuentas[1].usuario).toBe('tutor.diego.p'); // a un tutor se le antepone tutor.
    expect(p.tareas[0]).toMatchObject({ robot: 'VEX', pasos: ['Cortar', 'Atornillar'], fecha_limite: '2026-12-06T05:59:00.000Z' });
  });

  it('cruza con lo que ya existe: área, cuenta y tarea iguales salen como existentes (no se duplican)', async () => {
    conApp.tareas = [{ id: await idEstable('tarea|TAR-01|calibrar sensor|PROG'), titulo: 'Calibrar sensor', area_id: 'a-prog' }];
    const p = await revisar(hoja({
      areas: [{ clave_area: 'PROG', nombre: 'programacion' }],
      cuentas: [{ clave_persona: 'ALU-01', nombre_visible: 'Ana López', usuario_deseado: 'ana.l', rol: 'alumno' }],
      asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'PROG', rol_en_area: '' }],
      tutorias: [],
      tareas: [{ clave_tarea: 'TAR-01', titulo: 'Calibrar sensor', clave_area: 'PROG', responsables: 'ALU-01', fecha_limite: '', robot: '', descripcion_opcional: '', pasos: '' }],
    }), conApp);
    expect(p.bloquea).toBe(false);
    expect([p.areas[0].estado, p.cuentas[0].estado, p.tareas[0].estado]).toEqual(['existente', 'existente', 'existente']);
    expect(p.areas[0].id).toBe('a-prog');
    expect(p.cuentas[0].id).toBe('p-ana');
  });

  it('detecta claves y usuarios repetidos, roles y referencias inválidas, y bloquea la carga', async () => {
    const p = await revisar(hoja({
      cuentas: [
        { clave_persona: 'ALU-01', nombre_visible: 'Diego Pérez', usuario_deseado: '', rol: 'alumno' },
        { clave_persona: 'ALU-01', nombre_visible: 'Otro', usuario_deseado: 'otro.x', rol: 'alumno' },
        { clave_persona: 'ALU-02', nombre_visible: 'Diego Paz', usuario_deseado: 'diego.p', rol: 'alumno' },
        { clave_persona: 'ALU-03', nombre_visible: 'Sin Rol', usuario_deseado: '', rol: 'jefe' },
        { clave_persona: 'ALU-04', nombre_visible: 'Mal Usuario', usuario_deseado: 'Mal Usuario!', rol: 'alumno' },
      ],
      tutorias: [{ clave_tutor: 'NADIE', clave_alumno: 'ALU-01' }],
      tareas: [{ clave_tarea: 'TAR-01', titulo: 'Ok', clave_area: 'XYZ', responsables: 'ALU-09', fecha_limite: '5/12/2026', robot: 'lego', descripcion_opcional: '', pasos: '' }],
    }), vacio);
    expect(p.bloquea).toBe(true);
    const msgs = p.problemas.map((x) => `${x.hoja}:${x.fila}:${x.mensaje}`).join('\n');
    expect(msgs).toMatch(/Cuentas:3:La clave ALU-01 está repetida/);
    expect(msgs).toMatch(/Cuentas:4:El usuario diego\.p se repite/);
    expect(msgs).toMatch(/Cuentas:5:Rol «jefe» no válido/);
    expect(msgs).toMatch(/Cuentas:6:Usuario «mal usuario!» no válido/);
    expect(msgs).toMatch(/Tutorías:2:NADIE no es un tutor/);
    expect(msgs).toMatch(/Tareas:2:El título debe tener de 3 a 120/);
    expect(msgs).toMatch(/Tareas:2:El área XYZ no está/);
    expect(msgs).toMatch(/Tareas:2:Robot «lego» no válido/);
    expect(msgs).toMatch(/Tareas:2:Fecha «5\/12\/2026» no válida/);
    expect(msgs).toMatch(/Tareas:2:El responsable ALU-09 no está/);
  });

  it('un alumno nuevo sin área y un tutor sin alumno no se pueden cargar', async () => {
    const p = await revisar(hoja({ asignaciones: [], tutorias: [] }), vacio);
    expect(p.cuentas.map((c) => c.estado)).toEqual(['invalida', 'invalida']);
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/no tiene ningún área.*no tiene alumno/s);
  });

  it('avisos que no bloquean: responsable fuera del área, asignación repetida, cuenta existente desactivada', async () => {
    const ex: Existentes = { ...vacio, perfiles: [{ id: 'p-x', usuario: 'diego.p', nombre_visible: 'Diego Pérez', rol_global: 'alumno', activo: false }] };
    const p = await revisar(hoja({
      areas: [{ clave_area: 'MEC', nombre: 'Mecánica' }, { clave_area: 'LOG', nombre: 'Logística' }],
      asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: '' }, { clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: '' }],
      tareas: [{ clave_tarea: 'TAR-01', titulo: 'Inventario', clave_area: 'LOG', responsables: 'ALU-01', fecha_limite: '', robot: 'ambos', descripcion_opcional: '', pasos: '' }],
    }), ex);
    expect(p.bloquea).toBe(false);
    expect(p.problemas.every((x) => !x.grave)).toBe(true);
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/desactivada.*asignado a MEC en otra fila.*no pertenece al área LOG/s);
  });

  it('un mentor solo lo puede cargar el coach principal; un rol distinto al existente es conflicto', async () => {
    const mentor = hoja({ cuentas: [{ clave_persona: 'MEN-01', nombre_visible: 'Laura Ortiz', usuario_deseado: '', rol: 'mentor' }], asignaciones: [], tutorias: [], tareas: [] });
    expect((await revisar(mentor, vacio, { coachPrincipal: false })).bloquea).toBe(true);
    expect((await revisar(mentor, vacio, { coachPrincipal: true })).cuentas[0]).toMatchObject({ rol: 'coach_aux', usuario: 'laura.o', estado: 'nueva' });
    const choque = await revisar(hoja({ cuentas: [{ clave_persona: 'X', nombre_visible: 'Ana López', usuario_deseado: 'ana.l', rol: 'mentor' }], asignaciones: [], tutorias: [], tareas: [] }), conApp);
    expect(choque.cuentas[0].estado).toBe('conflicto');
    expect(choque.problemas[0].mensaje).toMatch(/Ya existe la cuenta ana\.l pero con rol alumno/);
  });

  it('identidad: el mismo usuario con otro nombre, o el mismo nombre con otro usuario, no se vinculan solos', async () => {
    const cuentas = (nombre: string, usuario: string) => hoja({ cuentas: [{ clave_persona: 'ALU-01', nombre_visible: nombre, usuario_deseado: usuario, rol: 'alumno' }], asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'Programación', rol_en_area: '' }], tutorias: [], tareas: [] });
    const otraPersona = await revisar(cuentas('Ana Lara', 'ana.l'), conApp);
    expect(otraPersona.cuentas[0]).toMatchObject({ estado: 'conflicto', id: undefined });
    expect(otraPersona.problemas[0].mensaje).toMatch(/ya es de «Ana López»/);
    const homonimo = await revisar(cuentas('Ana López', 'ana.lopez'), conApp);
    expect(homonimo.cuentas[0].estado).toBe('conflicto');
    expect(homonimo.problemas[0].mensaje).toMatch(/pon usuario_deseado ana\.l/);
    const misma = await revisar(cuentas('Ana López', 'ana.l'), conApp);
    expect(misma.cuentas[0]).toMatchObject({ estado: 'existente', id: 'p-ana' });
    expect(misma.bloquea).toBe(false);
    expect(misma.problemas.map((x) => x.mensaje).join(' ')).toMatch(/Se usará la cuenta que ya existe: ana\.l/);
  });

  it('asignaciones como filas: falta una en una cuenta existente o cambia de líder → cuentan para cargar', async () => {
    const h = hoja({
      areas: [{ clave_area: 'MEC', nombre: 'Mecánica' }],
      cuentas: [{ clave_persona: 'ALU-01', nombre_visible: 'Ana López', usuario_deseado: 'ana.l', rol: 'alumno' }],
      asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'Programación', rol_en_area: 'lider' }, { clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: '' }],
      tutorias: [], tareas: [],
    });
    const p = await revisar(h, conApp);
    expect(p.asignaciones.map((a) => a.estado)).toEqual(['cambio', 'nueva']);
    expect(conteo(p).asignaciones).toMatchObject({ nueva: 1, cambio: 1 });
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/pasa de integrante a líder en Programación/);
  });

  it('tareas: misma fila = misma tarea; otra fila con el mismo título en el área es conflicto', async () => {
    const id = await idEstable('tarea|TAR-01|calibrar sensor|PROG');
    const ex = { ...conApp, tareas: [{ id, titulo: 'Calibrar sensor', area_id: 'a-prog', fecha_limite: null, robot: 'Ambos' }] };
    const fila = (clave: string, fecha = '') => hoja({ areas: [{ clave_area: 'PROG', nombre: 'Programación' }], cuentas: [], asignaciones: [], tutorias: [], tareas: [{ clave_tarea: clave, titulo: 'Calibrar  sensor', clave_area: 'PROG', responsables: '', fecha_limite: fecha, robot: '', descripcion_opcional: '', pasos: '' }] });
    const igual = await revisar(fila('TAR-01'), ex);
    expect(igual.tareas[0]).toMatchObject({ estado: 'existente', id });
    expect(igual.problemas).toEqual([]);
    const cambiada = await revisar(fila('TAR-01', '2026-12-05'), ex);
    expect(cambiada.tareas[0].estado).toBe('existente');
    expect(cambiada.problemas[0]).toMatchObject({ grave: false, mensaje: expect.stringMatching(/no cambia su fecha/) });
    const otra = await revisar(fila('TAR-07'), ex);
    expect(otra.tareas[0].estado).toBe('conflicto');
    expect(otra.bloquea).toBe(true);
  });

  it('una celda de fecha a medianoche avisa que vence a las 23:59', async () => {
    const filas = filasDe([['clave_tarea', 'titulo', 'clave_area', 'fecha_limite'], ['TAR-01', 'Armar el chasis', 'MEC', new Date(Date.UTC(2026, 11, 5))]]);
    expect(filas[0].fecha_limite).toBe('2026-12-05');
    const p = await revisar(hoja({ tareas: filas.map((f) => ({ ...f, responsables: 'ALU-01' })) }), vacio);
    expect(p.tareas[0].fecha_limite).toBe('2026-12-06T05:59:00.000Z');
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/vence a las 23:59/);
    expect(p.bloquea).toBe(false);
  });
});
