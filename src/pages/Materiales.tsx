// Materiales del equipo: feed tipo publicación (autor, título, nota, archivos o enlaces y comentarios).
// Un solo feed para todo Zero-Ohms; la base de datos decide quién ve, publica, comenta y modera.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Avatar, Boton, Campo, Cargando, EmptyState, HeaderVino, PantallaCel, Sheet, claseCampo, useToast } from '../components/ui';
import { useAreas, useTareas } from '../lib/datos';
import { haceCuanto } from '../lib/fechas';
import {
  MAX_ADJUNTOS, abrirArchivo, claseDe, leerCodigo, limpiarMateriales, useFotoMaterial, type InformeLimpieza, quitarRegistrado, sitioDe, useComentarMaterial, useComentariosMaterial,
  useEditarMaterial, useMateriales, usePublicarMaterial, useRetirarComentario, useRetirarMaterial, validarArchivo,
  type ArchivoPendiente, type Borrador,
} from '../lib/materiales';
import { useSesion } from '../lib/sesion';
import { CATEGORIAS_MATERIAL, type AdjuntoMaterial, type AutorMaterial, type CategoriaMaterial, type Material } from '../lib/tipos';

type Filtro = CategoriaMaterial | 'todo';
const textoCategoria = (c: CategoriaMaterial) => CATEGORIAS_MATERIAL.find((x) => x.id === c)?.texto ?? c;
const nuevoId = () => crypto.randomUUID();

export default function Materiales() {
  const { esCoach, esCoachPrincipal } = useSesion();
  const q = useMateriales();
  const { data: areas = [] } = useAreas();
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [area, setArea] = useState<string>('todas');
  const [nueva, setNueva] = useState(false);

  const lista = useMemo(
    () => (q.data?.materiales ?? []).filter((m) => (filtro === 'todo' || m.categoria === filtro) && (area === 'todas' || m.area_id === area)),
    [q.data, filtro, area],
  );

  const filtros = (
    <div className="flex flex-col gap-2.5">
      <div role="tablist" aria-label="Categoría" className="sin-barra -mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {([{ id: 'todo', texto: 'Todo', icono: 'tablero' }, ...CATEGORIAS_MATERIAL] as { id: Filtro; texto: string; icono: string }[]).map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={filtro === c.id}
            onClick={() => setFiltro(c.id)}
            className={`flex h-10 shrink-0 snap-start items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200 ${filtro === c.id ? 'border border-vino bg-vino text-crema' : 'border border-linea-campo bg-white text-vino'}`}
          >
            <Icon name={c.icono} size={16} /> {c.texto}
          </button>
        ))}
      </div>
      {filtro === 'programacion' && <p className="m-0 text-xs text-tinta-3">Banco de códigos: el código del equipo con su autor. Se ve como texto y se descarga; nunca se ejecuta aquí.</p>}
      <label className="flex items-center gap-2 text-[13px] text-tinta-2">
        Área
        <select value={area} onChange={(e) => setArea(e.target.value)} className="h-10 min-w-0 flex-1 rounded-full border border-linea-campo bg-white px-3 text-base text-tinta md:max-w-xs">
          <option value="todas">Todas las áreas</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </label>
    </div>
  );

  const feed = q.isLoading ? <Cargando /> : q.isError ? (
    <EmptyState titulo="No se pudieron cargar los materiales" texto={(q.error as Error).message} accion={<Boton onClick={() => q.refetch()}>Reintentar</Boton>} />
  ) : lista.length === 0 ? (
    <EmptyState
      titulo={filtro === 'todo' && area === 'todas' ? 'Aún no hay materiales' : 'Nada en este filtro'}
      texto="Comparte código, fotos, PDF o enlaces para que el equipo los encuentre después."
      accion={<Boton onClick={() => setNueva(true)}><Icon name="mas" size={18} /> Publicar</Boton>}
    />
  ) : (
    <div className="flex flex-col gap-3">
      {lista.map((m) => <TarjetaMaterial key={m.id} m={m} autor={q.data!.autores[m.autor_id]} areaNombre={areas.find((a) => a.id === m.area_id)?.nombre} />)}
    </div>
  );

  const hoja = <NuevaPublicacion abierto={nueva} onCerrar={() => setNueva(false)} />;

  if (esCoach) {
    return (
      <LayoutCoach>
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[.06em] text-tinta-3 md:text-xs">TODO EL EQUIPO</span>
            <h1 className="m-0 font-titulo text-[24px] font-bold text-vino md:text-[30px]">Materiales del equipo</h1>
          </div>
          <Boton onClick={() => setNueva(true)} alto={44}><Icon name="mas" size={18} /> Publicar</Boton>
        </div>
        <div className="flex max-w-2xl flex-col gap-4">{esCoachPrincipal && <Limpieza />}{filtros}{feed}</div>
        {hoja}
      </LayoutCoach>
    );
  }
  return (
    <PantallaCel>
      <HeaderVino titulo="Materiales del equipo" subtitulo="Código, fotos, documentos y enlaces de todo Zero-Ohms" />
      <div className="flex flex-col gap-4 px-4 pt-4">{filtros}{feed}</div>
      <button
        onClick={() => setNueva(true)}
        className="fixed bottom-[92px] right-[max(18px,calc(50vw-222px))] z-30 flex h-14 items-center gap-2 rounded-[18px] bg-ambar px-5 font-semibold text-vino-oscuro shadow-[0_8px_20px_rgba(89,2,2,.25)] transition-transform duration-150 active:scale-95"
      >
        <Icon name="mas" size={20} /> Publicar
      </button>
      {hoja}
    </PantallaCel>
  );
}

// ---------- Limpieza (solo coach principal) ----------
const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
/** Borradores sin actividad por 30 días y archivos que nunca se registraron. Primero se simula; borrar es aparte. */
function Limpieza() {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [informe, setInforme] = useState<InformeLimpieza | null>(null);
  const [ocupado, setOcupado] = useState<'simular' | 'borrar' | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  async function correr(modo: 'simular' | 'borrar') {
    setOcupado(modo);
    try {
      const r = await limpiarMateriales(modo);
      setInforme(r);
      setConfirmar(false);
      if (modo === 'borrar') toast({ titulo: 'Limpieza hecha.', texto: `${pl(r.hecho?.borradores ?? 0, 'borrador', 'borradores')} y ${pl(r.hecho?.archivos ?? 0, 'archivo', 'archivos')} fuera (${mb(r.hecho?.bytes ?? 0)}).` });
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se pudo.', texto: (e as Error).message });
    } finally {
      setOcupado(null);
    }
  }
  const nada = informe && informe.borradores + informe.huerfanos === 0;
  return (
    <>
      <button onClick={() => { setAbierto(true); void correr('simular'); }} className="flex items-center gap-2 self-start rounded-full border border-linea-campo bg-white px-3.5 py-2 text-[13px] font-semibold text-vino">
        <Icon name="basura" size={16} /> Limpieza de borradores
      </button>
      <Sheet abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Limpieza de borradores">
        <p className="m-0 text-sm text-tinta-2">Se quitan los borradores sin actividad en {informe?.dias ?? 30} días y los archivos que alguien subió pero nunca quedaron en una publicación. Lo publicado no se toca.</p>
        {ocupado === 'simular' && !informe && <Cargando texto="Revisando…" />}
        {informe && (
          <div className="flex flex-col gap-1 rounded-campo bg-kanban p-3 text-sm" aria-live="polite">
            {informe.hecho ? (
              <>
                <strong className="text-vino">Listo</strong>
                <span>{pl(informe.hecho.borradores, 'borrador', 'borradores')} y {pl(informe.hecho.archivos, 'archivo', 'archivos')} fuera ({mb(informe.hecho.bytes)}).</span>
                {informe.hecho.omitidos > 0 && <span className="text-xs text-tinta-3">{informe.hecho.omitidos} se dejaron porque alguien los volvió a usar.</span>}
                {informe.hecho.errores > 0 && <span className="text-xs font-semibold text-vino">{informe.hecho.errores} no se pudieron borrar; se reintentan la próxima vez.</span>}
              </>
            ) : nada ? (
              <span>No hay nada que limpiar.</span>
            ) : (
              <>
                <strong className="text-vino">Simulacro: no se ha borrado nada</strong>
                <span>{pl(informe.borradores, 'borrador abandonado', 'borradores abandonados')} y {pl(informe.huerfanos, 'archivo suelto', 'archivos sueltos')}: {pl(informe.archivos, 'archivo', 'archivos')}, {mb(informe.bytes)}.</span>
                {informe.quedan && <span className="text-xs text-tinta-3">Hay más; se limpian por tandas de 200.</span>}
              </>
            )}
          </div>
        )}
        {informe && !nada && !informe.hecho && (confirmar ? (
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
            <Boton className="flex-grow" disabled={!!ocupado} onClick={() => void correr('borrar')}>{ocupado === 'borrar' ? 'Borrando…' : 'Sí, borrar'}</Boton>
          </div>
        ) : (
          <Boton variante="fantasma" disabled={!!ocupado} onClick={() => setConfirmar(true)}>Borrar ahora</Boton>
        ))}
      </Sheet>
    </>
  );
}

// ---------- Tarjeta (publicación) ----------
/** Foto privada: se pide a la Edge Function (permiso revisado en cada apertura); el objectURL se libera al salir. */
function FotoMaterial({ ruta, nombre, sola }: { ruta: string; nombre: string; sola: boolean }) {
  const { data: blob, isError } = useFotoMaterial(ruta);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url) {
    return (
      <span className={`flex aspect-square items-center justify-center text-tinta-3 ${isError ? '' : 'animate-pulse'}`}>
        <Icon name="imagen" size={28} />
        {isError && <span className="sr-only">La foto ya no está disponible</span>}
      </span>
    );
  }
  return <img src={url} alt={nombre} className={`block w-full object-cover ${sola ? 'max-h-[420px]' : 'aspect-square'}`} />;
}

function TarjetaMaterial({ m, autor, areaNombre }: { m: Material; autor?: AutorMaterial; areaNombre?: string }) {
  const { perfil, esCoach } = useSesion();
  const { data: tareas = [] } = useTareas();
  const [verComentarios, setVerComentarios] = useState(false);
  const [opciones, setOpciones] = useState(false);
  const [editar, setEditar] = useState(false);
  const [codigo, setCodigo] = useState<AdjuntoMaterial | null>(null);
  const toast = useToast();
  const imagenes = m.material_adjuntos.filter((a) => a.clase === 'imagen');
  const otros = m.material_adjuntos.filter((a) => a.clase !== 'imagen');
  const comentarios = m.material_comentarios[0]?.count ?? 0;
  const esMio = m.autor_id === perfil?.id;
  const tarea = m.tarea_id ? tareas.find((t) => t.id === m.tarea_id) : undefined; // solo si la RLS deja verla

  async function abrir(a: AdjuntoMaterial, descargar = false) {
    try {
      await abrirArchivo(a, descargar);
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se pudo abrir.', texto: (e as Error).message });
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-tarjeta border border-linea bg-white p-3.5" aria-label={`${m.titulo}, de ${autor?.nombre_visible ?? 'alguien del equipo'}`}>
      <header className="flex items-center gap-3">
        <Avatar iniciales={autor?.iniciales ?? '?'} color={autor?.color ?? '#6B5444'} size={40} />
        <div className="flex min-w-0 flex-grow flex-col">
          <strong className="truncate text-[15px]">{autor?.nombre_visible ?? 'Alguien del equipo'}</strong>
          <span className="text-xs text-tinta-3">
            {haceCuanto(m.publicado_at ?? m.creado_at)} · {textoCategoria(m.categoria)}{areaNombre && areaNombre !== textoCategoria(m.categoria) ? ` · ${areaNombre}` : ''}{m.editado_at ? ' · editado' : ''}
          </span>
        </div>
        {(esMio || esCoach) && (
          <button onClick={() => setOpciones(true)} aria-label="Opciones de la publicación" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-transparent text-tinta-2 hover:bg-kanban">
            <Icon name="puntos" size={22} stroke={3} />
          </button>
        )}
      </header>

      {m.retirado_at && <p className="m-0 rounded-campo bg-[#F6D6D6] px-3 py-2 text-xs font-semibold text-vino">Retirada · solo la ve el coach</p>}
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-titulo text-[17px] font-bold leading-[1.25] text-tinta">{m.titulo}</h2>
        {m.nota && <p className="m-0 whitespace-pre-line text-sm leading-[1.45] text-tinta-2">{m.nota}</p>}
        {tarea && (
          <Link to={`/tarea/${tarea.id}`} className="flex items-center gap-1.5 self-start text-xs font-semibold">
            <Icon name="tablero" size={14} /> {tarea.titulo}
          </Link>
        )}
      </div>

      {imagenes.length > 0 && (
        <div className={`grid gap-1.5 overflow-hidden rounded-campo ${imagenes.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {imagenes.map((a) => (
            <button key={a.id} onClick={() => abrir(a)} className="block bg-kanban p-0" aria-label={`Ver foto ${a.nombre}`}>
              <FotoMaterial ruta={a.ruta!} nombre={a.nombre} sola={imagenes.length === 1} />
            </button>
          ))}
        </div>
      )}

      {otros.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {otros.map((a) => {
            const s = a.clase === 'enlace' ? sitioDe(a.url!) : null;
            const icono = a.clase === 'codigo' ? 'codigo' : a.clase === 'pdf' ? 'documento' : s!.icono;
            const detalle = a.clase === 'codigo' ? 'Código · ver o descargar' : a.clase === 'pdf' ? `PDF${a.tamano ? ` · ${tamano(a.tamano)}` : ''}` : s!.texto;
            const contenido = (
              <>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino"><Icon name={icono} size={20} /></span>
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-sm font-semibold text-tinta">{a.clase === 'enlace' ? a.nombre.replace(/^https:\/\//, '') : a.nombre}</span>
                  <span className="text-xs text-tinta-3">{detalle}</span>
                </span>
              </>
            );
            const clase = 'flex min-h-tap w-full items-center gap-3 rounded-campo border border-linea bg-fondo/0 p-2 no-underline transition-colors duration-150 hover:bg-kanban';
            return (
              <li key={a.id}>
                {a.clase === 'enlace' ? (
                  <a href={a.url!} target="_blank" rel="noopener noreferrer nofollow" className={clase}>{contenido}</a>
                ) : (
                  <button onClick={() => (a.clase === 'codigo' ? setCodigo(a) : abrir(a))} className={`${clase} bg-transparent`}>{contenido}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        onClick={() => setVerComentarios((v) => !v)}
        aria-expanded={verComentarios}
        className="flex h-11 items-center gap-2 self-start rounded-campo bg-transparent px-1 text-sm font-semibold text-vino"
      >
        <Icon name="comentario" size={18} /> {comentarios === 0 ? 'Comentar' : comentarios === 1 ? '1 comentario' : `${comentarios} comentarios`}
      </button>
      {verComentarios && <Hilo material={m} />}

      {codigo && <VisorCodigo adjunto={codigo} onCerrar={() => setCodigo(null)} onDescargar={() => abrir(codigo, true)} />}
      <OpcionesMaterial m={m} esMio={esMio} abierto={opciones} onCerrar={() => setOpciones(false)} onEditar={() => { setOpciones(false); setEditar(true); }} />
      {esMio && <EditarMaterial m={m} abierto={editar} onCerrar={() => setEditar(false)} />}
    </article>
  );
}

function tamano(b: number) {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

// ---------- Código: se muestra como texto, nunca se ejecuta ----------
function VisorCodigo({ adjunto, onCerrar, onDescargar }: { adjunto: AdjuntoMaterial; onCerrar: () => void; onDescargar: () => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    leerCodigo(adjunto).then((t) => vivo && setTexto(t), (e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [adjunto]);
  const lineas = texto?.split('\n') ?? [];
  return (
    <Sheet abierto onCerrar={onCerrar} titulo={adjunto.nombre}>
      {error ? <p className="m-0 text-sm text-vino">{error}</p> : texto === null ? <Cargando texto="Abriendo el código…" /> : (
        <pre className="m-0 max-h-[55vh] overflow-auto rounded-campo bg-[#1C110D] p-3 font-mono text-[12px] leading-[1.5] text-[#F3E2C1]">
          <code>{lineas.slice(0, 2000).join('\n')}{lineas.length > 2000 ? '\n… (descárgalo para verlo completo)' : ''}</code>
        </pre>
      )}
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={onCerrar}>Cerrar</Boton>
        <Boton className="flex-grow" onClick={onDescargar}><Icon name="descargar" size={18} /> Descargar</Boton>
      </div>
    </Sheet>
  );
}

// ---------- Comentarios ----------
function Hilo({ material }: { material: Material }) {
  const { perfil, esCoach } = useSesion();
  const q = useComentariosMaterial(material.id, true);
  const { data: feed } = useMateriales();
  const comentar = useComentarMaterial();
  const retirar = useRetirarComentario();
  const toast = useToast();
  const [texto, setTexto] = useState('');
  const clienteId = useRef(nuevoId()); // el mismo intento no se duplica aunque se reenvíe
  const autor = (id: string) => feed?.autores[id] ?? (id === perfil?.id ? { nombre_visible: perfil.nombre_visible, iniciales: perfil.iniciales, color: perfil.color } : undefined);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    try {
      await comentar.mutateAsync({ material: material.id, clienteId: clienteId.current, texto: t });
      setTexto('');
      clienteId.current = nuevoId();
    } catch (err) {
      toast({ tipo: 'error', titulo: 'No se envió tu comentario.', texto: `${(err as Error).message} Tu texto sigue ahí.` });
    }
  }

  return (
    <section aria-label="Comentarios" className="flex flex-col gap-2.5 border-t border-linea pt-3">
      {q.isLoading && <Cargando texto="Cargando comentarios…" />}
      {q.data?.length === 0 && <span className="text-sm text-tinta-3">Sé la primera persona en comentar.</span>}
      {q.data?.map((c) => {
        const a = autor(c.autor_id);
        const puede = c.autor_id === perfil?.id || esCoach;
        return (
          <div key={c.id} className={`flex gap-2.5 ${c.retirado_at ? 'opacity-60' : ''}`}>
            <Avatar iniciales={a?.iniciales ?? '?'} color={a?.color ?? '#6B5444'} size={30} />
            <div className="flex min-w-0 flex-grow flex-col gap-0.5 rounded-campo bg-kanban px-3 py-2">
              <span className="text-xs"><strong>{a?.nombre_visible ?? 'Alguien del equipo'}</strong> <span className="text-tinta-3">· {haceCuanto(c.creado_at)}{c.retirado_at ? ' · retirado' : ''}</span></span>
              <p className="m-0 whitespace-pre-line text-sm leading-[1.4]">{c.texto}</p>
            </div>
            {puede && !c.retirado_at && (
              <button
                onClick={() => retirar.mutate({ id: c.id, material: material.id }, { onError: (e) => toast({ tipo: 'error', titulo: 'No se pudo retirar.', texto: e.message }) })}
                aria-label="Retirar comentario"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-transparent text-tinta-3 hover:bg-kanban"
              >
                <Icon name="cerrar" size={16} />
              </button>
            )}
          </div>
        );
      })}
      {!material.retirado_at && (
        <form onSubmit={enviar} className="flex gap-2">
          <label htmlFor={`comentario-${material.id}`} className="sr-only">Escribe un comentario</label>
          <input id={`comentario-${material.id}`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Pregunta o comenta…" className={`${claseCampo} h-11 flex-grow`} />
          <button type="submit" disabled={!texto.trim() || comentar.isPending} aria-label="Enviar comentario" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-vino text-crema disabled:opacity-50">
            <Icon name="enviar" size={18} />
          </button>
        </form>
      )}
    </section>
  );
}

// ---------- Opciones (autor y moderación) ----------
function OpcionesMaterial({ m, esMio, abierto, onCerrar, onEditar }: { m: Material; esMio: boolean; abierto: boolean; onCerrar: () => void; onEditar: () => void }) {
  const retirar = useRetirarMaterial();
  const toast = useToast();
  const [confirmar, setConfirmar] = useState(false);
  return (
    <Sheet abierto={abierto} onCerrar={() => { setConfirmar(false); onCerrar(); }} titulo={esMio ? 'Tu publicación' : 'Moderar publicación'}>
      {esMio && !m.retirado_at && <Boton variante="fantasma" onClick={onEditar}><Icon name="editar" size={18} /> Editar título y nota</Boton>}
      {!m.retirado_at && (confirmar ? (
        <div className="flex flex-col gap-2 rounded-campo bg-crema p-3">
          <span className="text-sm">{esMio ? 'Tu publicación dejará de verse en el feed.' : 'El equipo dejará de verla. Queda registrada para el coach.'}</span>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
            <Boton
              className="flex-grow"
              disabled={retirar.isPending}
              onClick={() => retirar.mutate(m.id, {
                onSuccess: () => { toast({ titulo: 'Publicación retirada.' }); onCerrar(); },
                onError: (e) => toast({ tipo: 'error', titulo: 'No se pudo retirar.', texto: e.message }),
              })}
            >
              Sí, retirar
            </Boton>
          </div>
        </div>
      ) : (
        <Boton variante="secundario" onClick={() => setConfirmar(true)}><Icon name="cerrar" size={18} /> Retirar publicación</Boton>
      ))}
      {m.retirado_at && <p className="m-0 text-sm text-tinta-2">Esta publicación ya está retirada.</p>}
    </Sheet>
  );
}

function EditarMaterial({ m, abierto, onCerrar }: { m: Material; abierto: boolean; onCerrar: () => void }) {
  const editar = useEditarMaterial();
  const toast = useToast();
  const [titulo, setTitulo] = useState(m.titulo);
  const [nota, setNota] = useState(m.nota ?? '');
  const [categoria, setCategoria] = useState<CategoriaMaterial>(m.categoria);
  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo="Editar publicación">
      <Campo id={`ed-titulo-${m.id}`} label="Título">
        <input id={`ed-titulo-${m.id}`} value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} className={claseCampo} />
      </Campo>
      <Campo id={`ed-cat-${m.id}`} label="Categoría">
        <select id={`ed-cat-${m.id}`} value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaMaterial)} className={claseCampo}>
          {CATEGORIAS_MATERIAL.map((c) => <option key={c.id} value={c.id}>{c.texto}</option>)}
        </select>
      </Campo>
      <Campo id={`ed-nota-${m.id}`} label="Nota">
        <textarea id={`ed-nota-${m.id}`} value={nota} maxLength={2000} rows={4} onChange={(e) => setNota(e.target.value)} className={`${claseCampo} h-auto py-3`} />
      </Campo>
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton
          className="flex-grow"
          disabled={!titulo.trim() || editar.isPending}
          onClick={() => editar.mutate({ id: m.id, titulo: titulo.trim(), nota, categoria }, {
            onSuccess: () => { toast({ titulo: 'Publicación actualizada.' }); onCerrar(); },
            onError: (e) => toast({ tipo: 'error', titulo: 'No se guardó.', texto: e.message }),
          })}
        >
          Guardar
        </Boton>
      </div>
    </Sheet>
  );
}

// ---------- Nueva publicación ----------
const vacio = (): Borrador => ({ clienteId: nuevoId(), titulo: '', nota: '', categoria: 'programacion', area: null, tarea: null, archivos: [], enlaces: [] });

function NuevaPublicacion({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { perfil, misAreas } = useSesion();
  const { data: areas = [] } = useAreas();
  const { data: tareas = [] } = useTareas();
  const publicar = usePublicarMaterial();
  const toast = useToast();
  const [b, setB] = useState<Borrador>(vacio);
  const [enlace, setEnlace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const cambiar = (p: Partial<Borrador>) => setB((x) => ({ ...x, ...p }));
  const total = b.archivos.length + b.enlaces.length;
  const misTareas = tareas.filter((t) => t.estado !== 'hecha' && (t.tarea_responsables.some((r) => r.usuario_id === perfil?.id) || misAreas.includes(t.area_id)));

  function agregarArchivos(lista: FileList | null) {
    if (!lista) return;
    const nuevos: ArchivoPendiente[] = [];
    for (const f of Array.from(lista)) {
      const e = validarArchivo(f);
      if (e) return setError(e);
      if (total + nuevos.length >= MAX_ADJUNTOS) return setError(`Una publicación admite hasta ${MAX_ADJUNTOS} archivos o enlaces.`);
      nuevos.push({ uid: nuevoId(), archivo: f, clase: claseDe(f)! });
    }
    setError(null);
    cambiar({ archivos: [...b.archivos, ...nuevos] });
  }

  function agregarEnlace() {
    const u = enlace.trim();
    if (!u) return;
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(u)) return setError('El enlace debe empezar con https://');
    if (total >= MAX_ADJUNTOS) return setError(`Una publicación admite hasta ${MAX_ADJUNTOS} archivos o enlaces.`);
    if (!b.enlaces.includes(u)) cambiar({ enlaces: [...b.enlaces, u] });
    setEnlace('');
    setError(null);
  }

  async function quitarArchivo(a: ArchivoPendiente) {
    try {
      if (a.registrado) await quitarRegistrado(a.registrado); // ya se había guardado en un intento anterior
      cambiar({ archivos: b.archivos.filter((x) => x.uid !== a.uid) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!b.titulo.trim()) return setError('Ponle un título.');
    if (total === 0 && !enlace.trim()) return setError('Agrega al menos un archivo o un enlace.');
    let borrador = b;
    if (enlace.trim()) {
      // Un enlace escrito sin tocar "Agregar" también cuenta
      const u = enlace.trim();
      if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(u)) return setError('El enlace debe empezar con https://');
      borrador = { ...b, enlaces: b.enlaces.includes(u) ? b.enlaces : [...b.enlaces, u] };
      setB(borrador);
      setEnlace('');
    }
    setError(null);
    try {
      await publicar.mutateAsync({
        b: { ...borrador, titulo: borrador.titulo.trim(), nota: borrador.nota.trim() },
        avance: (uid, adjunto) => setB((x) => ({ ...x, archivos: x.archivos.map((a) => (a.uid === uid ? { ...a, registrado: adjunto } : a)) })),
      });
      toast({ titulo: 'Publicado.', texto: 'Ya lo ve todo el equipo.' });
      setB(vacio());
      onCerrar();
    } catch (err) {
      // Lo escrito y lo ya subido se conservan: el reintento continúa donde se quedó
      setError(`${(err as Error).message} Tu publicación no se perdió: toca «Reintentar».`);
    }
  }

  const enviando = publicar.isPending;
  return (
    <Sheet abierto={abierto} onCerrar={() => !enviando && onCerrar()} titulo="Nueva publicación">
      <form onSubmit={enviar} className="flex flex-col gap-3" noValidate>
        <Campo id="mat-titulo" label="Título">
          <input id="mat-titulo" value={b.titulo} maxLength={120} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Ej. Rutina autónoma de 15 s" className={claseCampo} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo id="mat-cat" label="Categoría">
            <select id="mat-cat" value={b.categoria} onChange={(e) => cambiar({ categoria: e.target.value as CategoriaMaterial })} className={claseCampo}>
              {CATEGORIAS_MATERIAL.map((c) => <option key={c.id} value={c.id}>{c.texto}</option>)}
            </select>
          </Campo>
          <Campo id="mat-area" label="Área (opcional)">
            <select id="mat-area" value={b.area ?? ''} onChange={(e) => cambiar({ area: e.target.value || null })} className={claseCampo}>
              <option value="">Todo el equipo</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </Campo>
        </div>
        <Campo id="mat-nota" label="Nota (opcional)" ayuda="Qué es, cómo probarlo o qué observar.">
          <textarea id="mat-nota" value={b.nota} maxLength={2000} rows={3} onChange={(e) => cambiar({ nota: e.target.value })} className={`${claseCampo} h-auto py-3`} />
        </Campo>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-vino">Archivos y enlaces · {total} de {MAX_ADJUNTOS}</span>
          {b.archivos.map((a) => (
            <div key={a.uid} className="flex items-center gap-2.5 rounded-campo border border-linea bg-white p-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino">
                <Icon name={a.clase === 'imagen' ? 'imagen' : a.clase === 'pdf' ? 'documento' : 'codigo'} size={18} />
              </span>
              <span className="flex min-w-0 flex-grow flex-col">
                <span className="truncate text-sm font-semibold">{a.archivo.name}</span>
                <span className="text-xs text-tinta-3">{a.registrado ? 'Subido' : a.clase === 'imagen' ? 'Foto (se comprime al subir)' : tamano(a.archivo.size)}</span>
              </span>
              <button type="button" disabled={enviando} onClick={() => quitarArchivo(a)} aria-label={`Quitar ${a.archivo.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-transparent text-tinta-3 hover:bg-kanban">
                <Icon name="cerrar" size={16} />
              </button>
            </div>
          ))}
          {b.enlaces.map((u) => (
            <div key={u} className="flex items-center gap-2.5 rounded-campo border border-linea bg-white p-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-crema text-vino"><Icon name={sitioDe(u).icono} size={18} /></span>
              <span className="min-w-0 flex-grow truncate text-sm">{u.replace(/^https:\/\//, '')}</span>
              <button type="button" disabled={enviando} onClick={() => cambiar({ enlaces: b.enlaces.filter((x) => x !== u) })} aria-label="Quitar enlace" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-transparent text-tinta-3 hover:bg-kanban">
                <Icon name="cerrar" size={16} />
              </button>
            </div>
          ))}
          <input
            ref={entrada}
            type="file"
            multiple
            accept="image/*,.pdf,application/pdf,.ino,.cpp,.c,.h,.hpp,.py,.java,.js,.ts,.json,.md,.txt,.csv,.yaml,.yml"
            onChange={(e) => {
              agregarArchivos(e.target.files);
              e.target.value = '';
            }}
            className="sr-only"
            id="mat-archivos"
          />
          <Boton type="button" variante="fantasma" disabled={enviando || total >= MAX_ADJUNTOS} onClick={() => entrada.current?.click()}>
            <Icon name="imagen" size={18} /> Agregar foto, PDF o código
          </Boton>
          <div className="flex gap-2">
            <label htmlFor="mat-enlace" className="sr-only">Pegar enlace</label>
            <input
              id="mat-enlace"
              value={enlace}
              onChange={(e) => setEnlace(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), agregarEnlace())}
              inputMode="url"
              placeholder="https://github.com/… · Drive · video"
              className={`${claseCampo} flex-grow`}
            />
            <Boton type="button" variante="fantasma" disabled={!enlace.trim() || enviando} onClick={agregarEnlace}>Agregar</Boton>
          </div>
        </div>

        {misTareas.length > 0 && (
          <Campo id="mat-tarea" label="Vincular a una tarea (opcional)">
            <select id="mat-tarea" value={b.tarea ?? ''} onChange={(e) => cambiar({ tarea: e.target.value || null })} className={claseCampo}>
              <option value="">Sin tarea</option>
              {misTareas.map((t) => <option key={t.id} value={t.id}>{t.titulo}</option>)}
            </select>
          </Campo>
        )}

        {error && <p role="alert" className="m-0 rounded-campo bg-[#F6D6D6] px-3 py-2 text-sm font-semibold text-vino">{error}</p>}
        <div className="flex gap-2">
          <Boton type="button" variante="secundario" disabled={enviando} onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" className="flex-grow" disabled={enviando}>
            {enviando ? 'Publicando…' : error ? 'Reintentar' : 'Publicar'}
          </Boton>
        </div>
      </form>
    </Sheet>
  );
}
