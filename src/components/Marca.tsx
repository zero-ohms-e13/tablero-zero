// Marca oficial de Zero-Ohms (carpeta Zero-Ohms_marca, dibujada a partir del boceto de los alumnos).
// Los SVG usan currentColor: toman el color del texto donde se ponen (crema sobre vino, vino sobre crema).
// Tamaños mínimos del manual: wordmark 200 px de ancho, isotipo 64 px, emblema 300 px.
import isotipoSvg from '../assets/marca/isotipo.svg?raw';
import wordmarkSvg from '../assets/marca/wordmark.svg?raw';
import lockupSvg from '../assets/marca/lockup.svg?raw';

function Svg({ svg, ancho, etiqueta, className }: { svg: string; ancho: number; etiqueta: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={etiqueta}
      className={`block shrink-0 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full ${className ?? ''}`}
      style={{ width: ancho }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** 13 maya suelto (para íconos chicos e impresiones). */
export function Maya13({ className }: { className?: string }) {
  return (
    <svg width="22" height="19" viewBox="0 0 28 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="6" cy="4" r="3" />
      <circle cx="14" cy="4" r="3" />
      <circle cx="22" cy="4" r="3" />
      <rect x="0" y="10" width="28" height="5" rx="1.5" />
      <rect x="0" y="18" width="28" height="5" rx="1.5" />
    </svg>
  );
}

/** Wordmark oficial ZERΩ 13 ΩHMS. Nunca por debajo de 200 px de ancho. */
export function Wordmark({ ancho = 200 }: { ancho?: number }) {
  return <Svg svg={wordmarkSvg} ancho={Math.max(200, ancho)} etiqueta="Zero-Ohms 13" />;
}

/** Isotipo: el armadillo que forma una Ω. Mínimo 64 px. */
export function Isotipo({ ancho = 72 }: { ancho?: number }) {
  return <Svg svg={isotipoSvg} ancho={Math.max(64, ancho)} etiqueta="Isotipo de Zero-Ohms" />;
}

/** Lockup anidado: armadillo con el wordmark debajo de la cabeza. */
export function Lockup({ ancho = 300 }: { ancho?: number }) {
  return <Svg svg={lockupSvg} ancho={ancho} etiqueta="Zero-Ohms 13" />;
}

export function FilaMarca() {
  return (
    <div className="flex items-center justify-between gap-3 text-crema">
      <Wordmark />
      <span className="font-mono text-[11px] tracking-[.1em] opacity-85">PREPA 13</span>
    </div>
  );
}
