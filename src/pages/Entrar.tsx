import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Lockup } from '../components/Marca';
import { Alerta, AvisoBloqueo, Boton, Campo, claseCampo, Sheet } from '../components/ui';
import { entrar, useSesion, type ErrorEntrar } from '../lib/sesion';
import { configurado, recordar, supabase } from '../lib/supabase';

const MENSAJES: Record<ErrorEntrar['codigo'], string> = {
  incorrecta: 'El usuario o la contraseña no coinciden. Revisa mayúsculas o pide un reinicio al coach.',
  bloqueada: '',
  inactiva: 'Esta cuenta está desactivada. Habla con el coach.',
  temporal_vencida: 'La contraseña de tu ficha ya venció (duran 7 días). Pide una nueva al coach.',
  red: 'Sin internet. Revisa tu conexión y vuelve a intentar.',
  config: 'La app aún no está conectada a la base de datos. Avisa al coach.',
};

export default function Entrar() {
  const { sesion, perfil, cargando } = useSesion();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [ver, setVer] = useState(false);
  const [recordarme, setRecordarme] = useState(recordar.get());
  const [error, setError] = useState<ErrorEntrar | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [olvido, setOlvido] = useState(false);

  if (!cargando && sesion && perfil) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!configurado) return setError({ codigo: 'config' });
    if (!usuario.trim() || !password) return setError({ codigo: 'incorrecta' });
    setEnviando(true);
    setError(null);
    const r = await entrar(usuario, password, recordarme);
    setEnviando(false);
    if (r) {
      setError(r);
      setPassword('');
    }
  }

  const bloqueada = error?.codigo === 'bloqueada';
  const malPassword = error?.codigo === 'incorrecta';

  return (
    <main className="flex min-h-screen justify-center bg-vino">
      <div className="box-border flex min-h-screen w-full max-w-[480px] flex-col gap-[22px] px-6 pb-6 pt-10 text-crema">
        <div className="flex flex-col gap-3.5">
          <Lockup ancho={300} />
          <span className="font-mono text-xs tracking-[.12em] opacity-85">ROBOTICS · PREPA ESTATAL 13</span>
          <h1 className="m-0 font-titulo text-[54px] font-bold leading-[.95]">
            Tablero
            <br />
            Zero
          </h1>
          <p className="m-0 max-w-[290px] text-[15px] leading-[1.45]">Tus pendientes del taller, lo que ya cargaste y lo que le toca al robot.</p>
        </div>

        <form onSubmit={enviar} noValidate className="flex flex-col gap-3.5 rounded-[22px] bg-fondo p-[22px] text-tinta">
          {bloqueada && <AvisoBloqueo />}
          {error && !bloqueada && <Alerta>{MENSAJES[error.codigo]}{malPassword && error.restantes !== undefined && error.restantes <= 2 ? ` Te quedan ${error.restantes} intentos.` : ''}</Alerta>}
          <Campo id="usuario" label="Usuario">
            <input
              id="usuario"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/\s/g, ''))}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              className={`${claseCampo} h-[52px] font-mono text-[17px]`}
              placeholder="ana.l"
            />
          </Campo>
          <Campo id="password" label="Contraseña">
            <div className="flex gap-2">
              <input
                id="password"
                type={ver ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-invalid={malPassword || undefined}
                aria-describedby={error ? 'password-error' : undefined}
                className={`${claseCampo} h-[52px] min-w-0 flex-grow text-[17px] ${malPassword ? 'border-vino' : ''}`}
              />
              <button
                type="button"
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={ver}
                onClick={() => setVer((v) => !v)}
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-campo border-2 border-linea-campo bg-white text-vino"
              >
                <Icon name="ojo" />
              </button>
            </div>
          </Campo>
          <label className="flex min-h-tap items-center gap-2.5 text-sm">
            <input type="checkbox" checked={recordarme} onChange={(e) => setRecordarme(e.target.checked)} className="h-[22px] w-[22px] accent-vino" />
            Recordarme en este celular
          </label>
          <button
            type="submit"
            disabled={enviando || bloqueada}
            className="flex h-14 items-center justify-center gap-2.5 rounded-[14px] border-0 bg-vino font-titulo text-[17px] font-semibold text-crema disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar al taller'}
            <Icon name="rayo" fill="#E9A84F" />
          </button>
          <button type="button" onClick={() => setOlvido(true)} className="min-h-tap bg-transparent py-2 text-center text-sm text-vino underline">
            Olvidé mi contraseña
          </button>
        </form>

        <div className="mt-auto flex items-center gap-3.5 rounded-2xl border border-crema/35 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo bg-crema text-vino">
            <Icon name="llave" />
          </span>
          <span className="flex flex-col gap-0.5">
            <strong className="text-[15px]">¿Eres mamá, papá o tutor?</strong>
            <span className="text-[13px] opacity-[.92]">Entra con el usuario y la contraseña de tu ficha de acceso.</span>
          </span>
        </div>
      </div>
      <Olvide abierto={olvido} onCerrar={() => setOlvido(false)} inicial={usuario} />
    </main>
  );
}

function Olvide({ abierto, onCerrar, inicial }: { abierto: boolean; onCerrar: () => void; inicial: string }) {
  const [u, setU] = useState(inicial);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const cerrar = () => {
    setListo(false);
    onCerrar();
  };
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!u.trim()) return;
    setEnviando(true);
    await supabase.rpc('solicitar_reinicio', { p_usuario: u.trim().toLowerCase() });
    setEnviando(false);
    setListo(true);
  }
  return (
    <Sheet abierto={abierto} onCerrar={cerrar} titulo="Olvidé mi contraseña">
      {listo ? (
        <>
          <p className="m-0 text-sm leading-[1.45] text-tinta-2">Listo. El coach verá tu solicitud y te dará una contraseña nueva en una ficha. No mandamos correos.</p>
          <Boton onClick={cerrar}>Entendido</Boton>
        </>
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <p className="m-0 text-sm leading-[1.45] text-tinta-2">No mandamos correos. Le avisamos al coach para que te reinicie la contraseña.</p>
          <Campo id="olvide-usuario" label="Tu usuario">
            <input id="olvide-usuario" value={u} onChange={(e) => setU(e.target.value.toLowerCase())} autoCapitalize="none" className={`${claseCampo} font-mono`} />
          </Campo>
          <div className="flex gap-2">
            <Boton type="button" variante="secundario" onClick={cerrar}>Cancelar</Boton>
            <Boton type="submit" className="flex-grow" disabled={enviando || !u.trim()}>Avisar al coach</Boton>
          </div>
        </form>
      )}
    </Sheet>
  );
}
