// Apoyo para las pruebas de teléfono: cuentas de demo del proyecto de PRUEBAS, entrar por la pantalla real y
// limpieza con la llave de servicio (solo para borrar lo que crea la prueba; nunca para "ayudarle" a la app).
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('../tz-candidata/supabase/.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.SUPABASE_URL?.includes('kwzzytdphhghwhoktavw')) throw new Error('Detenido: las pruebas de teléfono solo corren contra el proyecto de PRUEBAS.');
export const PASS = env.SEED_PASSWORD;
export const URL_SUPABASE = env.SUPABASE_URL;
export const ANON = env.SUPABASE_ANON_KEY;
export const srv = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
/** Marca única de esta corrida para encontrar (y borrar) lo que se crea. */
export const MARCA = `e2e-${Date.now().toString(36)}`;

export async function entrar(page: Page, usuario: string) {
  await page.goto('/entrar');
  await page.locator('#usuario').fill(usuario);
  await page.locator('#password').fill(PASS);
  await page.getByRole('button', { name: /Entrar al taller/ }).click();
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 30_000 });
}

/** Un "teléfono" nuevo (contexto aislado) con la sesión ya iniciada. */
export async function telefono(browser: Browser, opciones: Parameters<Browser['newContext']>[0], usuario: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(opciones);
  const page = await ctx.newPage();
  await entrar(page, usuario);
  return { ctx, page };
}

export async function idDe(usuario: string) {
  return (await srv.from('profiles').select('id').eq('usuario', usuario).single()).data!.id as string;
}

/** Borra lo que creó esta corrida (bitácoras y materiales con la marca, y sus archivos). */
export async function limpiar() {
  const { data: mats } = await srv.from('materiales').select('id').like('titulo', `%${MARCA}%`);
  for (const m of mats ?? []) {
    const { data } = await srv.storage.from('materiales').list(m.id);
    if (data?.length) await srv.storage.from('materiales').remove(data.map((f) => `${m.id}/${f.name}`));
    await srv.from('materiales').delete().eq('id', m.id);
  }
  await srv.from('bitacoras').delete().like('aporte', `%${MARCA}%`);
}
