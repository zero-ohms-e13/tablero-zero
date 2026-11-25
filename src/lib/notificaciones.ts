// Notificaciones push de la PWA ("Avisos en el celular").
// La llave pública VAPID la da la Edge Function `push`; la privada vive solo en el servidor.
import { useCallback, useEffect, useState } from 'react';
import { FUNCIONES, supabase } from './supabase';

const soportado = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function aUint8(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function registro() {
  return navigator.serviceWorker.ready;
}

export function useNotificaciones() {
  const [activo, setActivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [bloqueado, setBloqueado] = useState(soportado && Notification.permission === 'denied');

  useEffect(() => {
    if (!soportado) return;
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const reg = await Promise.race([registro(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (vivo) setActivo(!!sub && Notification.permission === 'granted');
      } catch {
        /* sin service worker (modo desarrollo) */
      }
    }, 0);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, []);

  const activar = useCallback(async () => {
    if (!soportado) return;
    setOcupado(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setBloqueado(permiso === 'denied');
        return;
      }
      const r = await fetch(`${FUNCIONES}/push`, { headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '' } });
      const { publica } = await r.json();
      const reg = await registro();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aUint8(publica) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { data: u } = await supabase.auth.getUser();
      await supabase.from('suscripciones_push').upsert(
        { usuario_id: u.user!.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
        { onConflict: 'endpoint' },
      );
      setActivo(true);
    } finally {
      setOcupado(false);
    }
  }, []);

  const desactivar = useCallback(async () => {
    if (!soportado) return;
    setOcupado(true);
    try {
      const reg = await registro();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('suscripciones_push').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setActivo(false);
    } finally {
      setOcupado(false);
    }
  }, []);

  return { soportado, activo, ocupado, bloqueado, activar, desactivar };
}
