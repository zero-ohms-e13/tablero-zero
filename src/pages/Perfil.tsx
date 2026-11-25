import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Avatar, HeaderVino, PantallaCel, Sheet } from '../components/ui';
import { CambiarPassword } from './Varias';
import { AvisoCompleto } from './Bienvenida';
import { esMia, useAreas, useAvanceMetas, useMetas, useTareas, useTutores } from '../lib/datos';
import { semanaDe } from '../lib/fechas';
import { usePrefs } from '../lib/preferencias';
import { useNotificaciones } from '../lib/notificaciones';
import { useSesion } from '../lib/sesion';

function Interruptor({ etiqueta, activo, onCambio, icono, detalle, deshabilitado }: {
  etiqueta: string; activo: boolean; onCambio: (v: boolean) => void; icono: string; detalle?: ReactNode; deshabilitado?: boolean;
}) {
  const id = `sw-${etiqueta.replace(/\s/g, '-')}`;
  return (
    <div className="flex min-h-[56px] items-center gap-3 border-b border-[#F0E4CC] px-3.5 last:border-b-0">
      <span className="text-vino"><Icon name={icono} /></span>
      <label htmlFor={id} className="flex flex-grow flex-col py-2 text-[15px]">
        {etiqueta}
        {detalle && <span className="text-xs text-tinta-3">{detalle}</span>}
      </label>
      <button
        id={id}
        role="switch"
        aria-checked={activo}
        disabled={deshabilitado}
        onClick={() => onCambio(!activo)}
        className={`relative h-7 w-12 shrink-0 rounded-full border-0 transition-colors disabled:opacity-50 ${activo ? 'bg-vino' : 'bg-[#D8C6A6]'}`}
      >
        <span aria-hidden="true" className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-all" style={{ left: activo ? 23 : 3 }} />
      </button>
    </div>
  );
}

export default function Perfil() {
  const { perfil, membresias, salir, esTutor, esCoach } = useSesion();
  const { data: areas = [] } = useAreas();
  const { data: tareas = [] } = useTareas();
  const { data: metas = [] } = useMetas();
  const { data: avance = [] } = useAvanceMetas();
  const { data: vinculos = [] } = useTutores(!esCoach);
  const [prefs, setPrefs] = usePrefs();
  const notif = useNotificaciones();
  const [cambiar, setCambiar] = useState(false);
  const [aviso, setAviso] = useState(false);

  const stats = useMemo(() => {
    if (!perfil) return { hechas: 0, semanas: 0, metas: 0 };
    const mias = tareas.filter((t) => esMia(t, perfil.id));
    // Semanas con batería llena: semanas pasadas o actual con tareas y todas hechas
    const porSemana = new Map<string, { total: number; hechas: number }>();
    for (const t of mias) {
      if (!t.fecha_limite) continue;
      const k = semanaDe(new Date(t.fecha_limite)).inicio.toISOString();
      const s = porSemana.get(k) ?? { total: 0, hechas: 0 };
      s.total++;
      if (t.estado === 'hecha') s.hechas++;
      porSemana.set(k, s);
    }
    const semanas = [...porSemana.values()].filter((s) => s.total > 0 && s.hechas === s.total).length;
    const metasCumplidas = metas.filter((m) => {
      const a = avance.find((x) => x.meta_id === m.id);
      return a && a.total > 0 && a.hechas === a.total && mias.some((t) => t.meta_id === m.id);
    }).length;
    return { hechas: mias.filter((t) => t.estado === 'hecha').length, semanas, metas: metasCumplidas };
  }, [perfil, tareas, metas, avance]);

  if (!perfil) return null;
  const misAreas = membresias.map((m) => areas.find((a) => a.id === m.area_id)).filter(Boolean);
  const rol = esCoach ? (perfil.rol_global === 'coach' ? 'Coach' : 'Mentor') : esTutor ? 'Tutor' : membresias.some((m) => m.es_lider) ? 'Líder' : 'Integrante';
  const tieneTutor = vinculos.some((v) => v.alumno_id === perfil.id);

  const cuerpo = (
    <>
      <HeaderVino atras={esCoach ? '/coach' : esTutor ? '/familia' : undefined} titulo={esCoach || esTutor ? 'Perfil' : undefined}>
        <div className="flex items-center gap-3.5">
          <Avatar iniciales={perfil.iniciales} color={perfil.color} size={64} className="ring-2 ring-crema/50" />
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-titulo text-2xl font-bold">{perfil.nombre_visible}</h1>
            <span className="font-mono text-[13px] opacity-90">{perfil.usuario}</span>
            <span className="flex flex-wrap gap-1.5">
              {misAreas.map((a) => (
                <span key={a!.id} className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: a!.color_claro, color: a!.color }}>{a!.nombre}</span>
              ))}
              <span className="whitespace-nowrap rounded-full bg-crema px-2.5 py-1 text-xs font-semibold text-vino">{rol}</span>
            </span>
          </div>
        </div>
        {!esTutor && !esCoach && (
          <div className="grid grid-cols-3 gap-2">
            {[[stats.hechas, 'tareas hechas'], [stats.semanas, 'semanas con batería llena'], [stats.metas, 'metas cumplidas']].map(([n, t]) => (
              <div key={t} className="rounded-campo bg-crema/[.12] p-2.5">
                <div className="font-titulo text-[22px] font-bold">{n}</div>
                <div className="text-xs">{t}</div>
              </div>
            ))}
          </div>
        )}
      </HeaderVino>

      <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
        <div className="flex flex-col rounded-tarjeta border border-linea bg-white">
          <button onClick={() => setCambiar(true)} className="flex min-h-[56px] items-center gap-3 border-0 border-b border-[#F0E4CC] bg-transparent px-3.5 text-left text-[15px] text-tinta">
            <span className="text-vino"><Icon name="llave" /></span>
            <span className="flex-grow">Cambiar contraseña</span>
            <Icon name="atras" className="rotate-180 text-tinta-3" size={18} />
          </button>
          <Interruptor icono="editar" etiqueta="Letra grande" activo={prefs.letraGrande} onCambio={(v) => setPrefs({ letraGrande: v })} />
          <Interruptor icono="ojo" etiqueta="Modo oscuro" activo={prefs.oscuro} onCambio={(v) => setPrefs({ oscuro: v })} />
          <Interruptor
            icono="campana"
            etiqueta="Avisos en el celular"
            activo={notif.activo}
            deshabilitado={!notif.soportado || notif.ocupado}
            detalle={!notif.soportado ? 'Este navegador no permite avisos. En iPhone, primero instala la app.' : notif.bloqueado ? 'Los bloqueaste en el navegador; actívalos en sus ajustes.' : undefined}
            onCambio={(v) => (v ? notif.activar() : notif.desactivar())}
          />
        </div>
      </section>

      {!esCoach && (
        <section className="mx-4 mt-[18px] flex flex-col gap-2.5">
          <div className="flex items-center gap-3 rounded-tarjeta border border-linea bg-white p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-campo bg-crema text-vino"><Icon name="candado" /></span>
            <div className="flex flex-col gap-0.5">
              {esTutor ? (
                <>
                  <strong className="text-[15px]">Cuenta de solo lectura</strong>
                  <span className="text-[13px] leading-[1.4] text-tinta-2">Ves las tareas de tu hijo(a) y el avance general, sin poder cambiarlos.</span>
                  <button onClick={() => setAviso(true)} className="min-h-tap self-start bg-transparent p-0 text-[13px] text-vino underline">Leer el aviso de privacidad</button>
                </>
              ) : (
                <>
                  <strong className="text-[15px]">{tieneTutor ? 'Tu tutor tiene cuenta' : 'Tu tutor aún no tiene cuenta'}</strong>
                  <span className="text-[13px] leading-[1.4] text-tinta-2">{tieneTutor ? 'Ve tus tareas y el avance del equipo, sin poder cambiarlos.' : 'Cuando el coach la cree, verá tus tareas y el avance del equipo, sin poder cambiarlos.'}</span>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="mx-4 mt-[18px] mb-6 flex flex-col gap-2.5">
        <button onClick={salir} className="flex h-12 items-center justify-center gap-2 rounded-campo border border-vino bg-white text-[15px] font-medium text-vino">
          <Icon name="salir" size={18} /> Cerrar sesión
        </button>
        {esTutor && <Link to="/familia" className="text-center text-sm">Regresar</Link>}
      </section>
      <CambiarPassword abierto={cambiar} onCerrar={() => setCambiar(false)} />
      <Sheet abierto={aviso} onCerrar={() => setAviso(false)} titulo="Aviso de privacidad"><AvisoCompleto /></Sheet>
    </>
  );
  return esTutor || esCoach ? <div className="mx-auto min-h-screen max-w-[480px] bg-fondo">{cuerpo}</div> : <PantallaCel>{cuerpo}</PantallaCel>;
}
