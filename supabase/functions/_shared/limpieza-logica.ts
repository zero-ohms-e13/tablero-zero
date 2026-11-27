// Limpieza de borradores abandonados y archivos huérfanos de Materiales (lógica pura, probada con Vitest).
// "simular" solo cuenta. "borrar" revalida cada caso en el momento: un borrador se borra solo si sigue
// siendo borrador y sigue inactivo, y un huérfano solo si sigue sin registrarse. El registro del borrador se
// borra ANTES que sus archivos: si quitar archivos falla, quedan como huérfanos y la siguiente corrida los quita.
export type Pendiente = { tipo: 'borrador' | 'huerfano'; material_id: string | null; rutas: string[]; bytes: number; actividad: string };
export type Deps = {
  porLimpiar: (dias: number) => Promise<Pendiente[]>;
  borrarBorrador: (material: string, dias: number) => Promise<boolean>;
  sigueHuerfano: (ruta: string) => Promise<boolean>;
  quitarArchivos: (rutas: string[]) => Promise<void>;
};
export type Informe = {
  modo: 'simular' | 'borrar';
  dias: number;
  borradores: number;
  huerfanos: number;
  archivos: number;
  bytes: number;
  /** solo en "borrar" */
  hecho?: { borradores: number; archivos: number; bytes: number; omitidos: number; errores: number };
  /** quedan más por limpiar que el máximo por corrida */
  quedan: boolean;
};

export const DIAS_MIN = 14;
export const DIAS_MAX = 365;
export const DIAS = 30; // decisión de Jaime

export async function limpiar(modo: 'simular' | 'borrar', dias: number, deps: Deps, maximo = 200): Promise<Informe> {
  const d = Math.min(DIAS_MAX, Math.max(DIAS_MIN, Math.round(dias) || DIAS));
  const todo = await deps.porLimpiar(d);
  const lote = todo.slice(0, maximo);
  const inf: Informe = {
    modo, dias: d,
    borradores: lote.filter((x) => x.tipo === 'borrador').length,
    huerfanos: lote.filter((x) => x.tipo === 'huerfano').length,
    archivos: lote.reduce((s, x) => s + x.rutas.length, 0),
    bytes: lote.reduce((s, x) => s + Number(x.bytes || 0), 0),
    quedan: todo.length > lote.length,
  };
  if (modo === 'simular') return inf;

  const hecho = { borradores: 0, archivos: 0, bytes: 0, omitidos: 0, errores: 0 };
  for (const x of lote) {
    try {
      if (x.tipo === 'borrador') {
        if (!x.material_id || !(await deps.borrarBorrador(x.material_id, d))) {
          hecho.omitidos++; // volvió a tener actividad o ya no es borrador
          continue;
        }
        hecho.borradores++;
        if (x.rutas.length) await deps.quitarArchivos(x.rutas);
        hecho.archivos += x.rutas.length;
        hecho.bytes += Number(x.bytes || 0);
      } else {
        const ruta = x.rutas[0];
        if (!ruta || !(await deps.sigueHuerfano(ruta))) {
          hecho.omitidos++;
          continue;
        }
        await deps.quitarArchivos([ruta]);
        hecho.archivos++;
        hecho.bytes += Number(x.bytes || 0);
      }
    } catch {
      hecho.errores++; // se reintenta en la siguiente corrida
    }
  }
  return { ...inf, hecho };
}
