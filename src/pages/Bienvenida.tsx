import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Marca';
import { Alerta, Campo, claseCampo, Sheet } from '../components/ui';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';

export default function Bienvenida() {
  const { perfil, esTutor, recargarPerfil } = useSesion();
  const nav = useNavigate();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [aviso, setAviso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [distinta, setDistinta] = useState<boolean | null>(null);

  if (!perfil) return null;
  if (!perfil.debe_cambiar_password) return <Navigate to="/" replace />;

  const largo = p1.length >= 8;
  const coinciden = p1.length > 0 && p1 === p2;
  const listo = largo && coinciden && (!esTutor || acepta);
  const nombre = perfil.nombre_visible.replace(/^Familia/, 'familia');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!listo) {
      setError(!largo ? 'La contraseña necesita al menos 8 caracteres.' : !coinciden ? 'Las dos contraseñas no coinciden.' : 'Acepta el aviso de privacidad para entrar.');
      return;
    }
    setEnviando(true);
    setError(null);
    const { error: e1 } = await supabase.auth.updateUser({ password: p1 });
    if (e1) {
      setEnviando(false);
      if (/different|same/i.test(e1.message)) {
        setDistinta(false);
        return setError('Usa una contraseña distinta a la de tu ficha.');
      }
      if (/weak|short|length/i.test(e1.message)) return setError('Esa contraseña es muy fácil. Usa al menos 8 caracteres, mezcla letras y números.');
      return setError('No se pudo guardar. Revisa tu conexión y vuelve a intentar.');
    }
    const { error: e2 } = await supabase.rpc('completar_primer_ingreso', { p_acepta_privacidad: esTutor ? acepta : false });
    setEnviando(false);
    if (e2) return setError('No se pudo guardar. Vuelve a intentar.');
    await recargarPerfil();
    nav(esTutor ? '/familia' : '/', { replace: true });
  }

  const Regla = ({ ok, children }: { ok: boolean | null; children: string }) => (
    <li className={`flex items-center gap-2 ${ok ? 'text-atiempo' : 'text-tinta-3'}`}>
      <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${ok ? 'bg-atiempo text-white' : 'border-2 border-linea-campo'}`}>
        {ok && <Icon name="palomita" size={12} stroke={3} />}
      </span>
      {children}
      <span className="sr-only">{ok ? '(cumple)' : '(pendiente)'}</span>
    </li>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-fondo text-tinta">
      <div className="flex flex-col gap-3 rounded-b-header bg-vino px-6 pb-7 pt-10 text-crema">
        <Wordmark size={18} />
        <h1 className="m-0 mt-2 font-titulo text-[28px] font-bold leading-[1.1]">Bienvenida, {nombre}</h1>
        <p className="m-0 text-sm leading-[1.45]">Antes de entrar, cambia la contraseña de tu ficha por una que solo tú conozcas.</p>
      </div>
      <form onSubmit={enviar} noValidate className="mx-5 mt-5 flex flex-col gap-3.5 pb-8">
        {error && <Alerta>{error}</Alerta>}
        <Campo id="n1" label="Nueva contraseña">
          <input id="n1" type="password" autoComplete="new-password" value={p1} onChange={(e) => { setP1(e.target.value); setDistinta(null); }} className={claseCampo} aria-describedby="reglas" />
        </Campo>
        <Campo id="n2" label="Repítela">
          <input id="n2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} className={claseCampo} aria-describedby="reglas" />
        </Campo>
        <ul id="reglas" className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
          <Regla ok={largo}>Al menos 8 caracteres</Regla>
          <Regla ok={coinciden}>Las dos coinciden</Regla>
          <Regla ok={distinta === false ? false : largo && coinciden ? true : null}>Distinta a la de la ficha</Regla>
        </ul>
        {esTutor && (
          <div className="flex flex-col gap-2 rounded-2xl border border-linea bg-white p-3.5">
            <strong className="font-titulo text-base text-vino">Aviso de privacidad</strong>
            <ul className="m-0 pl-[18px] text-[13px] leading-[1.5] text-[#3F2C20]">
              <li>Solo verás las tareas de tu hijo(a) y el avance general del equipo.</li>
              <li>La app guarda nombre corto y tareas; no pide correo, teléfono ni CURP.</li>
              <li>Al terminar el ciclo la cuenta se desactiva y sus datos se borran.</li>
            </ul>
            <button type="button" onClick={() => setAviso(true)} className="self-start bg-transparent p-0 text-[13px] text-vino underline min-h-tap">Leer el aviso completo</button>
            <label className="flex min-h-tap items-center gap-2.5 text-sm">
              <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="m-0 h-[22px] w-[22px] accent-vino" />
              Leí y acepto el aviso
            </label>
          </div>
        )}
        <button type="submit" disabled={enviando} className="flex h-14 items-center justify-center rounded-campo border-0 bg-vino font-titulo text-base font-bold text-crema disabled:opacity-60">
          {enviando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
      </form>
      <Sheet abierto={aviso} onCerrar={() => setAviso(false)} titulo="Aviso de privacidad">
        <AvisoCompleto />
        <button onClick={() => setAviso(false)} className="h-12 rounded-campo border-0 bg-vino font-semibold text-crema">Cerrar</button>
      </Sheet>
    </main>
  );
}

export function AvisoCompleto() {
  return (
    <div className="flex flex-col gap-2 text-sm leading-[1.5] text-tinta-2">
      <p className="m-0"><strong className="text-tinta">Quién lo usa.</strong> Tablero Zero es la app interna de la Selección de Robótica Zero-Ohms de la Preparatoria Estatal N.º 13. Solo el coach crea cuentas.</p>
      <p className="m-0"><strong className="text-tinta">Qué guarda.</strong> Un nombre corto, iniciales, un color, las tareas del taller, sus pasos, comentarios y fotos del robot o del trabajo. No pide correo, teléfono, dirección, CURP ni fotos de cara.</p>
      <p className="m-0"><strong className="text-tinta">Qué ves como tutor.</strong> Solo las tareas de tu hijo(a), en solo lectura, y el avance del equipo en totales por área, sin nombres de otros alumnos.</p>
      <p className="m-0"><strong className="text-tinta">Quién más lo ve.</strong> El coach y los líderes del área de tu hijo(a) ven sus tareas para acompañarlo. Nadie fuera del equipo. La app no es pública ni aparece en buscadores.</p>
      <p className="m-0"><strong className="text-tinta">Cuánto tiempo.</strong> Al terminar el ciclo el coach desactiva la cuenta y borra sus datos.</p>
      <p className="m-0"><strong className="text-tinta">Dudas o cambios.</strong> Habla con el coach del equipo.</p>
    </div>
  );
}
