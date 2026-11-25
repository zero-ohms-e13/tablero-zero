// Utilidades puras (sin Deno ni red): se usan en las Edge Functions y en las pruebas con Vitest.

export const USUARIO_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

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
