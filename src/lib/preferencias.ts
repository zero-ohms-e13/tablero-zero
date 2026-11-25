// Preferencias de este dispositivo (letra grande y modo oscuro). Son comodidades por
// celular, así que viven en localStorage; si no hay almacenamiento, la app funciona igual.
import { useEffect, useState } from 'react';

export type Prefs = { letraGrande: boolean; oscuro: boolean };
const CLAVE = 'tz.prefs';

export function leerPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
    return { letraGrande: !!p.letraGrande, oscuro: !!p.oscuro };
  } catch {
    return { letraGrande: false, oscuro: false };
  }
}

export function aplicarPrefs(p: Prefs) {
  const html = document.documentElement;
  html.classList.toggle('letra-grande', p.letraGrande);
  html.classList.toggle('oscuro', p.oscuro);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.oscuro ? '#1C110D' : '#590202');
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(leerPrefs);
  useEffect(() => {
    aplicarPrefs(prefs);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  }, [prefs]);
  return [prefs, (cambio: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...cambio }))] as const;
}
