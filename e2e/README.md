# Pruebas "como en el teléfono" (Playwright)

La lista de prueba en teléfono real, automatizada en dos navegadores:

- **android**: Chrome con medidas y comportamiento de un Pixel 7.
- **iphone**: WebKit (el motor de Safari) con medidas de un iPhone 14. Se parece a Safari, pero no es iOS.

Las pruebas usan el **build de producción** de la app, con su service worker, como la PWA instalada. Ese build
apunta al proyecto Supabase de **pruebas** (`.env.pruebas.local`) y la configuración se niega a correr si
apunta a producción. Se usan las cuentas de demo (ana.l, sofia.r, jaime.l, tutor.luis.m), y al terminar se
borra todo lo creado (marca `e2e-…`).

## Qué cubre

- Entrar, cerrar la app, volver a abrirla con la sesión guardada y cerrar sesión.
- Bitácora sin conexión: escribir, cerrar y reabrir sin red, y que se guarde sola al volver la conexión.
- Dos teléfonos con la misma bitácora: aviso de conflicto sin perder lo escrito.
- Cambiar de cuenta en el mismo teléfono sin ver nada del alumno anterior.
- Materiales:
  - subir fotos;
  - una subida cortada se reintenta sin duplicar;
  - las fotos llegan por la función;
  - el retiro corta el acceso al instante.
- El tutor solo ve a su alumno; el coach ve el simulacro de limpieza.

## Qué NO cubre

Eso queda para la prueba en el Android de Jaime y para los reportes de alumnos con iPhone:

- la cámara real;
- instalar en la pantalla de inicio;
- cómo iOS cierra o limpia la app;
- la red del taller.

## Cómo correrlas

1. Activa el proyecto de pruebas (en el plan Free hay que pausar InventarioMaker un rato).
2. Corre:

   ```
   cd tablero-zero
   npx playwright test                 # los dos
   npx playwright test --project=iphone
   ```

El servidor de la prueba usa el puerto 4173, que es el que el proyecto de pruebas acepta en `ORIGENES_PERMITIDOS`.
