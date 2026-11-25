// SEG-003 · partes deterministas del aislamiento de caché por usuario (Node + localStorage simulado).
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

class Almacen {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const ls = new Almacen();
(globalThis as unknown as { window: unknown }).window = { localStorage: ls };

const { activarCacheDe, cerrarCache, limpiarCopias, PREFIJO } = await import('../../src/lib/cache-privada');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

let qc: QueryClient;
beforeEach(async () => {
  if (qc) await cerrarCache(qc);
  ls.clear();
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: 60_000, retry: false } } });
});

describe('SEG-003 · caché aislada por usuario', () => {
  it('guarda la copia con la clave del usuario y la borra al cerrar sesión', async () => {
    await activarCacheDe(qc, 'A');
    qc.setQueryData(['tareas'], 'tareas-de-A');
    await espera(400);
    expect(ls.getItem(PREFIJO + 'A')).toContain('tareas-de-A');
    await cerrarCache(qc);
    expect(ls.getItem(PREFIJO + 'A')).toBeNull();
    expect(qc.getQueryData(['tareas'])).toBeUndefined();
  });

  it('cambio de A a B: B no ve nada de A y la copia de A desaparece', async () => {
    await activarCacheDe(qc, 'A');
    qc.setQueryData(['tareas'], 'tareas-de-A');
    await espera(400);
    await activarCacheDe(qc, 'B');
    expect(qc.getQueryData(['tareas'])).toBeUndefined();
    expect(ls.getItem(PREFIJO + 'A')).toBeNull();
    qc.setQueryData(['tareas'], 'tareas-de-B');
    await espera(400);
    expect(ls.getItem(PREFIJO + 'B')).toContain('tareas-de-B');
    expect(ls.getItem(PREFIJO + 'B')).not.toContain('tareas-de-A');
  });

  it('una respuesta tardía de A no repuebla el estado tras cambiar a B', async () => {
    await activarCacheDe(qc, 'A');
    const lenta = qc.fetchQuery({ queryKey: ['avisos'], queryFn: async () => { await espera(300); return 'avisos-de-A'; } }).catch(() => 'cancelada');
    await espera(50);
    await activarCacheDe(qc, 'B');
    await lenta;
    await espera(400);
    expect(qc.getQueryData(['avisos'])).toBeUndefined();
    expect(ls.getItem(PREFIJO + 'B') ?? '').not.toContain('avisos-de-A');
  });

  it('no se hidrata la copia de otro usuario: al entrar B se borra la de A', async () => {
    ls.setItem(PREFIJO + 'A', JSON.stringify({ buster: 'v2', timestamp: Date.now(), clientState: { queries: [], mutations: [] } }));
    await activarCacheDe(qc, 'B');
    expect(ls.getItem(PREFIJO + 'A')).toBeNull();
  });

  it('la recarga del mismo usuario restaura sus datos', async () => {
    await activarCacheDe(qc, 'A');
    qc.setQueryData(['tareas'], 'tareas-de-A');
    await espera(400);
    const copia = ls.getItem(PREFIJO + 'A');
    // "recarga": nuevo cliente, misma copia guardada
    const qc2 = new QueryClient();
    await cerrarCache(qc); // detiene el guardado del cliente anterior (borra la copia: la reponemos)
    ls.setItem(PREFIJO + 'A', copia!);
    await activarCacheDe(qc2, 'A');
    expect(qc2.getQueryData(['tareas'])).toBe('tareas-de-A');
    await cerrarCache(qc2);
  });

  it('borra las claves de versiones anteriores (tz.cache, tz.cache.dueno)', () => {
    ls.setItem('tz.cache', '{"datos":"viejos"}');
    ls.setItem('tz.cache.dueno', 'A');
    ls.setItem('tz.prefs', '{}');
    limpiarCopias();
    expect(ls.getItem('tz.cache')).toBeNull();
    expect(ls.getItem('tz.cache.dueno')).toBeNull();
    expect(ls.getItem('tz.prefs')).toBe('{}'); // preferencias del dispositivo se quedan
  });
});
