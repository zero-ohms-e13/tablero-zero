-- Tablero Zero · Materiales (PASO 2 de 2): cerrar la vía directa de Storage.
--
-- Se aplica DESPUÉS de publicar el frontend que abre los archivos por la Edge Function archivo-material
-- (migración 15). Desde aquí el navegador ya no puede leer, listar, firmar ni borrar objetos del bucket
-- 'materiales', NADIE, tampoco el autor de un borrador: un enlace firmado durante el borrador podría
-- sobrevivir a la publicación y a un retiro. El autor solo SUBE (insert) a su borrador. Quitar un adjunto
-- borra su registro (quitar_adjunto) y el archivo suelto lo retira la limpieza (limpiar-materiales).
-- Al aplicarla en producción no había archivos de Materiales (respaldo del 2026-11-27: 0 objetos), así que
-- no queda ninguna URL firmada anterior viva.
drop policy if exists mat_storage_select on storage.objects;
drop policy if exists mat_storage_delete on storage.objects;
