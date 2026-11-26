// SEG-003 · Caché sin conexión aislada por usuario.
//
// - Nada se hidrata antes de saber quién inició sesión.
// - Cada usuario tiene su propia clave en localStorage (tz.cache.u.<id>).
// - Al cerrar sesión o cambiar de cuenta: se cancelan las consultas en curso (una respuesta tardía de A
//   se descarta), se vacía la caché en memoria y se BORRA la copia guardada del usuario anterior.
// - Disponible sin conexión: la estructura de la app (service worker) y los últimos datos del usuario
//   que tiene la sesión abierta. Nada de otros usuarios ni de una sesión cerrada.
import type { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const PREFIJO = 'tz.cache.u.';
/** Respaldos de texto aún no guardado (bitácora): tz.respaldo.<uid>.<nombre>. No se borran al arrancar
 *  (aún no se sabe quién es); sí al cerrar sesión, al entrar otra cuenta o al abrir sin sesión. */
export const RESPALDO = 'tz.respaldo.';
const LEGADO = ['tz.cache', 'tz.cache.dueno'];
const MAX_EDAD = 7 * 86400_000;

let actual: { uid: string; detener: () => void; quitarVigia: () => void } | null = null;

/** Almacén con compuerta: solo escribe mientras `uid` sea el usuario activo. Así un guardado
 *  pendiente (throttle) de A que se dispare después de cerrar sesión no recrea la copia de A. */
function almacenDe(s: Storage, uid: string): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: (k) => (actual?.uid === uid ? s.getItem(k) : null),
    setItem: (k, v) => {
      if (actual?.uid === uid) s.setItem(k, v);
    },
    removeItem: (k) => s.removeItem(k),
  };
}

/** Otra pestaña cerró la sesión de este usuario (borró su copia): esta pestaña vacía su memoria. */
function vigilarOtrasPestanas(qc: QueryClient, uid: string): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const alCambiar = (e: StorageEvent) => {
    if (e.key === PREFIJO + uid && e.newValue === null && actual?.uid === uid) void cerrarCache(qc);
  };
  window.addEventListener('storage', alCambiar);
  return () => window.removeEventListener('storage', alCambiar);
}

function almacen(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Borra claves de versiones anteriores y copias de otros usuarios. */
export function limpiarCopias(conservar?: string) {
  const s = almacen();
  if (!s) return;
  for (const k of LEGADO) s.removeItem(k);
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIJO) && k !== (conservar ? PREFIJO + conservar : '')) s.removeItem(k);
    else if (k && conservar && k.startsWith(RESPALDO) && !k.startsWith(RESPALDO + conservar + '.')) s.removeItem(k);
  }
}

/** Activa la caché del usuario (restaura su copia y empieza a guardarla). Idempotente. */
export async function activarCacheDe(qc: QueryClient, uid: string) {
  if (actual?.uid === uid) return;
  await cerrarCache(qc);
  limpiarCopias(uid);
  const s = almacen();
  if (!s) return; // sin almacenamiento: todo en memoria
  actual = { uid, detener: () => {}, quitarVigia: vigilarOtrasPestanas(qc, uid) };
  const persister = createSyncStoragePersister({ storage: almacenDe(s, uid), key: PREFIJO + uid, throttleTime: 200 });
  const [detener, restaurado] = persistQueryClient({ queryClient: qc, persister, maxAge: MAX_EDAD, buster: 'v2' });
  actual.detener = detener;
  await restaurado.catch(() => {});
}

/** Cierra la caché actual: deja de guardar, cancela consultas, vacía memoria y borra la copia. */
export async function cerrarCache(qc: QueryClient) {
  const previo = actual;
  actual = null;
  previo?.detener();
  previo?.quitarVigia();
  await qc.cancelQueries();
  qc.clear();
  if (previo) {
    const s = almacen();
    s?.removeItem(PREFIJO + previo.uid);
    // Respaldos del usuario (p. ej. texto de bitácora sin guardar): también se borran al salir
    borrarRespaldos(previo.uid);
  }
}

export function usuarioDeLaCache() {
  return actual?.uid ?? null;
}

/** Respaldo local del usuario activo (texto aún no guardado en el servidor). Vive bajo su prefijo, así que
 *  se borra al cerrar sesión o al entrar otra cuenta, igual que su caché. Solo escribe si es el activo. */
export const respaldo = {
  leer<T>(uid: string, nombre: string): T | null {
    try {
      const v = actual?.uid === uid ? almacen()?.getItem(RESPALDO + uid + '.' + nombre) : null;
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  guardar(uid: string, nombre: string, valor: unknown) {
    try {
      if (actual?.uid === uid) almacen()?.setItem(RESPALDO + uid + '.' + nombre, JSON.stringify(valor));
    } catch {
      /* sin espacio o sin almacenamiento: se sigue sin respaldo */
    }
  },
  borrar(uid: string, nombre: string) {
    try {
      almacen()?.removeItem(RESPALDO + uid + '.' + nombre);
    } catch {
      /* sin almacenamiento */
    }
  },
};

/** Borra respaldos locales: de un usuario, o de todos si no se indica (al abrir la app sin sesión). */
export function borrarRespaldos(uid?: string) {
  const s = almacen();
  if (!s) return;
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i);
    if (k?.startsWith(uid ? RESPALDO + uid + '.' : RESPALDO)) s.removeItem(k);
  }
}
