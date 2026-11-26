// Mis bitácoras (alumno): varias por semana (una por día de taller), también atrasadas desde el arranque.
// Cada una es un borrador que se guarda solo y se entrega con las tres preguntas. Privadas: solo las ven
// el alumno y el coach. El plazo de la semana (domingo 8 p. m. por omisión) lo puede cambiar el coach.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { TextoLibre } from '../components/TextoLibre';
import { Boton, Cargando, HeaderVino, PantallaCel, TituloSeccion, claseCampo, useToast } from '../components/ui';
import {
  ETIQUETA_ESTADO_BITACORA, PREGUNTAS, diaBitacora, hoyMerida, lunesDe, rangoSemana, semanaAbierta, sumarSemanas, useEntregarBitacora,
  useGuardarBitacora, useBitacorasSemana, useInicioBitacoras, useMisBitacoras, plazoTexto, usePlazoBitacora,
  type Bitacora as TBitacora, type DatosBitacora, type EvidenciaBitacora,
} from '../lib/bitacoras';
import { esMia, useTareas } from '../lib/datos';
import { useMateriales } from '../lib/materiales';
import { useSesion } from '../lib/sesion';
import { respaldo } from '../lib/cache-privada';
import { haceCuanto } from '../lib/fechas';
import type { Tarea } from '../lib/tipos';

type MaterialMin = { id: string; titulo: string; retirado_at?: string | null };

const vacia = (): DatosBitacora => ({ aporte: '', aprendizaje: '', siguiente: '', necesita_ayuda: false, texto_libre: '', evidencias: [] });
const deServidor = (b: TBitacora | null | undefined): DatosBitacora =>
  b
    ? {
        aporte: b.aporte, aprendizaje: b.aprendizaje, siguiente: b.siguiente, necesita_ayuda: b.necesita_ayuda, texto_libre: b.texto_libre,
        evidencias: b.bitacora_evidencias.map((e) =>
          e.tipo === 'tarea' ? { tipo: 'tarea', tarea_id: e.tarea_id! } : e.tipo === 'material' ? { tipo: 'material', material_id: e.material_id! } : { tipo: 'enlace', url: e.url!, nombre: e.nombre },
        ),
      }
    : vacia();

type Respaldo = { id: string; d: DatosBitacora; version: number; at: number; fecha: string; semana: string };
const lunesDeFecha = (fecha: string) => lunesDe(new Date(`${fecha}T12:00:00-06:00`));

export default function Bitacora() {
  const { perfil } = useSesion();
  const uid = perfil?.id ?? '';
  const [params, setParams] = useSearchParams();
  const actual = lunesDe();
  const pedida = params.get('semana');
  const lunes = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) && pedida <= actual ? pedida : actual;
  const sel = params.get('id'); // bitácora abierta (o una nueva, por su id generado aquí)
  const q = useBitacorasSemana(perfil?.id, lunes);
  const hist = useMisBitacoras(perfil?.id);
  const { data: inicio } = useInicioBitacoras();
  const [recargas, setRecargas] = useState(0);
  const lista = q.data ?? [];
  const abierta = semanaAbierta(lunes, inicio);
  const { data: vence = new Date() } = usePlazoBitacora(lunes);
  const plazo = plazoTexto(vence);
  const entregadas = lista.filter((b) => b.estado === 'entregada' || b.estado === 'revisada');
  // Bitácoras nuevas que solo existen en este teléfono (se escribieron sin conexión y no llegaron al servidor)
  const enServidor = new Set([...(hist.data ?? []).map((h) => h.id), ...lista.map((b) => b.id)]);
  const localesTodas = uid
    ? respaldo
        .listar<Respaldo>(uid, 'bitacora.')
        // El id de la bitácora va en el nombre del respaldo (bitacora.<id>); valor.id es el de la edición
        .map((x) => ({ ...x.valor, id: x.nombre.slice('bitacora.'.length) }))
        .filter((v) => v.semana && !enServidor.has(v.id))
    : [];
  const locales = localesTodas.filter((v) => v.semana === lunes);
  // Borradores: todo lo que aún no se entrega, de cualquier semana (para retomarlo cuando quieras)
  const borradores = [
    ...(hist.data ?? []).filter((h) => h.estado === 'borrador' || h.estado === 'devuelta')
      .map((h) => ({ id: h.id, semana: h.semana, fecha: h.fecha, resumen: h.aporte, devuelta: h.estado === 'devuelta', local: false, at: h.actualizado_at })),
    ...localesTodas.map((l) => ({ id: l.id, semana: l.semana, fecha: l.fecha, resumen: l.d.aporte, devuelta: false, local: true, at: new Date(l.at).toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const salirEditor = useRef<(() => Promise<boolean>) | null>(null);
  const toastP = useToast();
  // Moverse dentro de la bitácora espera a que se confirme el guardado; si falla, se queda aquí
  async function ir(p: { semana?: string; id?: string | null }) {
    if (salirEditor.current && !(await salirEditor.current())) {
      toastP({ tipo: 'error', titulo: 'No se guardó tu bitácora.', texto: 'Te quedas aquí para que no pierdas lo escrito. Toca «Reintentar».' });
      return;
    }
    const semana = p.semana ?? lunes;
    const nuevo: Record<string, string> = {};
    if (semana !== actual) nuevo.semana = semana;
    if (p.id) nuevo.id = p.id;
    setParams(nuevo, { replace: true });
  }
  const nueva = () => void ir({ id: crypto.randomUUID() });

  // Semanas con bitácoras (para ponerse al día o revisar)
  const semanas = [...new Set((hist.data ?? []).map((h) => h.semana))].filter((x) => x !== lunes);
  const actualB = sel ? lista.find((b) => b.id === sel) ?? null : null;
  const localSel = sel ? locales.find((l) => l.id === sel) ?? null : null;

  return (
    <PantallaCel>
      <HeaderVino titulo="Mis bitácoras" subtitulo="Solo las ven tú y el coach" atras="/">
        <div className="flex items-center gap-2">
          <button onClick={() => void ir({ semana: sumarSemanas(lunes, -1) })} disabled={!semanaAbierta(sumarSemanas(lunes, -1), inicio) && !semanas.includes(sumarSemanas(lunes, -1))} aria-label="Semana anterior" className="flex h-11 w-11 items-center justify-center rounded-campo border border-crema/35 bg-transparent text-crema disabled:opacity-40">
            <Icon name="atras" />
          </button>
          <div className="flex min-w-0 flex-grow flex-col items-center">
            <strong className="font-titulo text-[17px]">Semana del {rangoSemana(lunes)}</strong>
            <span className="text-xs opacity-90">{lunes === actual ? 'Esta semana' : abierta ? 'Puedes entregar atrasada' : 'Ya no está abierta'}</span>
          </div>
          <button onClick={() => void ir({ semana: sumarSemanas(lunes, 1) })} disabled={lunes >= actual} aria-label="Semana siguiente" className="flex h-11 w-11 rotate-180 items-center justify-center rounded-campo border border-crema/35 bg-transparent text-crema disabled:opacity-40">
            <Icon name="atras" />
          </button>
        </div>
      </HeaderVino>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {q.isLoading ? <Cargando /> : q.isError ? (
          <p className="m-0 rounded-campo bg-[#F6D6D6] p-3 text-sm text-vino">{(q.error as Error).message}</p>
        ) : sel ? (
          <>
            <button type="button" onClick={() => void ir({ id: null })} className="flex items-center gap-1.5 self-start bg-transparent p-0 text-sm font-semibold text-vino">
              <Icon name="atras" size={16} /> Bitácoras de esta semana
            </button>
            {actualB?.retro && (
              <section className={`flex flex-col gap-1 rounded-tarjeta p-3.5 ${actualB.estado === 'devuelta' ? 'border-2 border-ambar bg-white' : 'bg-crema'}`}>
                <strong className="text-sm text-vino">{actualB.estado === 'devuelta' ? 'El coach te pidió corregir' : 'Comentario del coach'}</strong>
                <p className="m-0 whitespace-pre-line text-sm leading-[1.45]">{actualB.retro}</p>
              </section>
            )}
            {actualB && (actualB.estado === 'entregada' || actualB.estado === 'revisada') ? (
              <>
                <span className="text-sm text-tinta-2">Bitácora del {diaBitacora(actualB.fecha)} · {ETIQUETA_ESTADO_BITACORA[actualB.estado]}</span>
                <Lectura b={actualB} />
              </>
            ) : actualB?.estado === 'devuelta' || abierta ? (
              <Editor
                key={`${sel}-${recargas}`}
                id={sel}
                lunes={lunes}
                fechaInicial={actualB?.fecha ?? localSel?.fecha ?? (lunes === actual ? hoyMerida() : lunes)}
                inicial={actualB}
                fijarFecha={actualB?.estado === 'devuelta'}
                salirRef={salirEditor}
                onRecargar={async () => { await q.refetch(); setRecargas((n) => n + 1); }}
                onEntregada={() => void ir({ id: null })}
              />
            ) : (
              <p className="m-0 text-sm text-tinta-2">Esta semana ya no está abierta para escribir.</p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${entregadas.length ? 'bg-vino text-crema' : 'bg-crema text-vino'}`}>
                {entregadas.length === 0 ? 'Sin entregar' : entregadas.length === 1 ? '1 entregada' : `${entregadas.length} entregadas`}
              </span>
              {abierta && <span className={`text-xs ${plazo.tono === 'normal' ? 'text-tinta-2' : 'font-semibold text-urgente'}`}>{plazo.texto}</span>}
            </div>
            <p className="m-0 text-xs text-tinta-2">Puedes entregar una por cada día de taller; con una entregada cumples la semana.</p>
            {borradores.length > 0 && (
              <section aria-label="Borradores" className="flex flex-col gap-2 rounded-tarjeta border border-linea bg-kanban p-3">
                <div className="flex flex-col">
                  <strong className="text-[15px] text-vino">Borradores · {borradores.length}</strong>
                  <span className="text-xs text-tinta-3">Se guardan solos, aunque cierres la app o te quedes sin señal. Retómalos cuando quieras.</span>
                </div>
                {borradores.map((x) => (
                  <button key={x.id} type="button" onClick={() => void ir({ semana: x.semana, id: x.id })} className={`flex min-h-tap w-full items-center gap-3 rounded-campo border bg-white p-2.5 text-left ${x.devuelta || x.local ? 'border-2 border-ambar' : 'border-linea'}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino"><Icon name={x.local ? 'sinred' : 'editar'} size={16} /></span>
                    <span className="flex min-w-0 flex-grow flex-col">
                      <strong className="text-sm text-tinta">Bitácora del {diaBitacora(x.fecha)}</strong>
                      <span className={`truncate text-xs ${x.local || x.devuelta ? 'text-urgente' : 'text-tinta-3'}`}>
                        {x.local ? 'Solo está en este teléfono: ábrela para guardarla' : x.devuelta ? 'El coach te pidió corregirla' : `${x.resumen.trim() || 'Sin escribir todavía'} · guardado ${haceCuanto(x.at)}`}
                      </span>
                    </span>
                  </button>
                ))}
              </section>
            )}
            {lista.length === 0 && locales.length === 0 && (
              <p className="m-0 text-sm text-tinta-3">{abierta ? 'Todavía no escribes ninguna esta semana.' : 'No escribiste bitácoras esta semana.'}</p>
            )}
            {lista.map((b) => (
              <button key={b.id} type="button" onClick={() => void ir({ id: b.id })} className={`flex min-h-tap w-full items-center gap-3 rounded-tarjeta border bg-white p-3 text-left ${b.estado === 'devuelta' ? 'border-2 border-ambar' : 'border-linea'}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-campo ${b.estado === 'entregada' || b.estado === 'revisada' ? 'bg-atiempo-fondo text-atiempo' : 'bg-crema text-vino'}`}>
                  <Icon name={b.estado === 'entregada' || b.estado === 'revisada' ? 'palomita' : 'editar'} size={18} />
                </span>
                <span className="flex min-w-0 flex-grow flex-col">
                  <strong className="text-sm text-tinta">Bitácora del {diaBitacora(b.fecha)}</strong>
                  <span className="truncate text-xs text-tinta-3">{b.aporte.trim() || 'Sin escribir todavía'}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-vino">{ETIQUETA_ESTADO_BITACORA[b.estado]}</span>
              </button>
            ))}
            {locales.map((l) => (
              <button key={l.id} type="button" onClick={() => void ir({ id: l.id })} className="flex min-h-tap w-full items-center gap-3 rounded-tarjeta border-2 border-ambar bg-white p-3 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-campo bg-crema text-vino"><Icon name="sinred" size={18} /></span>
                <span className="flex min-w-0 flex-grow flex-col">
                  <strong className="text-sm text-tinta">Bitácora del {diaBitacora(l.fecha)}</strong>
                  <span className="text-xs text-urgente">Solo está en este teléfono: ábrela para guardarla</span>
                </span>
              </button>
            ))}
            {abierta && (
              <Boton onClick={nueva}><Icon name="mas" size={18} /> {lista.length ? 'Otra bitácora (otro día de taller)' : 'Escribir bitácora'}</Boton>
            )}
            {semanas.length > 0 && (
              <section className="flex flex-col gap-2 pb-4">
                <TituloSeccion>Otras semanas</TituloSeccion>
                {semanas.map((w) => {
                  const de = (hist.data ?? []).filter((h) => h.semana === w);
                  const n = de.filter((h) => h.estado === 'entregada' || h.estado === 'revisada').length;
                  const corregir = de.some((h) => h.estado === 'devuelta');
                  return (
                    <button key={w} type="button" onClick={() => void ir({ semana: w })} className="flex min-h-tap w-full items-center justify-between gap-2 rounded-campo border border-linea bg-white px-3.5 py-2.5 text-left text-sm text-tinta">
                      <span>Semana del {rangoSemana(w)}</span>
                      <span className={`text-xs font-semibold ${corregir ? 'text-urgente' : 'text-vino'}`}>{corregir ? 'Por corregir' : n ? `${n} entregada${n > 1 ? 's' : ''}` : 'Borrador'}</span>
                    </button>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>
    </PantallaCel>
  );
}

// ---------- Editor con guardado automático ----------
type EstadoGuardado = 'guardado' | 'cambios' | 'guardando' | 'error' | 'conflicto';

function Editor({ id, lunes, fechaInicial, inicial, fijarFecha, onRecargar, onEntregada, salirRef }: {
  id: string; lunes: string; fechaInicial: string; inicial: TBitacora | null; fijarFecha: boolean;
  onRecargar: () => Promise<void>; onEntregada: () => void; salirRef: { current: (() => Promise<boolean>) | null };
}) {
  const { perfil: yo } = useSesion();
  const uid = yo?.id ?? '';
  const clave = `bitacora.${id}`;
  const [fecha, setFecha] = useState(fechaInicial);
  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;
  // Si quedó texto sin guardar en este teléfono (red caída al salir, app cerrada), se recupera
  const [recuperado] = useState<Respaldo | null>(() => {
    const x = uid ? respaldo.leer<Respaldo>(uid, clave) : null;
    return x && JSON.stringify(x.d) !== JSON.stringify(deServidor(inicial)) ? x : null;
  });
  const { mutateAsync: guardarRpc } = useGuardarBitacora();
  const entregar = useEntregarBitacora();
  const toast = useToast();
  const [d, setD] = useState<DatosBitacora>(() => recuperado?.d ?? deServidor(inicial));
  const [estado, setEstado] = useState<EstadoGuardado>(recuperado ? 'cambios' : 'guardado');
  const [error, setError] = useState<string | null>(null);
  const [verFormato, setVerFormato] = useState(false);
  const [libre, setLibre] = useState(!!inicial?.texto_libre);
  // Con texto recuperado se usa la versión en que se escribió: si el servidor cambió después, habrá conflicto (no se pisa)
  const servidor = useRef({ id: inicial?.id ?? null, version: recuperado ? recuperado.version : inicial?.version ?? 0 });
  const enCurso = useRef<Promise<boolean> | null>(null);
  const ultimo = useRef(d);
  ultimo.current = d;
  const sucio = useRef(!!recuperado); // hay algo escrito que no ha llegado al servidor
  const idRespaldo = useRef<{ datos: DatosBitacora; id: string } | null>(recuperado ? { datos: recuperado.d, id: recuperado.id } : null);
  const cambiar = (p: Partial<DatosBitacora>) => {
    setD((x) => ({ ...x, ...p }));
    sucio.current = true;
    setEstado('cambios');
  };

  // Guarda lo último escrito; si ya hay un guardado en curso, espera y vuelve a guardar (nunca dos a la vez)
  const guardarAhora = useCallback(async (): Promise<boolean> => {
    if (enCurso.current) await enCurso.current;
    const p = (async () => {
      setEstado('guardando');
      try {
        const enviado = ultimo.current;
        const respaldoEnviado = idRespaldo.current?.datos === enviado ? idRespaldo.current.id : null;
        const r = await guardarRpc({ id, fecha: fechaRef.current, version: servidor.current.version, datos: enviado });
        servidor.current = { id: r.id, version: r.version };
        if (ultimo.current === enviado) {
          sucio.current = false; // si escribió mientras guardaba, sigue pendiente
          // Solo si el respaldo guardado es justo lo que se confirmó (otra pestaña pudo escribir uno más nuevo)
          if (uid) {
            const r = respaldo.leer<Respaldo>(uid, clave);
            // También si su contenido es exactamente lo que se confirmó (ya no hay nada pendiente en él)
            if (r && (r.id === respaldoEnviado || JSON.stringify(r.d) === JSON.stringify(enviado))) respaldo.borrar(uid, clave);
          }
        }
        setEstado((e) => (e === 'guardando' ? 'guardado' : e));
        setError(null);
        return true;
      } catch (e) {
        const m = (e as Error).message;
        setEstado(/otra pestaña|conflicto|cambió/i.test(m) ? 'conflicto' : 'error');
        setError(m);
        return false;
      } finally {
        enCurso.current = null;
      }
    })();
    enCurso.current = p;
    return p;
  }, [guardarRpc, id, uid, clave]);

  // Respaldo local de lo escrito mientras no llegue al servidor
  useEffect(() => {
    if (!sucio.current || !uid) return;
    const idR = crypto.randomUUID();
    idRespaldo.current = { datos: d, id: idR };
    respaldo.guardar(uid, clave, { id: idR, d, version: servidor.current.version, at: Date.now(), fecha, semana: lunesDeFecha(fecha) } satisfies Respaldo);
  }, [d, fecha, uid, clave]);

  // La página pide salir: espera a que se confirme el guardado (true) o avisa que falló (false)
  useEffect(() => {
    salirRef.current = async () => (sucio.current ? guardarAhora() : true);
    return () => {
      salirRef.current = null;
    };
  }, [salirRef, guardarAhora]);

  // Si llega del servidor una versión más nueva (p. ej. al volver a una semana que se guardó al salir) y no
  // hay nada escrito pendiente, se adopta; si hay cambios pendientes, el guardado detectará el conflicto.
  useEffect(() => {
    if (inicial && inicial.version > servidor.current.version && !sucio.current) {
      servidor.current = { id: inicial.id, version: inicial.version };
      setD(deServidor(inicial));
      setEstado('guardado');
    }
  }, [inicial]);

  // No perder lo escrito: guarda lo pendiente al cambiar de semana o de pantalla (desmontar), al ocultar
  // la app y al cerrar; si se cierra con cambios sin guardar, el navegador pide confirmar.
  useEffect(() => {
    const pendiente = () => {
      if (sucio.current) void guardarAhora();
    };
    const oculto = () => document.visibilityState === 'hidden' && pendiente();
    const cerrar = (e: BeforeUnloadEvent) => {
      if (!sucio.current) return;
      pendiente();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', oculto);
    window.addEventListener('pagehide', pendiente);
    window.addEventListener('beforeunload', cerrar);
    return () => {
      document.removeEventListener('visibilitychange', oculto);
      window.removeEventListener('pagehide', pendiente);
      window.removeEventListener('beforeunload', cerrar);
      pendiente();
    };
  }, [guardarAhora]);

  useEffect(() => {
    if (estado !== 'cambios') return;
    const t = setTimeout(() => void guardarAhora(), 2500);
    return () => clearTimeout(t);
  }, [d, fecha, estado, guardarAhora]);

  // Rescate ante un conflicto: todo lo escrito en esta pantalla, como texto, al portapapeles
  async function copiarMiTexto() {
    const texto = [
      ...PREGUNTAS.map((p, i) => `${i + 1}. ${p.titulo}\n${d[p.campo]}`),
      d.texto_libre.trim() ? `Mi bitácora completa\n${d.texto_libre}` : '',
    ].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(texto);
      toast({ titulo: 'Copiado.', texto: 'Ya puedes cargar la versión guardada y pegar lo tuyo donde lo necesites.' });
    } catch {
      toast({ tipo: 'error', titulo: 'No se pudo copiar.', texto: 'Selecciona y copia el texto a mano antes de cargar la versión guardada.' });
    }
  }

  async function enviar() {
    const faltan = PREGUNTAS.filter((p) => !d[p.campo].trim());
    if (faltan.length) return setError(`Responde: ${faltan.map((p) => `«${p.titulo}»`).join(' y ')}`);
    if (!(await guardarAhora())) return;
    try {
      await entregar.mutateAsync({ id: servidor.current.id!, version: servidor.current.version });
      toast({ titulo: 'Bitácora entregada.', texto: 'El coach ya puede leerla.' });
      onEntregada();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const { data: tareas = [] } = useTareas();
  const misTareas = useMemo(() => tareas.filter((t) => esMia(t, uid)), [tareas, uid]);
  const { data: feed } = useMateriales();

  return (
    <form onSubmit={(e) => { e.preventDefault(); void enviar(); }} className="flex flex-col gap-4" noValidate>
      {recuperado && (
        <p role="status" className="m-0 rounded-campo border-2 border-ambar bg-white px-3 py-2.5 text-sm">
          <strong className="text-vino">Recuperamos lo que escribiste</strong> y no se había guardado ({haceCuanto(new Date(recuperado.at).toISOString())}). Se guardará en cuanto haya conexión.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bit-fecha" className="text-[15px] font-semibold text-vino">¿De qué día es esta bitácora?</label>
        <input
          id="bit-fecha"
          type="date"
          value={fecha}
          min={lunes}
          max={sumarSemanas(lunes, 1) <= hoyMerida() ? new Date(Date.parse(`${lunes}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10) : hoyMerida()}
          disabled={fijarFecha}
          onChange={(e) => {
            if (!e.target.value) return;
            setFecha(e.target.value);
            sucio.current = true;
            setEstado('cambios');
          }}
          className={claseCampo}
        />
        <span className="text-xs text-tinta-2">Por ejemplo, el día de taller que vas a contar.</span>
      </div>
      {PREGUNTAS.map((p, i) => (
        <div key={p.campo} className="flex flex-col gap-1.5">
          <label htmlFor={`bit-${p.campo}`} className="text-[15px] font-semibold text-vino">{i + 1}. {p.titulo}</label>
          {p.ayuda && <span className="text-xs text-tinta-2">{p.ayuda}</span>}
          <textarea id={`bit-${p.campo}`} value={d[p.campo]} maxLength={2000} rows={3} onChange={(e) => cambiar({ [p.campo]: e.target.value } as Partial<DatosBitacora>)} className={`${claseCampo} h-auto py-3`} />
        </div>
      ))}
      <label className="flex min-h-tap items-center gap-2.5 text-sm">
        <input type="checkbox" checked={d.necesita_ayuda} onChange={(e) => cambiar({ necesita_ayuda: e.target.checked })} className="h-5 w-5 accent-[#590202]" />
        Necesito ayuda del coach con algo de esto
      </label>

      <section className="flex flex-col gap-2 rounded-tarjeta border border-linea bg-white p-3.5">
        <button type="button" onClick={() => setLibre((v) => !v)} aria-expanded={libre} className="flex min-h-tap items-center justify-between gap-2 bg-transparent p-0 text-left">
          <span className="flex flex-col">
            <strong className="text-[15px] text-vino">Mi bitácora completa <span className="font-normal text-tinta-3">(opcional)</span></strong>
            <span className="text-xs text-tinta-2">Desde unas líneas hasta varias páginas. Puedes pegar la que hiciste en otro documento.</span>
          </span>
          <Icon name="mas" size={18} className={`shrink-0 transition-transform duration-200 ${libre ? 'rotate-45' : ''}`} />
        </button>
        {libre && (
          <>
            <div role="tablist" aria-label="Texto libre" className="grid grid-cols-2 gap-1 rounded-campo bg-kanban p-1">
              {[['Escribir', false], ['Vista previa', true]].map(([t, v]) => (
                <button key={String(t)} type="button" role="tab" aria-selected={verFormato === v} onClick={() => setVerFormato(v as boolean)} className={`h-9 rounded-[9px] text-[13px] font-semibold ${verFormato === v ? 'bg-vino text-crema' : 'bg-transparent text-vino'}`}>{t}</button>
              ))}
            </div>
            {verFormato ? (
              <div className="min-h-[120px] rounded-campo border border-linea p-3">{d.texto_libre.trim() ? <TextoLibre texto={d.texto_libre} /> : <span className="text-sm text-tinta-3">Nada escrito todavía.</span>}</div>
            ) : (
              <>
                <label htmlFor="bit-libre" className="sr-only">Mi bitácora completa</label>
                <textarea id="bit-libre" value={d.texto_libre} maxLength={50000} rows={10} onChange={(e) => cambiar({ texto_libre: e.target.value })} className={`${claseCampo} h-auto py-3 font-sans`} placeholder={'# Título\nUn párrafo…\n\n- Una viñeta\n- Otra viñeta'} />
                <span className="text-xs text-tinta-3"># para títulos, - para viñetas, 1. para listas numeradas, línea vacía para un párrafo nuevo. {d.texto_libre.length.toLocaleString('es-MX')} / 50 000</span>
              </>
            )}
          </>
        )}
      </section>

      <Evidencias d={d} cambiar={cambiar} misTareas={misTareas} materiales={feed?.materiales ?? []} />

      <div className="flex items-center gap-2 text-xs text-tinta-3" aria-live="polite">
        <Icon name={estado === 'guardado' ? 'palomita' : estado === 'error' || estado === 'conflicto' ? 'alerta' : 'editar'} size={14} />
        {estado === 'guardado' ? (servidor.current.id ? 'Borrador guardado' : 'Empieza a escribir; se guarda solo') : estado === 'guardando' ? 'Guardando…' : estado === 'cambios' ? 'Cambios sin guardar' : estado === 'conflicto' ? 'Hay una versión más nueva' : 'No se guardó'}
      </div>
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-campo bg-[#F6D6D6] px-3 py-2.5 text-sm font-semibold text-vino">
          <span>{error}</span>
          {estado === 'conflicto' && (
            <>
              <span className="text-xs font-normal">Antes de cargar la versión guardada, copia lo que escribiste para pegarlo después.</span>
              <Boton type="button" variante="fantasma" alto={44} onClick={() => void copiarMiTexto()}>
                <Icon name="documento" size={18} /> Copiar lo que escribí
              </Boton>
              <Boton type="button" variante="secundario" alto={44} onClick={() => void onRecargar()}>Cargar la versión guardada</Boton>
            </>
          )}
          {estado === 'error' && <Boton type="button" variante="secundario" alto={44} onClick={() => void guardarAhora()}>Reintentar</Boton>}
        </div>
      )}
      <div className="flex gap-2 pb-2">
        <Boton type="button" variante="secundario" disabled={estado === 'guardando'} onClick={() => void guardarAhora()}>Guardar</Boton>
        <Boton type="submit" className="flex-grow" disabled={entregar.isPending || estado === 'conflicto'}>
          <Icon name="enviar" size={18} /> {inicial?.estado === 'devuelta' ? 'Entregar corregida' : 'Entregar bitácora'}
        </Boton>
      </div>
    </form>
  );
}

// ---------- Evidencias (opcionales: algo que ya existe) ----------
function Evidencias({ d, cambiar, misTareas, materiales }: { d: DatosBitacora; cambiar: (p: Partial<DatosBitacora>) => void; misTareas: Tarea[]; materiales: MaterialMin[] }) {
  const [tipo, setTipo] = useState<'tarea' | 'material' | 'enlace'>('tarea');
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titulo = (e: EvidenciaBitacora) =>
    e.tipo === 'tarea' ? misTareas.find((t) => t.id === e.tarea_id)?.titulo ?? 'Tarea'
      : e.tipo === 'material' ? materiales.find((m) => m.id === e.material_id && !m.retirado_at)?.titulo ?? 'Evidencia no disponible'
        : e.url.replace(/^https:\/\//, '');
  function agregar() {
    if (!valor) return;
    if (d.evidencias.length >= 10) return setError('Hasta 10 evidencias.');
    let e: EvidenciaBitacora;
    if (tipo === 'enlace') {
      if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(valor.trim())) return setError('El enlace debe empezar con https://');
      e = { tipo: 'enlace', url: valor.trim() };
    } else e = tipo === 'tarea' ? { tipo, tarea_id: valor } : { tipo, material_id: valor };
    cambiar({ evidencias: [...d.evidencias, e] });
    setValor('');
    setError(null);
  }
  return (
    <section className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold text-vino">Evidencia <span className="font-normal text-tinta-3">(opcional)</span></span>
      <span className="text-xs text-tinta-2">Si ya existe una tarea, una publicación en Materiales o un enlace que muestra tu aporte, basta con vincularlo.</span>
      {d.evidencias.map((e, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-campo border border-linea bg-white p-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino"><Icon name={e.tipo === 'tarea' ? 'tablero' : e.tipo === 'material' ? 'documento' : 'enlace'} size={18} /></span>
          <span className="min-w-0 flex-grow truncate text-sm">{titulo(e)}</span>
          <button type="button" onClick={() => cambiar({ evidencias: d.evidencias.filter((_, j) => j !== i) })} aria-label="Quitar evidencia" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-transparent text-tinta-3"><Icon name="cerrar" size={16} /></button>
        </div>
      ))}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ev-tipo" className="sr-only">Tipo de evidencia</label>
        <select id="ev-tipo" value={tipo} onChange={(e) => { setTipo(e.target.value as typeof tipo); setValor(''); }} className={`${claseCampo} sm:w-40`}>
          <option value="tarea">Una tarea</option>
          <option value="material">Una publicación</option>
          <option value="enlace">Un enlace</option>
        </select>
        <label htmlFor="ev-valor" className="sr-only">Evidencia</label>
        {tipo === 'enlace' ? (
          <input id="ev-valor" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="url" placeholder="https://…" className={`${claseCampo} flex-grow`} />
        ) : (
          <select id="ev-valor" value={valor} onChange={(e) => setValor(e.target.value)} className={`${claseCampo} flex-grow`}>
            <option value="">{tipo === 'tarea' ? 'Elige una de tus tareas' : 'Elige una publicación'}</option>
            {(tipo === 'tarea' ? misTareas : materiales.filter((m) => !m.retirado_at)).map((x) => <option key={x.id} value={x.id}>{x.titulo}</option>)}
          </select>
        )}
        <Boton type="button" variante="fantasma" disabled={!valor} onClick={agregar}>Vincular</Boton>
      </div>
      {error && <span className="text-xs font-semibold text-vino">{error}</span>}
    </section>
  );
}

// ---------- Lectura (entregada o revisada) ----------
export function Lectura({ b }: { b: TBitacora }) {
  const { data: feed } = useMateriales();
  const { data: ts = [] } = useTareas();
  const mats: MaterialMin[] = feed?.materiales ?? [];
  const tars = ts;
  return (
    <div className="flex flex-col gap-3">
      {PREGUNTAS.map((p, i) => (
        <section key={p.campo} className="flex flex-col gap-1 rounded-tarjeta border border-linea bg-white p-3.5">
          <strong className="text-sm text-vino">{i + 1}. {p.titulo}</strong>
          <p className="m-0 whitespace-pre-line text-sm leading-[1.45]">{b[p.campo] || '—'}</p>
        </section>
      ))}
      {b.necesita_ayuda && <p className="m-0 rounded-campo bg-urgente-fondo px-3 py-2 text-sm font-semibold text-urgente">Pidió ayuda del coach</p>}
      {b.texto_libre.trim() && (
        <section className="flex flex-col gap-2 rounded-tarjeta border border-linea bg-white p-3.5">
          <strong className="text-sm text-vino">Bitácora completa</strong>
          <TextoLibre texto={b.texto_libre} />
        </section>
      )}
      {b.bitacora_evidencias.length > 0 && (
        <section className="flex flex-col gap-2">
          <strong className="text-sm text-vino">Evidencia</strong>
          {b.bitacora_evidencias.map((e) => {
            const t = e.tipo === 'tarea' ? tars.find((x) => x.id === e.tarea_id) : undefined;
            // Una publicación retirada (o que ya no se puede ver) se muestra como no disponible; el texto se conserva
            const m = e.tipo === 'material' ? mats.find((x) => x.id === e.material_id && !x.retirado_at) : undefined;
            const disponible = e.tipo === 'enlace' || (e.tipo === 'tarea' ? !!t : !!m);
            const clase = 'flex min-h-tap items-center gap-2.5 rounded-campo border border-linea bg-white p-2 text-sm no-underline';
            const contenido = (
              <>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino"><Icon name={e.tipo === 'tarea' ? 'tablero' : e.tipo === 'material' ? 'documento' : 'enlace'} size={18} /></span>
                <span className={`min-w-0 truncate ${disponible ? 'text-tinta' : 'text-tinta-3'}`}>{disponible ? (t?.titulo ?? m?.titulo ?? e.nombre ?? e.url?.replace(/^https:\/\//, '')) : 'Evidencia no disponible'}</span>
              </>
            );
            if (!disponible) return <div key={e.id} className={clase}>{contenido}</div>;
            if (e.tipo === 'enlace') return <a key={e.id} href={e.url!} target="_blank" rel="noopener noreferrer nofollow" className={clase}>{contenido}</a>;
            return <Link key={e.id} to={e.tipo === 'tarea' ? `/tarea/${e.tarea_id}` : '/materiales'} className={clase}>{contenido}</Link>;
          })}
        </section>
      )}
    </div>
  );
}
