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
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
