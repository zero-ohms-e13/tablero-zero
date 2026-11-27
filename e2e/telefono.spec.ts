// La lista de "Prueba en teléfono real", automatizada en Chrome (Android) y WebKit (Safari/iPhone).
// Lo que de verdad necesita un teléfono (cámara, instalar en la pantalla de inicio, cómo iOS cierra la app,
// la red del taller) queda para la prueba manual en Android y los reportes de los alumnos con iPhone.
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { ANON, MARCA, URL_SUPABASE, entrar, idDe, limpiar, srv, telefono } from './apoyo';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const opciones = (): BrowserContextOptions => {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, serviceWorkers } = test.info().project.use;
  return { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, serviceWorkers };
};
const estadoGuardado = (page: Page) => page.locator('text=/Borrador guardado|Guardando…|Cambios sin guardar|Hay una versión más nueva|No se guardó|se guarda solo/').first();

test.afterAll(async () => {
  await limpiar();
});

test('entrar, cerrar la app y volver a abrirla con la sesión guardada; cerrar sesión', async ({ browser }) => {
  const { ctx, page } = await telefono(browser, opciones(), 'ana.l');
  await expect(page).toHaveURL(/\/($|\?)/);
  // "Cerrar la app": se cierra el contexto y se abre otro con lo que el teléfono guardó
  const guardado = await ctx.storageState();
  await ctx.close();
  const ctx2 = await browser.newContext({ ...opciones(), storageState: guardado });
  const p2 = await ctx2.newPage();
  await p2.goto('/');
  await expect(p2).not.toHaveURL(/\/entrar/);
  await p2.goto('/perfil');
  await p2.getByRole('button', { name: /Cerrar sesión/ }).click();
  await expect(p2).toHaveURL(/\/entrar/);
  await ctx2.close();
});

test('bitácora sin conexión: se escribe, se cierra y se reabre sin red, y se guarda sola al volver', async ({ browser }) => {
  const { ctx, page } = await telefono(browser, opciones(), 'ana.l');
  await page.goto('/bitacora');
  await page.getByRole('button', { name: /Escribir bitácora|Otra bitácora/ }).click();
  await page.locator('#bit-aporte').fill(`Probé el sensor ${MARCA}`);
  await expect(page.getByText('Borrador guardado')).toBeVisible({ timeout: 30_000 });
  const id = new URL(page.url()).searchParams.get('id');
  expect(id, 'la bitácora tiene id en la dirección').toBeTruthy();
  // Que el service worker ya controle la página (así abre sin red, como la PWA instalada)
  const conSw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))]);
    return !!navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistration()) !== undefined;
  });

  await ctx.setOffline(true);
  await page.locator('#bit-aprendizaje').fill(`Sin red aprendí algo ${MARCA}`);
  await expect(estadoGuardado(page)).not.toHaveText('Borrador guardado', { timeout: 15_000 });

  if (conSw) {
    // "Cerrar y reabrir sin red"
    await page.reload().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (!(await page.locator('#bit-aprendizaje').isVisible().catch(() => false))) {
      await page.goto(`/bitacora?id=${id}`).catch(() => {});
    }
    await expect(page.locator('#bit-aprendizaje')).toHaveValue(new RegExp(`Sin red aprendí algo ${MARCA}`), { timeout: 20_000 });
  } else {
    test.info().annotations.push({ type: 'aviso', description: 'este navegador de prueba no instala el service worker: no se probó reabrir sin red' });
  }

  await ctx.setOffline(false);
  await expect(page.getByText('Borrador guardado')).toBeVisible({ timeout: 45_000 });
  const { data } = await srv.from('bitacoras').select('aprendizaje').eq('id', id!).single();
  expect(data?.aprendizaje, 'lo escrito sin red llegó al servidor').toContain(`Sin red aprendí algo ${MARCA}`);
  await ctx.close();
});

test('dos teléfonos con la misma bitácora: el segundo avisa del conflicto y no pierde lo escrito', async ({ browser }) => {
  const a = await telefono(browser, opciones(), 'ana.l');
  await a.page.goto('/bitacora');
  await a.page.getByRole('button', { name: /Escribir bitácora|Otra bitácora/ }).click();
  await a.page.locator('#bit-aporte').fill(`Versión uno ${MARCA}`);
  await expect(a.page.getByText('Borrador guardado')).toBeVisible({ timeout: 30_000 });
  const id = new URL(a.page.url()).searchParams.get('id');

  const b = await telefono(browser, opciones(), 'ana.l');
  await b.page.goto(`/bitacora?id=${id}`);
  await expect(b.page.locator('#bit-aporte')).toHaveValue(`Versión uno ${MARCA}`);

  await a.page.locator('#bit-aporte').fill(`Versión del teléfono A ${MARCA}`);
  await expect(a.page.getByText('Borrador guardado')).toBeVisible({ timeout: 30_000 });
  await b.page.locator('#bit-aporte').fill(`Versión del teléfono B ${MARCA}`);
  await expect(b.page.getByText('Hay una versión más nueva')).toBeVisible({ timeout: 30_000 });
  await expect(b.page.locator('#bit-aporte'), 'B no pierde lo que escribió').toHaveValue(`Versión del teléfono B ${MARCA}`);
  await expect(b.page.getByRole('button', { name: /Cargar la versión guardada/ })).toBeVisible();
  const { data } = await srv.from('bitacoras').select('aporte').eq('id', id!).single();
  expect(data?.aporte, 'el servidor conserva la de A (B no la pisó)').toBe(`Versión del teléfono A ${MARCA}`);
  await a.ctx.close();
  await b.ctx.close();
});

test('cambiar de cuenta en el mismo teléfono no deja ver nada del alumno anterior', async ({ browser }) => {
  const { ctx, page } = await telefono(browser, opciones(), 'ana.l');
  await page.goto('/bitacora');
  await page.getByRole('button', { name: /Escribir bitácora|Otra bitácora/ }).click();
  await page.locator('#bit-aporte').fill(`Secreto de Ana ${MARCA}`);
  await expect(page.getByText('Borrador guardado')).toBeVisible({ timeout: 30_000 });
  // Además un texto que solo quedó en el teléfono (sin red)
  await ctx.setOffline(true);
  await page.locator('#bit-siguiente').fill(`Solo en el teléfono ${MARCA}`);
  await page.waitForTimeout(1500);
  await ctx.setOffline(false);
  await page.goto('/perfil');
  await page.getByRole('button', { name: /Cerrar sesión/ }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await entrar(page, 'sofia.r');
  for (const ruta of ['/', '/bitacora']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.locator('body')).not.toContainText(MARCA);
  }
  const respaldos = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('respaldo')));
  const ana = await idDe('ana.l');
  expect(respaldos.filter((k) => k.includes(ana)), 'no quedan respaldos locales de Ana').toEqual([]);
  await ctx.close();
});

test('Materiales: foto subida, subida cortada que se reintenta sin duplicar, y retiro que corta al instante', async ({ browser }) => {
  const titulo = `Pista de prueba ${MARCA} ${test.info().project.name}`;
  // Sin service worker en este teléfono: en WebKit las peticiones que pasan por él no se pueden cortar a propósito
  const ana = await telefono(browser, { ...opciones(), serviceWorkers: 'block' }, 'ana.l');
  await ana.page.goto('/materiales');
  await ana.page.getByRole('button', { name: /Publicar/ }).first().click();
  await ana.page.locator('#mat-titulo').fill(titulo);
  await ana.page.locator('#mat-archivos').setInputFiles([
    { name: 'pista1.png', mimeType: 'image/png', buffer: PNG },
    { name: 'pista2.png', mimeType: 'image/png', buffer: PNG },
  ]);
  // Se cae la red justo en la segunda subida
  let subidas = 0;
  await ana.ctx.route('**/storage/v1/object/materiales/**', async (r) => {
    if (r.request().method() === 'POST' && ++subidas === 2) return r.abort('failed');
    return r.continue();
  });
  const enviar = ana.page.getByRole('button', { name: /^(Publicar|Reintentar)$/ }).last();
  await enviar.click();
  await expect(ana.page.getByRole('button', { name: /^Reintentar$/ })).toBeVisible({ timeout: 30_000 });
  await ana.page.getByRole('button', { name: /^Reintentar$/ }).click();
  const tarjeta = ana.page.getByRole('article', { name: new RegExp(titulo) });
  await expect(tarjeta).toHaveCount(1, { timeout: 30_000 });
  const { data: mats } = await srv.from('materiales').select('id, estado, material_adjuntos(id)').eq('titulo', titulo);
  expect(mats?.length, 'una sola publicación').toBe(1);
  expect(mats![0].estado).toBe('publicada');
  expect(mats![0].material_adjuntos.length, 'con sus 2 fotos').toBe(2);
  // Las fotos llegan por la función (blob), sin enlaces firmados
  await expect(tarjeta.locator('img').first()).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });

  // Otro alumno la ve; el coach la retira; al otro se le corta en la siguiente apertura
  const sofia = await telefono(browser, opciones(), 'sofia.r');
  await sofia.page.goto('/materiales');
  const suya = sofia.page.getByRole('article', { name: new RegExp(titulo) });
  await expect(suya.locator('img').first()).toHaveAttribute('src', /^blob:/, { timeout: 30_000 });
  const tokenSofia = await sofia.page.evaluate(() => JSON.parse(localStorage.getItem('tz.sesion') ?? sessionStorage.getItem('tz.sesion') ?? '{}').access_token as string);
  const ruta = (await srv.from('material_adjuntos').select('ruta').eq('material_id', mats![0].id).limit(1).single()).data!.ruta as string;
  const abrir = () => fetch(`${URL_SUPABASE}/functions/v1/archivo-material`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${tokenSofia}` }, body: JSON.stringify({ ruta }) });
  expect((await abrir()).status, 'antes del retiro Sofía la abre').toBe(200);

  const coach = await telefono(browser, opciones(), 'jaime.l');
  await coach.page.goto('/materiales');
  const deCoach = coach.page.getByRole('article', { name: new RegExp(titulo) });
  await deCoach.getByRole('button', { name: 'Opciones de la publicación' }).click();
  await coach.page.getByRole('button', { name: /Retirar publicación/ }).click();
  await coach.page.getByRole('button', { name: /Sí, retirar/ }).click();
  await expect(coach.page.getByText('Publicación retirada.')).toBeVisible();
  expect((await abrir()).status, 'justo después del retiro, Sofía ya no la abre').toBe(404);
  await sofia.page.reload();
  await sofia.page.waitForLoadState('networkidle').catch(() => {});
  await expect(sofia.page.getByRole('article', { name: new RegExp(titulo) })).toHaveCount(0);
  for (const t of [ana, sofia, coach]) await t.ctx.close();
});

test('el tutor solo ve a su alumno y no entra a Materiales; el coach ve el simulacro de limpieza', async ({ browser }) => {
  const tutor = await telefono(browser, opciones(), 'tutor.luis.m');
  await expect(tutor.page).toHaveURL(/\/familia/);
  await tutor.page.goto('/materiales');
  await expect(tutor.page).not.toHaveURL(/\/materiales/);
  await tutor.ctx.close();

  const coach = await telefono(browser, opciones(), 'jaime.l');
  await coach.page.goto('/materiales');
  await coach.page.getByRole('button', { name: /Limpieza de borradores/ }).click();
  await expect(coach.page.getByText(/Simulacro: no se ha borrado nada|No hay nada que limpiar/)).toBeVisible({ timeout: 30_000 });
  await coach.ctx.close();
});
