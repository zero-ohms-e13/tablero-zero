// Limpieza de Materiales · lógica de la Edge Function con dependencias simuladas (sin red).
import { describe, expect, it } from 'vitest';
import { limpiar, type Deps, type Pendiente } from '../../supabase/functions/_shared/limpieza-logica';

const pendientes: Pendiente[] = [
  { tipo: 'borrador', material_id: 'm1', rutas: ['m1/a.jpg', 'm1/b.jpg'], bytes: 3000, actividad: '2026-10-01' },
  { tipo: 'borrador', material_id: 'm2', rutas: [], bytes: 0, actividad: '2026-10-02' },
  { tipo: 'huerfano', material_id: 'm3', rutas: ['m3/x.pdf'], bytes: 5000, actividad: '2026-10-03' },
];
function deps(o: { activo?: string[]; registrado?: string[]; fallaQuitar?: string } = {}) {
  const quitados: string[] = [];
  const borrados: string[] = [];
  const d: Deps = {
    porLimpiar: async () => structuredClone(pendientes),
    borrarBorrador: async (m) => {
      if (o.activo?.includes(m)) return false;
      borrados.push(m);
      return true;
    },
    sigueHuerfano: async (r) => !o.registrado?.includes(r),
    quitarArchivos: async (rutas) => {
      if (rutas.some((r) => r === o.fallaQuitar)) throw new Error('Storage caído (simulado)');
      quitados.push(...rutas);
    },
  };
  return { d, quitados, borrados };
}

describe('Limpieza de Materiales', () => {
  it('simular solo cuenta y no borra nada', async () => {
    const { d, quitados, borrados } = deps();
    const r = await limpiar('simular', 30, d);
    expect(r).toMatchObject({ modo: 'simular', dias: 30, borradores: 2, huerfanos: 1, archivos: 3, bytes: 8000, quedan: false });
    expect(r.hecho).toBeUndefined();
    expect([...quitados, ...borrados]).toEqual([]);
  });

  it('borrar quita registros y archivos; respeta lo que volvió a usarse o se registró', async () => {
    const { d, quitados, borrados } = deps({ activo: ['m2'], registrado: ['m3/x.pdf'] });
    const r = await limpiar('borrar', 30, d);
    expect(borrados).toEqual(['m1']);
    expect(quitados).toEqual(['m1/a.jpg', 'm1/b.jpg']);
    expect(r.hecho).toEqual({ borradores: 1, archivos: 2, bytes: 3000, omitidos: 2, errores: 0 });
  });

  it('si Storage falla, el error se cuenta y sigue con lo demás (se reintenta la próxima vez)', async () => {
    const { d, quitados } = deps({ fallaQuitar: 'm1/a.jpg' });
    const r = await limpiar('borrar', 30, d);
    expect(r.hecho).toMatchObject({ errores: 1, borradores: 2, archivos: 1 }); // m1 se borró pero sus archivos quedan como huérfanos
    expect(quitados).toEqual(['m3/x.pdf']);
  });

  it('los días quedan entre 14 y 365 y se limpia por tandas', async () => {
    const { d } = deps();
    expect((await limpiar('simular', 3, d)).dias).toBe(14);
    expect((await limpiar('simular', 9999, d)).dias).toBe(365);
    expect((await limpiar('simular', Number.NaN, d)).dias).toBe(30);
    const tanda = await limpiar('simular', 30, d, 2);
    expect(tanda).toMatchObject({ borradores: 2, huerfanos: 0, quedan: true });
  });
});
