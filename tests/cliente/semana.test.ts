// FUN-001 · una sola semana (lunes 00:00 a lunes siguiente excluido, America/Merida) para la pestaña y la batería.
// Reloj fijo y zona del dispositivo distinta a la de Mérida.
import { afterAll, describe, expect, it } from 'vitest';
import { agruparSemana, enSemana, semanaDe } from '../../src/lib/fechas';

const TZ_ORIGINAL = process.env.TZ;
afterAll(() => {
  process.env.TZ = TZ_ORIGINAL;
});

// Miércoles 25 nov 2026, 10:00 en Mérida (UTC-6) = 16:00Z. Semana: lun 23 00:00 (06:00Z) a lun 30 00:00 (06:00Z).
const AHORA = new Date('2026-11-25T16:00:00Z');
const t = (id: string, fecha_limite: string | null, estado = 'pendiente') => ({ id, fecha_limite, estado });

const TAREAS = [
  t('lunes-inicio', '2026-11-23T06:00:00Z'), // lunes 00:00 Mérida: dentro
  t('domingo-final', '2026-11-30T05:59:59Z'), // domingo 23:59:59 Mérida: dentro
  t('lunes-siguiente', '2026-11-30T06:00:00Z'), // lunes siguiente 00:00: fuera (próxima)
  t('domingo-anterior', '2026-11-23T05:59:59Z'), // domingo anterior 23:59:59: vencida de semana anterior
  t('hecha-semana', '2026-11-24T20:00:00Z', 'hecha'),
  t('vencida-semana', '2026-11-24T18:00:00Z', 'en_proceso'), // ya pasó pero es de esta semana: sigue en la semana
  t('hecha-vieja', '2026-11-10T18:00:00Z', 'hecha'),
  t('futura', '2026-12-08T18:00:00Z'),
  t('sin-fecha', null),
  t('sin-fecha-hecha', null, 'hecha'),
];

describe.each(['America/Merida', 'Asia/Tokyo', 'Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'])('FUN-001 · zona del dispositivo %s', (tz) => {
  it('límites: lunes inicial incluido, domingo final incluido, lunes siguiente excluido', () => {
    process.env.TZ = tz;
    const { inicio, finExclusivo } = semanaDe(AHORA);
    expect(inicio.toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(finExclusivo.toISOString()).toBe('2026-11-30T06:00:00.000Z');
    expect(enSemana('2026-11-23T06:00:00Z', AHORA)).toBe(true);
    expect(enSemana('2026-11-30T05:59:59.999Z', AHORA)).toBe(true);
    expect(enSemana('2026-11-30T06:00:00Z', AHORA)).toBe(false);
    expect(enSemana('2026-11-23T05:59:59.999Z', AHORA)).toBe(false);
  });

  it('la pestaña Semana y la batería usan el mismo conjunto; lo demás sigue localizable', () => {
    process.env.TZ = tz;
    const g = agruparSemana(TAREAS, AHORA);
    const ids = (l: { id: string }[]) => l.map((x) => x.id);
    expect(ids(g.semana).sort()).toEqual(['domingo-final', 'hecha-semana', 'lunes-inicio', 'vencida-semana']);
    expect(g.hechas).toBe(1); // numerador
    expect(g.semana.length).toBe(4); // denominador
    expect(ids(g.pendientes)).toEqual(['lunes-inicio', 'vencida-semana', 'domingo-final']); // ordenadas por fecha
    expect(g.pendientes.every((x) => g.semana.includes(x))).toBe(true);
    expect(g.hechas + g.pendientes.length).toBe(g.semana.length);
    expect(ids(g.vencidas)).toEqual(['domingo-anterior']);
    expect(ids(g.proximas)).toEqual(['lunes-siguiente', 'futura']);
    expect(ids(g.sinFecha)).toEqual(['sin-fecha']);
    // Ninguna tarea sin terminar se pierde
    const activas = TAREAS.filter((x) => x.estado !== 'hecha').length;
    expect(g.pendientes.length + g.vencidas.length + g.proximas.length + g.sinFecha.length).toBe(activas);
  });
});

describe('FUN-001 · bordes de reloj', () => {
  it('el lunes a las 00:00 de Mérida ya es la semana nueva; el domingo 23:59 aún es la anterior', () => {
    expect(semanaDe(new Date('2026-11-30T06:00:00Z')).inicio.toISOString()).toBe('2026-11-30T06:00:00.000Z');
    expect(semanaDe(new Date('2026-11-30T05:59:00Z')).inicio.toISOString()).toBe('2026-11-23T06:00:00.000Z');
  });

});
