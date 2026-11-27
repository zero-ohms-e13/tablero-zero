# Respaldo y recuperación de Tablero Zero

El plan Free de Supabase **no hace respaldos automáticos**. Este procedimiento deja una copia que sí se puede
restaurar: los datos de la base, las cuentas con sus contraseñas (Supabase las guarda cifradas, nunca en texto)
y los archivos de Storage. El **esquema** no va en el respaldo, porque lo reconstruyen las migraciones del repo;
el respaldo anota cuáles tenía la base.

## Qué hay en un respaldo

`respaldos/<destino>-<fecha>/`, carpeta ignorada por git:

| Archivo | Contenido |
|---|---|
| `datos.sql.enc` | Datos de `public` y de Auth (`auth.users`, `auth.identities`), cifrados |
| `archivos.bin.enc` | Archivos de los buckets `evidencias` y `materiales`, cifrados |
| `manifiesto.json` | Fecha, commit, migraciones, conteos por tabla y número de archivos (sin datos personales) |

El cifrado es AES-256-GCM con una llave derivada de `RESPALDO_CLAVE`. **Sin esa clave el respaldo no sirve**:
guárdala en tu gestor de contraseñas, no en la misma carpeta que los respaldos.

No se respaldan las sesiones ni los tokens: después de restaurar, cada persona vuelve a entrar con su contraseña.

## Preparación (una vez)

1. Herramientas de PostgreSQL 17 (solo cliente) en `C:\Users\jaime\herramientas\pgsql-17.12\pgsql\bin`.
   Otra ruta se indica con `PG_BIN`.
2. Crea `tablero-zero/.env.respaldo` (git lo ignora) **escribiéndolo tú mismo**:

   ```
   PROD_DB_PASSWORD=<la contraseña de la base de producción: Supabase → Project Settings → Database>
   RESPALDO_CLAVE=<una frase larga solo para los respaldos, mínimo 12 caracteres>
   ```

## Cuándo respaldar

- Antes y después de cada lote del importador.
- Al terminar cada día de taller. Si la app se usa a diario, una vez al día.
- El script conserva 14 días y siempre deja los 3 más recientes. **Copia cada carpeta nueva fuera de la PC**
  (Drive personal o USB).

```
cd tablero-zero
node scripts/respaldo.mjs produccion
```

## Recuperar

### En el mismo proyecto (por ejemplo, se borró algo por error)

Reemplaza **todos** los datos por los del respaldo. Solo con decisión de Jaime:

```
node scripts/restaurar.mjs produccion respaldos/<carpeta> --confirmo-produccion
```

### En un proyecto nuevo (se perdió el proyecto)

1. Crea el proyecto en Supabase con PostgreSQL 17.
2. Aplica las migraciones: `supabase link --project-ref <nuevo>` y `supabase db push`.
3. Despliega las funciones `entrar` y `admin-accounts` y pon sus secretos (`ORIGENES_PERMITIDOS` y los demás
   que pida cada función).
4. Agrega el destino en `scripts/respaldo-comun.mjs` y corre `node scripts/restaurar.mjs <destino> respaldos/<carpeta>`.
5. Cambia `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel y vuelve a desplegar.

`restaurar.mjs` se niega a correr si al destino le faltan migraciones, y al final compara los conteos con el
manifiesto.

## Simulacro

`node scripts/simulacro-restauracion.mjs` lo hace todo en el proyecto de **pruebas**:

1. Respalda.
2. Borra una cuenta con sus vínculos y un archivo, y mete datos de más.
3. Restaura.
4. Comprueba que la cuenta entra con su contraseña anterior, con el mismo id, rol y áreas, que el archivo
   vuelve idéntico y que los permisos funcionan.

Repítelo cuando cambie el esquema. Requiere `tablero-zero/.env.respaldo.pruebas` con `POOLER_HOST` y
`RESPALDO_CLAVE`, y pausar InventarioMaker mientras el proyecto de pruebas está activo.
