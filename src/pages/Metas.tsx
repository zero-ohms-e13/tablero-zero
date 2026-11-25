// Metas y competencias (coach). Cada tarea apunta a una meta comprobable en la cancha.
// Incluye exportar la bitácora (historial) de una meta a CSV o PDF para el Engineering Notebook.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Battery } from '../components/Battery';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Marca';
import { Alerta, Boton, Campo, Cargando, Sheet, claseCampo, useToast } from '../components/ui';
import { useAreas, useAvanceMetas, useCompetencias, useMetas, usePerfiles, useTareas } from '../lib/datos';
import { diaMes, diasHasta, enMerida, fechaCorta, fechaLarga } from '../lib/fechas';
import { supabase } from '../lib/supabase';
import { ROBOT_NOMBRE, type Competencia, type Meta, type Robot } from '../lib/tipos';

type MetaForm = { id?: string; titulo: string; robot: Robot; competencia_id: string | null; fecha: string; areas: string[] };

export default function Metas() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: metas = [], isLoading } = useMetas();
  const { data: competencias = [] } = useCompetencias();
  const { data: avance = [] } = useAvanceMetas();
  const { data: areas = [] } = useAreas();
  const proximas = competencias.filter((c) => diasHasta(c.fecha_fin) >= 0);
  const [compSel, setCompSel] = useState<string | 'todas'>('');
  const comp = compSel === 'todas' ? null : competencias.find((c) => c.id === compSel) ?? proximas[0] ?? null;
  const vacia: MetaForm = { titulo: '', robot: 'VEX', competencia_id: comp?.id ?? null, fecha: '', areas: [] };
  const [f, setF] = useState<MetaForm>(vacia);
  const [error, setError] = useState<string | null>(null);
  const [editarComp, setEditarComp] = useState<Partial<Competencia> | null>(null);
  const [borrar, setBorrar] = useState<Meta | null>(null);
  const [confirmarBorrarComp, setConfirmarBorrarComp] = useState(false);

  // La meta nueva propone la competencia que estás viendo
  useEffect(() => {
    setF((x) => (x.id || x.titulo ? x : { ...x, competencia_id: comp?.id ?? null }));
  }, [comp?.id]);

  async function borrarComp() {
    const c = editarComp!;
    const r = await supabase.from('competencias').delete().eq('id', c.id!).select('id');
    if (r.error || !r.data?.length) return setError('No se pudo borrar la competencia.');
    setEditarComp(null);
    setCompSel('');
    toast({ titulo: 'Competencia borrada.', texto: 'Sus metas quedaron sin competencia.' });
    recargar();
  }

  const lista = compSel === 'todas' ? metas : metas.filter((m) => (comp ? m.competencia_id === comp.id : !m.competencia_id));
  const recargar = () => ['metas', 'competencias', 'avance_metas'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (f.titulo.trim().length < 5) return setError('Escribe la meta como algo que se pueda comprobar en la cancha.');
    setError(null);
    const datos = { titulo: f.titulo.trim(), robot: f.robot, competencia_id: f.competencia_id, fecha: f.fecha || null, areas: f.areas };
    const r = f.id ? await supabase.from('metas').update(datos).eq('id', f.id).select('id') : await supabase.from('metas').insert(datos).select('id');
    if (r.error || !r.data?.length) return setError('No se pudo guardar la meta. Vuelve a intentar.');
    toast({ titulo: f.id ? 'Meta actualizada.' : 'Meta creada.' });
    setF({ ...vacia, competencia_id: f.competencia_id });
    recargar();
  }

  async function guardarComp(e: FormEvent) {
    e.preventDefault();
    const c = editarComp!;
    if (!c.nombre?.trim() || !c.fecha_inicio || !c.fecha_fin) return setError('Escribe nombre y fechas de la competencia.');
    if (c.fecha_fin < c.fecha_inicio) return setError('La fecha final va después de la inicial.');
    const datos = { nombre: c.nombre.trim(), fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin, equipo: c.equipo?.trim() || null };
    const r = c.id ? await supabase.from('competencias').update(datos).eq('id', c.id).select('id') : await supabase.from('competencias').insert(datos).select('id');
    if (r.error) return setError('No se pudo guardar la competencia.');
    setError(null);
    setEditarComp(null);
    if (!c.id && r.data?.[0]) setCompSel(r.data[0].id);
    toast({ titulo: 'Competencia guardada.' });
    recargar();
  }

  return (
    <LayoutCoach>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[.06em] text-tinta-3">CADA TAREA APUNTA A UNA META DEL ROBOT</span>
          <h1 className="m-0 font-titulo text-[30px] font-bold text-vino">Metas y competencias</h1>
        </div>
        <Boton onClick={() => { setF(vacia); document.getElementById('m-titulo')?.focus(); }}><Icon name="mas" size={18} /> Nueva meta</Boton>
      </div>

      <div className="flex flex-wrap gap-3.5">
        {comp ? (
          <section className="flex flex-[2_1_380px] flex-wrap items-center gap-[18px] rounded-3xl bg-vino px-6 py-5 text-crema">
            <div className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-[18px] bg-ambar text-vino-oscuro">
              <span className="font-titulo text-[30px] font-bold leading-none">{Math.max(0, diasHasta(comp.fecha_inicio))}</span>
              <span className="text-xs font-semibold">días</span>
            </div>
            <div className="flex flex-[1_1_200px] flex-col gap-1">
              <span className="text-[13px] opacity-85">{diasHasta(comp.fecha_inicio) >= 0 ? 'Próxima competencia' : 'Competencia'}</span>
              <strong className="font-titulo text-[26px] leading-tight">{comp.nombre}</strong>
              <span className="text-sm">{diaMes(comp.fecha_inicio + 'T18:00:00Z')}{comp.fecha_fin !== comp.fecha_inicio ? ` y ${diaMes(comp.fecha_fin + 'T18:00:00Z')}` : ''}{comp.equipo ? ` · ${comp.equipo}` : ''}</span>
              <span className="text-[13px] opacity-90">{metas.filter((m) => m.competencia_id === comp.id).length} metas ligadas</span>
            </div>
            <button onClick={() => setEditarComp(comp)} className="h-11 rounded-campo border border-crema/40 bg-transparent px-3 text-[13px] text-crema">Editar</button>
          </section>
        ) : (
          <section className="flex flex-[2_1_380px] items-center rounded-3xl bg-vino px-6 py-5 text-crema">
            <span className="text-sm">{compSel === 'todas' ? 'Viendo todas las metas.' : 'No hay competencias próximas. Agrega una.'}</span>
          </section>
        )}
        <button onClick={() => setEditarComp({ nombre: '', fecha_inicio: '', fecha_fin: '', equipo: '' })} className="flex flex-[1_1_220px] flex-col items-center justify-center gap-1 rounded-3xl border-2 border-dashed border-[#A88F6A] bg-white p-5 text-vino">
          <Icon name="mas" size={22} />
          <strong className="text-[15px]">Agregar competencia</strong>
          <span className="text-xs text-tinta-2">Nombre, fechas y qué equipo va</span>
        </button>
      </div>

      {competencias.length > 0 && (
        <div role="tablist" aria-label="Competencia" className="flex flex-wrap gap-1.5">
          {competencias.map((c) => (
            <button key={c.id} role="tab" aria-selected={comp?.id === c.id && compSel !== 'todas'} onClick={() => setCompSel(c.id)} className={`h-11 rounded-full px-3.5 text-sm ${comp?.id === c.id && compSel !== 'todas' ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>
              {c.nombre} · {fechaCorta(c.fecha_inicio + 'T18:00:00Z')}
            </button>
          ))}
          <button role="tab" aria-selected={compSel === 'todas'} onClick={() => setCompSel('todas')} className={`h-11 rounded-full px-3.5 text-sm ${compSel === 'todas' ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>Todas las metas</button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-[18px]">
        <section className="flex min-w-0 flex-[3_1_520px] flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 font-titulo text-xl font-bold text-vino">{comp && compSel !== 'todas' ? `Metas rumbo a ${comp.nombre}` : 'Metas'}</h2>
            <span className="text-xs text-tinta-3">batería = tareas listas de la meta</span>
          </div>
          {isLoading ? <Cargando /> : lista.length === 0 ? <span className="text-sm text-tinta-3">Aún no hay metas aquí. Crea la primera con el formulario.</span> : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
              {lista.map((m) => {
                const av = avance.find((a) => a.meta_id === m.id);
                return (
                  <div key={m.id} className="flex flex-col gap-2.5 rounded-2xl border border-linea p-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {m.areas.map((aid) => {
                        const a = areas.find((x) => x.id === aid);
                        return a ? <span key={aid} className="texto-area flex items-center gap-1.5 font-semibold" style={{ color: a.color }}><span className="h-2 w-2 rounded-full" style={{ background: a.color }} />{a.nombre}</span> : null;
                      })}
                    </div>
                    <span className="font-mono text-xs text-tinta-3">{ROBOT_NOMBRE[m.robot]}{m.fecha ? ` · ${fechaCorta(m.fecha + 'T18:00:00Z')}` : ''}</span>
                    <strong className="font-titulo text-base font-semibold leading-[1.25]">{m.titulo}</strong>
                    <Battery done={av?.hechas ?? 0} total={av?.total ?? 0} />
                    <span className="text-xs text-tinta-2">{av?.hechas ?? 0} de {av?.total ?? 0} tareas listas</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Link to={`/coach/metas/${m.id}`} className="flex h-11 items-center rounded-[10px] border border-linea-campo px-3 text-[13px] no-underline">Ver tareas y bitácora</Link>
                      <button onClick={() => setF({ id: m.id, titulo: m.titulo, robot: m.robot, competencia_id: m.competencia_id, fecha: m.fecha ?? '', areas: m.areas })} className="h-11 rounded-[10px] border border-linea-campo bg-white px-3 text-[13px] text-vino">Editar</button>
                      <button aria-label={`Borrar la meta ${m.titulo}`} onClick={() => setBorrar(m)} className="h-11 w-11 rounded-[10px] border border-linea-campo bg-white text-vino"><Icon name="cerrar" size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px] lg:max-w-[340px]">
          <h2 className="m-0 font-titulo text-xl font-bold text-vino">{f.id ? 'Editar meta' : 'Nueva meta'}</h2>
          <form onSubmit={guardar} noValidate className="flex flex-col gap-3">
            {error && !editarComp && <Alerta>{error}</Alerta>}
            <Campo id="m-titulo" label="Meta" ayuda="Escríbela como algo que se puede comprobar en la cancha.">
              <textarea id="m-titulo" rows={2} maxLength={160} value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={`${claseCampo} h-auto resize-none py-3 leading-[1.4]`} placeholder="Autonomous de 15 s probado en la cancha" />
            </Campo>
            <Campo id="m-comp" label="Competencia">
              <select id="m-comp" value={f.competencia_id ?? ''} onChange={(e) => setF({ ...f, competencia_id: e.target.value || null })} className={claseCampo}>
                <option value="">Sin competencia</option>
                {competencias.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {fechaCorta(c.fecha_inicio + 'T18:00:00Z')}</option>)}
              </select>
            </Campo>
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-semibold text-vino">Robot</legend>
              <div className="flex flex-wrap gap-2">
                {(['VEX', 'FTC', 'Ambos'] as Robot[]).map((r) => (
                  <button key={r} type="button" aria-pressed={f.robot === r} onClick={() => setF({ ...f, robot: r })} className={`h-10 rounded-full px-3.5 text-sm ${f.robot === r ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>{r}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-semibold text-vino">Áreas</legend>
              {areas.map((a) => (
                <label key={a.id} className="flex min-h-tap items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.areas.includes(a.id)} onChange={() => setF({ ...f, areas: f.areas.includes(a.id) ? f.areas.filter((x) => x !== a.id) : [...f.areas, a.id] })} className="h-5 w-5 accent-vino" />
                  {a.nombre}
                </label>
              ))}
            </fieldset>
            <Campo id="m-fecha" label="Fecha">
              <input id="m-fecha" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} className={claseCampo} />
            </Campo>
            <div className="flex gap-2">
              {f.id && <Boton type="button" variante="secundario" onClick={() => setF(vacia)}>Cancelar</Boton>}
              <Boton type="submit" className="flex-grow">Guardar meta</Boton>
            </div>
          </form>
        </section>
      </div>

      <Sheet abierto={!!editarComp} onCerrar={() => { setEditarComp(null); setError(null); setConfirmarBorrarComp(false); }} titulo={editarComp?.id ? 'Editar competencia' : 'Agregar competencia'}>
        {editarComp && (
          <form onSubmit={guardarComp} className="flex flex-col gap-3">
            {error && <Alerta>{error}</Alerta>}
            <Campo id="c-nombre" label="Nombre"><input id="c-nombre" value={editarComp.nombre ?? ''} onChange={(e) => setEditarComp({ ...editarComp, nombre: e.target.value })} className={claseCampo} placeholder="Girl Powered" /></Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo id="c-ini" label="Empieza"><input id="c-ini" type="date" value={editarComp.fecha_inicio ?? ''} onChange={(e) => setEditarComp({ ...editarComp, fecha_inicio: e.target.value, fecha_fin: editarComp.fecha_fin || e.target.value })} className={claseCampo} /></Campo>
              <Campo id="c-fin" label="Termina"><input id="c-fin" type="date" value={editarComp.fecha_fin ?? ''} onChange={(e) => setEditarComp({ ...editarComp, fecha_fin: e.target.value })} className={claseCampo} /></Campo>
            </div>
            <Campo id="c-equipo" label="Qué equipo va" ayuda="Ej. rama femenil, VEX completo, FTC."><input id="c-equipo" value={editarComp.equipo ?? ''} onChange={(e) => setEditarComp({ ...editarComp, equipo: e.target.value })} className={claseCampo} /></Campo>
            <div className="flex gap-2">
              <Boton type="button" variante="secundario" onClick={() => setEditarComp(null)}>Cancelar</Boton>
              <Boton type="submit" className="flex-grow">Guardar competencia</Boton>
            </div>
            {editarComp.id && !confirmarBorrarComp && (
              <button type="button" onClick={() => setConfirmarBorrarComp(true)} className="min-h-tap self-center bg-transparent text-[13px] text-vino underline">
                Borrar esta competencia
              </button>
            )}
            {editarComp.id && confirmarBorrarComp && (
              <div role="alert" className="flex flex-col gap-2 rounded-campo bg-[#F6D6D6] p-3 text-sm text-vino">
                <span>¿Seguro? Se borra la competencia; sus metas se quedan sin competencia. No se puede deshacer.</span>
                <div className="flex gap-2">
                  <Boton type="button" variante="secundario" alto={44} onClick={() => setConfirmarBorrarComp(false)}>No</Boton>
                  <Boton type="button" alto={44} className="flex-grow" onClick={() => { setConfirmarBorrarComp(false); borrarComp(); }}>Sí, borrar</Boton>
                </div>
              </div>
            )}
          </form>
        )}
      </Sheet>

      <Sheet abierto={!!borrar} onCerrar={() => setBorrar(null)} titulo="Borrar meta">
        <p className="m-0 text-sm leading-[1.45] text-tinta-2">Se borra <strong>{borrar?.titulo}</strong>. Sus tareas se quedan, pero ya no apuntan a ninguna meta. No se puede deshacer.</p>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={() => setBorrar(null)}>Cancelar</Boton>
          <Boton className="flex-grow" onClick={async () => {
            const r = await supabase.from('metas').delete().eq('id', borrar!.id).select('id');
            setBorrar(null);
            if (r.error || !r.data?.length) return toast({ tipo: 'error', titulo: 'No se pudo borrar.' });
            toast({ titulo: 'Meta borrada.' });
            recargar();
          }}>Sí, borrar</Boton>
        </div>
      </Sheet>
    </LayoutCoach>
  );
}

// ---------- Bitácora de una meta (Engineering Notebook) ----------
type Entrada = { id: number; tarea_id: string; actor_id: string | null; accion: string; detalle: string | null; creado_at: string };

export function BitacoraMeta() {
  const { id } = useParams();
  const { data: metas = [] } = useMetas();
  const { data: tareas = [] } = useTareas();
  const { data: perfiles = [] } = usePerfiles();
  const { data: areas = [] } = useAreas();
  const meta = metas.find((m) => m.id === id);
  const deMeta = tareas.filter((t) => t.meta_id === id);
  const { data: hist = [], isLoading } = useQuery({
    queryKey: ['bitacora', id, deMeta.map((t) => t.id).join()],
    enabled: deMeta.length > 0,
    queryFn: async () => (await supabase.from('historial').select('*').in('tarea_id', deMeta.map((t) => t.id)).order('creado_at')).data as Entrada[],
  });
  const titulo = (tid: string) => deMeta.find((t) => t.id === tid)?.titulo ?? '';
  const fechaHora = (s: string) => {
    const m = enMerida(s).toISOString();
    return `${m.slice(0, 10)} ${m.slice(11, 16)}`;
  };

  function csv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const filas = [['fecha (Mérida)', 'tarea', 'acción', 'detalle'], ...hist.map((h) => [fechaHora(h.creado_at), titulo(h.tarea_id), h.accion, h.detalle ?? ''])];
    const blob = new Blob(['﻿' + filas.map((f) => f.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bitacora-${(meta?.titulo ?? 'meta').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!meta) return <LayoutCoach><Cargando /></LayoutCoach>;
  const hechas = deMeta.filter((t) => t.estado === 'hecha').length;
  return (
    <LayoutCoach>
      <div className="no-imprimir flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link to="/coach/metas" className="text-[13px]">← Metas y competencias</Link>
          <h1 className="m-0 font-titulo text-[28px] font-bold text-vino">{meta.titulo}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={csv} disabled={!hist.length}>Descargar CSV</Boton>
          <Boton onClick={() => window.print()} disabled={!hist.length}><Icon name="imprimir" size={18} /> Guardar PDF</Boton>
        </div>
      </div>
      <p className="no-imprimir m-0 text-xs text-tinta-3">"Guardar PDF" abre la impresión: elige "Guardar como PDF" como impresora.</p>

      <article className="imprimible flex flex-col gap-4 rounded-[20px] border border-linea bg-white p-6 text-tinta">
        <div className="flex items-center justify-between text-vino">
          <Wordmark />
          <span className="font-mono text-[11px] tracking-[.1em]">ENGINEERING NOTEBOOK · BITÁCORA</span>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-titulo text-2xl font-bold text-vino">{meta.titulo}</h2>
          <span className="text-sm text-tinta-2">{ROBOT_NOMBRE[meta.robot]}{meta.fecha ? ` · meta para el ${fechaLarga(meta.fecha + 'T18:00:00Z')}` : ''} · {hechas} de {deMeta.length} tareas listas</span>
        </div>
        <section className="flex flex-col gap-2">
          <h3 className="m-0 font-titulo text-lg text-vino">Tareas</h3>
          <table className="w-full border-collapse text-sm">
            <thead><tr>{['Tarea', 'Área', 'Responsables', 'Estado'].map((h) => <th key={h} className="border-b-2 border-linea px-2 py-1.5 text-left text-xs text-tinta-3">{h}</th>)}</tr></thead>
            <tbody>
              {deMeta.map((t) => (
                <tr key={t.id}>
                  <td className="border-b border-[#F0E4CC] px-2 py-1.5"><Link to={`/tarea/${t.id}`} className="text-tinta">{t.titulo}</Link></td>
                  <td className="border-b border-[#F0E4CC] px-2 py-1.5">{areas.find((a) => a.id === t.area_id)?.nombre}</td>
                  <td className="border-b border-[#F0E4CC] px-2 py-1.5">{t.tarea_responsables.map((r) => perfiles.find((p) => p.id === r.usuario_id)?.nombre_visible.split(' ')[0]).filter(Boolean).join(', ')}</td>
                  <td className="border-b border-[#F0E4CC] px-2 py-1.5">{t.estado === 'hecha' ? 'Hecha' : t.estado === 'en_revision' ? 'En revisión' : t.estado === 'en_proceso' ? 'En proceso' : 'Por hacer'}</td>
                </tr>
              ))}
              {deMeta.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-tinta-3">Esta meta aún no tiene tareas.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="m-0 font-titulo text-lg text-vino">Bitácora</h3>
          {isLoading ? <Cargando /> : (
            <ol className="m-0 flex list-none flex-col gap-1.5 border-l-2 border-linea-campo p-0 pl-3.5">
              {hist.map((h) => (
                <li key={h.id} className="relative text-[13px] leading-[1.4]">
                  <span aria-hidden="true" className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full bg-cobre" />
                  <span className="font-mono text-xs text-tinta-3">{fechaHora(h.creado_at)}</span> · <strong>{titulo(h.tarea_id)}</strong>: {h.detalle ?? h.accion}
                </li>
              ))}
              {!hist.length && <li className="text-sm text-tinta-3">Sin movimientos todavía.</li>}
            </ol>
          )}
        </section>
      </article>
    </LayoutCoach>
  );
}
