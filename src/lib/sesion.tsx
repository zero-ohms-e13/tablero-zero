import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { activarCacheDe, borrarRespaldos, cerrarCache, limpiarCopias } from './cache-privada';
import { FUNCIONES, recordar, supabase, usuarioGuardado } from './supabase';
import type { Membresia, Perfil } from './tipos';

type Ctx = {
  cargando: boolean;
  sesion: Session | null;
  perfil: Perfil | null;
  membresias: Membresia[];
  esCoach: boolean;
  esCoachPrincipal: boolean;
  esTutor: boolean;
  esAlumno: boolean;
  areasLider: string[];
  misAreas: string[];
  recargarPerfil: () => Promise<void>;
  salir: () => Promise<void>;
};

const SesionCtx = createContext<Ctx | null>(null);

export type ErrorEntrar = { codigo: 'incorrecta' | 'bloqueada' | 'inactiva' | 'temporal_vencida' | 'red' | 'config' | 'servicio'; restantes?: number };

export async function entrar(usuario: string, password: string, recordarme: boolean): Promise<ErrorEntrar | null> {
  recordar.set(recordarme);
  let r: Response;
  try {
    r = await fetch(`${FUNCIONES}/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '' },
      body: JSON.stringify({ usuario: usuario.trim().toLowerCase(), password }),
    });
  } catch {
    return { codigo: 'red' };
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { codigo: data.codigo ?? 'incorrecta', restantes: data.restantes };
  const { error } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  return error ? { codigo: 'red' } : null;
}

export function SesionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [membresias, setMembresias] = useState<Membresia[]>([]);
  const [cargando, setCargando] = useState(true);
  const qc = useQueryClient();

  const cargarPerfil = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setPerfil(null);
      setMembresias([]);
      return;
    }
    const [{ data: p, error: ep }, { data: m, error: em }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('membresias').select('*').eq('usuario_id', uid),
    ]);
    if (ep || em) {
      // Sin conexión (o el servidor no respondió): se usa la última copia del perfil, guardada en la caché
      // privada de ESTE usuario (se borra al cerrar sesión). Así la app abre sin red y no pierde borradores.
      const copia = qc.getQueryData<{ perfil: Perfil; membresias: Membresia[] }>(['mi-sesion', uid]);
      if (copia?.perfil) {
        setPerfil(copia.perfil);
        setMembresias(copia.membresias ?? []);
        return;
      }
    }
    setPerfil((p as Perfil) ?? null);
    setMembresias((m as Membresia[]) ?? []);
    if (!ep && !em && p) qc.setQueryData(['mi-sesion', uid], { perfil: p, membresias: m ?? [] });
  }, [qc]);

  // Al volver la conexión se vuelve a leer el perfil (por si cambió mientras estaba sin red)
  const uidActual = sesion?.user.id;
  useEffect(() => {
    if (!uidActual) return;
    const alVolver = () => void cargarPerfil(uidActual).catch(() => {});
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, [uidActual, cargarPerfil]);

  // Supabase emite INITIAL_SESSION al arrancar (con o sin sesión guardada), así que
  // todo se carga desde aquí. Las consultas van fuera del callback (setTimeout) para
  // no trabar el candado interno del cliente de auth.
  useEffect(() => {
    let ultimoUid: string | undefined | null = null;
    // Serializa los cambios de sesión: cada evento espera al anterior (cambio A→B rápido, dos pestañas).
    let cola: Promise<void> = Promise.resolve();
    // Se borran las copias de OTRAS cuentas y de versiones anteriores; la de quien tiene la sesión guardada en
    // este teléfono se conserva (antes se borraba también y la app no podía abrir sin red: se quedaba en
    // "Preparando tu cuenta…"). Si al final entra otra persona, activarCacheDe borra esta copia.
    limpiarCopias(usuarioGuardado());
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      const uid = s?.user.id;
      const recargar = evento === 'INITIAL_SESSION' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED' || (evento === 'SIGNED_IN' && uid !== ultimoUid);
      if (!recargar) return;
      ultimoUid = uid;
      if (evento !== 'INITIAL_SESSION') setCargando(true);
      // Fuera del callback (setTimeout) para no trabar el candado interno del cliente de auth.
      cola = cola.then(
        () =>
          new Promise<void>((listo) =>
            setTimeout(async () => {
              try {
                // SEG-003: hidratar solo con identidad conocida; cerrar y borrar la caché al salir o cambiar
                if (uid) await activarCacheDe(qc, uid);
                else {
                  await cerrarCache(qc);
                  borrarRespaldos(); // sin sesión no debe quedar texto privado de nadie en el teléfono
                }
                await cargarPerfil(uid);
              } catch {
                /* la pantalla de error se encarga */
              } finally {
                setCargando(false);
                listo();
              }
            }, 0),
          ),
      );
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarPerfil, qc]);

  const valor = useMemo<Ctx>(() => {
    const rol = perfil?.rol_global;
    return {
      cargando,
      sesion,
      perfil,
      membresias,
      esCoach: rol === 'coach' || rol === 'coach_aux',
      esCoachPrincipal: rol === 'coach',
      esTutor: rol === 'tutor',
      esAlumno: rol === 'alumno',
      areasLider: membresias.filter((m) => m.es_lider).map((m) => m.area_id),
      misAreas: membresias.map((m) => m.area_id),
      recargarPerfil: () => cargarPerfil(sesion?.user.id),
      salir: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [cargando, sesion, perfil, membresias, cargarPerfil]);

  return <SesionCtx.Provider value={valor}>{children}</SesionCtx.Provider>;
}

export function useSesion() {
  const c = useContext(SesionCtx);
  if (!c) throw new Error('useSesion fuera de SesionProvider');
  return c;
}
