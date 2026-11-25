import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Alerta, Avatar, Boton, Cargando, HeaderVino, Sheet, claseCampo, useToast } from '../components/ui';
import { cargaPorPersona, nuevoId, useAreas, useGuardarTarea, useMembresias, useMetas, usePerfiles, useTareaDetalle, useTareas, type TareaForm as Form } from '../lib/datos';
import { aInputLocal, deInputLocal } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import type { Robot } from '../lib/tipos';

export default function TareaForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { esCoach, areasLider } = useSesion();
  const { data: areas = [] } = useAreas();
  const { data: metas = [] } = useMetas();
  const { data: perfiles = [] } = usePerfiles();
  const { data: membresias = [] } = useMembresias();
  const { data: tareas = [] } = useTareas();
  const detalle = useTareaDetalle(id);
  const guardar = useGuardarTarea();

  const misAreasGestion = esCoach ? areas.map((a) => a.id) : areasLider;
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegir, setElegir] = useState(false);

  // Estado inicial: nueva o edición
  useEffect(() => {
    if (f) return;
    if (id) {
      const t = detalle.data?.tarea;
      if (!t) return;
      setF({
        id: t.id, version: t.actualizada_at, titulo: t.titulo, para_que_sirve: t.para_que_sirve, area_id: t.area_id, meta_id: t.meta_id, robot: t.robot,
        fecha_limite: t.fecha_limite, herramienta_url: t.herramienta_url, responsables: t.tarea_responsables.map((r) => r.usuario_id),
        pasos: t.tarea_pasos.map((p) => ({ id: p.id, texto: p.texto, hecho: p.hecho })),
      });
    } else if (misAreasGestion.length) {
      const pedida = params.get('area');
      const area = pedida && misAreasGestion.includes(pedida) ? pedida : misAreasGestion[0];
      const pre = params.get('para');
      setF({
        nuevo_id: nuevoId(), titulo: '', para_que_sirve: '', area_id: area, meta_id: null, robot: 'VEX', fecha_limite: null, herramienta_url: null,
        responsables: pre ? [pre] : [], pasos: [{ id: nuevoId(), texto: '' }, { id: nuevoId(), texto: '' }, { id: nuevoId(), texto: '' }],
      });
    }
  }, [id, detalle.data, misAreasGestion, f, params]);

  const carga = useMemo(() => cargaPorPersona(tareas.filter((t) => t.id !== id)), [tareas, id]);
  const integrantes = useMemo(() => {
    if (!f) return [];
    const ids = membresias.filter((m) => m.area_id === f.area_id).map((m) => m.usuario_id);
    return perfiles.filter((p) => ids.includes(p.id) && p.activo).sort((a, b) => (carga[a.id] ?? 0) - (carga[b.id] ?? 0));
  }, [f, membresias, perfiles, carga]);

  if (!esCoach && areasLider.length === 0) return <Navigate to="/" replace />;
  if (!f) return <div className="mx-auto max-w-[480px]"><HeaderVino titulo={id ? 'Editar tarea' : 'Nueva tarea'} atras="/area" /><Cargando /></div>;

  const area = areas.find((a) => a.id === f.area_id);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const metasArea = metas.filter((m) => m.areas.length === 0 || m.areas.includes(f.area_id) || m.id === f.meta_id);
  const persona = (uid: string) => perfiles.find((p) => p.id === uid);

  // Aviso de carga: alguien elegido con 4+ tareas y la persona más libre del área
  const cargados = f.responsables.filter((u) => (carga[u] ?? 0) >= 4);
  const libre = integrantes.find((p) => !f.responsables.includes(p.id));
  const avisoCarga = cargados.length
    ? `${cargados.map((u) => `${persona(u)?.nombre_visible.split(' ')[0]} ya tiene ${carga[u]} tareas activas`).join('. ')}.` +
      (libre && (carga[libre.id] ?? 0) < 3 ? ` ${libre.nombre_visible.split(' ')[0]} tiene ${carga[libre.id] ?? 0}: puede llevar esta${f.responsables.length === 1 ? ' sola' : ''}.` : '')
    : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    if (f.titulo.trim().length < 3) return setError('Escribe un título de al menos 3 letras.');
    if (f.responsables.length === 0) return setError('Elige al menos a una persona responsable.');
    setError(null);
    try {
      const nuevoId = await guardar.mutateAsync(f);
      toast({ titulo: id ? 'Cambios guardados.' : 'Tarea asignada.', texto: id ? undefined : 'Ya aparece en su tablero.' });
      nav(`/tarea/${nuevoId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const chipRobot = (r: Robot) => (
    <button
      key={r}
      type="button"
      aria-pressed={f.robot === r}
      onClick={() => set('robot', r)}
      className={`h-10 rounded-full px-3.5 text-sm ${f.robot === r ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}
    >
      {r}
    </button>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-fondo pb-28">
      <HeaderVino titulo={id ? 'Editar tarea' : 'Nueva tarea'} subtitulo={area ? `Área de ${area.nombre}` : undefined} atras={id ? `/tarea/${id}` : esCoach ? '/coach' : '/area'} />
      <form id="form-tarea" onSubmit={enviar} noValidate className="mx-4 mt-[18px] flex flex-col gap-[18px]">
        {error && <Alerta>{error}</Alerta>}
        {misAreasGestion.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="f-area" className="text-[13px] font-semibold text-vino">Área</label>
            <select id="f-area" value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value, responsables: [], meta_id: null })} className={claseCampo}>
              {areas.filter((a) => misAreasGestion.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-titulo" className="text-[13px] font-semibold text-vino">Título</label>
          <input id="f-titulo" value={f.titulo} maxLength={120} onChange={(e) => set('titulo', e.target.value)} className={claseCampo} placeholder="Rutina autonomous de 15 s" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-para" className="text-[13px] font-semibold text-vino">Para qué sirve</label>
          <textarea id="f-para" rows={3} value={f.para_que_sirve} maxLength={240} onChange={(e) => set('para_que_sirve', e.target.value)} aria-describedby="f-para-ayuda" className={`${claseCampo} h-auto resize-none py-3 leading-[1.4]`} />
          <span id="f-para-ayuda" className="text-xs text-tinta-2">Una frase: qué se rompe o qué se gana si no se hace.</span>
        </div>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[13px] font-semibold text-vino">Robot</legend>
          <div className="flex flex-wrap gap-2">{(['VEX', 'FTC', 'Ambos'] as Robot[]).map(chipRobot)}</div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-meta" className="text-[13px] font-semibold text-vino">Meta del robot</label>
          <select id="f-meta" value={f.meta_id ?? ''} onChange={(e) => set('meta_id', e.target.value || null)} className={claseCampo}>
            <option value="">Sin meta</option>
            {metasArea.map((m) => <option key={m.id} value={m.id}>{m.titulo}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <span id="f-resp" className="text-[13px] font-semibold text-vino">Responsables</span>
          <div className="flex flex-wrap gap-2" aria-labelledby="f-resp">
            {f.responsables.map((u) => {
              const p = persona(u);
              return (
                <span key={u} className="flex h-10 items-center gap-1.5 rounded-full border border-linea-campo bg-white pl-1 pr-1.5 text-sm">
                  <Avatar iniciales={p?.iniciales ?? '?'} color={p?.color ?? '#6B5444'} size={30} />
                  {p?.nombre_visible.split(' ')[0]}
                  <button type="button" aria-label={`Quitar a ${p?.nombre_visible}`} onClick={() => set('responsables', f.responsables.filter((x) => x !== u))} className="flex h-11 w-9 items-center justify-center border-0 bg-transparent text-tinta-3">
                    <Icon name="cerrar" size={16} />
                  </button>
                </span>
              );
            })}
            <button type="button" onClick={() => setElegir(true)} className="flex h-10 items-center gap-1.5 rounded-full border-2 border-dashed border-[#A88F6A] bg-transparent px-3 text-sm font-semibold text-vino">
              <Icon name="mas" size={16} /> Agregar
            </button>
          </div>
          {avisoCarga && (
            <div role="status" className="flex items-start gap-2.5 rounded-campo bg-urgente-fondo px-3 py-2.5 text-[13px] leading-[1.4] text-[#5A2C04]">
              <span className="shrink-0"><Icon name="alerta" size={18} /></span>
              <span>{avisoCarga}</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-fecha" className="text-[13px] font-semibold text-vino">Fecha límite</label>
          <input
            id="f-fecha"
            type="date"
            value={aInputLocal(f.fecha_limite).slice(0, 10)}
            onChange={(e) => set('fecha_limite', e.target.value ? deInputLocal(`${e.target.value}T${aInputLocal(f.fecha_limite).slice(11, 16) || '18:00'}`) : null)}
            className={claseCampo}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-hora" className="text-[13px] font-semibold text-vino">Hora</label>
          <input
            id="f-hora"
            type="time"
            disabled={!f.fecha_limite}
            value={aInputLocal(f.fecha_limite).slice(11, 16) || '18:00'}
            onChange={(e) => f.fecha_limite && set('fecha_limite', deInputLocal(`${aInputLocal(f.fecha_limite).slice(0, 10)}T${e.target.value || '18:00'}`))}
            className={claseCampo}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-vino">Pasos</span>
          {f.pasos.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-[18px] font-mono text-xs text-tinta-3">{i + 1}</span>
              <label htmlFor={`paso-${i}`} className="sr-only">Paso {i + 1}</label>
              <input id={`paso-${i}`} value={p.texto} maxLength={200} onChange={(e) => set('pasos', f.pasos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} className={claseCampo} />
              {f.pasos.length > 1 && (
                <button type="button" aria-label={`Quitar paso ${i + 1}`} onClick={() => set('pasos', f.pasos.filter((_, j) => j !== i))} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo border border-linea-campo bg-white text-tinta-3">
                  <Icon name="cerrar" size={16} />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => set('pasos', [...f.pasos, { id: nuevoId(), texto: '' }])} className="flex h-11 items-center justify-center gap-1.5 rounded-campo border-2 border-dashed border-[#A88F6A] bg-transparent text-sm font-semibold text-vino">
            <Icon name="mas" size={16} /> Agregar paso
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="f-herr" className="text-[13px] font-semibold text-vino">Enlace a la herramienta (opcional)</label>
          <input id="f-herr" type="url" inputMode="url" value={f.herramienta_url ?? ''} onChange={(e) => set('herramienta_url', e.target.value)} placeholder="github.com/… u Onshape, Canva" className={`${claseCampo} font-mono`} />
        </div>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[480px] gap-2 border-t border-linea bg-white px-4 pt-3" style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}>
        <Boton type="button" variante="secundario" onClick={() => nav(-1)}>Cancelar</Boton>
        <Boton type="submit" form="form-tarea" className="flex-grow" disabled={guardar.isPending}>{guardar.isPending ? 'Guardando…' : id ? 'Guardar cambios' : 'Guardar y asignar'}</Boton>
      </div>

      <Sheet abierto={elegir} onCerrar={() => setElegir(false)} titulo={`Integrantes de ${area?.nombre ?? 'el área'}`}>
        <span className="text-xs text-tinta-2">Ordenados de menos a más tareas activas.</span>
        <ul className="m-0 flex list-none flex-col p-0">
          {integrantes.map((p) => {
            const elegido = f.responsables.includes(p.id);
            const n = carga[p.id] ?? 0;
            return (
              <li key={p.id}>
                <label className="flex min-h-[52px] items-center gap-3 border-b border-[#F0E4CC] py-1.5">
                  <input type="checkbox" checked={elegido} onChange={() => set('responsables', elegido ? f.responsables.filter((x) => x !== p.id) : [...f.responsables, p.id])} className="h-[22px] w-[22px] accent-vino" />
                  <Avatar iniciales={p.iniciales} color={p.color} size={32} />
                  <span className="flex-grow text-sm font-semibold">{p.nombre_visible}</span>
                  <span className={`font-mono text-xs ${n >= 6 ? 'font-bold text-vino' : 'text-tinta-3'}`}>{n} activas</span>
                </label>
              </li>
            );
          })}
          {integrantes.length === 0 && <li className="py-3 text-sm text-tinta-3">Esta área aún no tiene integrantes.</li>}
        </ul>
        <Boton onClick={() => setElegir(false)}>Listo</Boton>
      </Sheet>
    </div>
  );
}
