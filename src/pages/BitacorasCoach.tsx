// Bitácoras (coach): quién entregó, quién va atrasado y qué necesita apoyo; leer, comentar y devolver.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Avatar, Boton, Campo, Cargando, EmptyState, Sheet, claseCampo, useToast } from '../components/ui';
import {
  ETIQUETA_ESTADO_BITACORA, lunesDe, rangoSemana, sumarSemanas, useBitacora, useResumenBitacoras, useRevisarBitacora, usePlazoBitacora, useFijarPlazo, cuandoVence, esOmision,
  type FilaResumen,
} from '../lib/bitacoras';
import { aInputLocal, deInputLocal, haceCuanto } from '../lib/fechas';
import { Lectura } from './Bitacora';

type Filtro = 'todas' | 'pendiente' | 'entregada' | 'atrasada' | 'ayuda';

export default function BitacorasCoach() {
  const [params, setParams] = useSearchParams();
  const actual = lunesDe();
  const pedida = params.get('semana');
  const lunes = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) && pedida <= actual ? pedida : actual;
  const q = useResumenBitacoras(lunes);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const filas = q.data ?? [];
  const cuenta = {
    entregada: filas.filter((f) => f.estado === 'entregada' || f.estado === 'revisada').length,
    porRevisar: filas.filter((f) => f.estado === 'entregada').length,
    pendiente: filas.filter((f) => f.estado === 'pendiente' || f.estado === 'devuelta').length,
    atrasada: filas.filter((f) => f.atrasada).length,
    ayuda: filas.filter((f) => f.necesita_ayuda).length,
  };
  const visibles = filas.filter((f) =>
    filtro === 'todas' ? true
      : filtro === 'pendiente' ? f.estado === 'pendiente' || f.estado === 'devuelta'
        : filtro === 'entregada' ? f.estado === 'entregada' || f.estado === 'revisada'
          : filtro === 'atrasada' ? f.atrasada : f.necesita_ayuda);
  const ir = (l: string) => setParams(l === actual ? {} : { semana: l }, { replace: true });
  const { data: vence = new Date() } = usePlazoBitacora(lunes);
  const vencio = new Date() > vence;
  const [cambiarPlazo, setCambiarPlazo] = useState(false);

  return (
    <LayoutCoach>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[.06em] text-tinta-3 md:text-xs">BITÁCORA PERSONAL · PRIVADA</span>
        <h1 className="m-0 font-titulo text-[24px] font-bold text-vino md:text-[30px]">Bitácoras de la semana</h1>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => ir(sumarSemanas(lunes, -1))} aria-label="Semana anterior" className="flex h-11 w-11 items-center justify-center rounded-campo border border-linea-campo bg-white text-vino"><Icon name="atras" /></button>
        <div className="flex min-w-0 flex-grow flex-col">
          <strong className="font-titulo text-[17px] text-tinta">Semana del {rangoSemana(lunes)}</strong>
          <span className="text-xs text-tinta-2">{vencio ? 'Venció' : 'Vence'} {cuandoVence(vence)}{esOmision(lunes, vence) ? '' : ' · fecha cambiada'}</span>
          <button onClick={() => setCambiarPlazo(true)} className="flex items-center gap-1 self-start bg-transparent p-0 py-1 text-xs font-semibold text-vino underline">
            <Icon name="editar" size={14} /> Cambiar fecha de entrega
          </button>
        </div>
        <button onClick={() => ir(sumarSemanas(lunes, 1))} disabled={lunes >= actual} aria-label="Semana siguiente" className="flex h-11 w-11 rotate-180 items-center justify-center rounded-campo border border-linea-campo bg-white text-vino disabled:opacity-40"><Icon name="atras" /></button>
      </div>

      {q.isLoading ? <Cargando /> : q.isError ? (
        <EmptyState titulo="No se pudo cargar el seguimiento" texto={(q.error as Error).message} accion={<Boton onClick={() => q.refetch()}>Reintentar</Boton>} />
      ) : (
        <>
          <div role="tablist" aria-label="Filtrar" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([
              ['todas', 'Todos', filas.length],
              ['entregada', 'Entregadas', cuenta.entregada],
              ['pendiente', 'Pendientes', cuenta.pendiente],
              ['atrasada', 'Atrasadas', cuenta.atrasada],
              ['ayuda', 'Piden ayuda', cuenta.ayuda],
            ] as [Filtro, string, number][]).map(([k, t, n]) => (
              <button key={k} role="tab" aria-selected={filtro === k} onClick={() => setFiltro(k)} className={`flex flex-col items-start rounded-campo px-3 py-2.5 text-left transition-colors duration-200 ${filtro === k ? 'border border-vino bg-vino text-crema' : 'border border-linea bg-white text-tinta'}`}>
                <span className="font-titulo text-[24px] font-bold leading-none">{n}</span>
                <span className="text-xs font-semibold">{t}</span>
              </button>
            ))}
          </div>
          {cuenta.porRevisar > 0 && <p className="m-0 text-sm text-tinta-2">{cuenta.porRevisar === 1 ? '1 bitácora entregada espera tu revisión.' : `${cuenta.porRevisar} bitácoras entregadas esperan tu revisión.`}</p>}
          <div className="flex max-w-3xl flex-col gap-2">
            {visibles.length === 0 && <span className="text-sm text-tinta-3">Nadie en este filtro.</span>}
            {visibles.map((f) => <Fila key={f.alumno_id} f={f} lunes={lunes} />)}
          </div>
        </>
      )}
      <CambiarPlazo lunes={lunes} vence={vence} abierto={cambiarPlazo} onCerrar={() => setCambiarPlazo(false)} />
    </LayoutCoach>
  );
}

function Fila({ f, lunes }: { f: FilaResumen; lunes: string }) {
  const contenido = (
    <>
      <Avatar iniciales={f.iniciales} color={f.color} size={36} />
      <span className="flex min-w-0 flex-grow flex-col">
        <strong className="truncate text-[15px] text-tinta">{f.nombre_visible}</strong>
        <span className="text-xs text-tinta-3">{f.entregada_at ? `Entregó ${haceCuanto(f.entregada_at)}` : f.estado === 'devuelta' ? 'Corrigiendo' : 'Sin entregar'}</span>
      </span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {f.necesita_ayuda && <span className="rounded-full bg-urgente-fondo px-2 py-0.5 text-[11px] font-semibold text-urgente">Pide ayuda</span>}
        {f.tarde && <span className="rounded-full bg-urgente-fondo px-2 py-0.5 text-[11px] font-semibold text-urgente">Tarde</span>}
        {f.atrasada && <span className="rounded-full bg-vino px-2 py-0.5 text-[11px] font-semibold text-crema">Atrasada</span>}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.estado === 'entregada' ? 'bg-ambar text-vino-oscuro' : 'bg-crema text-vino'}`}>{ETIQUETA_ESTADO_BITACORA[f.estado]}</span>
      </span>
    </>
  );
  const clase = 'flex min-h-tap items-center gap-3 rounded-campo border border-linea bg-white p-2.5 no-underline';
  // Solo se abre lo entregado (o devuelto); un borrador sigue siendo privado del alumno hasta que lo entregue
  return f.bitacora_id && f.estado !== 'pendiente'
    ? <Link to={`/coach/bitacoras/${f.bitacora_id}?semana=${lunes}`} className={`${clase} transition-colors duration-150 hover:bg-kanban`}>{contenido}</Link>
    : <div className={clase}>{contenido}</div>;
}

export function BitacoraDetalle() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const q = useBitacora(id);
  const { data: venceB = new Date() } = usePlazoBitacora(q.data?.semana ?? lunesDe());
  const { data: resumen = [] } = useResumenBitacoras(q.data?.semana ?? '', !!q.data);
  const revisar = useRevisarBitacora();
  const toast = useToast();
  const [retro, setRetro] = useState<string | null>(null);
  const b = q.data;
  const alumno = resumen.find((r) => r.alumno_id === b?.alumno_id);
  const volver = `/coach/bitacoras${params.get('semana') ? `?semana=${params.get('semana')}` : ''}`;
  const texto = retro ?? b?.retro ?? '';

  async function guardar(devolver: boolean) {
    try {
      await revisar.mutateAsync({ id: b!.id, retro: texto, devolver });
      toast({ titulo: devolver ? 'Bitácora devuelta.' : 'Bitácora revisada.', texto: devolver ? 'Le llegó un aviso para corregirla.' : undefined });
      nav(volver);
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se guardó.', texto: (e as Error).message });
    }
  }

  return (
    <LayoutCoach>
      <Link to={volver} className="flex items-center gap-1.5 self-start text-sm font-semibold"><Icon name="atras" size={16} /> Bitácoras de la semana</Link>
      {q.isLoading ? <Cargando /> : !b ? (
        <EmptyState titulo="No encontré esa bitácora" texto="Puede que ya no exista." />
      ) : (
        <div className="flex max-w-2xl flex-col gap-4">
          <div className="flex items-center gap-3">
            {alumno && <Avatar iniciales={alumno.iniciales} color={alumno.color} size={44} />}
            <div className="flex min-w-0 flex-col">
              <h1 className="m-0 font-titulo text-[22px] font-bold text-vino">{alumno?.nombre_visible ?? 'Alumno'}</h1>
              <span className="text-xs text-tinta-2">
                Semana del {rangoSemana(b.semana)} · {ETIQUETA_ESTADO_BITACORA[b.estado]}
                {b.primera_entrega_at && new Date(b.primera_entrega_at) > venceB ? ' · entregada tarde' : ''}
              </span>
            </div>
          </div>
          <Lectura b={b} />
          {b.estado === 'devuelta' ? (
            <section className="flex flex-col gap-1 rounded-tarjeta border-2 border-ambar bg-white p-3.5">
              <strong className="text-sm text-vino">La devolviste para corregir</strong>
              <p className="m-0 whitespace-pre-line text-sm">{b.retro}</p>
            </section>
          ) : (
            <section className="flex flex-col gap-2 rounded-tarjeta border border-linea bg-white p-3.5">
              <label htmlFor="retro" className="text-sm font-semibold text-vino">Tu retroalimentación</label>
              <textarea id="retro" value={texto} maxLength={4000} rows={4} onChange={(e) => setRetro(e.target.value)} placeholder="Qué estuvo bien y qué puede mejorar" className={`${claseCampo} h-auto py-3`} />
              <span className="text-xs text-tinta-3">Para devolverla escribe qué hay que corregir: el alumno recibe un aviso y puede volver a entregarla.</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Boton variante="secundario" disabled={revisar.isPending || !texto.trim()} onClick={() => void guardar(true)}>Devolver para corregir</Boton>
                <Boton className="flex-grow" disabled={revisar.isPending} onClick={() => void guardar(false)}><Icon name="palomita" size={18} /> {b.estado === 'revisada' ? 'Actualizar revisión' : 'Marcar revisada'}</Boton>
              </div>
            </section>
          )}
        </div>
      )}
    </LayoutCoach>
  );
}

/** El coach cambia la fecha de entrega de una semana (los alumnos reciben un aviso). */
function CambiarPlazo({ lunes, vence, abierto, onCerrar }: { lunes: string; vence: Date; abierto: boolean; onCerrar: () => void }) {
  const fijar = useFijarPlazo();
  const toast = useToast();
  const [valor, setValor] = useState<string | null>(null);
  const v = valor ?? aInputLocal(vence.toISOString());
  async function guardar(nuevo: string | null) {
    try {
      await fijar.mutateAsync({ lunes, vence: nuevo });
      toast({ titulo: 'Fecha de entrega actualizada.', texto: 'Los alumnos recibieron un aviso.' });
      setValor(null);
      onCerrar();
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se cambió.', texto: (e as Error).message });
    }
  }
  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo={`Fecha de entrega · semana del ${rangoSemana(lunes)}`}>
      <Campo id="plazo-bitacora" label="Vence (hora de Mérida)" ayuda="Puedes adelantarla o darles más tiempo, hasta 5 semanas después de que empieza la semana. Entregar después se marca como tarde.">
        <input id="plazo-bitacora" type="datetime-local" value={v} onChange={(e) => setValor(e.target.value)} className={claseCampo} />
      </Campo>
      <div className="flex flex-col gap-2">
        <Boton disabled={!v || fijar.isPending} onClick={() => void guardar(deInputLocal(v))}>Guardar fecha</Boton>
        {!esOmision(lunes, vence) && (
          <Boton variante="secundario" disabled={fijar.isPending} onClick={() => void guardar(null)}>Volver al domingo 8:00 p. m.</Boton>
        )}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
      </div>
    </Sheet>
  );
}
