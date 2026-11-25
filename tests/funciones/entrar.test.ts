// SEG-004 · lógica de la función entrar con dependencias controladas (sin red ni Supabase).
import { describe, expect, it, vi } from 'vitest';
import { ipCliente, procesarEntrada, type Deps, type ResultadoAuth } from '../../supabase/functions/_shared/entrar-logica';

const AHORA = new Date('2026-11-25T18:00:00Z');

function deps(over: Partial<Deps> = {}, auth: ResultadoAuth = { tipo: 'ok', userId: 'u1', access_token: 'tok-a', refresh_token: 'tok-r' }): Deps {
  return {
    reservar: vi.fn(async () => ({ permitido: true, hasta: null, reserva: 'r1' })),
    liquidar: vi.fn(async () => {}),
    autenticar: vi.fn(async () => auth),
    perfil: vi.fn(async () => ({ activo: true, debe_cambiar_password: false, password_temporal_vence: null })),
    cerrarSesion: vi.fn(async () => {}),
    ahora: () => AHORA,
    ...over,
  };
}

describe('SEG-004 · entrar', () => {
  it('credenciales válidas entran y limpian el contador de ese origen', async () => {
    const d = deps();
    const r = await procesarEntrada({ usuario: 'Ana.L ', password: 'secreta' }, '10.0.0.2', d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ access_token: 'tok-a', refresh_token: 'tok-r' });
    expect(d.liquidar).toHaveBeenCalledWith('r1', 'correcto');
    expect(d.liquidar).toHaveBeenCalledTimes(1);
  });

  it('el bloqueo se consulta por usuario + origen: otro origen con fallos no afecta', async () => {
    const d = deps({ reservar: vi.fn(async (_u: string, ip: string) => (ip === '10.6.6.6' ? { permitido: false, hasta: '2026-11-25T18:10:00Z', reserva: null } : { permitido: true, hasta: null, reserva: 'r1' })) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '10.6.6.6', d)).status).toBe(423);
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '10.0.0.2', d)).status).toBe(200);
  });

  it('bloqueado: no se intenta autenticar (no hay oráculo de contraseña)', async () => {
    const d = deps({ reservar: vi.fn(async () => ({ permitido: false, hasta: '2026-11-25T18:10:00Z', reserva: null })) });
    const r = await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '1.1.1.1', d);
    expect(r).toEqual({ status: 423, body: { codigo: 'bloqueada', hasta: '2026-11-25T18:10:00Z' } });
    expect(d.autenticar).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: el intento reservado queda contado y la respuesta es genérica', async () => {
    const d = deps({}, { tipo: 'credenciales' });
    const r = await procesarEntrada({ usuario: 'ana.l', password: 'mala' }, '1.1.1.1', d);
    expect(r).toEqual({ status: 401, body: { codigo: 'incorrecta' } });
    expect(d.reservar).toHaveBeenCalledWith('ana.l', '1.1.1.1');
    expect(d.reservar.mock.invocationCallOrder[0]).toBeLessThan((d.autenticar as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(d.liquidar).toHaveBeenCalledWith('r1', 'fallo');
    expect(d.liquidar).toHaveBeenCalledTimes(1);
  });

  it('el fallo que alcanza el límite responde bloqueada', async () => {
    const d = deps({ reservar: vi.fn(async () => ({ permitido: true, hasta: '2026-11-25T18:10:00Z', reserva: 'r1' })) }, { tipo: 'credenciales' });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'mala' }, '1.1.1.1', d)).status).toBe(423);
  });

  it('un error de infraestructura NO cuenta como contraseña incorrecta (se devuelve la reserva)', async () => {
    const d1 = deps({}, { tipo: 'infra' });
    expect(await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '1.1.1.1', d1)).toEqual({ status: 503, body: { codigo: 'servicio' } });
    expect(d1.liquidar).toHaveBeenCalledWith('r1', 'infra');
    const d2 = deps({ autenticar: vi.fn(async () => { throw new Error('red'); }) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '1.1.1.1', d2)).status).toBe(503);
    expect(d2.liquidar).toHaveBeenCalledWith('r1', 'infra');
    const d3 = deps({ reservar: vi.fn(async () => { throw new Error('bd'); }) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'x' }, '1.1.1.1', d3)).status).toBe(503);
    expect(d3.autenticar).not.toHaveBeenCalled();
  });

  it('cuenta inactiva: 403 y se cierra la sesión creada', async () => {
    const d = deps({ perfil: vi.fn(async () => ({ activo: false, debe_cambiar_password: false, password_temporal_vence: null })) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'ok' }, '1.1.1.1', d)).body).toEqual({ codigo: 'inactiva' });
    expect(d.cerrarSesion).toHaveBeenCalledWith('tok-a');
    expect(d.liquidar).toHaveBeenCalledWith('r1', 'correcto'); // la contraseña era correcta: no suma al bloqueo
  });

  it('sin perfil se trata como inactiva', async () => {
    const d = deps({ perfil: vi.fn(async () => null) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'ok' }, '1.1.1.1', d)).status).toBe(403);
  });

  it('contraseña temporal vencida: 403 y sesión cerrada; vigente: entra', async () => {
    const vencida = deps({ perfil: vi.fn(async () => ({ activo: true, debe_cambiar_password: true, password_temporal_vence: '2026-11-25T17:59:59Z' })) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'ok' }, '1.1.1.1', vencida)).body).toEqual({ codigo: 'temporal_vencida' });
    expect(vencida.cerrarSesion).toHaveBeenCalled();
    const vigente = deps({ perfil: vi.fn(async () => ({ activo: true, debe_cambiar_password: true, password_temporal_vence: '2026-11-26T00:00:00Z' })) });
    expect((await procesarEntrada({ usuario: 'ana.l', password: 'ok' }, '1.1.1.1', vigente)).status).toBe(200);
  });

  it('datos mal formados: respuesta genérica sin tocar Auth ni contadores', async () => {
    const d = deps();
    for (const e of [{}, { usuario: 'Ana López', password: 'x' }, { usuario: 'ana.l', password: '' }, { usuario: 'a'.repeat(41), password: 'x' }]) {
      expect(await procesarEntrada(e, '1.1.1.1', d)).toEqual({ status: 401, body: { codigo: 'incorrecta' } });
    }
    expect(d.autenticar).not.toHaveBeenCalled();
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('las respuestas no llevan datos innecesarios', async () => {
    const r = await procesarEntrada({ usuario: 'ana.l', password: 'mala' }, '1.1.1.1', deps({}, { tipo: 'credenciales' }));
    expect(Object.keys(r.body)).toEqual(['codigo']);
  });

  it('IP del cliente: se usa el último valor de X-Forwarded-For (el del proxy)', () => {
    expect(ipCliente('6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
    expect(ipCliente('203.0.113.9')).toBe('203.0.113.9');
    expect(ipCliente(null)).toBe('sin-ip');
    expect(ipCliente('<script>')).toBe('sin-ip');
  });
});
