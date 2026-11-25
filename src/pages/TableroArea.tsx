// Kanban por área (coach y líder), con arrastrar y soltar (dnd-kit; también con teclado).
// Reglas: soltar en "Hecho" = aprobar; sacar de "En revisión" hacia atrás = regresar con nota.
import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type Announcements,
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

  if (modo === 'coach' && !esCoach) return <Navigate to="/" replace />;
  if (modo === 'lider' && areasLider.length === 0) return <Navigate to="/area" replace />;

  function local(tid: string, estado: Estado) {
    qc.setQueryData(['tareas'], (old: Tarea[] | undefined) => old?.map((t) => (t.id === tid ? { ...t, estado } : t)));
  }

  async function soltar(e: DragEndEvent) {
    const t = delArea.find((x) => x.id === e.active.id);
    const destino = e.over?.id as Estado | undefined;
    if (!t || !destino || destino === t.estado) return;
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[.06em] text-tinta-3">
            {lideres.length ? `${lideres.length > 1 ? 'LÍDERES' : 'LÍDER'}: ${lideres.map((l) => l.nombre_visible.split(' ')[0].toUpperCase()).join(' Y ')} · ` : ''}{equipo.length} INTEGRANTES
          </span>
          <h1 className="m-0 font-titulo text-[30px] font-bold text-vino">Tablero de {area?.nombre}</h1>
        </div>
        <Link to={`/tarea/nueva?area=${areaId}`} className="flex h-12 items-center gap-2 rounded-campo bg-vino px-[18px] text-[15px] font-semibold text-crema no-underline hover:text-crema">
          <Icon name="mas" size={18} /> Nueva tarea
        </Link>
      </div>

      {permitidas.length > 1 && (
        <div role="tablist" aria-label="Área" className="flex flex-wrap gap-2">
          {areas.filter((a) => permitidas.includes(a.id)).map((a) => (
            <button
              key={a.id}
              role="tab"
              aria-selected={a.id === areaId}
              onClick={() => nav(modo === 'coach' ? `/coach/area/${a.id}` : `/area/tablero/${a.id}`, { replace: true })}
              className={`flex h-11 items-center gap-2 rounded-campo px-4 text-sm font-semibold ${a.id === areaId ? 'border-0 bg-vino text-crema' : 'border border-linea-campo bg-white'}`}
              style={a.id === areaId ? undefined : { color: a.color }}
            >
              <Icon name={a.icono} size={18} /> {a.nombre}
            </button>
          ))}
        </div>
      )}

      <section className="flex min-w-0 flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-tinta-2">Robot</span>
          {(['todos', 'VEX', 'FTC'] as const).map((r) => (
            <button key={r} aria-pressed={robot === r} onClick={() => setRobot(r)} className={`h-11 rounded-full px-3 text-[13px] ${robot === r ? 'border-0 bg-tinta text-white' : 'border border-linea-campo bg-white text-tinta'}`}>
              {r === 'todos' ? 'Todos' : r}
            </button>
          ))}
          <label htmlFor="kb-persona" className="ml-3 text-[13px] text-tinta-2">Persona</label>
          <select id="kb-persona" value={quien} onChange={(e) => setQuien(e.target.value)} className="h-11 rounded-full border border-linea-campo bg-white px-3 text-base">
            <option value="todos">Todo el área</option>
            {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre_visible.split(' ')[0]}</option>)}
          </select>
          <span className="ml-auto flex items-center gap-2.5 text-[13px]">
            Área al {delArea.length ? Math.round((hechas / delArea.length) * 100) : 0}%
            <span className="w-40"><Battery done={hechas} total={delArea.length} size="sm" /></span>
          </span>
        </div>
        <p className="m-0 text-xs text-tinta-3">Arrastra las tarjetas entre columnas (en celular, mantén presionado). Con teclado: Tab hasta la tarjeta, Espacio para tomarla, flechas y Espacio para soltar.</p>

        <DndContext sensors={sensores} onDragEnd={soltar} accessibility={{ announcements: anuncios }}>
          <div className="-mx-1 overflow-x-auto px-1 pb-2">
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))' }}>
              {COLUMNAS.map((c) => (
                <Columna key={c} id={c} titulo={ETIQUETA_ESTADO[c]} n={visibles.filter((t) => t.estado === c).length} pie={c === 'por_hacer' && (
                  <Link to={`/tarea/nueva?area=${areaId}`} className="flex h-11 items-center justify-center rounded-campo border-2 border-dashed border-[#A88F6A] text-sm font-semibold no-underline">+ Agregar tarea</Link>
                )}>
                  {visibles.filter((t) => t.estado === c).map((t) => (
                    <Tarjeta key={t.id} tarea={t} responsables={t.tarea_responsables.map((r) => persona(r.usuario_id)).filter(Boolean) as Perfil[]} />
                  ))}
                </Columna>
              ))}
            </div>
          </div>
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
    <div ref={setNodeRef} role="list" aria-label={`${titulo}, ${n} tareas`} className={`flex min-h-[420px] flex-col gap-2.5 rounded-2xl p-3 transition-shadow ${isOver ? 'bg-crema ring-[3px] ring-ambar' : 'bg-kanban'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-vino">{titulo}</span>
        <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-vino">{n}</span>
      </div>
      {children}
      {pie}
    </div>
  );
}

function Tarjeta({ tarea, responsables }: { tarea: Tarea; responsables: Perfil[] }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: tarea.id });
  const hecha = tarea.estado === 'hecha';
  const ayuda = tarea.pide_ayuda && !hecha;
  const f = chipFecha(tarea.fecha_limite, hecha);
  const pasosHechos = tarea.tarea_pasos.filter((p) => p.hecho).length;
  const chip = f.tono === 'vencida' ? 'bg-vino text-crema' : f.tono === 'urgente' ? 'bg-urgente-fondo text-urgente' : 'bg-crema text-vino';
  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-roledescription="tarjeta movible"
      aria-label={`${tarea.titulo}. ${ETIQUETA_ESTADO[tarea.estado]}${ayuda ? ', pidió ayuda' : ''}`}
      className={`flex touch-manipulation flex-col gap-2 rounded-campo p-3 ${hecha ? 'bg-[#F0D3AE]' : 'bg-white'} ${ayuda ? 'border-2 border-ambar' : 'border border-linea'} ${isDragging ? 'z-50 cursor-grabbing shadow-xl' : 'cursor-grab'}`}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="font-mono text-[11px] text-tinta-3">{tarea.robot}</span>
        {tarea.fecha_limite && <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${chip}`}>{f.texto}</span>}
      </div>
      <Link to={`/tarea/${tarea.id}`} onPointerDown={(e) => e.stopPropagation()} className="font-titulo text-[15px] font-semibold leading-[1.25] text-tinta no-underline hover:underline">{tarea.titulo}</Link>
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

