import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Battery } from '../components/Battery';
import { KanbanColumn, LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Boton, Cargando, useToast } from '../components/ui';
import { RegresarConNota } from './Revisar';
import {
  cargaPorPersona, tonoCarga, useAprobar, useAreas, useAvanceAreas, useAvanceMetas, useCompetencias, useMetas, useMoverEstado,
  usePerfiles, useRegresar, useSolicitudes, useTareas,
} from '../lib/datos';
import { diaMes, diasHasta, fechaCorta } from '../lib/fechas';
import { ETIQUETA_ESTADO, ROBOT_NOMBRE, type Estado, type Tarea } from '../lib/tipos';

export default function Coach() {
  const tareasQ = useTareas();
  const { data: areas = [] } = useAreas();
  const { data: avAreas = [] } = useAvanceAreas();
  const { data: metas = [] } = useMetas();
  const { data: avMetas = [] } = useAvanceMetas();
  const { data: competencias = [] } = useCompetencias();
  const { data: perfiles = [] } = usePerfiles();
  const { data: solicitudes = [] } = useSolicitudes(true);
  const [areaTablero, setAreaTablero] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const tareas = tareasQ.data ?? [];
  const hechas = avAreas.reduce((s, a) => s + a.hechas, 0);
  const total = avAreas.reduce((s, a) => s + a.total, 0);
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  const porRevisar = tareas.filter((t) => t.estado === 'en_revision');
  const alumnosAyuda = new Set(tareas.filter((t) => t.pide_ayuda && t.estado !== 'hecha').flatMap((t) => t.tarea_responsables.map((r) => r.usuario_id))).size;
  const proxima = competencias.find((c) => diasHasta(c.fecha_fin) >= 0);
  const dias = proxima ? Math.max(0, diasHasta(proxima.fecha_inicio)) : null;
  const metasProx = metas.filter((m) => !proxima || m.competencia_id === proxima.id);
  const carga = useMemo(() => cargaPorPersona(tareas), [tareas]);
  const alumnos = perfiles.filter((p) => p.rol_global === 'alumno' && p.activo);
  const persona = (id: string) => perfiles.find((p) => p.id === id);
  const nombres = (t: Tarea) => t.tarea_responsables.map((r) => persona(r.usuario_id)?.nombre_visible.split(' ')[0]).filter(Boolean).join(', ');
  const tableroId = areaTablero ?? avAreas.slice().sort((a, b) => b.vencidas + b.piden_ayuda - (a.vencidas + a.piden_ayuda))[0]?.area_id;
  const tableroArea = areas.find((a) => a.id === tableroId);

  if (tareasQ.isLoading) return <LayoutCoach><Cargando /></LayoutCoach>;

  return (
    <LayoutCoach>
      {solicitudes.length > 0 && (
        <Link to="/coach/cuentas" className="flex items-center gap-3 rounded-2xl border-2 border-ambar bg-white px-4 py-3 text-tinta no-underline">
          <Icon name="llave" />
          <span className="flex-grow text-sm"><strong>{solicitudes.length === 1 ? '1 persona pidió' : `${solicitudes.length} personas pidieron`} reiniciar su contraseña:</strong> {solicitudes.map((s) => s.usuario).join(', ')}</span>
          <span className="text-[13px] font-semibold text-vino">Atender</span>
        </Link>
      )}

      <section className="flex flex-wrap items-center gap-[22px] rounded-3xl bg-vino px-6 py-[22px] text-crema">
        {dias !== null && (
          <div className="flex h-[84px] w-[84px] shrink-0 flex-col items-center justify-center rounded-[18px] bg-ambar text-vino-oscuro">
            <span className="font-titulo text-[34px] font-bold leading-none">{dias}</span>
            <span className="text-xs font-semibold">{dias === 1 ? 'día' : 'días'}</span>
          </div>
        )}
        <div className="flex flex-[1_1_220px] flex-col gap-1">
          {proxima && <span className="text-[13px] opacity-85">Rumbo a {proxima.nombre} · {diaMes(proxima.fecha_inicio + 'T18:00:00Z')}</span>}
          <h1 className="m-0 font-titulo text-[30px] font-bold leading-[1.1]">El equipo va al {pct}%</h1>
          <span className="text-sm">
            {porRevisar.length === 1 ? '1 tarea espera' : `${porRevisar.length} tareas esperan`} tu visto bueno · {alumnosAyuda === 1 ? '1 alumno pide' : `${alumnosAyuda} alumnos piden`} ayuda
          </span>
        </div>
        <div role="img" aria-label={`Batería del equipo al ${pct} por ciento`} className="flex flex-[1_1_260px] items-center">
          <div className="box-border grid h-[70px] flex-grow grid-cols-10 gap-[5px] rounded-2xl border-[3px] border-crema p-1.5">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="seg rounded-md" style={{ background: i < Math.round(pct / 10) ? '#E9A84F' : 'rgba(243,226,193,.14)', animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
          <div className="h-[26px] w-[9px] rounded-r-[5px] bg-crema" />
        </div>
        <Link to="/tarea/nueva" className="flex h-12 items-center gap-2 rounded-[14px] bg-crema px-5 font-titulo text-[15px] font-bold text-vino no-underline hover:text-vino">
          <Icon name="mas" size={18} /> Nueva tarea
        </Link>
      </section>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {avAreas.map((a) => {
          const area = areas.find((x) => x.id === a.area_id);
          const p = a.total ? Math.round((a.hechas / a.total) * 100) : 0;
          const activa = a.area_id === tableroId;
          return (
            <button
              key={a.area_id}
              onClick={() => setAreaTablero(a.area_id)}
              aria-pressed={activa}
              aria-label={`${a.nombre}: ${p}% de avance. Ver su tablero`}
              className={`flex flex-col gap-2.5 rounded-tarjeta bg-white p-4 text-left text-tinta ${activa ? 'border-2 border-vino' : 'border border-linea'}`}
            >
              <span className="flex w-full items-center gap-2.5">
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: a.color_claro, color: a.color }}>
                  <Icon name={area?.icono ?? 'engrane'} size={20} />
                </span>
                <strong className="text-[15px]">{a.nombre}</strong>
                <span className="ml-auto font-titulo text-xl font-bold">{p}%</span>
              </span>
              <div className="flex w-full items-center">
                <div className="box-border h-5 flex-grow rounded-md border-2 border-vino p-0.5">
                  <div className="h-full rounded-[3px] bg-cobre" style={{ width: `${p}%` }} />
                </div>
                <div className="h-[9px] w-1 bg-vino" />
              </div>
              <span className="flex flex-wrap gap-1.5 text-xs">
                {a.por_revisar > 0 && <span className="rounded-full bg-crema px-2 py-[3px]">{a.por_revisar} por revisar</span>}
                {a.piden_ayuda > 0 && <span className="rounded-full bg-ambar px-2 py-[3px] font-semibold text-vino-oscuro">{a.piden_ayuda} {a.piden_ayuda === 1 ? 'pide' : 'piden'} ayuda</span>}
                {a.vencidas > 0 && <span className="rounded-full bg-vino px-2 py-[3px] font-semibold text-crema">{a.vencidas} {a.vencidas === 1 ? 'vencida' : 'vencidas'}</span>}
                {!a.por_revisar && !a.piden_ayuda && !a.vencidas && <span className="rounded-full bg-atiempo-fondo px-2 py-[3px] text-atiempo">Al día</span>}
              </span>
            </button>
          );
        })}
      </div>

      <section className="flex flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="m-0 font-titulo text-xl font-bold text-vino">{proxima ? `Metas rumbo a ${proxima.nombre}` : 'Metas del robot'}</h2>
          <Link to="/coach/metas" className="text-[13px]">Editar metas</Link>
        </div>
        {metasProx.length === 0 && <span className="text-sm text-tinta-3">Aún no hay metas.</span>}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {metasProx.map((m) => {
            const av = avMetas.find((x) => x.meta_id === m.id);
            const a = areas.find((x) => x.id === m.areas[0]);
            return (
              <div key={m.id} className="flex flex-col gap-2.5 rounded-2xl border border-linea p-3.5">
                <div className="flex justify-between gap-2 text-xs">
                  {a && <span className="texto-area flex items-center gap-1.5 font-semibold" style={{ color: a.color }}><span className="h-2 w-2 rounded-full" style={{ background: a.color }} />{a.nombre}</span>}
                  <span className="font-mono text-tinta-3">{ROBOT_NOMBRE[m.robot]}{m.fecha ? ` · ${fechaCorta(m.fecha + 'T18:00:00Z')}` : ''}</span>
                </div>
                <strong className="font-titulo text-base font-semibold leading-[1.25]">{m.titulo}</strong>
                <Battery done={av?.hechas ?? 0} total={av?.total ?? 0} />
                <span className="text-xs text-tinta-2">{av?.hechas ?? 0} de {av?.total ?? 0} tareas listas</span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap gap-[18px]">
        <section className="flex min-w-0 flex-[3_1_440px] flex-col gap-1 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="m-0 font-titulo text-xl font-bold text-vino">Esperan tu visto bueno</h2>
            {porRevisar.length > 3 && (
              <button onClick={() => setVerTodas((v) => !v)} className="min-h-tap bg-transparent text-[13px] text-vino underline">{verTodas ? 'Ver menos' : `Ver las ${porRevisar.length}`}</button>
            )}
          </div>
          {porRevisar.length === 0 && <span className="py-3 text-sm text-tinta-3">Nada pendiente de revisar.</span>}
          {(verTodas ? porRevisar : porRevisar.slice(0, 3)).map((t) => (
            <FilaRevision key={t.id} tarea={t} nombres={nombres(t)} area={areas.find((a) => a.id === t.area_id)?.nombre ?? ''} />
          ))}
        </section>

        <section className="flex min-w-0 flex-[2_1_300px] flex-col gap-2.5 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <h2 className="m-0 font-titulo text-xl font-bold text-vino">Carga del equipo</h2>
          <p className="m-0 text-xs text-tinta-2">Tareas activas por persona. Equilibra antes de asignar.</p>
          <ul className="m-0 grid list-none gap-2 p-0 text-[13px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {alumnos.map((p) => {
              const n = carga[p.id] ?? 0;
              const tono = tonoCarga(n);
              return (
                <li key={p.id} className="flex items-center gap-2 rounded-[10px] px-2.5 py-[9px]" style={{ background: n === 0 ? 'transparent' : tono.fondo, color: tono.texto, border: n === 0 ? '2px dashed #A88F6A' : undefined }}>
                  <strong className="font-titulo text-base">{n}</strong>
                  <span className="truncate">{p.nombre_visible.split(' ')[0]}</span>
                  <span className="sr-only">, {tono.nombre}</span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-xs text-tinta-2">Verde 1–3 · ámbar 4–5 · vino 6 o más · punteado sin tareas</p>
        </section>
      </div>

      {tableroArea && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 font-titulo text-xl font-bold text-vino">Tablero de {tableroArea.nombre}</h2>
            <Link to={`/coach/area/${tableroArea.id}`} className="text-[13px]">Abrir tablero completo (arrastrar tarjetas)</Link>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(200px, 1fr))' }}>
              {(['por_hacer', 'en_proceso', 'en_revision', 'hecha'] as Estado[]).map((e) => (
                <KanbanColumn key={e} titulo={ETIQUETA_ESTADO[e]} tareas={tareas.filter((t) => t.area_id === tableroArea.id && t.estado === e)} nombres={nombres} />
              ))}
            </div>
          </div>
        </section>
      )}
    </LayoutCoach>
  );
}

function FilaRevision({ tarea, nombres, area }: { tarea: Tarea; nombres: string; area: string }) {
  const aprobar = useAprobar();
  const regresar = useRegresar();
  const mover = useMoverEstado();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const hechos = tarea.tarea_pasos.filter((p) => p.hecho).length;
  const fotos = tarea.evidencias?.filter((e) => e.tipo === 'foto').length ?? 0;
  const enlaces = tarea.evidencias?.filter((e) => e.tipo === 'enlace').length ?? 0;
  const detalle = [nombres, area, ROBOT_NOMBRE[tarea.robot], tarea.tarea_pasos.length ? `${hechos}/${tarea.tarea_pasos.length} pasos` : '', fotos ? `${fotos} foto${fotos > 1 ? 's' : ''}` : '', enlaces ? `${enlaces} enlace${enlaces > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(' · ');
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-[#F0E4CC] py-3">
      <div className="flex flex-[1_1_220px] flex-col gap-0.5">
        <Link to={`/tarea/${tarea.id}`} className="font-titulo text-base font-semibold text-tinta no-underline hover:underline">{tarea.titulo}</Link>
        <span className="text-xs text-tinta-3">{detalle}</span>
      </div>
      <Boton
        alto={44}
        className="text-[13px]"
        disabled={aprobar.isPending}
        onClick={async () => {
          try {
            await aprobar.mutateAsync(tarea.id);
            toast({ titulo: 'Tarea aprobada.', texto: nombres ? `Se sumó a la batería de ${nombres.replace(/, /g, ' y ')}.` : undefined, deshacer: () => mover.mutate({ id: tarea.id, estado: 'en_revision' }) });
          } catch (e) {
            toast({ tipo: 'error', titulo: 'No se pudo aprobar.', texto: (e as Error).message });
          }
        }}
      >
        Aprobar
      </Boton>
      <Boton alto={44} variante="secundario" className="text-[13px]" onClick={() => setAbierto(true)}>Regresar con nota</Boton>
      <RegresarConNota
        abierto={abierto}
        nombre={nombres.replace(/, /g, ' y ')}
        onCerrar={() => setAbierto(false)}
        onEnviar={async (nota) => {
          await regresar.mutateAsync({ id: tarea.id, nota });
          setAbierto(false);
          toast({ titulo: 'Regresada con nota.' });
        }}
      />
    </div>
  );
}
