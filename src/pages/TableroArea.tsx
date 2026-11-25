// Kanban por área (coach y líder), con arrastrar y soltar (dnd-kit; también con teclado).
// Reglas: soltar en "Hecho" = aprobar; sacar de "En revisión" hacia atrás = regresar con nota.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, defaultDropAnimationSideEffects, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent, type Announcements, type DropAnimation,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { Battery } from '../components/Battery';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Avatar, Cargando, HeaderVino, useToast } from '../components/ui';
import { RegresarConNota } from './Revisar';
import { useAprobar, useAreas, useMembresias, useMoverEstado, usePerfiles, useRegresar, useTareas } from '../lib/datos';
import { chipFecha } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { ETIQUETA_ESTADO, type Estado, type Perfil, type Robot, type Tarea } from '../lib/tipos';

const COLUMNAS: Estado[] = ['por_hacer', 'en_proceso', 'en_revision', 'hecha'];

// Al soltar, la tarjeta flotante viaja a su lugar y se desvanece (sin salto).
const animacionSoltar: DropAnimation = {
  duration: 260,
  easing: 'cubic-bezier(.22, 1, .36, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.35' } } }),
};
const sinMovimiento = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function TableroArea({ modo }: { modo: 'coach' | 'lider' }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { esCoach, areasLider } = useSesion();
  const { data: areas = [] } = useAreas();
  const { data: perfiles = [] } = usePerfiles();
  const { data: membresias = [] } = useMembresias();
  const tareasQ = useTareas();
  const qc = useQueryClient();
  const mover = useMoverEstado();
  const aprobar = useAprobar();
  const regresar = useRegresar();
  const toast = useToast();
  const [robot, setRobot] = useState<Robot | 'todos'>('todos');
  const [quien, setQuien] = useState('todos');
  const [regresando, setRegresando] = useState<{ tarea: Tarea; destino: Estado } | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [recienMovida, setRecienMovida] = useState<string | null>(null);
  const [columnaVisible, setColumnaVisible] = useState<Estado>('por_hacer');
  const carril = useRef<HTMLDivElement>(null);

  const permitidas = modo === 'coach' ? areas.map((a) => a.id) : areasLider;
  const areaId = id && permitidas.includes(id) ? id : permitidas[0];
  const area = areas.find((a) => a.id === areaId);

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const delArea = useMemo(() => (tareasQ.data ?? []).filter((t) => t.area_id === areaId), [tareasQ.data, areaId]);
  const visibles = delArea
    .filter((t) => robot === 'todos' || t.robot === robot || t.robot === 'Ambos')
    .filter((t) => quien === 'todos' || t.tarea_responsables.some((r) => r.usuario_id === quien));
  const equipo = perfiles.filter((p) => membresias.some((m) => m.area_id === areaId && m.usuario_id === p.id));
  const lideres = equipo.filter((p) => membresias.some((m) => m.area_id === areaId && m.usuario_id === p.id && m.es_lider));
  const hechas = delArea.filter((t) => t.estado === 'hecha').length;
  const persona = (uid: string) => perfiles.find((p) => p.id === uid);
  const responsablesDe = (t: Tarea) => t.tarea_responsables.map((r) => persona(r.usuario_id)).filter(Boolean) as Perfil[];
  const tareaArrastrada = arrastrando ? delArea.find((t) => t.id === arrastrando) : undefined;

  // En celular las columnas se deslizan de lado: el indicador sigue a la columna que está a la vista.
  useEffect(() => {
    const el = carril.current;
    if (!el) return;
    let cuadro = 0;
    const medir = () => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        const cols = [...el.querySelectorAll<HTMLElement>('[data-columna]')];
        const centro = el.scrollLeft + el.clientWidth / 2;
        const cerca = cols.reduce((m, c) => (Math.abs(c.offsetLeft + c.offsetWidth / 2 - centro) < Math.abs(m.offsetLeft + m.offsetWidth / 2 - centro) ? c : m), cols[0]);
        const id = cerca?.dataset.columna as Estado | undefined;
        if (id) setColumnaVisible(id);
      });
    };
    el.addEventListener('scroll', medir, { passive: true });
    return () => {
      el.removeEventListener('scroll', medir);
      cancelAnimationFrame(cuadro);
    };
  }, [tareasQ.isLoading, areaId]);

  // La tarjeta recién soltada "aterriza" con un pequeño rebote.
  useEffect(() => {
    if (!recienMovida) return;
    const t = setTimeout(() => setRecienMovida(null), 400);
    return () => clearTimeout(t);
  }, [recienMovida]);

  if (modo === 'coach' && !esCoach) return <Navigate to="/" replace />;
  if (modo === 'lider' && areasLider.length === 0) return <Navigate to="/area" replace />;

  function local(tid: string, estado: Estado) {
    qc.setQueryData(['tareas'], (old: Tarea[] | undefined) => old?.map((t) => (t.id === tid ? { ...t, estado } : t)));
  }

  function tomar(e: DragStartEvent) {
    setArrastrando(String(e.active.id));
    try {
      navigator.vibrate?.(12); // en Android se siente que la tarjeta "se despega"
    } catch {
      /* sin vibración */
    }
  }

  function irAColumna(c: Estado) {
    const el = carril.current;
    const col = el?.querySelector<HTMLElement>(`[data-columna="${c}"]`);
    if (!el || !col) return;
    setColumnaVisible(c);
    // Solo se mueve el carril (no la página) para que el indicador no brinque de lugar.
    el.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft), behavior: sinMovimiento() ? 'auto' : 'smooth' });
  }

  async function soltar(e: DragEndEvent) {
    setArrastrando(null);
    const t = delArea.find((x) => x.id === e.active.id);
    const destino = e.over?.id as Estado | undefined;
    if (!t || !destino || destino === t.estado) return;
    setRecienMovida(t.id);
    if (t.estado === 'en_revision' && (destino === 'en_proceso' || destino === 'por_hacer')) {
      setRegresando({ tarea: t, destino });
      return;
    }
    const antes = t.estado;
    local(t.id, destino);
    try {
      if (destino === 'hecha') {
        await aprobar.mutateAsync(t.id);
        toast({ titulo: 'Tarea aprobada.', texto: 'Se sumó a la batería del equipo.', deshacer: () => mover.mutate({ id: t.id, estado: antes }) });
      } else {
        await mover.mutateAsync({ id: t.id, estado: destino });
      }
    } catch (err) {
      local(t.id, antes);
      toast({ tipo: 'error', titulo: 'No se movió.', texto: (err as Error).message });
    }
  }

  const nombreEstado = (id: unknown) => ETIQUETA_ESTADO[id as Estado] ?? '';
  const titulo = (id: unknown) => delArea.find((t) => t.id === id)?.titulo ?? 'la tarea';
  const anuncios: Announcements = {
    onDragStart: ({ active }) => `Tomaste ${titulo(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${titulo(active.id)} está sobre ${nombreEstado(over.id)}.` : `${titulo(active.id)} no está sobre una columna.`),
    onDragEnd: ({ active, over }) => (over ? `Soltaste ${titulo(active.id)} en ${nombreEstado(over.id)}.` : 'Cancelado.'),
    onDragCancel: ({ active }) => `Se canceló mover ${titulo(active.id)}.`,
  };

  const contenido = tareasQ.isLoading ? <Cargando /> : (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] tracking-[.06em] text-tinta-3 md:text-xs">
            {lideres.length ? `${lideres.length > 1 ? 'LÍDERES' : 'LÍDER'}: ${lideres.map((l) => l.nombre_visible.split(' ')[0].toUpperCase()).join(' Y ')} · ` : ''}{equipo.length} INTEGRANTES
          </span>
          <h1 className="m-0 font-titulo text-[24px] font-bold leading-[1.15] text-vino md:text-[30px]">Tablero de {area?.nombre}</h1>
        </div>
        <Link
          to={`/tarea/nueva?area=${areaId}`}
          aria-label="Nueva tarea"
          className="flex h-11 shrink-0 items-center gap-2 rounded-campo bg-vino px-3.5 text-[15px] font-semibold text-crema no-underline transition-transform duration-150 hover:text-crema active:scale-95 md:h-12 md:px-[18px]"
        >
          <Icon name="mas" size={18} /> <span className="hidden sm:inline">Nueva tarea</span><span className="sm:hidden">Nueva</span>
        </Link>
      </div>

      {permitidas.length > 1 && (
        <div role="tablist" aria-label="Área" className="sin-barra -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {areas.filter((a) => permitidas.includes(a.id)).map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === areaId}
              onClick={() => nav(modo === 'coach' ? `/coach/area/${a.id}` : `/area/tablero/${a.id}`, { replace: true })}
              className={`flex h-11 shrink-0 snap-start items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors duration-200 active:scale-[.97] ${a.id === areaId ? 'border border-vino bg-vino text-crema' : 'border border-linea-campo bg-white'}`}
              style={a.id === areaId ? undefined : { color: a.color }}
            >
              <Icon name={a.icono} size={18} /> {a.nombre}
            </button>
          ))}
        </div>
      )}

      <section className="flex min-w-0 flex-col gap-3 md:rounded-[20px] md:border md:border-linea md:bg-white md:px-5 md:py-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="hidden text-[13px] text-tinta-2 md:inline">Robot</span>
          <div role="group" aria-label="Robot" className="flex h-11 items-center rounded-full border border-linea-campo bg-white p-1">
            {(['todos', 'VEX', 'FTC'] as const).map((r) => (
              <button
                key={r}
                aria-pressed={robot === r}
                onClick={() => setRobot(r)}
                className={`h-full rounded-full px-3 text-[13px] transition-colors duration-200 ${robot === r ? 'bg-tinta font-semibold text-white' : 'bg-transparent text-tinta'}`}
              >
                {r === 'todos' ? 'Todos' : r}
              </button>
            ))}
          </div>
          <label htmlFor="kb-persona" className="sr-only text-[13px] text-tinta-2 md:not-sr-only md:ml-3">Persona</label>
          <select id="kb-persona" value={quien} onChange={(e) => setQuien(e.target.value)} className="h-11 min-w-0 flex-1 rounded-full border border-linea-campo bg-white px-3 text-base md:flex-none">
            <option value="todos">Todo el área</option>
            {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre_visible.split(' ')[0]}</option>)}
          </select>
          <span className="flex w-full items-center gap-2.5 text-[13px] md:ml-auto md:w-auto">
            <span className="whitespace-nowrap">Área al {delArea.length ? Math.round((hechas / delArea.length) * 100) : 0}%</span>
            <span className="flex-1 md:w-40 md:flex-none"><Battery done={hechas} total={delArea.length} size="sm" /></span>
          </span>
        </div>
        <p className="m-0 text-xs text-tinta-3">
          <span className="md:hidden">Mantén presionada una tarjeta para moverla. Desliza de lado para ver las columnas.</span>
          <span className="hidden md:inline">Arrastra las tarjetas entre columnas. Con teclado: Tab hasta la tarjeta, Espacio para tomarla, flechas y Espacio para soltar.</span>
        </p>

        {/* Celular: atajos a cada columna; el resaltado sigue a la que está a la vista */}
        <div className="grid grid-cols-4 gap-1 rounded-full bg-kanban p-1 md:hidden" aria-label="Columnas">
          {COLUMNAS.map((c) => (
            <button
              key={c}
              onClick={() => irAColumna(c)}
              aria-current={columnaVisible === c ? 'true' : undefined}
              className={`flex h-9 min-w-0 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-semibold transition-colors duration-200 ${columnaVisible === c ? 'bg-vino text-crema' : 'bg-transparent text-vino'}`}
            >
              <span className="truncate">{ETIQUETA_ESTADO[c]}</span>
              <span className="opacity-80">{visibles.filter((t) => t.estado === c).length}</span>
            </button>
          ))}
        </div>

        <DndContext sensors={sensores} onDragStart={tomar} onDragEnd={soltar} onDragCancel={() => setArrastrando(null)} accessibility={{ announcements: anuncios }}>
          <div
            ref={carril}
            className={`sin-barra relative -mx-4 scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0 ${arrastrando ? '' : 'snap-x snap-mandatory'} md:snap-none`}
          >
            <div className="grid auto-cols-[84%] grid-flow-col gap-3 sm:auto-cols-[46%] md:auto-cols-auto md:grid-flow-row md:grid-cols-[repeat(4,minmax(240px,1fr))] md:gap-3.5">
              {COLUMNAS.map((c) => (
                <Columna key={c} id={c} titulo={ETIQUETA_ESTADO[c]} n={visibles.filter((t) => t.estado === c).length} pie={c === 'por_hacer' && (
                  <Link to={`/tarea/nueva?area=${areaId}`} className="flex h-11 items-center justify-center rounded-campo border-2 border-dashed border-[#A88F6A] text-sm font-semibold no-underline transition-colors duration-200 hover:bg-white/60">+ Agregar tarea</Link>
                )}>
                  {visibles.filter((t) => t.estado === c).map((t) => (
                    <Tarjeta key={t.id} tarea={t} responsables={responsablesDe(t)} aterriza={recienMovida === t.id} />
                  ))}
                </Columna>
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={sinMovimiento() ? null : animacionSoltar}>
            {tareaArrastrada ? <Tarjeta tarea={tareaArrastrada} responsables={responsablesDe(tareaArrastrada)} flotante /> : null}
          </DragOverlay>
        </DndContext>
      </section>
      <RegresarConNota
        abierto={!!regresando}
        nombre={regresando ? regresando.tarea.tarea_responsables.map((r) => persona(r.usuario_id)?.nombre_visible.split(' ')[0]).filter(Boolean).join(' y ') : ''}
        onCerrar={() => setRegresando(null)}
        onEnviar={async (nota) => {
          await regresar.mutateAsync({ id: regresando!.tarea.id, nota });
          if (regresando!.destino === 'por_hacer') await mover.mutateAsync({ id: regresando!.tarea.id, estado: 'por_hacer' });
          setRegresando(null);
          toast({ titulo: 'Regresada con nota.' });
        }}
      />
    </>
  );

  if (modo === 'coach') return <LayoutCoach>{contenido}</LayoutCoach>;
  return (
    <div className="min-h-screen bg-fondo">
      <HeaderVino titulo="Tablero del área" subtitulo="Arrastra las tarjetas entre columnas" atras="/area" />
      <main className="mx-auto flex max-w-[1400px] flex-col gap-[22px] px-4 py-5 md:px-8">{contenido}</main>
    </div>
  );
}

function Columna({ id, titulo, n, children, pie }: { id: Estado; titulo: string; n: number; children: ReactNode; pie?: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-columna={id}
      role="list"
      aria-label={`${titulo}, ${n} tareas`}
      className={`flex min-h-[300px] snap-start flex-col gap-2.5 rounded-2xl p-3 transition-[background-color,box-shadow,transform] duration-200 ease-out md:min-h-[420px] ${isOver ? 'scale-[1.01] bg-crema ring-[3px] ring-ambar' : 'bg-kanban'}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-vino">{titulo}</span>
        <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-vino">{n}</span>
      </div>
      {children}
      {n === 0 && !pie && <p className="m-0 rounded-campo border border-dashed border-linea-campo p-3 text-center text-xs text-tinta-3">Suelta aquí una tarjeta</p>}
      {pie}
    </div>
  );
}

function Tarjeta({ tarea, responsables, flotante = false, aterriza = false }: { tarea: Tarea; responsables: Perfil[]; flotante?: boolean; aterriza?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tarea.id, disabled: flotante });
  const hecha = tarea.estado === 'hecha';
  const ayuda = tarea.pide_ayuda && !hecha;
  const f = chipFecha(tarea.fecha_limite, hecha);
  const pasosHechos = tarea.tarea_pasos.filter((p) => p.hecho).length;
  const chip = f.tono === 'vencida' ? 'bg-vino text-crema' : f.tono === 'urgente' ? 'bg-urgente-fondo text-urgente' : 'bg-crema text-vino';
  // La original se queda como hueco tenue mientras la copia flotante (DragOverlay) sigue al dedo.
  const estado = flotante
    ? 'cursor-grabbing rotate-[1.5deg] scale-[1.03] shadow-[0_14px_30px_rgba(89,2,2,.22)]'
    : isDragging
      ? 'opacity-35'
      : 'cursor-grab shadow-none md:hover:-translate-y-0.5 md:hover:shadow-[0_6px_16px_rgba(89,2,2,.10)]';
  return (
    <article
      ref={flotante ? undefined : setNodeRef}
      {...(flotante ? {} : listeners)}
      {...(flotante ? {} : attributes)}
      aria-roledescription={flotante ? undefined : 'tarjeta movible'}
      aria-hidden={flotante || undefined}
      aria-label={flotante ? undefined : `${tarea.titulo}. ${ETIQUETA_ESTADO[tarea.estado]}${ayuda ? ', pidió ayuda' : ''}`}
      className={`flex touch-manipulation select-none flex-col gap-2 rounded-campo p-3 transition-[transform,box-shadow,opacity] duration-200 ease-out [-webkit-touch-callout:none] ${hecha ? 'bg-[#F0D3AE]' : 'bg-white'} ${ayuda ? 'border-2 border-ambar' : 'border border-linea'} ${estado} ${aterriza ? 'aterriza' : ''}`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="font-mono text-[11px] text-tinta-3">{tarea.robot}</span>
        {tarea.fecha_limite && <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${chip}`}>{f.texto}</span>}
      </div>
      {flotante ? (
        <span className="font-titulo text-[15px] font-semibold leading-[1.25] text-tinta">{tarea.titulo}</span>
      ) : (
        <Link to={`/tarea/${tarea.id}`} onPointerDown={(e) => e.stopPropagation()} className="font-titulo text-[15px] font-semibold leading-[1.25] text-tinta no-underline hover:underline">{tarea.titulo}</Link>
      )}
      {tarea.tarea_pasos.length > 0 && (
        <div className="flex gap-[3px]" aria-label={`${pasosHechos} de ${tarea.tarea_pasos.length} pasos`}>
          {tarea.tarea_pasos.map((p, i) => <span key={p.id} className="h-1.5 flex-1 rounded-[3px]" style={{ background: i < pasosHechos ? '#9A590C' : '#EFE2C8' }} />)}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        {responsables.slice(0, 3).map((p) => <Avatar key={p.id} iniciales={p.iniciales} color={p.color} size={26} />)}
        <span className={ayuda ? 'font-semibold text-urgente' : ''}>
          {responsables.map((p) => p.nombre_visible.split(' ')[0]).join(', ') || 'Sin asignar'}{ayuda ? ' · pidió ayuda' : ''}
        </span>
      </div>
    </article>
  );
}
