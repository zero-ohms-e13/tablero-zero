// Íconos de las pantallas de diseno/ (trazo, currentColor).
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  codigo: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  engrane: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 1-5-5L13 2z" />
      <path d="m3 21 6-6" />
    </>
  ),
  camara: (
    <>
      <path d="M4 7h3l2-3h6l2 3h3v13H4z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  megafono: (
    <>
      <path d="M3 10v4h4l8 5V5L7 10z" />
      <path d="M19 9a4 4 0 0 1 0 6" />
    </>
  ),
  estrella: <path d="M12 2l3 6 6 1-4.5 4 1 6.5L12 16l-5.5 3.5 1-6.5L3 9l6-1z" />,
  campana: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21h4" />
    </>
  ),
  ayuda: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" />
    </>
  ),
  tablero: (
    <>
      <rect x="3" y="3" width="7" height="18" rx="2" />
      <rect x="14" y="3" width="7" height="11" rx="2" />
    </>
  ),
  equipo: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4.5" />
    </>
  ),
  trofeo: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />,
  persona: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </>
  ),
  llave: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3" />
    </>
  ),
  documento: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  descargar: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  comentario: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  puntos: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  enlace: <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  mas: <path d="M12 5v14M5 12h14" />,
  atras: <path d="M15 18l-6-6 6-6" />,
  ojo: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sinred: <path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.3-1.6M12 20h.01" />,
  palomita: <path d="M20 6 9 17l-5-5" />,
  enviar: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  cerrar: <path d="M6 6l12 12M18 6 6 18" />,
  imprimir: <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z" />,
  basura: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  imagen: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  candado: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  alerta: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  rayo: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  editar: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  salir: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  buscar: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 20, stroke = 2, className, fill }: { name: string; size?: number; stroke?: number; className?: string; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {P[name] ?? P.engrane}
    </svg>
  );
}
