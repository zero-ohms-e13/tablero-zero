// Utilidades compartidas por las Edge Functions.
// La SERVICE ROLE KEY solo existe aquí, como secreto del servidor. Nunca en el frontend.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.50.0';

export const DOMINIO = 'zeroohms.local';
export const correoDe = (usuario: string) => `${usuario}@${DOMINIO}`;
export const USUARIO_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

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

// Contraseña temporal palabra-número (ej. cobre-427), con números aleatorios seguros.
const PALABRAS = [
  'cobre', 'vino', 'crema', 'ambar', 'ohm', 'chasis', 'engrane', 'torre', 'garra', 'rueda',
  'motor', 'cable', 'tornillo', 'sensor', 'brazo', 'cadena', 'polea', 'voltio', 'chispa', 'piston',
  'tuerca', 'eje', 'bateria', 'diodo', 'resorte', 'helice', 'cancha', 'pits', 'servo', 'rampa',
  'gancho', 'perno', 'riel', 'placa', 'robot', 'nodo', 'pixel', 'rayo', 'faro', 'llanta',
];
export function passwordTemporal(): string {
  const n = new Uint32Array(2);
  crypto.getRandomValues(n);
  return `${PALABRAS[n[0] % PALABRAS.length]}-${100 + (n[1] % 900)}`;
}

export function sinAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/gi, 'n');
}

// "Ana López" -> "ana.l"
export function usuarioDesdeNombre(nombre: string): string {
  const partes = sinAcentos(nombre).toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'usuario';
  return partes.length > 1 ? `${partes[0]}.${partes[1][0]}` : partes[0];
}

export function inicialesDe(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}
