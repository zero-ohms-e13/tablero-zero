/** @type {import('tailwindcss').Config} */
// Tokens de diseno/GUIA_VISUAL.md
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vino: { DEFAULT: '#590202', oscuro: '#3A0101' },
        cobre: '#9A590C',
        ambar: '#E9A84F',
        crema: '#F3E2C1',
        fondo: '#FBF4E6',
        linea: { DEFAULT: '#E9D9BC', campo: '#E0CCA8' },
        vacio: '#EFE2C8',
        kanban: '#F6EEDF',
        tinta: { DEFAULT: '#2A1A12', 2: '#5A4335', 3: '#6B5444' },
        prog: { DEFAULT: '#2F5D8A', claro: '#E2EAF3' },
        meca: { DEFAULT: '#7A3E06', claro: '#F6E3CC' },
        logi: { DEFAULT: '#2E5A36', claro: '#E1ECE2' },
        fem: { DEFAULT: '#8A3B6B', claro: '#F1E0EA' },
        urgente: { DEFAULT: '#7A3E06', fondo: '#FCE7D6' },
        atiempo: { DEFAULT: '#2E5A36', fondo: '#E3EEDF' },
      },
      fontFamily: {
        titulo: ['"Chakra Petch"', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { tarjeta: '18px', campo: '12px', header: '28px' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
};
