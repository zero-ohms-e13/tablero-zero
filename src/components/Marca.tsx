// Wordmark ZERΩ + 13 maya + ΩHMS. El logo del armadillo es de los alumnos:
// solo dejamos el espacio punteado hasta tener el SVG oficial.

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

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <div role="img" aria-label="Zero-Ohms, 13" className="flex items-center gap-2 font-titulo font-bold tracking-[.06em]" style={{ fontSize: size }}>
      <span aria-hidden="true">ZERΩ</span>
      <Maya13 />
      <span aria-hidden="true">ΩHMS</span>
    </div>
  );
}

export function LogoEspacio({ size = 72 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[20px] border-2 border-dashed border-crema/60 text-center text-[10px] leading-tight text-crema"
      style={{ width: size, height: size }}
    >
      Logo
      <br />
      Zero-Ohms
    </div>
  );
}

export function FilaMarca() {
  return (
    <div className="flex items-center justify-between text-crema">
      <Wordmark />
      <span className="font-mono text-[11px] tracking-[.1em] opacity-85">PREPA 13</span>
    </div>
  );
}
