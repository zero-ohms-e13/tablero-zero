import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { FUNCIONES, recordar, supabase } from './supabase';
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

export type ErrorEntrar = { codigo: 'incorrecta' | 'bloqueada' | 'inactiva' | 'temporal_vencida' | 'red' | 'config'; restantes?: number };

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

  const cargarPerfil = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setPerfil(null);
      setMembresias([]);
      return;
    }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('membresias').select('*').eq('usuario_id', uid),
    ]);
    setPerfil((p as Perfil) ?? null);
    setMembresias((m as Membresia[]) ?? []);
  }, []);

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return;
      setSesion(data.session);
      await cargarPerfil(data.session?.user.id);
      if (vivo) setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setCargando(true);
        // Fuera del callback para no bloquear el cliente de auth.
        setTimeout(() => cargarPerfil(s?.user.id).finally(() => setCargando(false)), 0);
      }
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [cargarPerfil]);

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
