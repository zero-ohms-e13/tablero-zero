// Menú lateral del coach y columnas del kanban (solo lectura en Fase 1).
import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { Wordmark } from './Marca';
import { Boton, Campo, Sheet, claseCampo, useToast } from './ui';
import { chipFecha } from '../lib/fechas';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';
import type { Perfil, Tarea } from '../lib/tipos';

export function SidebarCoach() {
  const { perfil, salir } = useSesion();
  const [editar, setEditar] = useState(false);
  const item = (to: string, texto: string, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-[10px] px-3.5 py-[11px] text-sm no-underline ${isActive ? 'bg-ambar font-semibold text-vino-oscuro hover:text-vino-oscuro' : 'text-crema hover:bg-crema/10 hover:text-crema'}`
      }
    >
      {texto}
    </NavLink>
  );
  const pronto = (texto: string) => (
    <span aria-disabled="true" className="flex items-center justify-between rounded-[10px] px-3.5 py-[11px] text-sm text-crema/70">
      {texto}
      <span className="rounded-full border border-crema/30 px-2 py-0.5 text-[10px]">pronto</span>
    </span>
  );
  return (
    <aside className="box-border flex w-full flex-col gap-1 bg-vino px-[18px] py-5 text-crema md:min-h-screen md:w-[250px] md:shrink-0 md:py-7">
      <div className="mb-4 flex flex-col gap-2.5 px-1.5 md:mb-6">
        <Wordmark size={17} />
        <span className="text-xs opacity-85">Tablero Zero · Coach</span>
      </div>
      <nav aria-label="Coach" className="flex flex-col gap-1">
        {item('/coach', 'Panel', true)}
        {pronto('Tableros por área')}
        {pronto('Metas y competencias')}
        {item('/coach/cuentas', 'Cuentas y fichas de tutor')}
        {pronto('Logros del equipo')}
      </nav>
      <div className="mt-4 flex flex-col gap-1 border-t border-crema/20 pt-4 md:mt-auto">
        <span className="px-3.5 text-xs opacity-80">{perfil?.rol_global === 'coach_aux' ? 'Mentor' : 'Coach'} · {perfil?.nombre_visible.replace(/^Coach\s+/, '')}</span>
        <button onClick={() => setEditar(true)} className="flex min-h-tap items-center gap-2 rounded-[10px] bg-transparent px-3.5 text-left text-[13px] text-crema hover:bg-crema/10">
          <Icon name="editar" size={16} /> Cambiar mi nombre
        </button>
        <button onClick={salir} className="flex min-h-tap items-center gap-2 rounded-[10px] bg-transparent px-3.5 text-left text-[13px] text-crema hover:bg-crema/10">
          <Icon name="salir" size={16} /> Cerrar sesión
        </button>
      </div>
      {perfil && <EditarNombre perfil={perfil} abierto={editar} onCerrar={() => setEditar(false)} />}
    </aside>
  );
}

/** El coach cambia su propio nombre visible (ej. "Coach Jaime Lugo"). */
export function EditarNombre({ perfil, abierto, onCerrar, onListo }: { perfil: Perfil; abierto: boolean; onCerrar: () => void; onListo?: () => void }) {
  const { recargarPerfil } = useSesion();
  const toast = useToast();
  const [nombre, setNombre] = useState(perfil.nombre_visible);
  const [ini, setIni] = useState(perfil.iniciales);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    const n = nombre.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 40) return setError('Escribe un nombre de 2 a 40 letras.');
    const i = ini.trim().toUpperCase().slice(0, 3) || n.replace(/^Coach\s+/, '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const { error: e } = await supabase.from('profiles').update({ nombre_visible: n, iniciales: i }).eq('id', perfil.id);
    if (e) return setError('No se pudo guardar. Vuelve a intentar.');
    if (onListo) onListo();
    else await recargarPerfil();
    toast({ titulo: 'Nombre actualizado.' });
    onCerrar();
  }
  return (
    <Sheet abierto={abierto} onCerrar={onCerrar} titulo="Nombre visible">
      <Campo id="nombre-visible" label="Nombre" error={error} ayuda="Así te ven el equipo y los tutores.">
        <input id="nombre-visible" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} className={claseCampo} />
      </Campo>
      <Campo id="iniciales" label="Iniciales">
        <input id="iniciales" value={ini} maxLength={3} onChange={(e) => setIni(e.target.value.toUpperCase())} className={`${claseCampo} w-24 font-mono`} />
      </Campo>
      <div className="flex gap-2">
        <Boton variante="secundario" onClick={onCerrar}>Cancelar</Boton>
        <Boton className="flex-grow" onClick={guardar}>Guardar</Boton>
      </div>
    </Sheet>
  );
}

export function LayoutCoach({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-fondo text-tinta md:flex-row">
      <SidebarCoach />
      <main className="box-border flex min-w-0 flex-1 flex-col gap-[22px] px-4 pb-10 pt-5 md:px-8 md:pt-7">{children}</main>
    </div>
  );
}

export function KanbanColumn({ titulo, tareas, nombres }: { titulo: string; tareas: Tarea[]; nombres: (t: Tarea) => string }) {
  return (
    <div className="flex min-w-[200px] flex-col gap-2 rounded-[14px] bg-kanban p-2.5" role="list" aria-label={`${titulo}, ${tareas.length} tareas`}>
      <span className="text-[13px] font-semibold text-vino">{titulo} · {tareas.length}</span>
      {tareas.map((t) => {
        const hecha = t.estado === 'hecha';
        const ayuda = t.pide_ayuda && !hecha;
        const f = chipFecha(t.fecha_limite, hecha);
        return (
          <Link
            role="listitem"
            key={t.id}
            to={`/tarea/${t.id}`}
            className={`flex flex-col gap-1 rounded-[10px] p-2.5 text-[13px] text-tinta no-underline ${hecha ? 'bg-[#F0D3AE]' : ayuda ? 'border-2 border-ambar bg-white' : 'border border-linea bg-white'}`}
          >
            <span className="font-mono text-[11px] text-tinta-3">{t.robot}{t.fecha_limite ? ` · ${f.texto}` : ''}</span>
            <strong>{t.titulo}</strong>
            <span className={`text-xs ${ayuda ? 'font-semibold text-urgente' : 'text-tinta-2'}`}>{nombres(t) || 'Sin asignar'}{ayuda ? ' · pidió ayuda' : ''}</span>
          </Link>
        );
      })}
    </div>
  );
}
