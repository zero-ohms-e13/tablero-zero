// SEG-004 · admisión atómica con reservas identificadas y liquidación idempotente (SQL, PGlite, datos ficticios).
// Fallido = reservar + liquidar('fallo'); correcto = reservar + liquidar('correcto'); infraestructura = liquidar('infra').
import { beforeAll, describe, expect, it } from 'vitest';
import { crearBase, U } from './pglite';

type Base = Awaited<ReturnType<typeof crearBase>>;
type Reserva = { permitido: boolean; hasta: string | null; reserva: string | null };
let b: Base;
beforeAll(async () => {
  b = await crearBase();
}, 60_000);

const reservar = (u: string, ip: string) =>
  b.comoServicio<{ r: Reserva }>(`select public.reservar_intento('${u}', '${ip}') as r`).then((x) => x[0].r);
const liquidar = (r: Reserva, res: 'fallo' | 'correcto' | 'infra') =>
  b.comoServicio<{ ok: boolean }>(`select public.liquidar_intento('${r.reserva}', '${res}') as ok`).then((x) => x[0].ok);
const fallo = async (u: string, ip: string) => {
  const r = await reservar(u, ip);
  if (r.reserva) await liquidar(r, 'fallo');
  return r;
};
const contador = (clave: string) =>
  b.comoServicio<{ fallidos: number }>(`select fallidos from public.intentos_acceso where clave = '${clave}'`).then((r) => r[0]?.fallidos ?? 0);
const alertas = () => b.comoServicio<{ clave: string }>(`select clave from public.alertas_acceso()`).then((r) => r.map((x) => x.clave));

describe('SEG-004 · limitación de intentos', () => {
  it('5 fallos del mismo usuario desde el mismo origen bloquean ese par; el 6.º no llega a Auth', async () => {
    for (let i = 0; i < 4; i++) expect((await fallo('ana.l', '10.0.0.1')).hasta).toBeNull();
    const quinto = await fallo('ana.l', '10.0.0.1');
    expect(quinto.permitido).toBe(true);
    expect(quinto.hasta).not.toBeNull(); // responde bloqueada
    const sexto = await reservar('ana.l', '10.0.0.1');
    expect(sexto).toMatchObject({ permitido: false, reserva: null });
    expect(await contador('ui:ana.l|10.0.0.1')).toBe(5); // rechazado sin contar
  });

  it('el mismo usuario con la contraseña correcta desde otro origen entra', async () => {
    const r = await reservar('ana.l', '10.0.0.2');
    expect(r.permitido).toBe(true);
    expect(await liquidar(r, 'correcto')).toBe(true);
    expect(await contador('ui:ana.l|10.0.0.2')).toBe(0);
  });

  it('el quinto intento con contraseña correcta entra y limpia el par', async () => {
    for (let i = 0; i < 4; i++) await fallo('lu.v', '10.0.0.3');
    const r = await reservar('lu.v', '10.0.0.3');
    expect(r.permitido).toBe(true);
    await liquidar(r, 'correcto');
    expect((await reservar('lu.v', '10.0.0.3')).permitido).toBe(true);
    expect(await contador('u:lu.v')).toBe(5); // 4 fallos + la reserva recién hecha
  });

  it('muchas cuentas desde un origen: alerta, pero las credenciales válidas siguen entrando', async () => {
    for (let i = 0; i < 60; i++) await fallo(`cuenta${i}`, '10.9.9.9');
    expect(await alertas()).toContain('ip:10.9.9.9');
    const r = await reservar('otra.x', '10.9.9.9');
    expect(r.permitido).toBe(true);
  });

  it('ataque distribuido: 30+ fallos de un usuario desde muchos orígenes generan alerta sin negar a otro origen', async () => {
    for (let i = 0; i < 31; i++) await fallo('marco.r', `172.16.0.${i}`);
    expect(await alertas()).toContain('u:marco.r');
    expect((await reservar('marco.r', '172.16.1.1')).permitido).toBe(true);
  });

  it('sin IP verificada no hay cupo común ni bloqueo compartido', async () => {
    for (let i = 0; i < 10; i++) await fallo('pepe.k', 'sin-ip');
    expect((await reservar('pepe.k', 'sin-ip')).permitido).toBe(true);
    expect((await reservar('alguien.mas', 'sin-ip')).permitido).toBe(true);
    expect(await contador('ip:sin-ip')).toBe(0);
    expect(await contador('ui:pepe.k|sin-ip')).toBe(0);
  });

  it('ráfaga concurrente: exactamente 5 admitidas y sin incrementos perdidos', async () => {
    const rs = await Promise.all(Array.from({ length: 12 }, () => reservar('rafaga.z', '192.168.5.5')));
    expect(rs.filter((r) => r.permitido)).toHaveLength(5);
    expect(await contador('ui:rafaga.z|192.168.5.5')).toBe(5);
    await Promise.all(Array.from({ length: 20 }, (_, i) => reservar(`conc${i}`, '192.168.6.6')));
    expect(await contador('ip:192.168.6.6')).toBe(20);
  });

  it('error de infraestructura devuelve la reserva; liquidar dos veces no descuenta dos veces', async () => {
    for (let i = 0; i < 2; i++) await fallo('sofi.m', '10.2.2.2');
    const r = await reservar('sofi.m', '10.2.2.2');
    expect(await liquidar(r, 'infra')).toBe(true);
    expect(await liquidar(r, 'infra')).toBe(false); // idempotente
    expect(await liquidar(r, 'correcto')).toBe(false); // una reserva se liquida una sola vez
    expect(await contador('ui:sofi.m|10.2.2.2')).toBe(2);
    expect(await contador('ip:10.2.2.2')).toBe(2);
    expect(await contador('u:sofi.m')).toBe(2);
  });

  it('respuesta fuera de orden: una liquidación tardía tras reiniciar la ventana no toca la ventana nueva', async () => {
    const vieja = await reservar('tardio.q', '10.3.3.3');
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes' where clave like '%tardio.q%'`);
    await fallo('tardio.q', '10.3.3.3'); // abre ventana nueva con 1
    await fallo('tardio.q', '10.3.3.3'); // 2
    await liquidar(vieja, 'infra');
    expect(await contador('ui:tardio.q|10.3.3.3')).toBe(2);
  });

  it('una reserva vencida sin liquidar (respuesta de Auth perdida) devuelve su capacidad y se purga', async () => {
    await fallo('perdida.w', '10.4.4.4');
    const r = await reservar('perdida.w', '10.4.4.4');
    expect(await contador('ui:perdida.w|10.4.4.4')).toBe(2);
    await b.comoServicio(`update public.intentos_reservas set creada = now() - interval '6 minutes' where id = '${r.reserva}'`);
    await b.comoServicio(`select public.purgar_intentos()`);
    expect(await liquidar(r, 'infra')).toBe(false); // ya no existe
    expect(await contador('ui:perdida.w|10.4.4.4')).toBe(1); // solo queda el fallo real
  });

  it('la ventana expira y el contador vuelve a empezar; un bloqueo vigente se respeta hasta vencer', async () => {
    for (let i = 0; i < 4; i++) await fallo('diego.p', '10.1.1.1');
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes' where clave like '%diego.p%'`);
    expect((await fallo('diego.p', '10.1.1.1')).hasta).toBeNull();
    expect(await contador('ui:diego.p|10.1.1.1')).toBe(1);
    await b.comoServicio(`update public.intentos_acceso set ventana_inicio = now() - interval '16 minutes' where clave = 'ui:ana.l|10.0.0.1'`);
    expect((await reservar('ana.l', '10.0.0.1')).permitido).toBe(false);
    await b.comoServicio(`update public.intentos_acceso set bloqueado_hasta = now() - interval '1 second' where clave = 'ui:ana.l|10.0.0.1'`);
    expect((await reservar('ana.l', '10.0.0.1')).permitido).toBe(true);
  });

  it('el reinicio de contraseña quita bloqueos y alertas del usuario', async () => {
    for (let i = 0; i < 5; i++) await fallo('karla.t', '10.5.5.5');
    expect((await b.comoServicio<{ usuario: string }>(`select usuario from public.usuarios_bloqueados()`)).map((r) => r.usuario)).toContain('karla.t');
    await b.comoServicio(`select public.desbloquear_usuario('karla.t'); select public.desbloquear_usuario('marco.r');`);
    expect((await reservar('karla.t', '10.5.5.5')).permitido).toBe(true);
    expect(await alertas()).not.toContain('u:marco.r');
  });

  it('ni alumnos ni anónimos pueden usar ni leer los contadores', async () => {
    expect(await b.falla(U.ana, `select public.reservar_intento('x', 'y')`)).toMatch(/permission denied/);
    expect(await b.falla(U.ana, `select public.liquidar_intento(gen_random_uuid(), 'infra')`)).toMatch(/permission denied/);
    expect(await b.falla(null, `select public.desbloquear_usuario('ana.l')`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `select * from public.intentos_acceso`)).toMatch(/permission denied/);
    expect(await b.falla(U.coach, `select * from public.intentos_reservas`)).toMatch(/permission denied/);
  });
});
