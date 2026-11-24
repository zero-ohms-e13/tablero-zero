// Ayudas de la pantalla Cuentas (el servidor valida todo de nuevo).
const PALABRAS = [
  'cobre', 'vino', 'crema', 'ambar', 'ohm', 'chasis', 'engrane', 'torre', 'garra', 'rueda',
  'motor', 'cable', 'tornillo', 'sensor', 'brazo', 'cadena', 'polea', 'voltio', 'chispa', 'piston',
  'tuerca', 'eje', 'bateria', 'diodo', 'resorte', 'helice', 'cancha', 'pits', 'servo', 'rampa',
  'gancho', 'perno', 'riel', 'placa', 'robot', 'nodo', 'pixel', 'rayo', 'faro', 'llanta',
];

export function passwordTemporal() {
  const n = new Uint32Array(2);
  crypto.getRandomValues(n);
  return `${PALABRAS[n[0] % PALABRAS.length]}-${100 + (n[1] % 900)}`;
}

export function sinAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Ana López" -> "ana.l" */
export function usuarioDesdeNombre(nombre: string) {
  const p = sinAcentos(nombre).toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  return p.length > 1 ? `${p[0]}.${p[1][0]}` : p[0];
}
