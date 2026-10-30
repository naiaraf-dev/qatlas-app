/**
 * E2E de QAtlas (especificación, sección 11): QAtlas se prueba a sí misma.
 *
 * Abre la app compilada con Playwright y verifica, desde afuera, que:
 * - la ventana carga desde app:// (no desde file:// ni desde internet);
 * - la interfaz no tiene acceso a Node;
 * - todos los controles del panel de seguridad están en verde;
 * - la prueba de contención bloquea todas las conexiones salientes;
 * - el tema sigue al sistema y se puede cambiar a mano.
 *
 * Requiere `npm run build` antes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { lanzarApp } from './lanzar';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';

let app: ElectronApplication;
let page: Page;
let carpeta: string;

test.beforeAll(async () => {
  // Carpeta de datos temporal: nunca la bóveda real del equipo.
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(CONTRASENA);
  await page.getByLabel('Repetí la contraseña', { exact: true }).fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await page.getByRole('button', { name: 'Crear bóveda' }).click();
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const nav = () => page.getByRole('navigation', { name: 'Principal' });

test('la interfaz carga desde el protocolo propio app://', async () => {
  await expect(
    page.getByRole('heading', { name: 'Te damos la bienvenida a QAtlas' }),
  ).toBeVisible();
  expect(page.url()).toBe('app://qatlas/index.html');
});

test('la interfaz no tiene acceso a Node ni a ipcRenderer', async () => {
  const exposed = await page.evaluate(() => {
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
    apiKeys: ['app', 'appearance', 'privacy', 'security', 'vault'],
    apiFrozen: true,
  });
});

test('el indicador de protecciones está visible en la barra superior', async () => {
  await expect(page.getByText('Protecciones activas · sin conexiones externas')).toBeVisible();
});

test('las secciones no construidas muestran cuándo llegan', async () => {
  await page.getByRole('button', { name: 'UAT' }).click();
  await expect(page.getByRole('heading', { name: 'UAT', level: 1 })).toBeVisible();
  await expect(page.getByText('Llega en: Fase 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'UAT' })).toHaveAttribute('aria-current', 'page');
});

test('todos los controles del panel de seguridad están correctos', async () => {
  await page.getByRole('button', { name: 'Privacidad y conexiones' }).click();
  const panel = page.getByRole('region', { name: 'Estado de seguridad' });
  await expect(panel.getByText('correcto', { exact: true })).toHaveCount(9);
  await expect(panel.getByText('con problemas')).toHaveCount(0);
});

test('la prueba de contención bloquea todas las conexiones salientes', async () => {
  await page.getByRole('button', { name: 'Probar conexiones salientes' }).click();
  const results = page.getByRole('region', { name: 'Prueba de contención de red' });
  await expect(results.getByText('Bloqueado:')).toHaveCount(3);
  await expect(results.getByText('NO bloqueado:')).toHaveCount(0);
});

test('el tema se puede cambiar a mano y vuelve a seguir al sistema', async () => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const themes = page.getByRole('radiogroup', { name: 'Tema de la interfaz' });

  await themes.getByRole('radio', { name: 'Oscuro' }).click();
  await expect.poll(background).toBe('rgb(11, 13, 18)');

  await themes.getByRole('radio', { name: 'Claro' }).click();
  await expect.poll(background).toBe('rgb(246, 247, 249)');
  await expect(themes.getByRole('radio', { name: 'Claro' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await themes.getByRole('radio', { name: 'Sistema' }).click();
  await expect(themes.getByRole('radio', { name: 'Sistema' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('la app no muestra ventanas nuevas aunque la página lo intente', async () => {
  await page.evaluate(() => {
    globalThis.open('https://example.com', '_blank');
  });
  await page.waitForTimeout(500);
  expect(app.windows()).toHaveLength(1);
  await expect(nav()).toBeVisible();
});
