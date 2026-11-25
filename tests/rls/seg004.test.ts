// SEG-004 · contadores de intentos de acceso (SQL), con datos ficticios en PGlite.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
let b: Base;
beforeAll(async () => {
  b = await crearBase();
}, 60_000);

const fallo = (u: string, ip: string) => b.comoServicio<{ h: string | null }>(`select public.registrar_fallo_acceso('${u}', '${ip}') as h`).then((r) => r[0].h);
const bloqueado = (u: string, ip: string) => b.comoServicio<{ h: string | null }>(`select public.acceso_bloqueado('${u}', '${ip}') as h`).then((r) => r[0].h);

describe('SEG-004 · limitación de intentos', () => {
  it('5 fallos del mismo usuario desde el mismo origen bloquean ese par', async () => {
    for (let i = 0; i < 4; i++) expect(await fallo('ana.l', '10.0.0.1')).toBeNull();
    expect(await fallo('ana.l', '10.0.0.1')).not.toBeNull();
    expect(await bloqueado('ana.l', '10.0.0.1')).not.toBeNull();
  });

  it('el mismo usuario desde otro origen sigue pudiendo entrar', async () => {
    expect(await bloqueado('ana.l', '10.0.0.2')).toBeNull();
  });

  it('una entrada correcta limpia el contador de ese origen', async () => {
    await b.comoServicio(`select public.acceso_correcto('ana.l', '10.0.0.1')`);
    expect(await bloqueado('ana.l', '10.0.0.1')).toBeNull();
  });

  it('un origen que prueba muchas cuentas queda limitado', async () => {
    for (let i = 0; i < 29; i++) await fallo(`cuenta${i}`, '10.9.9.9');
    expect(await bloqueado('otra.x', '10.9.9.9')).toBeNull();
    await fallo('cuenta29', '10.9.9.9');
    expect(await bloqueado('otra.x', '10.9.9.9')).not.toBeNull();
  });

  it('ataque distribuido: 30 fallos de un usuario desde muchos orígenes lo limitan', async () => {
    for (let i = 0; i < 30; i++) await fallo('marco.r', `172.16.0.${i}`);
    expect(await bloqueado('marco.r', '172.16.1.1')).not.toBeNull();
  });

  it('concurrencia: no se pierden incrementos', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => fallo(`conc${i}`, '192.168.5.5')));
    const [r] = await b.comoServicio<{ fallidos: number }>(`select fallidos from public.intentos_acceso where clave = 'ip:192.168.5.5'`);
    expect(r.fallidos).toBe(20);
  });

  it('la ventana expira y el contador vuelve a empezar', async () => {
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes', bloqueado_hasta = now() - interval '1 second' where clave like '%diego.p%'`);
    for (let i = 0; i < 4; i++) await fallo('diego.p', '10.1.1.1');
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes', bloqueado_hasta = null where clave like '%diego.p%'`);
    expect(await fallo('diego.p', '10.1.1.1')).toBeNull(); // reinicia a 1, no a 5
    const [r] = await b.comoServicio<{ fallidos: number }>(`select fallidos from public.intentos_acceso where clave = 'ui:diego.p|10.1.1.1'`);
    expect(r.fallidos).toBe(1);
  });

  it('el reinicio de contraseña quita los bloqueos del usuario en todos los orígenes', async () => {
    expect((await b.comoServicio<{ usuario: string }>(`select usuario from public.usuarios_bloqueados()`)).map((r) => r.usuario)).toContain('marco.r');
    await b.comoServicio(`select public.desbloquear_usuario('marco.r')`);
    expect(await bloqueado('marco.r', '172.16.1.1')).toBeNull();
  });

  it('ni alumnos ni anónimos pueden usar ni leer los contadores', async () => {
    expect(await b.falla(U.ana, `select public.registrar_fallo_acceso('x', 'y')`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select public.desbloquear_usuario('ana.l')`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `select * from public.intentos_acceso`)).toMatch(/permission denied/);
  });
});
