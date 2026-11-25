# Tablero Zero

App web (PWA) para organizar los pendientes de la Selección de Robótica **Zero-Ohms Robotics**, Preparatoria Estatal N.º 13 (Mérida, Yucatán).

- **Frontend:** React + Vite + TypeScript, Tailwind, React Router, TanStack Query y `vite-plugin-pwa`.
- **Backend:** Supabase en plan gratuito: Postgres, Auth, Storage, RLS y Edge Functions.
- **Hosting:** Vercel o Netlify gratis.

Nadie da correo ni teléfono. El coach crea las cuentas con **usuario y contraseña**.

---

## 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com>, crea una cuenta y luego **New project**.
   - Nombre: `tablero-zero`.
   - Región: la más cercana (por ejemplo, *East US*).
   - Guarda la contraseña de la base de datos en un lugar seguro.
2. Ve a **Authentication → Sign In / Providers → Email** y deja así:
   - *Enable email provider*: **encendido**.
   - *Confirm email*: **apagado**. Las cuentas usan un correo interno `usuario@zeroohms.local` que nunca se envía.
   - *Allow new users to sign up*: **apagado**. Solo el coach crea cuentas, desde la Edge Function.
3. Ve a **Authentication → Sessions**. La sesión se renueva sola con el *refresh token*. Si quieres que caduque, pon *Inactivity timeout* en **720 h** (30 días).
4. Ve a **Project Settings → API** y copia tres valores:
   - **Project URL**
   - **anon public key**
   - **service_role key**: es **secreta**. Nunca va en el frontend ni en el repo.

## 2. Poner las llaves en tu computadora

Hay dos archivos. Los dos están en `.gitignore`, así que nunca se suben.

| Archivo | Para qué | Qué lleva |
|---|---|---|
| `.env.local` | La app (frontend) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `supabase/.env` | Seed y pruebas | URL, anon, **service_role** y `SEED_PASSWORD` |

```powershell
Copy-Item .env.example .env.local
```

```powershell
Copy-Item supabase/.env.example supabase/.env
```

Abre cada archivo y pega tus valores.

## 3. Instalar y subir la base de datos

```powershell
npm install
```

```powershell
npx supabase login
```

```powershell
npx supabase link --project-ref TU-PROJECT-REF
```

```powershell
npx supabase db push
```

`TU-PROJECT-REF` es lo que va entre `https://` y `.supabase.co` en tu Project URL.

`db push` corre las migraciones de `supabase/migrations/` en este orden:
- **esquema:** las tablas.
- **permisos:** la RLS.
- **reglas y bitácora:** triggers, historial y funciones.

## 4. Desplegar las Edge Functions

Son tres: `entrar` (login), `admin-accounts` (cuentas, solo coach) y `push` (avisos en el celular).

```powershell
npx supabase functions deploy entrar --no-verify-jwt
```

```powershell
npx supabase functions deploy admin-accounts --no-verify-jwt
```

Supabase les entrega solas la `SUPABASE_SERVICE_ROLE_KEY`, así que no la tienes que pegar en ningún lado.

Las dos funciones revisan la sesión por dentro. Por eso se despliegan con `--no-verify-jwt`.

```powershell
npx supabase functions deploy push --no-verify-jwt
```

Para los avisos en el celular, corre **una sola vez**:

```powershell
node scripts/configurar-push.mjs
```

Genera las llaves VAPID y un secreto, los guarda como secretos de Supabase (no se imprimen) y registra la URL de la función. Un trigger de la base de datos manda el push cada vez que se crea un aviso, y `pg_cron` manda a las 8:00 los recordatorios de tareas que vencen hoy.

Opcional: limita desde qué dirección se puede llamar a las funciones:

```powershell
npx supabase secrets set ORIGENES_PERMITIDOS=https://tu-app.vercel.app
```

## 5. Datos de ejemplo (seed)

```powershell
npm run seed -- --solo-pruebas
```

> **Cuidado:** el seed borra todas las tareas y metas. Se niega a correr si ya hay cuentas reales. Con el equipo real usa `npx tsx scripts/limpiar-demo.ts --si-borrar` solo si quieres volver a empezar (conserva al coach, áreas y competencias). `npm run verificar` necesita las cuentas demo, así que solo funciona en una base de pruebas.

El seed crea:
- 1 coach y 1 mentora.
- 6 alumnos: hay un líder en Programación, y Mecánica tiene dos co-líderes.
- 2 tutores.
- La competencia Girl Powered con 2 metas.
- 10 tareas en distintos estados.

Todos los nombres son inventados, salvo el del coach. Todas las cuentas usan la contraseña `SEED_PASSWORD` de `supabase/.env`.

| Usuario | Rol | Para probar |
|---|---|---|
| `jaime.l` | Coach | Panel, Cuentas, aprobar |
| `laura.o` | Mentora (`coach_aux`) | Lo mismo que el coach, menos borrar cuentas |
| `marco.r` | Líder de Programación | Mi área, crear y aprobar |
| `karla.t` | Co-líder de Mecánica | Co-liderazgo |
| `ana.l` | Integrante (Programación y Rama femenil) | Mi tablero y batería |
| `diego.p` | Integrante (Programación y Mecánica) | Pidió ayuda |
| `tutor.ana.l` | Tutor | Primer ingreso con aviso de privacidad |
| `tutor.luis.m` | Tutor | Solo ve a Luis |

## 6. Correr en tu computadora

```powershell
npm run dev
```

Abre <http://localhost:5173>.

La ruta `/estados` muestra la galería de errores, vacíos y avisos para revisar el diseño.

## 7. Pruebas de permisos (RLS)

```powershell
npm test
```

Las pruebas corren las **migraciones reales** en un Postgres en memoria (PGlite), así que no necesitan internet ni Docker. Comprueban, entre otras cosas, que:
- Un tutor no ve a otros alumnos.
- Un integrante no ve otras áreas.
- Un líder no crea tareas fuera de su área.
- Nadie se aprueba solo.
- Nadie cambia su rol.

## 8. Publicar en Vercel

1. Sube el repo a GitHub. Ve la sección siguiente.
2. En <https://vercel.com>, elige **Add New → Project** e importa `tablero-zero`. Vercel detecta Vite solo.
3. En **Environment Variables**, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. Publica con **Deploy**. El archivo `vercel.json` ya redirige todas las rutas a la app y manda `noindex`.

En Netlify es igual: el comando es `npm run build` y la carpeta es `dist`. La redirección está en `public/_redirects`.

## 9. Repositorio en GitHub

Crea la organización `zero-ohms-e13` en GitHub y adentro un repositorio **privado** vacío llamado `tablero-zero`. Luego:

```powershell
git remote add origin https://github.com/zero-ohms-e13/tablero-zero.git
```

```powershell
git push -u origin master
```

## Seguridad y privacidad

- La service role key solo vive en las Edge Functions y en tu `supabase/.env` local.
- Los permisos se aplican con **RLS** en la base de datos. El frontend solo esconde botones.
- Las fotos de evidencia van a un bucket **privado** y se comprimen en el navegador a menos de 300 KB.
- La app es `noindex`, no tiene páginas públicas y no pide correo, teléfono ni CURP.
- Al cerrar el ciclo, el coach puede desactivar o borrar las cuentas de egresados desde **Cuentas**.

## Qué incluye cada fase

- **Fase 1:** login sin correo, primer ingreso, roles con RLS, Mi tablero, detalle de tarea, crear y editar, Mi área, panel del coach, Cuentas y estados.
- **Fase 2:** vista del tutor con "Escribir al coach", fichas imprimibles (`/coach/fichas`), kanban por área con arrastrar y soltar (`/coach/area`, `/area/tablero`), y perfil con letra grande y modo oscuro.
- **Fase 3:** metas y competencias (`/coach/metas`), bitácora de cada meta exportable a CSV o PDF, logros con felicitaciones (`/logros`), centro de avisos y notificaciones push.

Publicado en <https://tablero-zero.vercel.app>. Cada push a `master` publica solo.

## Estructura

```
src/
  components/  Battery, HeaderVino, TaskCard, MetaCard, WeekStrip, BottomNav, SidebarCoach, KanbanColumn, Sheet, Toast…
  pages/       Entrar, Bienvenida, MiTablero, TareaDetalle, TareaForm, MiArea, Coach, Cuentas, Varias
  lib/         supabase, sesión, datos (TanStack Query), fechas (hora de Mérida), tipos
supabase/
  migrations/  esquema, permisos (RLS), reglas y bitácora
  functions/   entrar, admin-accounts
scripts/seed.ts
tests/rls/     pruebas de permisos
docs/diseno/   pantallas aprobadas y guía visual
```
