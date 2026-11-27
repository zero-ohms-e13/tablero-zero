// Pruebas de punta a punta "como en el teléfono" (Playwright): Chrome con medidas de Android y WebKit (el motor
// de Safari) con medidas de iPhone. Corren contra el build de PRODUCCIÓN de la app (con su service worker)
// apuntado al proyecto Supabase de PRUEBAS, nunca a producción.
// Uso:  npx playwright test          (requiere el proyecto de pruebas activo; ver e2e/README.md)
import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env.pruebas.local', 'utf8');
if (!/kwzzytdphhghwhoktavw/.test(env) || /hyghwlmatnnvnkvmhxrt/.test(env)) {
  throw new Error('Detenido: .env.pruebas.local debe apuntar al proyecto de PRUEBAS.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // comparten las mismas cuentas de demo: una prueba a la vez
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npx vite build --mode pruebas --outDir dist-pruebas && npx vite preview --mode pruebas --outDir dist-pruebas --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 180_000,
    reuseExistingServer: true,
  },
});
