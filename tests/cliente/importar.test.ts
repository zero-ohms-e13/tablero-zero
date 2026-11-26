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

describe('Importar · lectura de la hoja', () => {
  it('reconoce pestañas y columnas aunque cambien acentos, mayúsculas o nombres cercanos', () => {
    expect(pestanaDe('Áreas')).toBe('areas');
    expect(pestanaDe('TUTORÍAS')).toBe('tutorias');
    expect(pestanaDe('Otra cosa')).toBeNull();
    const f = filasDe([['Clave persona', 'Nombre visible', 'Usuario', 'Rol'], ['ALU-01', ' Ana  López ', '', 'Alumna'], ['', '', '', '']]);
    expect(f).toEqual([{ clave_persona: 'ALU-01', nombre_visible: 'Ana  López', usuario_deseado: '', rol: 'Alumna' }]);
  });

  it('fechas: AAAA-MM-DD (23:59 Mérida) o con hora; las imposibles se rechazan', () => {
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

describe('Importar · revisor', () => {
  it('una hoja correcta queda lista: todo nuevo y sin problemas', () => {
    const p = revisar(hoja(), vacio);
    expect(p.bloquea).toBe(false);
    expect(p.problemas).toEqual([]);
    expect(conteo(p)).toEqual({ areas: { nueva: 1, existente: 0, error: 0 }, cuentas: { nueva: 2, existente: 0, error: 0 }, tutorias: { nueva: 1, existente: 0, error: 0 }, tareas: { nueva: 1, existente: 0, error: 0 } });
    const diego = p.cuentas[0];
    expect(diego).toMatchObject({ usuario: 'diego.p', rol: 'alumno', membresias: [{ clave_area: 'MEC', es_lider: true }] });
    expect(p.cuentas[1].usuario).toBe('tutor.diego.p'); // a un tutor se le antepone tutor.
    expect(p.tareas[0]).toMatchObject({ robot: 'VEX', pasos: ['Cortar', 'Atornillar'], fecha_limite: '2026-12-06T05:59:00.000Z' });
  });

  it('cruza con lo que ya existe: área, cuenta y tarea iguales salen como existentes (no se duplican)', () => {
    const p = revisar(hoja({
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

  it('detecta claves y usuarios repetidos, roles y referencias inválidas, y bloquea la carga', () => {
    const p = revisar(hoja({
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

  it('un alumno nuevo sin área y un tutor sin alumno no se pueden cargar', () => {
    const p = revisar(hoja({ asignaciones: [], tutorias: [] }), vacio);
    expect(p.cuentas.map((c) => c.estado)).toEqual(['invalida', 'invalida']);
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/no tiene ningún área.*no tiene alumno/s);
  });

  it('avisos que no bloquean: responsable fuera del área, asignación repetida, cuenta existente desactivada', () => {
    const ex: Existentes = { ...vacio, perfiles: [{ id: 'p-x', usuario: 'diego.p', nombre_visible: 'Diego', rol_global: 'alumno', activo: false }] };
    const p = revisar(hoja({
      areas: [{ clave_area: 'MEC', nombre: 'Mecánica' }, { clave_area: 'LOG', nombre: 'Logística' }],
      asignaciones: [{ clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: '' }, { clave_persona: 'ALU-01', clave_area: 'MEC', rol_en_area: '' }],
      tareas: [{ clave_tarea: 'TAR-01', titulo: 'Inventario', clave_area: 'LOG', responsables: 'ALU-01', fecha_limite: '', robot: 'ambos', descripcion_opcional: '', pasos: '' }],
    }), ex);
    expect(p.bloquea).toBe(false);
    expect(p.problemas.every((x) => !x.grave)).toBe(true);
    expect(p.problemas.map((x) => x.mensaje).join(' ')).toMatch(/desactivada.*asignado a MEC en otra fila.*no pertenece al área LOG/s);
  });

  it('un mentor solo lo puede cargar el coach principal; un rol distinto al existente es conflicto', () => {
    const mentor = hoja({ cuentas: [{ clave_persona: 'MEN-01', nombre_visible: 'Laura Ortiz', usuario_deseado: '', rol: 'mentor' }], asignaciones: [], tutorias: [], tareas: [] });
    expect(revisar(mentor, vacio, { coachPrincipal: false }).bloquea).toBe(true);
    expect(revisar(mentor, vacio, { coachPrincipal: true }).cuentas[0]).toMatchObject({ rol: 'coach_aux', usuario: 'laura.o', estado: 'nueva' });
    const choque = revisar(hoja({ cuentas: [{ clave_persona: 'X', nombre_visible: 'Ana López', usuario_deseado: 'ana.l', rol: 'mentor' }], asignaciones: [], tutorias: [], tareas: [] }), conApp);
    expect(choque.cuentas[0].estado).toBe('conflicto');
    expect(choque.problemas[0].mensaje).toMatch(/Ya existe la cuenta ana\.l pero con rol alumno/);
  });
});
