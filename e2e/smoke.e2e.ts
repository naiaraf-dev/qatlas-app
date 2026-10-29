/**
 * E2E de QAtlas (especificación, sección 11): QAtlas se prueba a sí misma.
 *
 * Abre la app compilada con Playwright y verifica, desde afuera, que:
 * - la ventana carga desde app:// (no desde file:// ni desde internet);
 * - la interfaz no tiene acceso a Node;
 * - todos los controles del panel de seguridad están en verde;
 * - la prueba de contención bloquea todas las conexiones salientes.
 *
 * Requiere `npm run build` antes.
 */
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const APP_DIR = path.resolve(import.meta.dirname, '../apps/desktop');

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [APP_DIR],
    // En CI Linux sin entorno gráfico se corre con xvfb-run.
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  });
});

test.afterAll(async () => {
  await app.close();
});

test('la interfaz carga desde el protocolo propio app://', async () => {
  const window = await app.firstWindow();
  await expect(window.getByRole('heading', { name: 'QAtlas' })).toBeVisible();
  expect(window.url()).toBe('app://qatlas/index.html');
});

test('la interfaz no tiene acceso a Node ni a ipcRenderer', async () => {
  const window = await app.firstWindow();
  const exposed = await window.evaluate(() => {
    const scope = globalThis as Record<string, unknown>;
    return {
      require: typeof scope.require,
      process: typeof scope.process,
      module: typeof scope.module,
      apiKeys: Object.keys((scope.qatlas as object | undefined) ?? {}).sort(),
      apiFrozen: Object.isFrozen(scope.qatlas),
    };
  });
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    apiKeys: ['app', 'privacy', 'security'],
    apiFrozen: true,
  });
});

test('todos los controles del panel de seguridad están correctos', async () => {
  const window = await app.firstWindow();
  const panel = window.getByRole('region', { name: 'Estado de seguridad' });
  await expect(panel.getByText('correcto')).toHaveCount(9);
  await expect(panel.getByText('con problemas')).toHaveCount(0);
});

test('la prueba de contención bloquea todas las conexiones salientes', async () => {
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Probar conexiones salientes' }).click();
  const results = window.getByRole('list').filter({ hasText: 'Bloqueado' });
  await expect(results.getByText(/✔ Bloqueado/)).toHaveCount(3);
  await expect(window.getByText(/NO bloqueado/)).toHaveCount(0);
});

test('la app no muestra ventanas nuevas aunque la página lo intente', async () => {
  const page = await app.firstWindow();
  await page.evaluate(() => {
    globalThis.open('https://example.com', '_blank');
  });
  await page.waitForTimeout(500);
  expect(app.windows()).toHaveLength(1);
});
