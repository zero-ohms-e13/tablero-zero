// Pantallas pequeñas de apoyo en Fase 1: Perfil básico, Avisos, Logros (pendiente),
// Familia (versión preliminar de la vista tutor) y la galería de Estados.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Battery, BateriaPorcentaje } from '../components/Battery';
import { Icon } from '../components/Icon';
import { MetaCard } from '../components/Tarjetas';
import { Alerta, AvisoBloqueo, Avatar, Boton, Cargando, ChipFecha, EmptyState, HeaderVino, PantallaCel, Sheet, TituloSeccion, WeekStrip, claseCampo, useToast } from '../components/ui';
import { RegresarConNota } from './Revisar';
import { AvisoCompleto } from './Bienvenida';
import { esMia, useAreas, useAvanceAreas, useAvanceMetas, useCompetencias, useMetas, usePerfiles, useTareas, useTutores } from '../lib/datos';
import { diasHasta, diaMes, enSemana, haceCuanto, vencida } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';
import { ETIQUETA_ESTADO, ROBOT_NOMBRE } from '../lib/tipos';

export function Perfil() {
  const { perfil, membresias, salir, esTutor } = useSesion();
  const { data: areas = [] } = useAreas();
  const { data: tareas = [] } = useTareas();
  const [cambiar, setCambiar] = useState(false);
  const [aviso, setAviso] = useState(false);
  if (!perfil) return null;
  const hechas = tareas.filter((t) => esMia(t, perfil.id) && t.estado === 'hecha').length;
  const misAreas = membresias.map((m) => areas.find((a) => a.id === m.area_id)?.nombre).filter(Boolean).join(' · ');
  const contenido = (
    <>
      <HeaderVino>
        <div className="flex items-center gap-3">
          <Avatar iniciales={perfil.iniciales} color={perfil.color} size={56} />
          <div className="flex flex-col gap-0.5">
            <span className="font-titulo text-[22px] font-bold">{perfil.nombre_visible}</span>
            <span className="font-mono text-[13px] opacity-90">{perfil.usuario}</span>
            {misAreas && <span className="text-[13px] opacity-90">{misAreas} · {membresias.some((m) => m.es_lider) ? 'Líder' : 'Integrante'}</span>}
          </div>
        </div>
      </HeaderVino>
      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        {!esTutor && (
          <div className="flex flex-col gap-0.5 rounded-tarjeta border border-linea bg-white p-4">
            <span className="font-titulo text-[28px] font-bold text-vino">{hechas}</span>
            <span className="text-[13px] text-tinta-2">tareas hechas</span>
          </div>
        )}
        <Boton variante="fantasma" className="justify-start" onClick={() => setCambiar(true)}><Icon name="llave" size={18} /> Cambiar contraseña</Boton>
        {esTutor && <Boton variante="fantasma" className="justify-start" onClick={() => setAviso(true)}>Leer el aviso de privacidad</Boton>}
        <span className="px-1 text-xs text-tinta-3">Letra grande, modo oscuro y avisos en el celular llegan en la siguiente fase.</span>
        <Boton variante="secundario" onClick={salir}><Icon name="salir" size={18} /> Cerrar sesión</Boton>
      </section>
      <CambiarPassword abierto={cambiar} onCerrar={() => setCambiar(false)} />
      <Sheet abierto={aviso} onCerrar={() => setAviso(false)} titulo="Aviso de privacidad"><AvisoCompleto /></Sheet>
    </>
  );
  return esTutor ? <div className="mx-auto min-h-screen max-w-[480px] bg-fondo pb-8">{contenido}<div className="mx-4 mt-4"><Link to="/familia">Regresar</Link></div></div> : <PantallaCel>{contenido}</PantallaCel>;
}

function CambiarPassword({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const toast = useToast();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (p1.length < 8) return setError('Usa al menos 8 caracteres.');
    if (p1 !== p2) return setError('Las dos contraseñas no coinciden.');
    const { error: er } = await supabase.auth.updateUser({ password: p1 });
    if (er) return setError(/different|same/i.test(er.message) ? 'Usa una contraseña distinta a la actual.' : 'No se pudo cambiar. Vuelve a intentar.');
    setP1(''); setP2(''); setError(null);
    toast({ titulo: 'Contraseña cambiada.' });
    onCerrar();
  }
  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo="Cambiar contraseña">
      <form onSubmit={enviar} className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}
        <label htmlFor="cp1" className="text-[13px] font-semibold text-vino">Nueva contraseña</label>
        <input id="cp1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} className={claseCampo} />
        <label htmlFor="cp2" className="text-[13px] font-semibold text-vino">Repítela</label>
        <input id="cp2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} className={claseCampo} />
        <div className="flex gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>Cancelar</Boton>
          <Boton type="submit" className="flex-grow">Guardar</Boton>
        </div>
      </form>
    </Sheet>
  );
}

export function Avisos() {
  const qc = useQueryClient();
  const { esTutor } = useSesion();
  const { data = [], isLoading } = useQuery({
    queryKey: ['avisos'],
    queryFn: async () => (await supabase.from('avisos').select('*').order('creado_at', { ascending: false }).limit(50)).data ?? [],
  });
  const sinLeer = data.filter((a) => !a.leido).length;
  async function marcar() {
    await supabase.from('avisos').update({ leido: true }).eq('leido', false);
    qc.invalidateQueries({ queryKey: ['avisos'] });
    qc.invalidateQueries({ queryKey: ['avisos_sin_leer'] });
  }
  const cuerpo = (
    <>
      <HeaderVino titulo="Avisos" subtitulo={sinLeer ? `${sinLeer} sin leer` : 'Todo leído'} atras={esTutor ? '/familia' : '/'} accion={sinLeer > 0 && (
        <button onClick={marcar} className="h-11 rounded-campo border border-crema/35 bg-transparent px-3 text-[13px] text-crema">Marcar leídos</button>
      )} />
      <section className="mx-4 mt-4 flex flex-col gap-2">
        {isLoading ? <Cargando /> : data.length === 0 ? <EmptyState titulo="Sin avisos" texto="Aquí verás cuando te asignen, aprueben o comenten una tarea." /> : data.map((a) => (
          <Link key={a.id} to={a.tarea_id ? `/tarea/${a.tarea_id}` : '#'} className={`flex items-start gap-3 rounded-2xl border bg-white p-3.5 text-tinta no-underline ${a.leido ? 'border-linea' : 'border-2 border-ambar'}`}>
            {!a.leido && <span aria-label="sin leer" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ambar" />}
            <span className="flex flex-col gap-0.5">
              <strong className="text-sm">{a.titulo}</strong>
              {a.detalle && <span className="text-[13px] text-tinta-2">{a.detalle}</span>}
              <span className="text-xs text-tinta-3">{haceCuanto(a.creado_at)}</span>
            </span>
          </Link>
        ))}
      </section>
    </>
  );
  return esTutor ? <div className="mx-auto min-h-screen max-w-[480px] bg-fondo pb-8">{cuerpo}</div> : <PantallaCel>{cuerpo}</PantallaCel>;
}

export function Logros() {
  return (
    <PantallaCel>
      <HeaderVino titulo="Logros del equipo" />
      <div className="m-4"><EmptyState titulo="Llega en la fase 3" texto="Aquí verás las tareas terminadas del equipo y podrás felicitar." accion={<Link to="/" className="font-semibold">Ir a Mi tablero</Link>} /></div>
    </PantallaCel>
  );
}

/** Vista tutor (versión preliminar; la completa es de la fase 2). Solo lectura. */
export function Familia() {
  const { perfil } = useSesion();
  const { data: vinculos = [] } = useTutores();
  const { data: perfiles = [] } = usePerfiles();
  const { data: tareas = [], isLoading } = useTareas();
  const { data: areas = [] } = useAreas();
  const { data: avAreas = [] } = useAvanceAreas();
  const { data: metas = [] } = useMetas();
  const { data: avMetas = [] } = useAvanceMetas();
  const { data: competencias = [] } = useCompetencias();
  const hijos = perfiles.filter((p) => vinculos.some((v) => v.tutor_id === perfil?.id && v.alumno_id === p.id));
  const [elegido, setElegido] = useState<string | null>(null);
  const hijo = hijos.find((h) => h.id === elegido) ?? hijos[0];
  if (!perfil) return null;
  const suyas = hijo ? tareas.filter((t) => esMia(t, hijo.id)) : [];
  const semana = suyas.filter((t) => enSemana(t.fecha_limite));
  const hechas = semana.filter((t) => t.estado === 'hecha').length;
  const apoyo = suyas.filter((t) => t.estado !== 'hecha' && (vencida(t.fecha_limite) || t.pide_ayuda));
  const proxima = competencias.find((c) => diasHasta(c.fecha_fin) >= 0);
  const nombre = hijo?.nombre_visible.split(' ')[0] ?? '';
  const areaHijo = areas.find((a) => suyas.some((t) => t.area_id === a.id));

  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-fondo pb-10">
      <HeaderVino>
        <div className="flex items-center gap-3">
          {hijo && <Avatar iniciales={hijo.iniciales} color={hijo.color} size={48} />}
          <div className="flex flex-grow flex-col gap-0.5">
            <span className="font-mono text-[11px] tracking-[.06em] opacity-85">Cuenta de tutor · solo lectura</span>
            <span className="font-titulo text-[22px] font-bold">{hijo ? `Así va ${nombre}` : 'Sin alumno vinculado'}</span>
          </div>
          <Link to="/perfil" aria-label="Mi cuenta" className="flex h-11 w-11 items-center justify-center rounded-campo border border-crema/35 text-crema hover:text-crema"><Icon name="persona" /></Link>
        </div>
        {hijos.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {hijos.map((h) => <button key={h.id} aria-pressed={h.id === hijo?.id} onClick={() => setElegido(h.id)} className={`h-11 rounded-full px-3.5 text-sm ${h.id === hijo?.id ? 'border-0 bg-ambar font-semibold text-vino-oscuro' : 'border border-crema/40 bg-transparent text-crema'}`}>{h.nombre_visible.split(' ')[0]}</button>)}
          </div>
        )}
        {hijo && (
          <>
            <Battery done={hechas} total={semana.length} size="xl" variant="oscura" label={`${hechas} de ${semana.length} tareas terminadas esta semana`} />
            <span className="text-sm"><strong className="font-titulo text-[22px]">{hechas} de {semana.length}</strong> tareas terminadas esta semana{areaHijo ? ` en ${areaHijo.nombre}` : ''}.</span>
          </>
        )}
      </HeaderVino>
      {isLoading ? <Cargando /> : hijo && (
        <>
          {apoyo.length > 0 && (
            <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
              <TituloSeccion>Necesita tu apoyo</TituloSeccion>
              {apoyo.map((t) => (
                <div key={t.id} className="flex flex-col gap-1.5 rounded-2xl border-2 border-ambar bg-white p-3.5">
                  <strong className="font-titulo text-base">{t.titulo}</strong>
                  <span className="text-[13px] leading-[1.4] text-tinta-2">
                    {vencida(t.fecha_limite) ? 'Se le pasó la fecha. ' : ''}{t.pide_ayuda ? 'Ya pidió ayuda a su líder; pregúntale cómo va.' : 'Pregúntale cómo va.'}
                  </span>
                </div>
              ))}
            </section>
          )}
          <div className="mx-4 mt-4"><WeekStrip fechasConEntrega={suyas.filter((t) => t.estado !== 'hecha').map((t) => t.fecha_limite)} /></div>
          <section className="mx-4 mt-[18px] flex flex-col gap-2">
            <TituloSeccion extra="solo lectura">Tareas de {nombre}</TituloSeccion>
            {suyas.length === 0 && <span className="text-sm text-tinta-3">Aún no tiene tareas asignadas.</span>}
            {suyas.map((t) => (
              <Link key={t.id} to={`/tarea/${t.id}`} className="flex flex-col gap-1.5 rounded-2xl border border-linea bg-white p-3.5 text-tinta no-underline">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[11px] text-tinta-3">{ROBOT_NOMBRE[t.robot]}</span><ChipFecha fecha={t.fecha_limite} hecha={t.estado === 'hecha'} /></div>
                <strong className="font-titulo text-base font-semibold">{t.titulo}</strong>
                <span className="text-xs text-tinta-2">{ETIQUETA_ESTADO[t.estado]}</span>
              </Link>
            ))}
          </section>
          {metas.filter((m) => suyas.some((t) => t.meta_id === m.id)).length > 0 && (
            <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
              <TituloSeccion>Metas del robot en las que participa {nombre}</TituloSeccion>
              {metas.filter((m) => suyas.some((t) => t.meta_id === m.id)).map((m) => {
                const av = avMetas.find((a) => a.meta_id === m.id);
                return <MetaCard key={m.id} meta={m} hechas={av?.hechas ?? 0} total={av?.total ?? 0} />;
              })}
            </section>
          )}
        </>
      )}
      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <TituloSeccion extra="todas las áreas">Avance del equipo</TituloSeccion>
        <div className="flex flex-col gap-3 rounded-tarjeta border border-linea bg-white p-4">
          {avAreas.map((a) => {
            const p = a.total ? Math.round((a.hechas / a.total) * 100) : 0;
            return (
              <div key={a.area_id} className="flex items-center gap-3">
                <span className="w-28 text-sm font-semibold" style={{ color: a.color }}>{a.nombre}</span>
                <div className="h-3 flex-grow rounded bg-vacio"><div className="h-full rounded bg-cobre" style={{ width: `${p}%` }} /></div>
                <span className="w-10 text-right font-mono text-xs">{p}%</span>
              </div>
            );
          })}
        </div>
        {proxima && (
          <div className="flex items-center gap-3 rounded-tarjeta bg-vino p-4 text-crema">
            <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-[14px] bg-ambar text-vino-oscuro"><strong className="font-titulo text-2xl leading-none">{Math.max(0, diasHasta(proxima.fecha_inicio))}</strong><span className="text-[11px] font-semibold">días</span></span>
            <span className="flex flex-col"><span className="text-xs opacity-85">Próxima competencia</span><strong className="font-titulo text-lg">{proxima.nombre}</strong><span className="text-xs">{diaMes(proxima.fecha_inicio + 'T18:00:00Z')}</span></span>
          </div>
        )}
      </section>
    </div>
  );
}

/** Galería de estados (referencia de Estados.dc.html), útil para revisar diseño. */
export function Estados() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  return (
    <div className="mx-auto min-h-screen max-w-[480px] bg-fondo pb-10">
      <HeaderVino titulo="Avisos y errores" subtitulo="Cómo responde la app cuando algo pasa" />
      {[
        ['CONTRASEÑA INCORRECTA', <div className="flex flex-col gap-2.5 rounded-tarjeta border border-linea bg-white p-3.5"><Alerta>El usuario o la contraseña no coinciden. Revisa mayúsculas o pide un reinicio al coach.</Alerta></div>],
        ['CUENTA BLOQUEADA', <AvisoBloqueo />],
        ['SIN INTERNET', <div role="status" className="flex items-center gap-2.5 rounded-[14px] bg-tinta px-3.5 py-3 text-sm leading-[1.4] text-crema"><Icon name="sinred" /><span>Sin internet. Tus cambios se guardan y se envían cuando vuelva la conexión.</span></div>],
        ['SIN PENDIENTES', <EmptyState titulo="Hoy no tienes pendientes" texto="Revisa la semana o pídele una tarea a tu líder." accion={<Boton alto={44}>Ver la semana</Boton>} />],
        ['REGRESAR CON NOTA', <Boton onClick={() => setSheet(true)}>Abrir diálogo</Boton>],
        ['TAREA APROBADA', <Boton onClick={() => toast({ titulo: 'Tarea aprobada.', texto: 'Se sumó a la batería de Ana.', deshacer: () => {} })}>Mostrar aviso breve</Boton>],
        ['BATERÍA', <div className="flex flex-col gap-3 rounded-tarjeta bg-vino p-4"><Battery done={3} total={4} size="xl" variant="oscura" cargando /><BateriaPorcentaje hechas={68} total={100} /></div>],
      ].map(([t, c], i) => (
        <section key={i} className="mx-4 mt-[18px] flex flex-col gap-2.5">
          <span className="font-mono text-[11px] tracking-[.08em] text-tinta-3">{t as string}</span>
          {c}
        </section>
      ))}
      <RegresarConNota abierto={sheet} nombre="Ana" onCerrar={() => setSheet(false)} onEnviar={async () => setSheet(false)} />
    </div>
  );
}
