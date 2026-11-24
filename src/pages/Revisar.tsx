// Piezas compartidas por Mi área (líder) y el Panel del coach.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alerta, Boton, Sheet, claseCampo, useToast } from '../components/ui';
import { useAprobar, useMoverEstado, useRegresar } from '../lib/datos';
import { ROBOT_NOMBRE, type Area, type Perfil, type Tarea } from '../lib/tipos';

export function RegresarConNota({ abierto, nombre, onCerrar, onEnviar }: {
  abierto: boolean; nombre: string; onCerrar: () => void; onEnviar: (nota: string) => Promise<void>;
}) {
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    if (!nota.trim()) return setError('Escribe qué le falta antes de regresarla.');
    setEnviando(true);
    try {
      await onEnviar(nota.trim());
      setNota('');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo={nombre ? `Regresar a ${nombre}` : 'Regresar con nota'}>
      {error && <Alerta>{error}</Alerta>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nota-regreso" className="text-[13px] font-semibold text-vino">¿Qué le falta?</label>
        <textarea
          id="nota-regreso"
          rows={3}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          aria-describedby="nota-ayuda"
          className={`${claseCampo} h-auto resize-none py-3 leading-[1.4]`}
          placeholder="Falta el video del tercer recorrido para el Notebook."
        />
        <span id="nota-ayuda" className="text-xs text-tinta-2">La nota es obligatoria: dile qué falta, no qué salió mal.</span>
      </div>
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton className="flex-grow" onClick={enviar} disabled={enviando}>Regresar con nota</Boton>
      </div>
    </Sheet>
  );
}

/** Tarjeta "Por revisar" con Aprobar / Regresar con nota. */
export function PorRevisar({ tarea, area, responsables, compacta }: { tarea: Tarea; area?: Area; responsables: Perfil[]; compacta?: boolean }) {
  const aprobar = useAprobar();
  const regresar = useRegresar();
  const mover = useMoverEstado();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const nombres = responsables.map((p) => p.nombre_visible.split(' ')[0]).join(' y ');
  const hechos = tarea.tarea_pasos.filter((p) => p.hecho).length;
  const fotos = tarea.evidencias?.filter((e) => e.tipo === 'foto').length ?? 0;
  const enlaces = tarea.evidencias?.filter((e) => e.tipo === 'enlace').length ?? 0;
  const evidencia = [
    tarea.tarea_pasos.length ? `${hechos} de ${tarea.tarea_pasos.length} pasos` : null,
    fotos ? `${fotos} foto${fotos > 1 ? 's' : ''}` : null,
    enlaces ? `${enlaces} enlace${enlaces > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ') || 'sin evidencia';

  async function ok() {
    try {
      await aprobar.mutateAsync(tarea.id);
      toast({ titulo: 'Tarea aprobada.', texto: nombres ? `Se sumó a la batería de ${nombres}.` : undefined, deshacer: () => mover.mutate({ id: tarea.id, estado: 'en_revision' }) });
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se pudo aprobar.', texto: (e as Error).message });
    }
  }

  return (
    <article className="flex flex-col gap-2.5 rounded-tarjeta border border-linea bg-white p-3.5">
      {!compacta && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-tinta-3">{ROBOT_NOMBRE[tarea.robot]} · {nombres}</span>
          <span className="rounded-full bg-crema px-2.5 py-[3px] text-xs font-semibold text-vino">evidencia</span>
        </div>
      )}
      <Link to={`/tarea/${tarea.id}`} className="font-titulo text-base font-semibold leading-[1.25] text-tinta no-underline hover:underline">{tarea.titulo}</Link>
      <span className="text-[13px] text-tinta-2">{compacta ? `${nombres} · ${area?.nombre ?? ''} · ${ROBOT_NOMBRE[tarea.robot]} · ` : ''}{evidencia}</span>
      <div className="flex gap-2">
        <Boton alto={44} className="flex-grow text-sm" onClick={ok} disabled={aprobar.isPending}>Aprobar</Boton>
        <Boton alto={44} variante="secundario" className="text-sm" onClick={() => setAbierto(true)}>Regresar con nota</Boton>
      </div>
      <RegresarConNota
        abierto={abierto}
        nombre={nombres}
        onCerrar={() => setAbierto(false)}
        onEnviar={async (nota) => {
          await regresar.mutateAsync({ id: tarea.id, nota });
          setAbierto(false);
          toast({ titulo: 'Regresada con nota.', texto: `${nombres || 'El equipo'} verá qué falta.` });
        }}
      />
    </article>
  );
}
