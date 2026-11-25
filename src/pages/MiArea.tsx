import { useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { BateriaPorcentaje } from '../components/Battery';
import { Icon } from '../components/Icon';
import { Avatar, Cargando, ChipFecha, EmptyState, HeaderVino, PantallaCel, TituloSeccion } from '../components/ui';
import { PorRevisar } from './Revisar';
import { cargaPorPersona, useAreas, useMembresias, usePerfiles, useTareas } from '../lib/datos';
import { enSemana } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { ETIQUETA_ESTADO, ROBOT_NOMBRE, type Estado, type Perfil, type Tarea } from '../lib/tipos';

export default function MiArea() {
  const { perfil, misAreas, areasLider, esCoach } = useSesion();
  const [params, setParams] = useSearchParams();
  const { data: areas = [] } = useAreas();
  const { data: perfiles = [] } = usePerfiles();
  const { data: membresias = [] } = useMembresias();
  const tareasQ = useTareas();

  const opciones = areas.filter((a) => misAreas.includes(a.id));
  const areaId = params.get('a') && misAreas.includes(params.get('a')!) ? params.get('a')! : (areasLider.find((a) => misAreas.includes(a)) ?? misAreas[0]);
  const area = areas.find((a) => a.id === areaId);
  const lider = areasLider.includes(areaId);

  const tareas = useMemo(() => (tareasQ.data ?? []).filter((t) => t.area_id === areaId), [tareasQ.data, areaId]);
  const equipo = useMemo(() => {
    const ids = membresias.filter((m) => m.area_id === areaId).map((m) => m.usuario_id);
    return perfiles.filter((p) => ids.includes(p.id) && p.activo);
  }, [membresias, perfiles, areaId]);

  if (esCoach) return <Navigate to="/coach" replace />;
  if (!perfil) return null;
  if (!areaId) {
    return (
      <PantallaCel>
        <HeaderVino titulo="Mi área" />
        <div className="m-4"><EmptyState titulo="Aún no tienes área" texto="Pídele al coach que te agregue a un área del equipo." /></div>
      </PantallaCel>
    );
  }

  const hechas = tareas.filter((t) => t.estado === 'hecha').length;
  const porRevisar = tareas.filter((t) => t.estado === 'en_revision');
  const piden = tareas.filter((t) => t.pide_ayuda && t.estado !== 'hecha');
  const persona = (uid: string) => perfiles.find((p) => p.id === uid);
  const responsables = (t: Tarea) => t.tarea_responsables.map((r) => persona(r.usuario_id)).filter(Boolean) as Perfil[];

  return (
    <PantallaCel>
      <HeaderVino titulo={area?.nombre} subtitulo={`${lider ? 'Eres líder' : 'Integrante'} · ${equipo.length} integrantes`}>
        {opciones.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Elegir área">
            {opciones.map((a) => (
              <button
                key={a.id}
                aria-pressed={a.id === areaId}
                onClick={() => setParams({ a: a.id }, { replace: true })}
                className={`h-11 rounded-full px-3.5 text-sm ${a.id === areaId ? 'border-0 bg-ambar font-semibold text-vino-oscuro' : 'border border-crema/40 bg-transparent text-crema'}`}
              >
                {a.nombre}
              </button>
            ))}
          </div>
        )}
        <BateriaPorcentaje hechas={hechas} total={tareas.length} etiqueta="Avance del área" />
        <div className="grid grid-cols-3 gap-2">
          <Dato n={hechas} t={hechas === 1 ? "hecha" : "hechas"} />
          <Dato n={porRevisar.length} t="por revisar" />
          <Dato n={piden.length} t={piden.length === 1 ? "pide ayuda" : "piden ayuda"} resaltar={piden.length > 0} />
        </div>
      </HeaderVino>

      {tareasQ.isLoading ? <Cargando /> : lider ? (
        <VistaLider area={areaId} tareas={tareas} piden={piden} porRevisar={porRevisar} equipo={equipo} responsables={responsables} />
      ) : (
        <VistaIntegrante tareas={tareas} equipo={equipo} responsables={responsables} miId={perfil.id} />
      )}

      {lider && (
        <Link
          to={`/tarea/nueva?area=${areaId}`}
          className="fixed bottom-[92px] right-[max(18px,calc(50vw-222px))] z-30 flex h-14 items-center gap-2 rounded-[18px] bg-ambar px-5 font-titulo text-base font-bold text-vino-oscuro no-underline shadow-[0_6px_18px_rgba(89,2,2,.25)] hover:text-vino-oscuro"
        >
          <Icon name="mas" /> Nueva tarea
        </Link>
      )}
    </PantallaCel>
  );
}

function Dato({ n, t, resaltar }: { n: number; t: string; resaltar?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-campo p-2.5 ${resaltar ? 'bg-ambar text-vino-oscuro' : 'bg-crema/[.12]'}`}>
      <span className="font-titulo text-[22px] font-bold">{n}</span>
      <span className={`text-xs ${resaltar ? 'font-semibold' : ''}`}>{t}</span>
    </div>
  );
}

function VistaLider({ area, tareas, piden, porRevisar, equipo, responsables }: {
  area: string; tareas: Tarea[]; piden: Tarea[]; porRevisar: Tarea[]; equipo: Perfil[]; responsables: (t: Tarea) => Perfil[];
}) {
  const { data: areas = [] } = useAreas();
  const a = areas.find((x) => x.id === area);
  const carga = cargaPorPersona(tareas);
  const filas = equipo
    .map((p) => {
      const semana = tareas.filter((t) => enSemana(t.fecha_limite) && t.tarea_responsables.some((r) => r.usuario_id === p.id));
      return { p, total: semana.length, hechas: semana.filter((t) => t.estado === 'hecha').length, activas: carga[p.id] ?? 0 };
    })
    .sort((x, y) => x.p.nombre_visible.localeCompare(y.p.nombre_visible));
  const saturado = filas.filter((f) => f.activas >= 6).sort((x, y) => y.activas - x.activas)[0];
  const libre = filas.filter((f) => f.activas === 0)[0] ?? filas.slice().sort((x, y) => x.activas - y.activas)[0];

  return (
    <>
      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <TituloSeccion>Piden ayuda</TituloSeccion>
        {piden.length === 0 && <span className="text-sm text-tinta-3">Nadie está atorado ahora.</span>}
        {piden.map((t) => {
          const r = responsables(t)[0];
          return (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl border-2 border-ambar bg-white px-3.5 py-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-campo font-titulo font-bold" style={{ background: a?.color_claro, color: a?.color }}>{r?.iniciales ?? '?'}</span>
              <div className="flex min-w-0 flex-grow flex-col">
                <span className="text-sm font-semibold">{r?.nombre_visible.split(' ')[0]} · {t.titulo}</span>
                {t.mensaje_ayuda && <span className="text-xs text-tinta-2">“{t.mensaje_ayuda}”</span>}
              </div>
              <Link to={`/tarea/${t.id}`} className="flex h-11 shrink-0 items-center rounded-[10px] bg-vino px-3 text-[13px] font-semibold text-crema no-underline hover:text-crema">Ayudar</Link>
            </div>
          );
        })}
      </section>

      <section className="mx-4 mt-5 flex flex-col gap-2.5">
        <TituloSeccion>Por revisar</TituloSeccion>
        {porRevisar.length === 0 && <span className="text-sm text-tinta-3">No hay tareas esperando revisión.</span>}
        {porRevisar.map((t) => <PorRevisar key={t.id} tarea={t} area={a} responsables={responsables(t)} />)}
      </section>

      <section className="mx-4 mt-5 flex flex-col gap-2.5 pb-16">
        <Link to={`/area/tablero/${area}`} className="flex min-h-tap items-center justify-center gap-2 rounded-campo border border-linea-campo bg-white text-sm font-semibold no-underline">
          <Icon name="tablero" size={18} /> Ver el tablero completo (kanban)
        </Link>
        <TituloSeccion extra="batería de la semana">Tu equipo</TituloSeccion>
        <div className="flex flex-col rounded-2xl border border-linea bg-white">
          {filas.map((f, i) => (
            <div key={f.p.id} className={`flex min-h-[52px] items-center gap-3 px-3.5 py-3 ${i < filas.length - 1 ? 'border-b border-[#F0E4CC]' : ''}`}>
              <span className="w-[110px] truncate text-sm font-semibold">{f.p.nombre_visible.split(' ')[0]}</span>
              {f.total === 0 ? (
                <>
                  <span className="flex-grow text-[13px] text-tinta-3">Sin tareas esta semana</span>
                  <Link to={`/tarea/nueva?area=${area}&para=${f.p.id}`} className="text-[13px] font-semibold">Asignar</Link>
                </>
              ) : (
                <>
                  <div role="img" aria-label={`${f.hechas} de ${f.total}${f.activas >= 6 ? ', mucha carga' : ''}`} className="flex h-4 flex-grow gap-[3px]">
                    {Array.from({ length: f.total }, (_, j) => <span key={j} className="flex-1 rounded-[3px]" style={{ background: j < f.hechas ? '#E9A84F' : '#EFE2C8' }} />)}
                  </div>
                  <span className={`w-[30px] text-right font-mono text-xs ${f.activas >= 6 ? 'font-bold text-vino' : ''}`}>{f.hechas}/{f.total}</span>
                </>
              )}
            </div>
          ))}
        </div>
        {saturado && libre && libre.p.id !== saturado.p.id && (
          <p className="m-0 text-xs text-tinta-2">
            {saturado.p.nombre_visible.split(' ')[0]} tiene {saturado.activas} tareas activas: pasa una a {libre.p.nombre_visible.split(' ')[0]} antes de asignar más.
          </p>
        )}
      </section>
    </>
  );
}

const FILTROS_ESTADO: { v: Estado | 'activas'; t: string }[] = [
  { v: 'activas', t: 'Pendientes' },
  { v: 'en_revision', t: 'En revisión' },
  { v: 'hecha', t: 'Hechas' },
];

/** Integrante: ve todo su área en solo lectura (quién tiene qué), sin carga de trabajo. */
function VistaIntegrante({ tareas, equipo, responsables, miId }: { tareas: Tarea[]; equipo: Perfil[]; responsables: (t: Tarea) => Perfil[]; miId: string }) {
  const [estado, setEstado] = useState<Estado | 'activas'>('activas');
  const [quien, setQuien] = useState<string>('todos');
  const lista = tareas
    .filter((t) => (estado === 'activas' ? t.estado !== 'hecha' : t.estado === estado))
    .filter((t) => quien === 'todos' || (quien === 'sin' ? t.tarea_responsables.length === 0 : t.tarea_responsables.some((r) => r.usuario_id === quien)))
    .sort((a, b) => (a.fecha_limite ?? '9').localeCompare(b.fecha_limite ?? '9'));

  return (
    <section className="mx-4 mt-[18px] flex flex-col gap-3 pb-6">
      <TituloSeccion extra="solo lectura">Pendientes del área</TituloSeccion>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por estado">
        {FILTROS_ESTADO.map((f) => (
          <button key={f.v} aria-pressed={estado === f.v} onClick={() => setEstado(f.v)} className={`h-11 shrink-0 rounded-full px-3.5 text-sm ${estado === f.v ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>{f.t}</button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filtro-persona" className="text-[13px] font-semibold text-vino">Persona</label>
        <select id="filtro-persona" value={quien} onChange={(e) => setQuien(e.target.value)} className="box-border h-12 w-full rounded-campo border-2 border-linea-campo bg-white px-3.5 text-base">
          <option value="todos">Todo el área</option>
          <option value={miId}>Solo las mías</option>
          {equipo.filter((p) => p.id !== miId).map((p) => <option key={p.id} value={p.id}>{p.nombre_visible}</option>)}
        </select>
      </div>
      {lista.length === 0 ? (
        <EmptyState titulo="Nada por aquí" texto="Cambia el filtro para ver otras tareas del área." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lista.map((t) => {
            const rs = responsables(t);
            return (
              <li key={t.id}>
                <Link to={`/tarea/${t.id}`} className={`flex flex-col gap-2 rounded-2xl border bg-white p-3.5 text-tinta no-underline ${t.pide_ayuda && t.estado !== 'hecha' ? 'border-2 border-ambar' : 'border-linea'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-tinta-3">{ROBOT_NOMBRE[t.robot]}</span>
                    <ChipFecha fecha={t.fecha_limite} hecha={t.estado === 'hecha'} />
                  </div>
                  <span className="font-titulo text-base font-semibold leading-[1.25]">{t.titulo}</span>
                  <div className="flex items-center gap-2">
                    <span className="flex -space-x-1">{rs.map((p) => <Avatar key={p.id} iniciales={p.iniciales} color={p.color} size={26} className="ring-2 ring-white" />)}</span>
                    <span className="flex-grow truncate text-[13px] text-tinta-2">{rs.length ? rs.map((p) => p.nombre_visible.split(' ')[0]).join(', ') : 'Sin asignar'}</span>
                    <span className="shrink-0 rounded-full bg-crema px-2.5 py-[3px] text-xs font-semibold text-vino">{ETIQUETA_ESTADO[t.estado]}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
