// Piezas reutilizables de la guía visual.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { FilaMarca } from './Marca';
import { chipFecha, LETRAS_SEMANA, semanaDe, claveDia, type TonoFecha } from '../lib/fechas';
import type { Area } from '../lib/tipos';

// ---------- Encabezado vino ----------
export function HeaderVino({ titulo, subtitulo, children, atras, accion }: {
  titulo?: ReactNode; subtitulo?: ReactNode; children?: ReactNode; atras?: string; accion?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-[18px] rounded-b-header bg-vino px-5 pb-6 pt-5 text-crema" style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
      <FilaMarca />
      {(titulo || atras) && (
        <div className="flex items-center gap-3">
          {atras && (
            <Link to={atras} aria-label="Regresar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-campo border border-crema/35 text-crema hover:text-crema">
              <Icon name="atras" />
            </Link>
          )}
          <div className="flex min-w-0 flex-grow flex-col gap-0.5">
            {titulo && <h1 className="m-0 font-titulo text-[22px] font-bold leading-[1.15]">{titulo}</h1>}
            {subtitulo && <span className="text-[13px] opacity-90">{subtitulo}</span>}
          </div>
          {accion}
        </div>
      )}
      {children}
    </header>
  );
}

export function Avatar({ iniciales, color, size = 36, className = '' }: { iniciales: string; color: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-titulo font-bold text-white ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.3, background: color, fontSize: size * 0.38 }}
    >
      {iniciales}
    </span>
  );
}

// ---------- Etiquetas ----------
export function AreaTag({ area, className = '' }: { area?: Pick<Area, 'nombre' | 'color' | 'color_claro'>; className?: string }) {
  if (!area) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${className}`} style={{ background: area.color_claro, color: area.color }}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: area.color }} />
      {area.nombre}
    </span>
  );
}

const TONOS: Record<TonoFecha, string> = {
  urgente: 'bg-urgente-fondo text-urgente',
  atiempo: 'bg-atiempo-fondo text-atiempo',
  vencida: 'bg-vino text-crema',
  neutro: 'bg-crema text-tinta-2',
};

export function Chip({ children, tono = 'neutro', className = '' }: { children: ReactNode; tono?: TonoFecha; className?: string }) {
  return <span className={`whitespace-nowrap rounded-full px-[9px] py-[3px] text-xs font-semibold ${TONOS[tono]} ${className}`}>{children}</span>;
}

export function ChipFecha({ fecha, hecha }: { fecha: string | null; hecha?: boolean }) {
  const c = chipFecha(fecha, hecha);
  return <Chip tono={c.tono}>{c.texto}</Chip>;
}

// ---------- Botones ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'ambar' | 'fantasma'; alto?: 44 | 48 | 56 };
export function Boton({ variante = 'primario', alto = 48, className = '', children, ...p }: BtnProps) {
  const estilos = {
    primario: 'bg-vino text-crema font-semibold hover:bg-vino-oscuro border-0',
    secundario: 'bg-white text-vino font-medium border border-vino',
    ambar: 'bg-ambar text-vino-oscuro font-semibold border-0',
    fantasma: 'bg-white text-vino font-medium border border-linea-campo',
  }[variante];
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-2 rounded-campo px-4 text-[15px] disabled:cursor-not-allowed disabled:opacity-60 ${estilos} ${className}`}
      style={{ height: alto, ...p.style }}
    >
      {children}
    </button>
  );
}

export function BotonIcono({ icono, label, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { icono: string; label: string }) {
  return (
    <button {...p} aria-label={label} title={label} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-campo border border-linea-campo bg-white text-vino ${className}`}>
      <Icon name={icono} />
    </button>
  );
}

// ---------- Campos ----------
export const claseCampo =
  'box-border h-12 w-full rounded-campo border-2 border-linea-campo bg-white px-3.5 text-base text-tinta outline-none focus:border-vino';

export function Campo({ id, label, ayuda, error, children }: { id: string; label: string; ayuda?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-vino">{label}</label>
      {children}
      {error ? (
        <span id={`${id}-error`} className="text-xs font-semibold text-vino">{error}</span>
      ) : (
        ayuda && <span id={`${id}-ayuda`} className="text-xs text-tinta-2">{ayuda}</span>
      )}
    </div>
  );
}

// ---------- Mensajes ----------
export function Alerta({ children }: { children: ReactNode }) {
  // Que el error se vea aunque el botón que lo causó esté lejos (formularios largos)
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [children]);
  return (
    <div ref={ref} role="alert" className="flex items-start gap-2.5 rounded-campo bg-[#F6D6D6] p-3 text-sm leading-[1.4] text-vino">
      <span className="mt-px shrink-0"><Icon name="alerta" /></span>
      <span>{children}</span>
    </div>
  );
}

export function AvisoBloqueo({ titulo = 'Demasiados intentos', texto = 'Vuelve a intentar en 10 minutos o pide un reinicio al coach.' }: { titulo?: string; texto?: string }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-tarjeta border border-linea bg-white p-3.5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-vino text-crema"><Icon name="candado" size={24} /></span>
      <div className="flex flex-col gap-0.5">
        <strong className="text-[15px]">{titulo}</strong>
        <span className="text-[13px] leading-[1.4] text-tinta-2">{texto}</span>
      </div>
    </div>
  );
}

export function SinInternet() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-4 top-3 z-50 mx-auto flex max-w-md items-center gap-2.5 rounded-[14px] bg-tinta px-3.5 py-3 text-sm leading-[1.4] text-crema shadow-lg">
      <span className="shrink-0"><Icon name="sinred" /></span>
      <span>Sin internet. Tus cambios se guardan y se envían cuando vuelva la conexión.</span>
    </div>
  );
}

export function EmptyState({ titulo, texto, accion }: { titulo: string; texto: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-tarjeta border border-linea bg-white px-3.5 py-6 text-center">
      <div aria-hidden="true" className="flex w-[120px] items-center">
        <div className="box-border flex h-11 flex-grow gap-1 rounded-[10px] border-[3px] border-vino p-1">
          {[0, 1, 2, 3].map((i) => <span key={i} className="flex-1 rounded bg-cobre" />)}
        </div>
        <div className="h-4 w-1.5 rounded-r-[3px] bg-vino" />
      </div>
      <strong className="font-titulo text-lg text-vino">{titulo}</strong>
      <span className="text-sm leading-[1.4] text-tinta-2">{texto}</span>
      {accion}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-8 text-sm text-tinta-3">
      <span className="rayo text-cobre"><Icon name="rayo" fill="#9A590C" /></span>
      {texto}
    </div>
  );
}

// ---------- Sheet (diálogo inferior) ----------
export function Sheet({ abierto, onCerrar, titulo, children }: { abierto: boolean; onCerrar: () => void; titulo: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus(), 30);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', esc);
      previo?.focus();
    };
  }, [abierto, onCerrar]);
  // Se queda montado un momento al cerrar para que la hoja baje en lugar de desaparecer de golpe.
  const [montado, setMontado] = useState(abierto);
  useEffect(() => {
    if (abierto) {
      setMontado(true);
      return;
    }
    const t = setTimeout(() => setMontado(false), 220);
    return () => clearTimeout(t);
  }, [abierto]);
  if (!abierto && !montado) return null;
  return (
    <div
      className={`fixed inset-0 z-40 flex items-end justify-center bg-tinta/40 sm:items-center ${abierto ? 'fondo-entra' : 'fondo-sale pointer-events-none'}`}
      onClick={onCerrar}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-white p-[18px] shadow-[0_-6px_24px_rgba(89,2,2,.15)] sm:rounded-[22px] ${abierto ? 'hoja-entra' : 'hoja-sale'}`}
        style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        <span aria-hidden="true" className="h-1 w-10 self-center rounded-sm bg-linea-campo" />
        <strong className="font-titulo text-lg text-vino">{titulo}</strong>
        {children}
      </div>
    </div>
  );
}

// ---------- Toast ----------
type ToastDatos = { id: number; titulo: string; texto?: string; deshacer?: () => void; tipo?: 'ok' | 'error' };
const ToastCtx = createContext<(t: Omit<ToastDatos, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<ToastDatos[]>([]);
  const mostrar = useCallback((t: Omit<ToastDatos, 'id'>) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), t.deshacer ? 6000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md flex-col gap-2">
        {lista.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm leading-[1.4] shadow-lg ${t.tipo === 'error' ? 'bg-tinta text-crema' : 'bg-vino text-crema'}`}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${t.tipo === 'error' ? 'bg-crema text-vino' : 'bg-ambar text-vino-oscuro'}`}>
              <Icon name={t.tipo === 'error' ? 'alerta' : 'palomita'} stroke={3} />
            </span>
            <span>
              <strong>{t.titulo}</strong> {t.texto}
            </span>
            {t.deshacer && (
              <button
                className="ml-auto min-h-tap shrink-0 bg-transparent px-1 text-[13px] font-semibold text-ambar underline"
                onClick={() => {
                  t.deshacer?.();
                  setLista((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                Deshacer
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Semana ----------
export function WeekStrip({ fechasConEntrega, colorPunto = '#590202' }: { fechasConEntrega: (string | null)[]; colorPunto?: string }) {
  const { dias } = semanaDe();
  const hoy = claveDia(new Date());
  const conEntrega = new Set(fechasConEntrega.filter(Boolean).map((f) => claveDia(f!)));
  return (
    <section aria-label="Semana" className="grid grid-cols-7 gap-1.5">
      {dias.map((d, i) => {
        const k = claveDia(d);
        const esHoy = k === hoy;
        const punto = conEntrega.has(k);
        return (
          <div key={k} className={`flex flex-col items-center gap-1 rounded-campo py-2 ${esHoy ? 'bg-vino text-crema' : 'bg-white text-tinta'}`} aria-current={esHoy ? 'date' : undefined}>
            <span className="text-[11px] font-semibold">{LETRAS_SEMANA[i]}</span>
            <span className="font-titulo text-[17px] font-bold">{Number(k.slice(8))}</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: punto ? (esHoy ? '#E9A84F' : colorPunto) : 'transparent' }} />
            {punto && <span className="sr-only">con entregas</span>}
          </div>
        );
      })}
    </section>
  );
}

// ---------- Navegación inferior ----------
export function BottomNav() {
  const item = (to: string, icono: string, texto: string, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex min-h-tap flex-col items-center gap-[3px] py-1.5 text-[11px] no-underline ${isActive ? 'font-semibold text-vino' : 'text-tinta-3'}`}
    >
      <Icon name={icono} size={22} />
      {texto}
    </NavLink>
  );
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-[480px] grid-cols-4 border-t border-linea bg-white px-2 pt-1.5" style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}>
      {item('/', 'tablero', 'Mi tablero', true)}
      {item('/area', 'equipo', 'Mi área')}
      {item('/logros', 'trofeo', 'Logros')}
      {item('/perfil', 'persona', 'Perfil')}
    </nav>
  );
}

/** Contenedor de pantallas de celular (390 px de diseño; centrado en pantallas anchas). */
export function PantallaCel({ children, conNav = true }: { children: ReactNode; conNav?: boolean }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-fondo" style={{ paddingBottom: conNav ? 96 : 24 }}>
      {children}
      {conNav && <BottomNav />}
    </div>
  );
}

export function TituloSeccion({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="m-0 font-titulo text-[19px] font-bold text-vino">{children}</h2>
      {extra && <span className="text-right text-[13px] text-tinta-3">{extra}</span>}
    </div>
  );
}
