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
const LEGADO = ['tz.cache', 'tz.cache.dueno'];
const MAX_EDAD = 7 * 86400_000;

let actual: { uid: string; detener: () => void } | null = null;

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
  }
}

/** Activa la caché del usuario (restaura su copia y empieza a guardarla). Idempotente. */
export async function activarCacheDe(qc: QueryClient, uid: string) {
  if (actual?.uid === uid) return;
  await cerrarCache(qc);
  limpiarCopias(uid);
  const s = almacen();
  if (!s) return; // sin almacenamiento: todo en memoria
  const persister = createSyncStoragePersister({ storage: s, key: PREFIJO + uid, throttleTime: 200 });
  const [detener, restaurado] = persistQueryClient({ queryClient: qc, persister, maxAge: MAX_EDAD, buster: 'v2' });
  actual = { uid, detener };
  await restaurado.catch(() => {});
}

/** Cierra la caché actual: deja de guardar, cancela consultas, vacía memoria y borra la copia. */
export async function cerrarCache(qc: QueryClient) {
  const previo = actual;
  actual = null;
  previo?.detener();
  await qc.cancelQueries();
  qc.clear();
  if (previo) almacen()?.removeItem(PREFIJO + previo.uid);
}

export function usuarioDeLaCache() {
  return actual?.uid ?? null;
}
