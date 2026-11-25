// GET  /functions/v1/push            -> { publica } (llave VAPID pública para suscribirse)
// POST /functions/v1/push            -> la llama el trigger de avisos (con x-push-secreto)
//      { usuario_id, titulo, detalle, tarea_id }  -> manda el push a sus celulares
import webpush from 'npm:web-push@3.6.7';
import { clienteServicio, cors, json } from '../_shared/comun.ts';

const PUBLICA = Deno.env.get('VAPID_PUBLICA') ?? '';
const PRIVADA = Deno.env.get('VAPID_PRIVADA') ?? '';
const SECRETO = Deno.env.get('PUSH_SECRETO') ?? '';

if (PUBLICA && PRIVADA) webpush.setVapidDetails('https://tablero-zero.vercel.app', PUBLICA, PRIVADA);

function iguales(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method === 'GET') return json(req, { publica: PUBLICA });
  if (req.method !== 'POST') return json(req, { error: 'Método no permitido' }, 405);
  if (!iguales(req.headers.get('x-push-secreto') ?? '', SECRETO)) return json(req, { error: 'No autorizado' }, 401);

  const { usuario_id, titulo, detalle, tarea_id } = await req.json().catch(() => ({}));
  if (!usuario_id) return json(req, { error: 'Falta usuario' }, 400);

  const srv = clienteServicio();
  const { data: subs } = await srv.from('suscripciones_push').select('id, endpoint, p256dh, auth').eq('usuario_id', usuario_id);
  const carga = JSON.stringify({ titulo: String(titulo ?? 'Tablero Zero').slice(0, 120), detalle: String(detalle ?? '').slice(0, 200), tarea_id });

  let enviados = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 86400, urgency: 'normal' });
      enviados++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await srv.from('suscripciones_push').delete().eq('id', s.id); // suscripción vencida
      else console.error('push', code, (e as Error).message);
    }
  }
  return json(req, { enviados });
});
