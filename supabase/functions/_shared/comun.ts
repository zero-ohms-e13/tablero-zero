// Utilidades compartidas por las Edge Functions.
// La SERVICE ROLE KEY solo existe aquí, como secreto del servidor. Nunca en el frontend.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.50.0';

export const DOMINIO = 'zeroohms.local';
export const correoDe = (usuario: string) => `${usuario}@${DOMINIO}`;
export { USUARIO_RE } from './texto.ts';

const ORIGENES = (Deno.env.get('ORIGENES_PERMITIDOS') ?? '*').split(',').map((s) => s.trim());

export function cors(req: Request): Record<string, string> {
  const origen = req.headers.get('origin') ?? '';
  const permitido = ORIGENES.includes('*') || ORIGENES.includes(origen) ? origen || '*' : ORIGENES[0];
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });
}

export function clienteServicio(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clienteAnonimo(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export { inicialesDe, passwordTemporal, sinAcentos, usuarioDesdeNombre } from './texto.ts';
