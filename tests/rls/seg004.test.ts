// SEG-004 · admisión atómica de intentos de acceso (SQL), con datos ficticios en PGlite.
// Un intento fallido = reservar (Auth respondió credenciales incorrectas; no hay más llamadas).
// Un intento correcto = reservar + acceso_correcto. Error de infraestructura = reservar + liberar.
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
type Reserva = { permitido: boolean; hasta: string | null };
let b: Base;
beforeAll(async () => {
  b = await crearBase();
}, 60_000);

const reservar = (u: string, ip: string) =>
  b.comoServicio<{ r: Reserva }>(`select public.reservar_intento('${u}', '${ip}') as r`).then((x) => x[0].r);
const correcto = (u: string, ip: string) => b.comoServicio(`select public.acceso_correcto('${u}', '${ip}')`);
const liberar = (u: string, ip: string) => b.comoServicio(`select public.liberar_intento('${u}', '${ip}')`);
const bloqueado = (u: string, ip: string) => b.comoServicio<{ h: string | null }>(`select public.acceso_bloqueado('${u}', '${ip}') as h`).then((r) => r[0].h);
const contador = (clave: string) =>
  b.comoServicio<{ fallidos: number }>(`select fallidos from public.intentos_acceso where clave = '${clave}'`).then((r) => r[0]?.fallidos ?? 0);

describe('SEG-004 · limitación de intentos', () => {
  it('5 fallos del mismo usuario desde el mismo origen bloquean ese par; el 6.º no llega a Auth', async () => {
    for (let i = 0; i < 4; i++) expect(await reservar('ana.l', '10.0.0.1')).toEqual({ permitido: true, hasta: null });
    const quinto = await reservar('ana.l', '10.0.0.1');
    expect(quinto.permitido).toBe(true);
    expect(quinto.hasta).not.toBeNull(); // si falla, responde bloqueada
    const sexto = await reservar('ana.l', '10.0.0.1');
    expect(sexto.permitido).toBe(false);
    expect(await contador('ui:ana.l|10.0.0.1')).toBe(5); // rechazado sin contar
  });

  it('el mismo usuario con la contraseña correcta desde otro origen entra', async () => {
    const r = await reservar('ana.l', '10.0.0.2');
    expect(r.permitido).toBe(true);
    await correcto('ana.l', '10.0.0.2');
    expect(await contador('ui:ana.l|10.0.0.2')).toBe(0);
  });

  it('el quinto intento con contraseña correcta entra y limpia el contador de ese origen', async () => {
    for (let i = 0; i < 4; i++) await reservar('lu.v', '10.0.0.3');
    expect((await reservar('lu.v', '10.0.0.3')).permitido).toBe(true);
    await correcto('lu.v', '10.0.0.3');
    expect(await bloqueado('lu.v', '10.0.0.3')).toBeNull();
    expect(await contador('u:lu.v')).toBe(4); // la entrada correcta devolvió su reserva global
  });

  it('un origen que prueba muchas cuentas queda limitado (60, red escolar)', async () => {
    for (let i = 0; i < 59; i++) await reservar(`cuenta${i}`, '10.9.9.9');
    expect(await bloqueado('otra.x', '10.9.9.9')).toBeNull();
    await reservar('cuenta59', '10.9.9.9');
    expect((await reservar('otra.x', '10.9.9.9')).permitido).toBe(false);
  });

  it('sin IP verificada no hay un cupo común compartido', async () => {
    for (let i = 0; i < 70; i++) await reservar(`sinip${i}`, 'sin-ip');
    expect((await reservar('alguien.mas', 'sin-ip')).permitido).toBe(true);
    expect(await contador('ip:sin-ip')).toBe(0);
  });

  it('ataque distribuido: 30 fallos de un usuario desde muchos orígenes lo limitan', async () => {
    for (let i = 0; i < 30; i++) await reservar('marco.r', `172.16.0.${i}`);
    expect((await reservar('marco.r', '172.16.1.1')).permitido).toBe(false);
  });

  it('ráfaga concurrente: no se pierden incrementos ni se rebasa el límite', async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, () => reservar('rafaga.z', '192.168.5.5')));
    expect(rs.filter((r) => r.permitido)).toHaveLength(5);
    expect(await contador('ui:rafaga.z|192.168.5.5')).toBe(5);
    await Promise.all(Array.from({ length: 20 }, (_, i) => reservar(`conc${i}`, '192.168.6.6')));
    expect(await contador('ip:192.168.6.6')).toBe(20);
  });

  it('un error de infraestructura devuelve la reserva', async () => {
    for (let i = 0; i < 3; i++) await reservar('sofi.m', '10.2.2.2');
    await liberar('sofi.m', '10.2.2.2');
    expect(await contador('ui:sofi.m|10.2.2.2')).toBe(2);
    expect(await contador('ip:10.2.2.2')).toBe(2);
    expect(await contador('u:sofi.m')).toBe(2);
  });

  it('la ventana expira y el contador vuelve a empezar', async () => {
    for (let i = 0; i < 4; i++) await reservar('diego.p', '10.1.1.1');
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes' where clave like '%diego.p%'`);
    expect(await reservar('diego.p', '10.1.1.1')).toEqual({ permitido: true, hasta: null }); // reinicia a 1, no a 5
    expect(await contador('ui:diego.p|10.1.1.1')).toBe(1);
  });

  it('un bloqueo vigente no se reinicia por ventana vieja hasta que vence', async () => {
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes' where clave = 'ui:ana.l|10.0.0.1'`);
    expect((await reservar('ana.l', '10.0.0.1')).permitido).toBe(false);
    await b.comoServicio(`update public.intentos_acceso set bloqueado_hasta = now() - interval '1 second' where clave = 'ui:ana.l|10.0.0.1'`);
    expect((await reservar('ana.l', '10.0.0.1')).permitido).toBe(true);
  });

  it('el reinicio de contraseña quita los bloqueos del usuario en todos los orígenes', async () => {
    expect((await b.comoServicio<{ usuario: string }>(`select usuario from public.usuarios_bloqueados()`)).map((r) => r.usuario)).toContain('marco.r');
    await b.comoServicio(`select public.desbloquear_usuario('marco.r')`);
    expect(await bloqueado('marco.r', '172.16.1.1')).toBeNull();
    expect((await reservar('marco.r', '172.16.1.1')).permitido).toBe(true);
  });

  it('ni alumnos ni anónimos pueden usar ni leer los contadores', async () => {
    expect(await b.falla(U.ana, `select public.reservar_intento('x', 'y')`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `select public.liberar_intento('x', 'y')`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select public.desbloquear_usuario('ana.l')`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `select * from public.intentos_acceso`)).toMatch(/permission denied/);
  });
});
