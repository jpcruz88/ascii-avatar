import { defineConfig, devices } from '@playwright/test';

// Prueba de navegador de la demo web (examples/web) con la muestra sintética.
// Se corre con `npm run test:e2e` (construye antes el paquete web).
const PORT = 4179;

export default defineConfig({
  testDir: 'examples/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node examples/web/serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/examples/web/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
