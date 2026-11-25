// Fichas de acceso imprimibles: 4 por hoja carta, para recortar y entregar en sobre cerrado.
// Las contraseñas no se guardan en ningún lado, así que imprimir fichas genera temporales nuevas.
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Marca';
import { Alerta, Avatar, Boton, Cargando, Sheet } from '../components/ui';
import { admin, usePerfiles, useTutores, type Ficha } from '../lib/datos';
import { fechaLarga } from '../lib/fechas';

type Filtro = 'tutores' | 'alumnos' | 'sin_activar';

export default function Fichas() {
  const loc = useLocation();
  const qc = useQueryClient();
  const { data: perfiles = [], isLoading } = usePerfiles();
  const { data: vinculos = [] } = useTutores();
  const [fichas, setFichas] = useState<Ficha[]>((loc.state as { fichas?: Ficha[] } | null)?.fichas ?? []);
  const [filtro, setFiltro] = useState<Filtro>('sin_activar');
  const [sel, setSel] = useState<string[]>([]);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(0);

  const lista = useMemo(() => {
    const base = perfiles.filter((p) => p.activo && (p.rol_global === 'tutor' || p.rol_global === 'alumno'));
    if (filtro === 'tutores') return base.filter((p) => p.rol_global === 'tutor');
    if (filtro === 'alumnos') return base.filter((p) => p.rol_global === 'alumno');
    return base.filter((p) => p.debe_cambiar_password);
  }, [perfiles, filtro]);

  const hijoDe = (tutor: string) => vinculos.filter((v) => v.tutor_id === tutor).map((v) => perfiles.find((p) => p.id === v.alumno_id)?.nombre_visible).filter(Boolean).join(' y ');

  async function generar() {
    setConfirmar(false);
    setError(null);
    const nuevas: Ficha[] = [];
    for (const id of sel) {
      setGenerando((n) => n + 1);
      try {
        const r = await admin({ accion: 'reiniciar', usuario_id: id });
        nuevas.push(...r.fichas.map((f) => ({ ...f, tutor_de: f.rol === 'tutor' ? hijoDe(f.usuario_id) || undefined : undefined })));
      } catch (e) {
        setError(`No se pudo generar la ficha de una cuenta: ${(e as Error).message}`);
      }
    }
    setGenerando(0);
    setFichas(nuevas);
    setSel([]);
    qc.invalidateQueries({ queryKey: ['perfiles'] });
  }

  const hojas: Ficha[][] = [];
  for (let i = 0; i < fichas.length; i += 4) hojas.push(fichas.slice(i, i + 4));

  return (
    <LayoutCoach>
      <div className="no-imprimir flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tracking-[.06em] text-tinta-3">4 POR HOJA CARTA · RECORTA Y ENTREGA EN SOBRE</span>
          <h1 className="m-0 font-titulo text-[30px] font-bold text-vino">Fichas de acceso</h1>
        </div>
        {fichas.length > 0 && (
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={() => setFichas([])}>Elegir otras</Boton>
            <Boton onClick={() => window.print()}><Icon name="imprimir" size={18} /> Imprimir {hojas.length} {hojas.length === 1 ? 'hoja' : 'hojas'}</Boton>
          </div>
        )}
      </div>

      {error && <div className="no-imprimir"><Alerta>{error}</Alerta></div>}

      {fichas.length === 0 ? (
        <section className="no-imprimir flex flex-col gap-3 rounded-[20px] border border-linea bg-white px-5 py-[18px]">
          <p className="m-0 text-sm leading-[1.45] text-tinta-2">
            Las contraseñas no se guardan, así que al imprimir se genera una <strong>temporal nueva</strong> (vence en 7 días) para cada cuenta elegida. La anterior deja de servir.
          </p>
          <div role="tablist" aria-label="Qué cuentas" className="flex flex-wrap gap-1.5">
            {([['sin_activar', 'Sin activar'], ['tutores', 'Tutores'], ['alumnos', 'Alumnos']] as [Filtro, string][]).map(([k, t]) => (
              <button key={k} role="tab" aria-selected={filtro === k} onClick={() => { setFiltro(k); setSel([]); }} className={`h-11 rounded-full px-3.5 text-sm ${filtro === k ? 'border-0 bg-vino font-semibold text-crema' : 'border border-linea-campo bg-white text-tinta'}`}>{t}</button>
            ))}
            <button onClick={() => setSel(sel.length === lista.length ? [] : lista.map((p) => p.id))} className="ml-auto h-11 rounded-full border border-linea-campo bg-white px-3.5 text-sm text-vino">
              {sel.length === lista.length && lista.length ? 'Quitar todas' : 'Elegir todas'}
            </button>
          </div>
          {isLoading ? <Cargando /> : (
            <ul className="m-0 grid list-none gap-2 p-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {lista.map((p) => (
                <li key={p.id}>
                  <label className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 ${sel.includes(p.id) ? 'border-2 border-vino bg-crema/40' : 'border-linea bg-white'}`}>
                    <input type="checkbox" checked={sel.includes(p.id)} onChange={() => setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} className="h-5 w-5 accent-vino" />
                    <Avatar iniciales={p.iniciales} color={p.color} size={32} />
                    <span className="flex min-w-0 flex-col">
                      <strong className="truncate text-sm">{p.rol_global === 'tutor' ? `Tutor de ${hijoDe(p.id) || '—'}` : p.nombre_visible}</strong>
                      <span className="font-mono text-xs text-tinta-3">{p.usuario}{p.debe_cambiar_password ? ' · sin activar' : ''}</span>
                    </span>
                  </label>
                </li>
              ))}
              {lista.length === 0 && <li className="text-sm text-tinta-3">No hay cuentas en esta lista.</li>}
            </ul>
          )}
          <Boton disabled={!sel.length || generando > 0} onClick={() => setConfirmar(true)} className="self-start">
            {generando ? `Generando ${generando} de ${sel.length}…` : `Generar ${sel.length || ''} ${sel.length === 1 ? 'ficha' : 'fichas'}`}
          </Boton>
        </section>
      ) : (
        <div className="imprimible flex flex-col items-center gap-6">
          {hojas.map((h, i) => (
            <div key={i} className="hoja-carta box-border flex w-full max-w-[816px] flex-col gap-4 bg-white p-10 shadow-md">
              <div className="flex items-baseline justify-between text-xs text-tinta-2">
                <span>Recorta por la línea punteada · entrega en sobre cerrado</span>
                <span>Hoja {i + 1} de {hojas.length}</span>
              </div>
              <div className="grid flex-grow grid-cols-2 gap-[18px]">
                {h.map((f) => <FichaImpresa key={f.usuario_id} f={f} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet abierto={confirmar} onCerrar={() => setConfirmar(false)} titulo={`Generar ${sel.length} ${sel.length === 1 ? 'ficha' : 'fichas'}`}>
        <p className="m-0 text-sm leading-[1.45] text-tinta-2">Cada cuenta recibe una contraseña temporal nueva y la anterior deja de funcionar. Entrega las fichas pronto: vencen en 7 días.</p>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
          <Boton className="flex-grow" onClick={generar}>Sí, generar</Boton>
        </div>
      </Sheet>
    </LayoutCoach>
  );
}

export function FichaImpresa({ f }: { f: Ficha }) {
  const tutor = f.rol === 'tutor';
  return (
    <div className="box-border flex flex-col gap-3 rounded-[14px] border-2 border-dashed border-[#A88F6A] p-[22px] text-tinta" style={{ breakInside: 'avoid' }}>
      <div className="flex items-center justify-between text-vino">
        <Wordmark />
        <span className="font-mono text-[10px] tracking-[.1em]">FICHA DE ACCESO</span>
      </div>
      <div>
        <div className="text-[11px] text-tinta-2">{tutor ? 'Cuenta de tutor de' : 'Cuenta de'}</div>
        <div className="font-titulo text-[22px] font-bold text-vino">{tutor ? (f.tutor_de ?? f.nombre.replace(/^Familia de /, '')) : f.nombre}</div>
      </div>
      <div className="grid items-center gap-x-3 gap-y-1.5 text-[13px]" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <span className="text-tinta-2">Dirección</span>
        <strong className="break-all font-mono text-[13px]">{location.host}</strong>
        <span className="text-tinta-2">Usuario</span>
        <strong className="font-mono text-[15px]">{f.usuario}</strong>
        <span className="text-tinta-2">Contraseña</span>
        <strong className="justify-self-start rounded bg-crema px-1.5 py-0.5 font-mono text-[15px]">{f.password}</strong>
      </div>
      <ol className="m-0 list-decimal pl-[18px] text-xs leading-[1.45]">
        <li>Abre la dirección en tu celular.</li>
        <li>Entra con tu usuario y contraseña.</li>
        <li>{tutor ? 'Cámbiala por una tuya y acepta el aviso de privacidad.' : 'Cámbiala por una tuya.'}</li>
      </ol>
      <div className="mt-auto flex justify-between border-t border-linea pt-2 text-[11px] text-tinta-2">
        <span>Vence el {fechaLarga(f.vence)}</span>
        <span>Dudas: coach del equipo</span>
      </div>
    </div>
  );
}
