# Guía visual — Tablero Zero (Zero-Ohms Robotics)

## Colores

| Token | Hex | Uso |
|---|---|---|
| vino | `#590202` | Encabezados, botones principales, texto fuerte, bordes de batería |
| vino-oscuro | `#3A0101` | Hover y texto sobre ámbar |
| cobre | `#9A590C` | Rellenos de progreso y segmentos de batería sobre fondo claro. **Nunca texto menor a 24 px** |
| ambar | `#E9A84F` | Segmentos de batería sobre vino, anillo de foco, "piden ayuda", punto de aviso sin leer |
| crema | `#F3E2C1` | Texto sobre vino, chips, tarjetas de meta |
| fondo | `#FBF4E6` | Fondo de la app |
| linea | `#E9D9BC` | Bordes de tarjetas |
| linea-campo | `#E0CCA8` | Bordes de campos y botones secundarios |
| vacio | `#EFE2C8` | Segmentos vacíos y pistas de barras |
| tinta | `#2A1A12` | Texto principal |
| tinta-2 | `#5A4335` | Texto secundario |
| tinta-3 | `#6B5444` | Etiquetas y fechas |

Áreas (texto / fondo claro):

| Área | Texto | Fondo |
|---|---|---|
| Programación | `#2F5D8A` | `#E2EAF3` |
| Mecánica | `#7A3E06` | `#F6E3CC` |
| Logística | `#2E5A36` | `#E1ECE2` |
| Rama femenil | `#8A3B6B` | `#F1E0EA` |

Estados de fecha: hoy o urgente `#FCE7D6` / `#7A3E06`, a tiempo `#E3EEDF` / `#2E5A36`, vencida `#590202` / `#F3E2C1`.

## Tipografía (Google Fonts)

- **Chakra Petch** 600/700: títulos (22–30 px), números grandes y nombres de tarjetas (15–17 px).
- **IBM Plex Sans** 400/500/600: texto (13–15 px); campos de 16 px.
- **IBM Plex Mono** 500: robot, fechas, usuarios y contraseñas (11–13 px).

## Medidas

- Radios: tarjetas 18 px, campos y botones 12 px, chips 999 px, encabezado vino con esquinas inferiores de 28 px.
- Botones principales de 48 a 56 px de alto. Cualquier objetivo táctil mide 44 px como mínimo.
- Espaciado en múltiplos de 2 y 4: márgenes laterales de 16 px en celular y 32 px en computadora.
- Anillo de foco: `outline: 3px solid #E9A84F; outline-offset: 2px`.

## Marca

Wordmark: `ZERΩ` + 13 maya + `ΩHMS`, en Chakra Petch 700 con `letter-spacing: .06em`.

13 maya en SVG (usa `currentColor`):

```svg
<svg width="22" height="19" viewBox="0 0 28 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="3"/><circle cx="14" cy="4" r="3"/><circle cx="22" cy="4" r="3"/><rect x="0" y="10" width="28" height="5" rx="1.5"/><rect x="0" y="18" width="28" height="5" rx="1.5"/></svg>
```

El logo del armadillo es de los alumnos. Deja un espacio punteado de 72 px hasta tener el SVG oficial y no lo redibujes.

## Piezas reutilizables

- **Battery:** marco con borde de 2–3 px, polo a la derecha y un segmento por tarea. Variante oscura (sobre vino: borde crema, lleno ámbar, vacío crema al 14 %) y variante clara (borde vino, lleno cobre, vacío `#EFE2C8`). En el integrante, el siguiente segmento muestra un rayo ámbar que pulsa (y no se mueve si el usuario pidió menos movimiento). Lleva `role="img"` con `aria-label="3 de 4 tareas listas"`.
- **HeaderVino:** fondo vino, fila de marca (wordmark + "PREPA 13"), título y subtítulo, y la batería.
- **TaskCard:** cuadro de ícono de 56 px con el tono del área, etiqueta del robot, chip de fecha, título, caja "Para qué sirve", barra de pasos por segmentos y acciones ("Mandar a revisión", abrir la herramienta, "Pedir ayuda").
- **MetaCard:** robot y fecha, chip "1 tarea tuya", título, batería clara y "3 de 5 tareas del equipo listas".
- **WeekStrip:** 7 días; hoy en vino y un punto en los días con entregas.
- **AreaTag:** punto de color más el nombre del área, siempre escrito.
- **BottomNav:** Mi tablero, Mi área, Logros y Perfil.
- **SidebarCoach:** vino con marca; la opción activa en ámbar.
- **KanbanColumn:** fondo `#F6EEDF`; tarjetas con borde ámbar cuando piden ayuda.
- **EmptyState, Toast, Sheet:** ver `Estados.dc.html`.

## Textos

- Español de México, frases cortas, sin jerga para tutores.
- Los botones dicen lo que hacen: "Mandar a revisión", "Regresar con nota", "Guardar y asignar".
- Los errores dicen qué pasó y qué hacer, sin disculpas.
- Nunca rankings ni comparaciones entre alumnos.
