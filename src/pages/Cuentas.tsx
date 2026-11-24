import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EditarNombre, LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Maya13 } from '../components/Marca';
import { Alerta, Avatar, Boton, Campo, Cargando, Sheet, claseCampo, useToast } from '../components/ui';
import { admin, useAreas, useMembresias, usePerfiles, useSolicitudes, useTutores, type Ficha } from '../lib/datos';
import { passwordTemporal, usuarioDesdeNombre } from '../lib/cuentas';
import { fechaLarga } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';
import type { Perfil } from '../lib/tipos';

type Pestana = 'alumnos' | 'tutores' | 'lideres' | 'mentores';
type RolForm = 'integrante' | 'lider' | 'tutor' | 'coach_aux';

export default function Cuentas() {
  const { perfil: yo, esCoachPrincipal } = useSesion();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: perfiles = [], isLoading } = usePerfiles();
  const { data: areas = [] } = useAreas();
  const { data: membresias = [] } = useMembresias();
  const { data: vinculos = [] } = useTutores();
  const { data: solicitudes = [] } = useSolicitudes(true);
  const { data: bloqueos = [] } = useQuery({
    queryKey: ['bloqueos'],
    queryFn: async () => (await admin<{ bloqueos: { usuario: string }[] }>({ accion: 'bloqueos' })).bloqueos,
    refetchInterval: 60_000,
  });

  const [pestana, setPestana] = useState<Pestana>('alumnos');
  const [q, setQ] = useState('');
  const [fichas, setFichas] = useState<Ficha[] | null>(null);
  const [reiniciar, setReiniciar] = useState<Perfil | null>(null);
  const [acciones, setAcciones] = useState<Perfil | null>(null);

  const recargar = () => ['perfiles', 'membresias', 'tutores_alumnos', 'solicitudes', 'bloqueos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const esLider = (id: string) => membresias.some((m) => m.usuario_id === id && m.es_lider);
  const alumnos = perfiles.filter((p) => p.rol_global === 'alumno');
  const tutores = perfiles.filter((p) => p.rol_global === 'tutor');
  const lideres = alumnos.filter((p) => esLider(p.id));
  const mentores = perfiles.filter((p) => p.rol_global === 'coach' || p.rol_global === 'coach_aux');

  const lista = useMemo(() => {
    const base = { alumnos, tutores, lideres, mentores }[pestana];
    const t = q.trim().toLowerCase();
    return t ? base.filter((p) => p.nombre_visible.toLowerCase().includes(t) || p.usuario.includes(t)) : base;
  }, [pestana, q, alumnos, tutores, lideres, mentores]);

  function rolTexto(p: Perfil) {
    if (p.rol_global === 'coach') return 'Coach';
    if (p.rol_global === 'coach_aux') return 'Mentor';
    if (p.rol_global === 'tutor') return 'Tutor';
    const mis = membresias.filter((m) => m.usuario_id === p.id && m.es_lider);
    if (!mis.length) return 'Integrante';
    const co = mis.some((m) => membresias.filter((x) => x.area_id === m.area_id && x.es_lider).length > 1);
    return co ? 'Co-líder' : 'Líder';
  }
  function estado(p: Perfil): { t: string; c: string } {
    if (!p.activo) return { t: 'Desactivada', c: 'bg-crema text-tinta-2' };
    if (bloqueos.some((b) => b.usuario === p.usuario)) return { t: 'Bloqueada', c: 'bg-vino text-crema' };
    if (solicitudes.some((s) => s.usuario === p.usuario)) return { t: 'Pidió reinicio', c: 'bg-ambar text-vino-oscuro' };
    if (p.debe_cambiar_password) return { t: 'Sin activar', c: 'bg-urgente-fondo text-urgente' };
    return { t: 'Activa', c: 'bg-atiempo-fondo text-atiempo' };
  }
  const tutorDe = (alumno: string) => vinculos.filter((v) => v.alumno_id === alumno).map((v) => perfiles.find((p) => p.id === v.tutor_id)?.usuario).filter(Boolean).join(', ');
  const hijosDe = (tutor: string) => vinculos.filter((v) => v.tutor_id === tutor).map((v) => perfiles.find((p) => p.id === v.alumno_id)?.nombre_visible).filter(Boolean).join(', ');
  const solicitudSinCuenta = solicitudes.filter((s) => !perfiles.some((p) => p.usuario === s.usuario));

  return (
    <LayoutCoach>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[.06em] text-tinta-3">SIN CORREO · SOLO USUARIO Y CONTRASEÑA</span>
          <h1 className="m-0 font-titulo text-[30px] font-bold text-vino">Cuentas</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={() => toast({ titulo: 'Las fichas imprimibles llegan en la fase 2.', texto: 'Por ahora imprime la ficha al crear o reiniciar una cuenta.' })}>
            <Icon name="imprimir" size={18} /> Imprimir fichas
          </Boton>
          <Boton onClick={() => document.getElementById('nc-nombre')?.focus()}><Icon name="mas" size={18} /> Nueva cuenta</Boton>
        </div>
      </div>

      {solicitudes.length > 0 && (
        <section className="flex flex-col gap-2 rounded-[20px] border-2 border-ambar bg-white px-5 py-4" aria-label="Solicitudes de reinicio">
          <h2 className="m-0 font-titulo text-lg font-bold text-vino">Piden reiniciar su contraseña</h2>
          {solicitudes.map((s) => {
            const p = perfiles.find((x) => x.usuario === s.usuario);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 border-t border-[#F0E4CC] pt-2">
                <span className="flex-grow text-sm"><span className="font-mono">{s.usuario}</span>{p ? ` · ${p.nombre_visible}` : ' · no existe esa cuenta'}</span>
                {p ? (
                  <Boton alto={44} className="text-[13px]" onClick={() => setReiniciar(p)}>Reiniciar contraseña</Boton>
                ) : (
                  <Boton alto={44} variante="fantasma" className="text-[13px]" onClick={async () => { await supabase.from('solicitudes_reinicio').update({ atendida: true }).eq('id', s.id); recargar(); }}>Descartar</Boton>
                )}
              </div>
            );
          })}
          {solicitudSinCuenta.length > 0 && <span className="text-xs text-tinta-2">Las solicitudes de usuarios que no existen se pueden descartar.</span>}
        </section>
      )}

      <div className="flex flex-wrap items-start gap-[18px]">
        <section className="flex min-w-0 flex-[3_1_560px] flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="tablist" aria-label="Tipo de cuenta" className="flex flex-wrap gap-1.5">
              {([['alumnos', `Alumnos · ${alumnos.length}`], ['tutores', `Tutores · ${tutores.length}`], ['lideres', `Líderes · ${lideres.length}`], ['mentores', `Coach y mentores · ${mentores.length}`]] as [Pestana, string][]).map(([k, t]) => (
                <button key={k} role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)} className={`h-11 rounded-full px-3.5 text-sm ${pestana === k ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>{t}</button>
              ))}
            </div>
            <label htmlFor="buscar" className="sr-only">Buscar</label>
            <input id="buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o usuario" className="ml-auto h-11 min-w-[220px] rounded-full border border-linea-campo px-3.5 text-base" />
          </div>
          {isLoading ? <Cargando /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    {['Nombre', 'Usuario', 'Rol', pestana === 'tutores' ? 'Tutor de' : 'Área', pestana === 'tutores' ? '' : 'Tutor vinculado', 'Estado', ''].map((h, i) => (
                      <th key={i} scope="col" className="whitespace-nowrap border-b-2 border-linea px-3 py-2.5 text-left text-xs font-semibold text-tinta-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => {
                    const e = estado(p);
                    const misAreas = membresias.filter((m) => m.usuario_id === p.id).map((m) => areas.find((a) => a.id === m.area_id)).filter(Boolean);
                    return (
                      <tr key={p.id}>
                        <td className="border-b border-[#F0E4CC] p-3 text-sm"><span className="flex items-center gap-2.5"><Avatar iniciales={p.iniciales} color={p.color} size={32} /><strong>{p.nombre_visible}</strong></span></td>
                        <td className="border-b border-[#F0E4CC] p-3 font-mono text-[13px]">{p.usuario}</td>
                        <td className="border-b border-[#F0E4CC] p-3 text-sm">{rolTexto(p)}</td>
                        <td className="border-b border-[#F0E4CC] p-3 text-sm">
                          {pestana === 'tutores' ? hijosDe(p.id) || '—' : (
                            <span className="flex flex-wrap gap-2">
                              {misAreas.map((a) => <span key={a!.id} className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: a!.color }}><span className="h-2 w-2 rounded-full" style={{ background: a!.color }} />{a!.nombre}</span>)}
                              {!misAreas.length && '—'}
                            </span>
                          )}
                        </td>
                        <td className="border-b border-[#F0E4CC] p-3 font-mono text-xs text-tinta-2">{pestana === 'tutores' ? '' : p.rol_global === 'alumno' ? tutorDe(p.id) || '—' : ''}</td>
                        <td className="border-b border-[#F0E4CC] p-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${e.c}`}>{e.t}</span></td>
                        <td className="whitespace-nowrap border-b border-[#F0E4CC] p-3 text-right">
                          <span className="inline-flex gap-1.5">
                            {(p.rol_global !== 'coach' || p.id === yo?.id) && (
                              <button onClick={() => setReiniciar(p)} className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-linea-campo bg-white px-3 text-[13px] text-vino">
                                <Icon name="llave" size={16} /> Reiniciar contraseña
                              </button>
                            )}
                            {p.id !== yo?.id && p.rol_global !== 'coach' && (
                              <button aria-label={`Más opciones para ${p.nombre_visible}`} onClick={() => setAcciones(p)} className="inline-flex h-11 w-11 items-center justify-center rounded-[9px] border border-linea-campo bg-white font-bold text-vino">⋯</button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && <tr><td colSpan={7} className="p-4 text-sm text-tinta-3">No hay cuentas aquí.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 text-xs text-tinta-2">Las contraseñas nunca se muestran; solo se reinician. "Sin activar" = aún no entra por primera vez.</p>
        </section>

        <NuevaCuenta
          areas={areas}
          alumnos={alumnos}
          puedeMentor={esCoachPrincipal}
          onCreada={(f) => {
            setFichas(f);
            recargar();
          }}
        />
      </div>

      <ConfirmarReinicio perfil={reiniciar} onCerrar={() => setReiniciar(null)} onListo={(f) => { setReiniciar(null); setFichas(f); recargar(); }} />
      <Acciones perfil={acciones} onCerrar={() => setAcciones(null)} alumnos={alumnos} tutores={tutores} vinculos={vinculos} puedeBorrar={esCoachPrincipal} onCambio={recargar} onFichas={setFichas} />
      <Fichas fichas={fichas} onCerrar={() => setFichas(null)} />
    </LayoutCoach>
  );
}

function NuevaCuenta({ areas, alumnos, puedeMentor, onCreada }: {
  areas: { id: string; nombre: string }[]; alumnos: Perfil[]; puedeMentor: boolean; onCreada: (f: Ficha[]) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [usuarioTocado, setUsuarioTocado] = useState(false);
  const [rol, setRol] = useState<RolForm>('integrante');
  const [sel, setSel] = useState<string[]>([]);
  const [password, setPassword] = useState(passwordTemporal());
  const [conTutor, setConTutor] = useState(true);
  const [alumnoId, setAlumnoId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const esAlumno = rol === 'integrante' || rol === 'lider';
  const usuarioFinal = usuarioTocado ? usuario : (rol === 'tutor' ? 'tutor.' : '') + usuarioDesdeNombre(nombre);

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (nombre.trim().length < 2) return setError('Escribe el nombre visible (nombre e inicial está bien).');
    if (esAlumno && sel.length === 0) return setError('Elige al menos un área.');
    if (rol === 'tutor' && !alumnoId) return setError('Elige de qué alumno es tutor.');
    setError(null);
    setEnviando(true);
    try {
      const r = await admin({
        accion: 'crear',
        nombre: nombre.trim(),
        usuario: usuarioFinal,
        rol: esAlumno ? 'alumno' : rol,
        password,
        membresias: esAlumno ? sel.map((area_id) => ({ area_id, es_lider: rol === 'lider' })) : [],
        con_tutor: esAlumno && conTutor,
        alumno_id: rol === 'tutor' ? alumnoId : undefined,
        color: esAlumno ? undefined : '#5A4335',
      });
      onCreada(r.fichas);
      setNombre('');
      setUsuario('');
      setUsuarioTocado(false);
      setSel([]);
      setPassword(passwordTemporal());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
      <h2 className="m-0 font-titulo text-xl font-bold text-vino">Nueva cuenta</h2>
      <form onSubmit={crear} noValidate className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}
        <Campo id="nc-nombre" label="Nombre visible" ayuda="Nombre corto: nada de apellidos completos ni datos personales.">
          <input id="nc-nombre" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} className={claseCampo} />
        </Campo>
        <Campo id="nc-usuario" label="Usuario" ayuda="Se arma solo con nombre e inicial; puedes cambiarlo.">
          <input id="nc-usuario" value={usuarioFinal} onChange={(e) => { setUsuarioTocado(true); setUsuario(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')); }} autoCapitalize="none" className={`${claseCampo} font-mono`} />
        </Campo>
        <Campo id="nc-rol" label="Rol">
          <select id="nc-rol" value={rol} onChange={(e) => setRol(e.target.value as RolForm)} className={claseCampo}>
            <option value="integrante">Integrante</option>
            <option value="lider">Líder de área</option>
            <option value="tutor">Tutor</option>
            {puedeMentor && <option value="coach_aux">Mentor o coach 2</option>}
          </select>
        </Campo>
        {esAlumno && (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-semibold text-vino">Áreas{rol === 'lider' ? ' que lidera' : ''}</legend>
            {areas.map((a) => (
              <label key={a.id} className="flex min-h-tap items-center gap-2 text-sm">
                <input type="checkbox" checked={sel.includes(a.id)} onChange={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))} className="m-0 h-5 w-5 accent-vino" />
                {a.nombre}
              </label>
            ))}
          </fieldset>
        )}
        {rol === 'tutor' && (
          <Campo id="nc-alumno" label="Tutor de">
            <select id="nc-alumno" value={alumnoId} onChange={(e) => setAlumnoId(e.target.value)} className={claseCampo}>
              <option value="">Elige al alumno</option>
              {alumnos.map((a) => <option key={a.id} value={a.id}>{a.nombre_visible}</option>)}
            </select>
          </Campo>
        )}
        <Campo id="nc-pass" label="Contraseña temporal" ayuda="Vence en 7 días. Al entrar, la cambia.">
          <div className="flex gap-2">
            <input id="nc-pass" value={password} readOnly className={`${claseCampo} flex-grow font-mono`} />
            <Boton type="button" variante="secundario" className="whitespace-nowrap text-[13px]" onClick={() => setPassword(passwordTemporal())}>Generar otra</Boton>
          </div>
        </Campo>
        {esAlumno && (
          <label className="flex min-h-tap items-center gap-2 text-sm">
            <input type="checkbox" checked={conTutor} onChange={(e) => setConTutor(e.target.checked)} className="m-0 h-5 w-5 accent-vino" />
            Crear también la cuenta de su tutor
          </label>
        )}
        <Boton type="submit" disabled={enviando}>{enviando ? 'Creando…' : 'Crear y generar fichas'}</Boton>
      </form>
    </section>
  );
}

function ConfirmarReinicio({ perfil, onCerrar, onListo }: { perfil: Perfil | null; onCerrar: () => void; onListo: (f: Ficha[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <Sheet abierto={!!perfil} onCerrar={onCerrar} titulo={`Reiniciar a ${perfil?.nombre_visible ?? ''}`}>
      {error && <Alerta>{error}</Alerta>}
      <p className="m-0 text-sm leading-[1.45] text-tinta-2">Se genera una contraseña temporal nueva (vence en 7 días) y se desbloquea la cuenta. La anterior deja de servir; nunca se muestra.</p>
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton
          className="flex-grow"
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            setError(null);
            try {
              const r = await admin({ accion: 'reiniciar', usuario_id: perfil!.id });
              onListo(r.fichas);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setEnviando(false);
            }
          }}
        >
          Reiniciar contraseña
        </Boton>
      </div>
    </Sheet>
  );
}

function Acciones({ perfil, onCerrar, alumnos, tutores, vinculos, puedeBorrar, onCambio, onFichas }: {
  perfil: Perfil | null; onCerrar: () => void; alumnos: Perfil[]; tutores: Perfil[]; vinculos: { tutor_id: string; alumno_id: string }[];
  puedeBorrar: boolean; onCambio: () => void; onFichas: (f: Ficha[]) => void;
}) {
  const toast = useToast();
  const [vista, setVista] = useState<'menu' | 'vincular' | 'borrar' | 'nombre'>('menu');
  const [elegido, setElegido] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cerrar = () => { setVista('menu'); setElegido(''); setError(null); onCerrar(); };
  if (!perfil) return null;
  const esAlumno = perfil.rol_global === 'alumno';
  const opciones = esAlumno ? tutores : alumnos;
  const yaVinculados = vinculos.filter((v) => (esAlumno ? v.alumno_id === perfil.id : v.tutor_id === perfil.id)).map((v) => (esAlumno ? v.tutor_id : v.alumno_id));

  async function correr(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try {
      await fn();
      toast({ titulo: ok });
      onCambio();
      cerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (vista === 'nombre') return <EditarNombre perfil={perfil} abierto onCerrar={cerrar} onListo={onCambio} />;

  return (
    <Sheet abierto onCerrar={cerrar} titulo={perfil.nombre_visible}>
      {error && <Alerta>{error}</Alerta>}
      {vista === 'menu' && (
        <div className="flex flex-col gap-2">
          <Boton variante="fantasma" onClick={() => setVista('nombre')}><Icon name="editar" size={18} /> Cambiar nombre visible</Boton>
          {(esAlumno || perfil.rol_global === 'tutor') && (
            <Boton variante="fantasma" onClick={() => setVista('vincular')}><Icon name="enlace" size={18} /> {esAlumno ? 'Vincular tutor' : 'Vincular a otro alumno'}</Boton>
          )}
          {esAlumno && (
            <Boton variante="fantasma" onClick={() => correr(async () => onFichas((await admin({ accion: 'crear', rol: 'tutor', nombre: `Familia de ${perfil.nombre_visible.split(' ')[0]}`, usuario: `tutor.${perfil.usuario}`, alumno_id: perfil.id })).fichas), 'Cuenta de tutor creada.')}>
              <Icon name="mas" size={18} /> Crear cuenta de tutor nueva
            </Boton>
          )}
          <Boton variante="fantasma" onClick={() => correr(() => admin({ accion: 'estado', usuario_id: perfil.id, activo: !perfil.activo }), perfil.activo ? 'Cuenta desactivada.' : 'Cuenta activada.')}>
            {perfil.activo ? 'Desactivar cuenta (egresado)' : 'Activar cuenta'}
          </Boton>
          {puedeBorrar && <Boton variante="secundario" onClick={() => setVista('borrar')}>Borrar cuenta y sus datos</Boton>}
        </div>
      )}
      {vista === 'vincular' && (
        <div className="flex flex-col gap-3">
          <Campo id="vincular" label={esAlumno ? 'Tutor' : 'Alumno'}>
            <select id="vincular" value={elegido} onChange={(e) => setElegido(e.target.value)} className={claseCampo}>
              <option value="">Elige…</option>
              {opciones.filter((o) => !yaVinculados.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.nombre_visible} ({o.usuario})</option>)}
            </select>
          </Campo>
          <span className="text-xs text-tinta-2">Un tutor puede estar vinculado a varios alumnos (hermanos).</span>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => setVista('menu')}>Atrás</Boton>
            <Boton className="flex-grow" disabled={!elegido} onClick={() => correr(async () => {
              const { error } = await supabase.from('tutores_alumnos').insert(esAlumno ? { tutor_id: elegido, alumno_id: perfil.id } : { tutor_id: perfil.id, alumno_id: elegido });
              if (error) throw new Error('No se pudo vincular.');
            }, 'Tutor vinculado.')}>Vincular</Boton>
          </div>
        </div>
      )}
      {vista === 'borrar' && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm leading-[1.45] text-tinta-2">Se borra la cuenta <strong className="font-mono">{perfil.usuario}</strong> con sus fotos y comentarios. Sus tareas quedan en el historial sin su nombre. <strong>No se puede deshacer.</strong></p>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => setVista('menu')}>Cancelar</Boton>
            <Boton className="flex-grow" onClick={() => correr(() => admin({ accion: 'borrar', usuario_id: perfil.id }), 'Cuenta borrada.')}>Sí, borrar para siempre</Boton>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Fichas de acceso recién generadas: única vez que se ve la contraseña temporal. */
function Fichas({ fichas, onCerrar }: { fichas: Ficha[] | null; onCerrar: () => void }) {
  return (
    <Sheet abierto={!!fichas} onCerrar={onCerrar} titulo={fichas && fichas.length > 1 ? 'Fichas de acceso' : 'Ficha de acceso'}>
      <p className="m-0 text-[13px] text-tinta-2">Anótalas o imprímelas ahora: al cerrar esta ventana ya no se vuelven a ver.</p>
      <div id="fichas-imprimir" className="flex flex-col gap-3">
        {fichas?.map((f) => (
          <div key={f.usuario_id} className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-linea-campo p-4">
            <div className="flex items-center gap-2 font-titulo text-sm font-bold tracking-[.06em] text-vino"><span>ZERΩ</span><Maya13 /><span>ΩHMS</span><span className="ml-auto font-mono text-[11px] font-medium tracking-normal text-tinta-3">FICHA DE ACCESO</span></div>
            <span className="text-[13px] text-tinta-2">{f.rol === 'tutor' ? `Cuenta de tutor de ${f.tutor_de ?? f.nombre.replace(/^Familia de /, '')}` : `Cuenta de ${f.nombre}`}</span>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col"><span className="text-xs text-tinta-3">Dirección</span><span className="break-all font-mono text-[13px]">{location.host}</span></div>
              <div />
              <div className="flex flex-col"><span className="text-xs text-tinta-3">Usuario</span><span className="font-mono text-base font-medium">{f.usuario}</span></div>
              <div className="flex flex-col"><span className="text-xs text-tinta-3">Contraseña</span><span className="font-mono text-base font-medium">{f.password}</span></div>
            </div>
            <span className="text-xs text-tinta-2">Vence el {fechaLarga(f.vence)}. Al entrar, cámbiala{f.rol === 'tutor' ? ' y acepta el aviso de privacidad' : ''}.</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={() => window.print()}><Icon name="imprimir" size={18} /> Imprimir</Boton>
        <Boton className="flex-grow" onClick={onCerrar}>Listo, ya las anoté</Boton>
      </div>
    </Sheet>
  );
}
