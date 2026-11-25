// Logros del equipo: tareas aprobadas de todo Zero-Ohms, con felicitaciones. Sin rankings.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Avatar, Cargando, EmptyState, HeaderVino, PantallaCel, useToast } from '../components/ui';
import { useAreas } from '../lib/datos';
import { haceCuanto } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';

type Logro = {
  tarea_id: string; titulo: string; robot: string; area_id: string; aprobada_at: string;
  quien: string; iniciales: string; color: string; felicitaciones: number; yo_felicite: boolean; es_mio: boolean;
};
type Vista = 'equipo' | 'area' | 'mios';

export default function Logros() {
  const { esCoach, misAreas } = useSesion();
  const { data: areas = [] } = useAreas();
  const qc = useQueryClient();
  const toast = useToast();
  const [vista, setVista] = useState<Vista>('equipo');
  const area = vista === 'area' ? misAreas[0] ?? null : null;

  const { data: total = 0 } = useQuery({ queryKey: ['total_logros'], queryFn: async () => (await supabase.rpc('total_logros')).data as number });
  const { data: logros = [], isLoading } = useQuery({
    queryKey: ['logros', vista, area],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('logros_equipo', { p_limite: 60, p_area: area, p_solo_mios: vista === 'mios' });
      if (error) throw error;
      return data as Logro[];
    },
  });

  const felicitar = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('felicitar', { p_tarea: id });
      if (error) throw error;
      return data as boolean;
    },
    onMutate: (id) => {
      qc.setQueryData(['logros', vista, area], (old: Logro[] | undefined) =>
        old?.map((l) => (l.tarea_id === id ? { ...l, yo_felicite: !l.yo_felicite, felicitaciones: l.felicitaciones + (l.yo_felicite ? -1 : 1) } : l)),
      );
    },
    onError: () => toast({ tipo: 'error', titulo: 'No se pudo felicitar.', texto: 'Revisa tu conexión.' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['logros'] }),
  });

  const lista = (
    <>
      {!esCoach && (
        <div role="tablist" aria-label="Ver logros" className="mx-4 mt-4 grid grid-cols-3 gap-1 rounded-campo bg-crema p-1">
          {([['equipo', 'Todo el equipo'], ['area', 'Mi área'], ['mios', 'Míos']] as [Vista, string][]).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={vista === k} onClick={() => setVista(k)} className={`h-11 rounded-[9px] border-0 text-sm font-semibold ${vista === k ? 'bg-vino text-crema' : 'bg-transparent text-vino'}`}>{t}</button>
          ))}
        </div>
      )}
      <section className={`flex flex-col gap-2.5 ${esCoach ? '' : 'mx-4 mt-4'}`}>
        {isLoading ? <Cargando /> : logros.length === 0 ? (
          <EmptyState titulo="Aún no hay logros aquí" texto="Cuando el líder apruebe una tarea, aparece en esta lista." />
        ) : logros.map((l) => {
          const a = areas.find((x) => x.id === l.area_id);
          return (
            <article key={l.tarea_id} className="flex flex-col gap-2.5 rounded-tarjeta border border-linea bg-white p-3.5">
              <div className="flex items-center gap-3">
                <Avatar iniciales={l.iniciales} color={l.color} size={40} />
                <div className="flex min-w-0 flex-grow flex-col">
                  <strong className="text-[15px]">{l.quien}</strong>
                  <span className="text-xs text-tinta-3">{a?.nombre} · {haceCuanto(l.aprobada_at)}</span>
                </div>
                <span className="shrink-0 rounded-full bg-crema px-2.5 py-1 font-mono text-[11px] text-vino">{l.robot}</span>
              </div>
              <p className="m-0 text-sm leading-[1.4]">Terminó «{l.titulo}»</p>
              {l.es_mio ? (
                <span className="flex h-11 items-center gap-2 self-start rounded-campo bg-crema px-4 text-sm font-semibold text-vino">
                  <Icon name="estrella" size={18} /> {l.felicitaciones === 0 ? 'Tu logro' : l.felicitaciones === 1 ? '1 felicitación para ti' : `${l.felicitaciones} felicitaciones para ti`}
                </span>
              ) : (
              <button
                onClick={() => felicitar.mutate(l.tarea_id)}
                aria-pressed={l.yo_felicite}
                className={`flex h-11 items-center justify-center gap-2 self-start rounded-campo px-4 text-sm font-semibold ${l.yo_felicite ? 'border-0 bg-ambar text-vino-oscuro' : 'border border-linea-campo bg-white text-vino'}`}
              >
                <Icon name="estrella" size={18} fill={l.yo_felicite ? '#3A0101' : undefined} />
                {l.yo_felicite ? 'Felicitaste' : 'Felicitar'} · {l.felicitaciones}
              </button>
              )}
            </article>
          );
        })}
      </section>
    </>
  );

  const cabeza = (
    <div className="flex items-center gap-3">
      <span className="font-titulo text-[44px] font-bold leading-none">{total}</span>
      <span className="text-sm leading-[1.35]">tareas terminadas esta temporada entre todo Zero-Ohms</span>
    </div>
  );

  if (esCoach) {
    return (
      <LayoutCoach>
        <h1 className="m-0 font-titulo text-[30px] font-bold text-vino">Logros del equipo</h1>
        <section className="rounded-3xl bg-vino px-6 py-5 text-crema">{cabeza}</section>
        <div className="max-w-2xl">{lista}</div>
      </LayoutCoach>
    );
  }
  return (
    <PantallaCel>
      <HeaderVino titulo="Logros del equipo">{cabeza}</HeaderVino>
      {lista}
      <div className="h-4" />
    </PantallaCel>
  );
}
