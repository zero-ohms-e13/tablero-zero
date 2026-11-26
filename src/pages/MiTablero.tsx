import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Battery } from '../components/Battery';
import { Icon } from '../components/Icon';
import { MetaCard, TaskCard } from '../components/Tarjetas';
import { Avatar, Boton, Cargando, EmptyState, HeaderVino, PantallaCel, Sheet, TituloSeccion, WeekStrip, claseCampo, useToast } from '../components/ui';
import { esMia, useAreas, useAvanceMetas, useCompetencias, useMetas, useMoverEstado, usePedirAyuda, usePerfiles, useTareas } from '../lib/datos';
import { agruparSemana, diasHasta, esHoy, haceCuanto, vencida } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { lunesDe, plazoTexto, useBitacorasSemana, usePlazoBitacora } from '../lib/bitacoras';
import { supabase } from '../lib/supabase';
import { ROBOT_NOMBRE, type Tarea } from '../lib/tipos';

type Pestana = 'hoy' | 'semana' | 'hecho';

export function mensajeBateria(done: number, total: number) {
  if (total === 0) return 'Esta semana no tienes tareas con fecha.';
  const faltan = total - done;
  if (faltan === 0) return 'Batería llena. Cerraste la semana.';
  if (faltan === 1) return 'Te falta 1 para la carga completa.';
  if (done / total >= 0.75) return 'Casi llena. Una más y cierras la semana.';
  if (done / total >= 0.4) return 'Vas a la mitad. Hoy puedes cargar una más.';
  return `Te faltan ${faltan} para la carga completa.`;
}

export default function MiTablero() {
  const { perfil, misAreas } = useSesion();
  const [params, setParams] = useSearchParams();
  const pestana = (params.get('ver') as Pestana) || 'hoy';
  const setPestana = (p: Pestana) => setParams(p === 'hoy' ? {} : { ver: p }, { replace: true });
  const tareasQ = useTareas();
  const { data: areas = [] } = useAreas();
  const { data: metas = [] } = useMetas();
  const { data: avance = [] } = useAvanceMetas();
  const { data: competencias = [] } = useCompetencias();
  const { data: perfiles = [] } = usePerfiles();
  const mover = useMoverEstado();
  const ayuda = usePedirAyuda();
  const toast = useToast();
  const [ayudaDe, setAyudaDe] = useState<Tarea | null>(null);

  const { data: sinLeer = 0 } = useQuery({
    queryKey: ['avisos_sin_leer'],
    queryFn: async () => (await supabase.from('avisos').select('id', { count: 'exact', head: true }).eq('leido', false)).count ?? 0,
  });

  const uid = perfil?.id;
  const todas = tareasQ.data ?? [];
  const mias = todas.filter((t) => esMia(t, uid));
  // FUN-001: una sola definición de semana (lunes 00:00 a lunes siguiente, Mérida) para pestaña y batería
  const grupos = agruparSemana(mias);
  const semana = grupos.semana;
  const hechasSemana = grupos.hechas;
  const activas = mias.filter((t) => t.estado !== 'hecha');

  const lista = useMemo(() => {
    const porFecha = (a: Tarea, b: Tarea) => (a.fecha_limite ?? '9').localeCompare(b.fecha_limite ?? '9');
    if (pestana === 'hecho') return mias.filter((t) => t.estado === 'hecha').sort((a, b) => (b.aprobada_at ?? '').localeCompare(a.aprobada_at ?? ''));
    if (pestana === 'semana') return grupos.pendientes;
    return activas.filter((t) => esHoy(t.fecha_limite) || vencida(t.fecha_limite)).sort(porFecha);
  }, [pestana, mias, activas, grupos.pendientes]);

  const areaPrincipal = areas.find((a) => a.id === misAreas[0]);
  const area = (id: string) => areas.find((a) => a.id === id);
  const robots = [...new Set(mias.map((t) => t.robot))];
  const robotTexto = robots.length === 1 ? ROBOT_NOMBRE[robots[0]] : robots.length ? 'Ambos robots' : '';

  const proxima = competencias.find((c) => diasHasta(c.fecha_fin) >= 0);
  const misMetas = metas.filter((m) => mias.some((t) => t.meta_id === m.id) || (!m.competencia_id || m.competencia_id === proxima?.id) && m.areas.some((a) => misAreas.includes(a)));
  const logros = todas
    .filter((t) => t.estado === 'hecha' && t.aprobada_at)
    .sort((a, b) => (b.aprobada_at ?? '').localeCompare(a.aprobada_at ?? ''))
    .slice(0, 6);
  const nombre = (id?: string) => perfiles.find((p) => p.id === id)?.nombre_visible.split(' ')[0] ?? 'Alguien';

  async function mandarRevision(t: Tarea) {
    try {
      await mover.mutateAsync({ id: t.id, estado: 'en_revision' });
      toast({
        titulo: 'Mandada a revisión.',
        texto: 'Tu líder la revisará.',
        deshacer: () => mover.mutate({ id: t.id, estado: 'en_proceso' }),
      });
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se pudo mandar.', texto: (e as Error).message });
    }
  }

  const tarjeta = (t: Tarea) => (
    <TaskCard
      key={t.id}
      tarea={t}
      area={area(t.area_id)}
      ocupado={mover.isPending}
      onRevision={t.estado !== 'en_revision' ? () => mandarRevision(t) : undefined}
      onAyuda={() => setAyudaDe(t)}
    />
  );

  if (!perfil) return null;

  return (
    <PantallaCel>
      <HeaderVino>
        <div className="flex items-center gap-3">
          <Avatar iniciales={perfil.iniciales} color={perfil.color} size={48} className="ring-2 ring-crema/50" />
          <div className="flex flex-grow flex-col gap-0.5">
            <span className="font-titulo text-[22px] font-bold">Hola, {perfil.nombre_visible.split(' ')[0]}</span>
            <span className="text-[13px] opacity-90">{[areaPrincipal?.nombre, robotTexto].filter(Boolean).join(' · ')}</span>
          </div>
          <Link to="/avisos" aria-label={sinLeer ? `Avisos, ${sinLeer} sin leer` : 'Avisos'} className="relative flex h-11 w-11 items-center justify-center rounded-campo border border-crema/35 text-crema hover:text-crema">
            <Icon name="campana" />
            {sinLeer > 0 && <span className="absolute right-[9px] top-2 h-2 w-2 rounded-full bg-ambar" />}
          </Link>
        </div>
        <Battery done={hechasSemana} total={semana.length} size="xl" variant="oscura" cargando label={`Batería de la semana: ${hechasSemana} de ${semana.length} tareas listas`} />
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-titulo text-[28px] font-bold leading-none">
            {hechasSemana}
            <span className="text-lg opacity-75"> / {semana.length} esta semana</span>
          </span>
        </div>
        <span className="-mt-2.5 text-sm leading-[1.4]">{mensajeBateria(hechasSemana, semana.length)}</span>
      </HeaderVino>

      <div className="mx-4 mt-4">
        <WeekStrip fechasConEntrega={activas.map((t) => t.fecha_limite)} colorPunto={areaPrincipal?.color} />
      </div>

      <TarjetaBitacora alumno={uid} />

      <section className="mx-4 mt-5 flex flex-col gap-3">
        <TituloSeccion extra={pestana === 'hecho' ? `${lista.length} hechas` : `${activas.length} por hacer`}>Tus pendientes</TituloSeccion>
        <div role="tablist" aria-label="Ver pendientes" className="grid grid-cols-3 gap-1 rounded-campo bg-crema p-1">
          {(['hoy', 'semana', 'hecho'] as Pestana[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pestana === p}
              onClick={() => setPestana(p)}
              className={`h-11 rounded-[9px] border-0 text-sm font-semibold ${pestana === p ? 'bg-vino text-crema' : 'bg-transparent text-vino'}`}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Semana' : 'Hecho'}
            </button>
          ))}
        </div>
        {tareasQ.isLoading ? (
          <Cargando />
        ) : pestana === 'semana' ? (
          <>
            {grupos.pendientes.length === 0 && (
              <EmptyState
                titulo="Nada pendiente esta semana"
                texto={activas.length ? 'Abajo están tus vencidas, próximas o sin fecha.' : 'No tienes tareas activas. Pídele una a tu líder.'}
              />
            )}
            {grupos.pendientes.map(tarjeta)}
            {([
              ['Vencidas de semanas anteriores', grupos.vencidas],
              ['Próximas semanas', grupos.proximas],
              ['Sin fecha', grupos.sinFecha],
            ] as const).map(([titulo, l]) =>
              l.length > 0 ? (
                <div key={titulo} className="flex flex-col gap-3">
                  <h3 className="m-0 mt-2 text-sm font-semibold text-vino">
                    {titulo} <span className="font-normal text-tinta-2">· {l.length}</span>
                  </h3>
                  {l.map(tarjeta)}
                </div>
              ) : null,
            )}
          </>
        ) : lista.length === 0 ? (
          pestana === 'hoy' ? (
            <EmptyState
              titulo="Hoy no tienes pendientes"
              texto="Revisa la semana o pídele una tarea a tu líder."
              accion={<Boton alto={44} onClick={() => setPestana('semana')}>Ver la semana</Boton>}
            />
          ) : (
            <EmptyState titulo="Aún no hay tareas hechas" texto="Cuando tu líder apruebe una tarea, aparece aquí y llena tu batería." />
          )
        ) : (
          lista.map(tarjeta)
        )}
      </section>

      {misMetas.length > 0 && (
        <section className="mx-4 mt-5 flex flex-col gap-2.5">
          <TituloSeccion extra="metas del robot">{proxima ? `Tus metas rumbo a ${proxima.nombre}` : 'Tus metas'}</TituloSeccion>
          {misMetas.map((m) => {
            const a = avance.find((x) => x.meta_id === m.id);
            return <MetaCard key={m.id} meta={m} hechas={a?.hechas ?? 0} total={a?.total ?? 0} mias={mias.filter((t) => t.meta_id === m.id).length} area={areaPrincipal} />;
          })}
        </section>
      )}

      {logros.length > 0 && (
        <section className="mt-5 flex flex-col gap-2.5">
          <h2 className="mx-4 my-0 font-titulo text-lg font-bold text-vino">Logros del equipo</h2>
          <div className="flex gap-2.5 overflow-x-auto px-4 pb-1">
            {logros.map((t, i) => (
              <div key={t.id} className={`flex flex-[0_0_200px] flex-col gap-1.5 rounded-2xl p-3.5 ${i === 0 ? 'bg-vino text-crema' : 'border border-linea bg-white'}`}>
                <Icon name="palomita" size={22} stroke={2.2} className={i === 0 ? 'text-ambar' : 'text-cobre'} />
                <span className="text-sm leading-[1.35]">{nombre(t.tarea_responsables[0]?.usuario_id)} terminó «{t.titulo}»</span>
                <span className={`text-[11px] ${i === 0 ? 'opacity-80' : 'text-tinta-3'}`}>{haceCuanto(t.aprobada_at!)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PedirAyuda tarea={ayudaDe} onCerrar={() => setAyudaDe(null)} guardar={async (pide, mensaje) => {
        if (!ayudaDe) return;
        try {
          await ayuda.mutateAsync({ id: ayudaDe.id, pide, mensaje });
          toast({ titulo: pide ? 'Listo.' : 'Quitamos la solicitud.', texto: pide ? 'Tu líder ya sabe que necesitas ayuda.' : undefined });
          setAyudaDe(null);
        } catch (e) {
          toast({ tipo: 'error', titulo: 'No se pudo guardar.', texto: (e as Error).message });
        }
      }} />
    </PantallaCel>
  );
}

export function PedirAyuda({ tarea, onCerrar, guardar }: { tarea: Tarea | null; onCerrar: () => void; guardar: (pide: boolean, mensaje?: string) => void }) {
  const [msg, setMsg] = useState('');
  return (
    <Sheet abierto={!!tarea} onCerrar={onCerrar} titulo="Pedir ayuda">
      {tarea?.pide_ayuda ? (
        <>
          <p className="m-0 text-sm text-tinta-2">Ya pediste ayuda en <strong>{tarea.titulo}</strong>{tarea.mensaje_ayuda ? `: “${tarea.mensaje_ayuda}”` : '.'}</p>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
            <Boton className="flex-grow" onClick={() => guardar(false)}>Ya no necesito ayuda</Boton>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="msg-ayuda" className="text-[13px] font-semibold text-vino">¿En qué te atoraste?</label>
            <textarea id="msg-ayuda" rows={3} maxLength={200} value={msg} onChange={(e) => setMsg(e.target.value)} className={`${claseCampo} h-auto resize-none py-3 leading-[1.4]`} placeholder="No sé cómo leer la odometría en el código" />
            <span className="text-xs text-tinta-2">Tu líder lo verá en "Piden ayuda". Pedir ayuda está bien.</span>
          </div>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
            <Boton className="flex-grow" onClick={() => { guardar(true, msg); setMsg(''); }}>Pedir ayuda</Boton>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Acceso a las bitácoras de la semana: cuántas entregó, si hay algo por corregir y el plazo. */
function TarjetaBitacora({ alumno }: { alumno?: string }) {
  const lunes = lunesDe();
  const { data: lista = [], isLoading } = useBitacorasSemana(alumno, lunes);
  const { data: vence = new Date() } = usePlazoBitacora(lunes);
  if (isLoading) return null;
  const entregadas = lista.filter((b) => b.estado === 'entregada' || b.estado === 'revisada').length;
  const corregir = lista.some((b) => b.estado === 'devuelta');
  const borrador = lista.some((b) => b.estado === 'borrador');
  const listo = entregadas > 0 && !corregir;
  const plazo = plazoTexto(vence);
  return (
    <Link
      to="/bitacora"
      className={`mx-4 mt-4 flex min-h-tap items-center gap-3 rounded-tarjeta p-3.5 no-underline transition-transform duration-150 active:scale-[.99] ${corregir ? 'border-2 border-ambar bg-white' : listo ? 'border border-linea bg-white' : 'bg-crema'}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-campo ${listo ? 'bg-atiempo-fondo text-atiempo' : 'bg-vino text-crema'}`}>
        <Icon name={listo ? 'palomita' : 'editar'} size={20} />
      </span>
      <span className="flex min-w-0 flex-grow flex-col">
        <strong className="text-[15px] text-vino">Mis bitácoras de la semana</strong>
        <span className={`text-xs ${!listo && plazo.tono !== 'normal' ? 'font-semibold text-urgente' : 'text-tinta-2'}`}>
          {corregir ? 'El coach te pidió corregir una' : listo ? `${entregadas} entregada${entregadas > 1 ? 's' : ''} · puedes agregar otra` : `${borrador ? 'Tienes un borrador · ' : ''}${plazo.texto}`}
        </span>
      </span>
      <Icon name="atras" size={18} className="shrink-0 rotate-180 text-vino" />
    </Link>
  );
}
