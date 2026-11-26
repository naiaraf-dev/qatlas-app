import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Los E2E que usan la bóveda importan better-sqlite3: sin esto, Playwright cargaría sus tipos.
  tsconfig: './tsconfig.e2e.json',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // El reintento sirve para distinguir una falla inestable de una fija; las dos hacen fallar el job.
  failOnFlakyTests: Boolean(process.env.CI),
  // En el CI cada parte deja un reporte «blob», y un job final los junta en uno HTML (ADR 044).
  reporter: process.env.CI
    ? [['list'], ['blob']]
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    // Si algún test usara los fixtures de navegador, que sea el Chromium verificado (ADR 020), nunca el
    // headless shell, que no se instala ni se verifica.
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
