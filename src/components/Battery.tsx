// Pieza principal: la batería. Cada segmento es una tarea.
// variant "oscura" va sobre vino (borde crema, lleno ámbar); "clara" sobre fondo claro (borde vino, lleno cobre).
import { Icon } from './Icon';

type Props = {
  done: number;
  total: number;
  size?: 'xl' | 'lg' | 'md' | 'sm';
  variant?: 'oscura' | 'clara';
  /** Muestra el rayo ámbar en el siguiente segmento (vista del integrante). */
  cargando?: boolean;
  label?: string;
  className?: string;
};

const MEDIDAS = {
  xl: { h: 78, borde: 3, pad: 6, gap: 6, radio: 16, seg: 9, poloW: 9, poloH: 28, rayo: 26 },
  lg: { h: 44, borde: 3, pad: 4, gap: 4, radio: 10, seg: 4, poloW: 6, poloH: 16, rayo: 18 },
  md: { h: 22, borde: 2, pad: 2, gap: 2, radio: 6, seg: 3, poloW: 4, poloH: 9, rayo: 0 },
  sm: { h: 14, borde: 2, pad: 2, gap: 2, radio: 4, seg: 2, poloW: 3, poloH: 6, rayo: 0 },
};

/** Batería de avance en porcentaje (área o equipo), sobre vino. */
export function BateriaPorcentaje({ hechas, total, alto = 64, etiqueta }: { hechas: number; total: number; alto?: number; etiqueta?: string }) {
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  return (
    <div role="img" aria-label={`${etiqueta ?? 'Avance'}: ${pct} por ciento`} className="flex items-center">
      <div className="relative box-border flex-grow rounded-[14px] border-[3px] border-crema p-1.5" style={{ height: alto }}>
        <div className="seg h-full rounded-lg bg-ambar" style={{ width: `${pct}%` }} />
        <span className={`absolute right-3.5 top-1/2 -translate-y-1/2 font-titulo text-[22px] font-bold ${pct > 82 ? 'text-vino-oscuro' : 'text-crema'}`}>{pct}%</span>
      </div>
      <div className="h-6 w-[9px] rounded-r-[5px] bg-crema" />
    </div>
  );
}

export function Battery({ done, total, size = 'md', variant = 'clara', cargando = false, label, className }: Props) {
  const m = MEDIDAS[size];
  const oscura = variant === 'oscura';
  const borde = oscura ? '#F3E2C1' : '#590202';
  const lleno = oscura ? '#E9A84F' : '#9A590C';
  const vacio = oscura ? 'rgba(243,226,193,.14)' : '#EFE2C8';
  const n = Math.max(total, 1);
  const hechos = Math.min(done, total);
  const texto = label ?? (total === 0 ? 'Sin tareas' : `${hechos} de ${total} tareas listas`);

  return (
    <div role="img" aria-label={texto} className={`flex items-center ${className ?? ''}`}>
      <div
        className="box-border flex flex-grow"
        style={{
          height: m.h,
          border: `${m.borde}px ${total === 0 ? 'dashed' : 'solid'} ${borde}`,
          borderRadius: m.radio,
          padding: m.pad,
          gap: m.gap,
        }}
      >
        {total > 0 &&
          Array.from({ length: n }, (_, i) => (
            <span
              key={i}
              className={`seg flex flex-1 items-center justify-center`}
              style={{ borderRadius: m.seg, background: i < hechos ? lleno : vacio, animationDelay: `${i * 60}ms` }}
            >
              {cargando && m.rayo > 0 && i === hechos && (
                <span className="rayo text-ambar">
                  <Icon name="rayo" size={m.rayo} fill="#E9A84F" />
                </span>
              )}
            </span>
          ))}
      </div>
      <div style={{ width: m.poloW, height: m.poloH, background: borde, borderRadius: `0 ${m.poloW / 2 + 1}px ${m.poloW / 2 + 1}px 0` }} />
    </div>
  );
}
