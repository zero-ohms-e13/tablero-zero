import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configurado = !!url && !!anon;

// "Recordarme": la sesión vive en localStorage (30 días con refresh); si no, en sessionStorage.
const CLAVE_RECORDAR = 'tz.recordar';
export const recordar = {
  get: () => {
    try {
      return localStorage.getItem(CLAVE_RECORDAR) !== 'no';
    } catch {
      return true;
    }
  },
  set: (v: boolean) => {
    try {
      localStorage.setItem(CLAVE_RECORDAR, v ? 'si' : 'no');
    } catch {
      /* sin almacenamiento */
    }
  },
};

const almacen = {
  getItem: (k: string) => {
    try {
      return (recordar.get() ? localStorage : sessionStorage).getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      (recordar.get() ? localStorage : sessionStorage).setItem(k, v);
    } catch {
      /* sin almacenamiento */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {
      /* sin almacenamiento */
    }
  },
};

/** Usuario de la sesión guardada en este teléfono (sin red ni validar: solo para no borrar SU caché al abrir). */
export function usuarioGuardado(): string | undefined {
  try {
    const v = almacen.getItem('tz.sesion');
    const id = v ? (JSON.parse(v) as { user?: { id?: unknown } }).user?.id : undefined;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'falta-configurar', {
  auth: { storage: almacen, persistSession: true, autoRefreshToken: true, storageKey: 'tz.sesion' },
});

export const FUNCIONES = `${url}/functions/v1`;
