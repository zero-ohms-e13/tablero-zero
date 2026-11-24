import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { Battery } from './Battery';
import { Chip, ChipFecha } from './ui';
import { fechaCorta } from '../lib/fechas';
import { ROBOT_NOMBRE, type Area, type Meta, type Tarea } from '../lib/tipos';

/** Nombre corto de la herramienta a partir del enlace: "Abrir GitHub". */
export function nombreHerramienta(url: string | null) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const conocidas: Record<string, string> = {
      'github.com': 'GitHub', 'canva.com': 'Canva', 'onshape.com': 'Onshape', 'cad.onshape.com': 'Onshape',
      'docs.google.com': 'Docs', 'drive.google.com': 'Drive', 'codevex.com': 'VEXcode',
    };
    return conocidas[h] ?? h.split('.')[0].replace(/^./, (c) => c.toUpperCase());
  } catch {
    return 'enlace';
  }
}

export function BarraPasos({ hechos, total }: { hechos: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={`${hechos} de ${total} pasos hechos`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-2 flex-1 rounded" style={{ background: i < hechos ? '#9A590C' : '#EFE2C8' }} />
      ))}
      <span className="ml-1 font-mono text-xs text-tinta-3">{hechos}/{total}</span>
    </div>
  );
}

export function TaskCard({ tarea, area, onRevision, onAyuda, ocupado }: {
  tarea: Tarea; area?: Area; onRevision?: () => void; onAyuda?: () => void; ocupado?: boolean;
}) {
  const hechos = tarea.tarea_pasos.filter((p) => p.hecho).length;
  const herramienta = nombreHerramienta(tarea.herramienta_url);
  const enRevision = tarea.estado === 'en_revision';
  const hecha = tarea.estado === 'hecha';
  return (
    <article className={`flex flex-col gap-3 rounded-tarjeta border bg-white p-3.5 ${tarea.pide_ayuda && !hecha ? 'border-2 border-ambar' : 'border-linea'}`}>
      <div className="flex gap-3">
        <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px]" style={{ background: area?.color_claro ?? '#F3E2C1', color: area?.color ?? '#590202' }}>
          <Icon name={area?.icono ?? 'engrane'} size={28} stroke={2.2} />
        </div>
        <div className="flex min-w-0 flex-grow flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-tinta-3">{ROBOT_NOMBRE[tarea.robot]}</span>
            <ChipFecha fecha={tarea.fecha_limite} hecha={hecha} />
          </div>
          <h3 className="m-0 font-titulo text-[17px] font-semibold leading-[1.2]">
            <Link to={`/tarea/${tarea.id}`} className="text-tinta no-underline hover:underline">{tarea.titulo}</Link>
          </h3>
        </div>
      </div>
      {tarea.para_que_sirve && (
        <p className="m-0 rounded-[10px] bg-fondo px-2.5 py-2 text-[13px] leading-[1.45] text-tinta-2">
          <strong className="text-vino">Para qué sirve:</strong> {tarea.para_que_sirve}
        </p>
      )}
      <BarraPasos hechos={hechos} total={tarea.tarea_pasos.length} />
      {tarea.pide_ayuda && !hecha && (
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-urgente"><Icon name="ayuda" size={16} /> Pediste ayuda a tu líder</span>
      )}
      {(onRevision || herramienta || onAyuda) && !hecha && (
        <div className="flex gap-2">
          {enRevision ? (
            <span className="flex h-11 flex-grow items-center justify-center rounded-campo bg-crema text-sm font-semibold text-vino">En revisión</span>
          ) : (
            onRevision && (
              <button onClick={onRevision} disabled={ocupado} className="h-11 flex-grow rounded-campo border-0 bg-vino text-sm font-semibold text-crema disabled:opacity-60">
                Mandar a revisión
              </button>
            )
          )}
          {herramienta && (
            <a href={tarea.herramienta_url!} target="_blank" rel="noreferrer" className="flex h-11 items-center rounded-campo border border-linea-campo px-3 text-[13px] no-underline">
              Abrir {herramienta}
            </a>
          )}
          {onAyuda && <button aria-label={tarea.pide_ayuda ? 'Ya pediste ayuda' : 'Pedir ayuda'} onClick={onAyuda} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-campo border ${tarea.pide_ayuda ? 'border-ambar bg-ambar/20' : 'border-linea-campo bg-white'} text-vino`}><Icon name="ayuda" /></button>}
        </div>
      )}
    </article>
  );
}

export function MetaCard({ meta, hechas, total, mias, area }: { meta: Meta; hechas: number; total: number; mias?: number; area?: Area }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-tarjeta border border-linea bg-white p-3.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-mono text-tinta-3">{ROBOT_NOMBRE[meta.robot]}{meta.fecha ? ` · ${fechaCorta(meta.fecha + 'T18:00:00Z')}` : ''}</span>
        {mias !== undefined && mias > 0 && (
          <span className="rounded-full px-[9px] py-[3px] font-semibold" style={{ background: area?.color_claro ?? '#F3E2C1', color: area?.color ?? '#590202' }}>
            {mias === 1 ? '1 tarea tuya' : `${mias} tareas tuyas`}
          </span>
        )}
      </div>
      <strong className="font-titulo text-[17px] font-semibold leading-[1.25]">{meta.titulo}</strong>
      <Battery done={hechas} total={total} size="md" />
      <span className="text-xs text-tinta-2">{hechas} de {total} tareas del equipo listas</span>
    </div>
  );
}

export { Chip };
