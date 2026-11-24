import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Battery } from '../components/Battery';
import { Icon } from '../components/Icon';
import { Avatar, Boton, Cargando, Chip, ChipFecha, EmptyState, HeaderVino, Sheet, claseCampo, useToast } from '../components/ui';
import { PedirAyuda } from './MiTablero';
import { RegresarConNota } from './Revisar';
import {
  esMia, useAgregarEnlace, useAprobar, useAreas, useAvanceMetas, useComentar, useMarcarPaso, useMembresias, useMetas,
  useMoverEstado, usePedirAyuda, usePerfiles, useRegresar, useSubirFoto, useTareaDetalle,
} from '../lib/datos';
import { chipFecha, haceCuanto } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { ETIQUETA_ESTADO, ROBOT_NOMBRE } from '../lib/tipos';

export default function TareaDetalle() {
  const { id } = useParams();
  const { perfil, esCoach, esTutor, areasLider } = useSesion();
  const q = useTareaDetalle(id);
  const { data: areas = [] } = useAreas();
  const { data: perfiles = [] } = usePerfiles();
  const { data: metas = [] } = useMetas();
  const { data: avance = [] } = useAvanceMetas();
  const { data: membresias = [] } = useMembresias();
  const paso = useMarcarPaso();
  const comentar = useComentar();
  const foto = useSubirFoto();
  const enlace = useAgregarEnlace();
  const mover = useMoverEstado();
  const ayuda = usePedirAyuda();
  const aprobar = useAprobar();
  const regresar = useRegresar();
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const [verEnlace, setVerEnlace] = useState(false);
  const [url, setUrl] = useState('');
  const [verAyuda, setVerAyuda] = useState(false);
  const [verRegresar, setVerRegresar] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const volver = esTutor ? '/familia' : esCoach ? '/coach' : '/';
  if (q.isLoading) return <div className="mx-auto max-w-[480px]"><HeaderVino titulo="Tarea" atras={volver} /><Cargando /></div>;
  const t = q.data?.tarea;
  if (!t || !perfil) {
    return (
      <div className="mx-auto max-w-[480px]">
        <HeaderVino titulo="Tarea" atras={volver} />
        <div className="m-4"><EmptyState titulo="No encontramos esta tarea" texto="Puede que la hayan borrado o que no sea de tu área." accion={<Link to={volver} className="font-semibold">Regresar</Link>} /></div>
      </div>
    );
  }
  const { evidencias, firmadas, comentarios, historial } = q.data!;

  const area = areas.find((a) => a.id === t.area_id);
  const meta = metas.find((m) => m.id === t.meta_id);
  const am = avance.find((a) => a.meta_id === t.meta_id);
  const gestor = esCoach || areasLider.includes(t.area_id);
  const mia = esMia(t, perfil.id);
  const trabaja = !esTutor && (gestor || mia);
  const hecha = t.estado === 'hecha';
  const persona = (uid: string | null) => perfiles.find((p) => p.id === uid);
  const etiquetaPersona = (uid: string | null) => {
    const p = persona(uid);
    if (!p) return 'Alguien';
    const corto = p.nombre_visible.split(' ')[0] === 'Coach' ? p.nombre_visible : p.nombre_visible.split(' ')[0];
    if (p.rol_global === 'coach' || p.rol_global === 'coach_aux') return `${corto} (coach)`;
    if (membresias.some((m) => m.usuario_id === p.id && m.area_id === t.area_id && m.es_lider)) return `${corto} (líder)`;
    return corto;
  };
  const hechos = t.tarea_pasos.filter((p) => p.hecho).length;
  const fechaTxt = chipFecha(t.fecha_limite, hecha).texto;

  async function enviarComentario(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    try {
      await comentar.mutateAsync({ tarea_id: t!.id, texto, autor_id: perfil!.id });
      setTexto('');
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se envió.', texto: (err as Error).message });
    }
  }

  async function subir(f: File | undefined) {
    if (!f) return;
    try {
      await foto.mutateAsync({ tarea_id: t!.id, archivo: f, subida_por: perfil!.id });
      toast({ titulo: 'Foto subida.' });
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se subió la foto.', texto: (err as Error).message });
    } finally {
      if (archivo.current) archivo.current.value = '';
    }
  }

  async function guardarEnlace(e: FormEvent) {
    e.preventDefault();
    try {
      await enlace.mutateAsync({ tarea_id: t!.id, url, subida_por: perfil!.id });
      setUrl('');
      setVerEnlace(false);
    } catch {
      toast({ tipo: 'error', titulo: 'Ese enlace no es válido.', texto: 'Copia la dirección completa, por ejemplo github.com/…' });
    }
  }

  async function aRevision() {
    try {
      await mover.mutateAsync({ id: t!.id, estado: 'en_revision' });
      toast({ titulo: 'Mandada a revisión.', texto: 'Tu líder la revisará.', deshacer: () => mover.mutate({ id: t!.id, estado: 'en_proceso' }) });
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se pudo mandar.', texto: (err as Error).message });
    }
  }

  async function aprobarTarea() {
    try {
      await aprobar.mutateAsync(t!.id);
      const quien = t!.tarea_responsables.map((r) => persona(r.usuario_id)?.nombre_visible.split(' ')[0]).filter(Boolean).join(' y ');
      toast({ titulo: 'Tarea aprobada.', texto: quien ? `Se sumó a la batería de ${quien}.` : undefined, deshacer: () => mover.mutate({ id: t!.id, estado: 'en_revision' }) });
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se pudo aprobar.', texto: (err as Error).message });
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-fondo" style={{ paddingBottom: trabaja && !hecha ? 96 : 24 }}>
      <HeaderVino
        titulo={t.titulo}
        subtitulo={`${ROBOT_NOMBRE[t.robot]} · ${hecha ? 'hecha' : !t.fecha_limite ? 'sin fecha' : fechaTxt.startsWith('venció') ? fechaTxt : `vence ${fechaTxt.toLowerCase()}`}`}
        atras={volver}
        accion={gestor && (
          <Link to={`/tarea/${t.id}/editar`} aria-label="Editar tarea" className="flex h-11 items-center rounded-campo border border-crema/35 px-3 text-[13px] text-crema no-underline hover:text-crema">Editar</Link>
        )}
      />

      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {area && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: area.color }}>
              <span className="h-2 w-2 rounded-full" style={{ background: area.color }} />{area.nombre}
            </span>
          )}
          <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: area?.color_claro, color: area?.color }}>{ETIQUETA_ESTADO[t.estado]}</span>
          <ChipFecha fecha={t.fecha_limite} hecha={hecha} />
          {t.pide_ayuda && !hecha && <Chip tono="urgente">Pidió ayuda</Chip>}
          <span className="ml-auto flex gap-1">
            {t.tarea_responsables.map((r) => {
              const p = persona(r.usuario_id);
              return p ? <Avatar key={r.usuario_id} iniciales={p.iniciales} color={p.color} size={30} /> : null;
            })}
            <span className="sr-only">Responsables: {t.tarea_responsables.map((r) => persona(r.usuario_id)?.nombre_visible).filter(Boolean).join(', ')}</span>
          </span>
        </div>
        {t.para_que_sirve && (
          <p className="m-0 rounded-[14px] border border-linea bg-white px-3.5 py-3 text-sm leading-[1.5]"><strong className="text-vino">Para qué sirve:</strong> {t.para_que_sirve}</p>
        )}
        {t.pide_ayuda && t.mensaje_ayuda && !hecha && (
          <p className="m-0 rounded-[14px] border-2 border-ambar bg-white px-3.5 py-3 text-sm leading-[1.5]"><strong className="text-vino">Pidió ayuda:</strong> “{t.mensaje_ayuda}”</p>
        )}
        {meta && (
          <div className="flex flex-col gap-2 rounded-[14px] bg-crema px-3.5 py-3 text-tinta">
            <span className="flex justify-between text-xs font-semibold text-vino"><span>Meta del robot</span><span>{am?.hechas ?? 0} de {am?.total ?? 0}</span></span>
            <strong className="font-titulo text-[15px] font-semibold">{meta.titulo}</strong>
            <Battery done={am?.hechas ?? 0} total={am?.total ?? 0} size="sm" />
          </div>
        )}
        {t.herramienta_url && (
          <a href={t.herramienta_url} target="_blank" rel="noreferrer" className="flex min-h-tap items-center gap-2.5 rounded-campo border border-linea bg-white px-3 py-2.5 text-[13px] text-tinta no-underline">
            <Icon name="enlace" size={18} />
            <span className="flex-grow truncate font-mono text-xs">Herramienta: {t.herramienta_url.replace(/^https?:\/\//, '')}</span>
          </a>
        )}
      </section>

      {t.tarea_pasos.length > 0 && (
        <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="m-0 font-titulo text-lg font-bold text-vino">Pasos</h2>
            <span className="font-mono text-xs text-tinta-3">{hechos}/{t.tarea_pasos.length}</span>
          </div>
          <div className="flex flex-col rounded-tarjeta border border-linea bg-white px-3.5 py-1">
            {t.tarea_pasos.map((p, i) => (
              <label key={p.id} className={`box-border flex min-h-tap items-start gap-3 py-2.5 text-sm leading-[1.4] ${i ? 'border-t border-[#F0E4CC]' : ''}`}>
                <input
                  type="checkbox"
                  checked={p.hecho}
                  disabled={!trabaja || hecha}
                  onChange={(e) => paso.mutate({ id: p.id, tarea_id: t.id, hecho: e.target.checked })}
                  className="m-0 h-[22px] w-[22px] shrink-0 accent-cobre"
                />
                <span className={p.hecho ? 'text-tinta-3 line-through' : ''}>{p.texto}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <h2 className="m-0 font-titulo text-lg font-bold text-vino">Evidencia</h2>
        {(evidencias.some((e) => e.tipo === 'foto') || (trabaja && !hecha)) && (
          <div className="grid grid-cols-3 gap-2">
            {evidencias.filter((e) => e.tipo === 'foto').map((e, i) => (
              <a key={e.id} href={firmadas[e.id]} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-campo" style={{ background: 'repeating-linear-gradient(135deg,#EFE2C8 0 8px,#F6EEDF 8px 16px)' }}>
                {firmadas[e.id] && <img src={firmadas[e.id]} alt={`Foto ${i + 1} de la evidencia`} loading="lazy" className="h-full w-full object-cover" />}
              </a>
            ))}
            {trabaja && !hecha && (
              <>
                <input ref={archivo} type="file" accept="image/*" capture="environment" className="sr-only" id="subir-foto" onChange={(e) => subir(e.target.files?.[0])} />
                <label htmlFor="subir-foto" className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-campo border-2 border-dashed border-[#A88F6A] bg-white p-1 text-center text-xs font-semibold text-vino">
                  <Icon name="camara" size={22} />
                  {foto.isPending ? 'Subiendo…' : 'Subir foto'}
                  <span className="text-[10px] font-normal leading-tight text-tinta-2">Solo del robot o del trabajo, sin caras</span>
                </label>
              </>
            )}
          </div>
        )}
        {evidencias.filter((e) => e.tipo === 'enlace').map((e) => (
          <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="flex min-h-tap items-center gap-2.5 rounded-campo border border-linea bg-white px-3 py-2.5 text-[13px] text-tinta no-underline">
            <Icon name="enlace" size={18} />
            <span className="flex-grow truncate font-mono text-xs">{e.url.replace(/^https?:\/\//, '')}</span>
          </a>
        ))}
        {!evidencias.length && !trabaja && <span className="text-sm text-tinta-3">Aún no hay evidencia.</span>}
        {trabaja && !hecha && (
          <Boton variante="secundario" alto={44} className="text-sm" onClick={() => setVerEnlace(true)}><Icon name="enlace" size={18} /> Agregar enlace</Boton>
        )}
      </section>

      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <h2 className="m-0 font-titulo text-lg font-bold text-vino">Comentarios</h2>
        {comentarios.length === 0 && <span className="text-sm text-tinta-3">Sin comentarios todavía.</span>}
        {comentarios.map((c) => {
          const p = persona(c.autor_id);
          return (
            <div key={c.id} className="flex gap-2.5">
              <Avatar iniciales={p?.iniciales ?? '?'} color={p?.color ?? '#6B5444'} size={32} />
              <div className="flex flex-grow flex-col gap-[3px] rounded-[4px_14px_14px_14px] border border-linea bg-white px-3 py-2.5">
                <span className="text-xs text-tinta-3"><strong className="text-tinta">{etiquetaPersona(c.autor_id)}</strong> · {haceCuanto(c.creado_at)}</span>
                <span className="whitespace-pre-wrap text-sm leading-[1.4]">{c.texto}</span>
              </div>
            </div>
          );
        })}
        {!esTutor && (
          <form onSubmit={enviarComentario} className="flex gap-2">
            <label htmlFor="nuevo-comentario" className="sr-only">Escribe un comentario</label>
            <input id="nuevo-comentario" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={1000} placeholder="Escribe un comentario" className={`${claseCampo} flex-grow`} />
            <button type="submit" aria-label="Enviar comentario" disabled={!texto.trim() || comentar.isPending} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-campo border-0 bg-vino text-crema disabled:opacity-60">
              <Icon name="enviar" />
            </button>
          </form>
        )}
      </section>

      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <h2 className="m-0 font-titulo text-lg font-bold text-vino">Historial</h2>
        <ol className="m-0 flex list-none flex-col gap-2.5 border-l-2 border-linea-campo p-0 pl-3.5">
          {historial.map((h) => (
            <li key={h.id} className="relative text-[13px] leading-[1.35]">
              <span aria-hidden="true" className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full bg-cobre" />
              {h.detalle ?? h.accion} <span className="text-tinta-3">· {haceCuanto(h.creado_at)}</span>
            </li>
          ))}
        </ol>
      </section>

      {trabaja && !hecha && (mia || t.estado === 'en_revision') && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[480px] gap-2 border-t border-linea bg-white px-4 pt-3" style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}>
          {gestor && t.estado === 'en_revision' ? (
            <>
              <Boton variante="secundario" onClick={() => setVerRegresar(true)}>Regresar con nota</Boton>
              <Boton className="flex-grow" onClick={aprobarTarea} disabled={aprobar.isPending}>Aprobar</Boton>
            </>
          ) : t.estado === 'en_revision' ? (
            <span className="flex h-12 flex-grow items-center justify-center rounded-campo bg-crema text-[15px] font-semibold text-vino">En revisión: tu líder la está viendo</span>
          ) : (
            <>
              <Boton variante="secundario" onClick={() => setVerAyuda(true)}>
                <Icon name="ayuda" size={18} />
                {t.pide_ayuda ? 'Ayuda pedida' : 'Pedir ayuda'}
              </Boton>
              {t.estado === 'por_hacer' && !gestor ? (
                <Boton className="flex-grow" onClick={() => mover.mutate({ id: t.id, estado: 'en_proceso' })}>Empezar</Boton>
              ) : (
                <Boton className="flex-grow" onClick={aRevision} disabled={mover.isPending}>Mandar a revisión</Boton>
              )}
            </>
          )}
        </div>
      )}

      <Sheet abierto={verEnlace} onCerrar={() => setVerEnlace(false)} titulo="Agregar enlace">
        <form onSubmit={guardarEnlace} className="flex flex-col gap-3">
          <label htmlFor="url-evidencia" className="text-[13px] font-semibold text-vino">Dirección del enlace</label>
          <input id="url-evidencia" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="github.com/…" className={`${claseCampo} font-mono`} />
          <div className="flex gap-2">
            <Boton type="button" variante="secundario" onClick={() => setVerEnlace(false)}>Cancelar</Boton>
            <Boton type="submit" className="flex-grow" disabled={!url.trim() || enlace.isPending}>Guardar enlace</Boton>
          </div>
        </form>
      </Sheet>
      <PedirAyuda tarea={verAyuda ? t : null} onCerrar={() => setVerAyuda(false)} guardar={async (pide, mensaje) => {
        try {
          await ayuda.mutateAsync({ id: t.id, pide, mensaje });
          setVerAyuda(false);
          toast({ titulo: pide ? 'Listo.' : 'Quitamos la solicitud.', texto: pide ? 'Tu líder ya sabe que necesitas ayuda.' : undefined });
        } catch (err) {
          toast({ tipo: 'error', titulo: 'No se pudo guardar.', texto: (err as Error).message });
        }
      }} />
      <RegresarConNota
        abierto={verRegresar}
        nombre={t.tarea_responsables.map((r) => persona(r.usuario_id)?.nombre_visible.split(' ')[0]).filter(Boolean).join(' y ')}
        onCerrar={() => setVerRegresar(false)}
        onEnviar={async (nota) => {
          await regresar.mutateAsync({ id: t.id, nota });
          setVerRegresar(false);
          toast({ titulo: 'Regresada con nota.' });
        }}
      />
    </div>
  );
}
