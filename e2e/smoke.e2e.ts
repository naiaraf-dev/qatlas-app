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
import { diferenciasDeEntorno, restaurarEntorno } from './entorno';
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

/** El color del símbolo y de la línea de escaneo del isotipo visible: cambian con el modo (docs/marca). */
const coloresDelLogo = (pagina: Page) =>
  pagina
    .locator('[data-marca="isotipo"]')
    .first()
    .evaluate((svg) => ({
      simbolo: getComputedStyle(svg.querySelector('rect') as Element).fill,
      escaneo: getComputedStyle(svg.querySelector('path') as Element).stroke,
    }));
const LOGO_CLARO = { simbolo: 'rgb(91, 91, 214)', escaneo: 'rgb(156, 156, 242)' };
const LOGO_OSCURO = { simbolo: 'rgb(109, 109, 227)', escaneo: 'rgb(199, 201, 255)' };

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
    apiKeys: [
      'app',
      'appearance',
      'credenciales',
      'ejecuciones',
      'privacy',
      'proyectos',
      'security',
      'vault',
    ],
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

  // El logo del menú lateral, en los dos modos, con los colores de la marca.
  await expect(page.locator('aside [data-marca="isotipo"]')).toBeVisible();

  await themes.getByRole('radio', { name: 'Oscuro' }).click();
  await expect.poll(background).toBe('rgb(11, 13, 18)');
  await expect.poll(() => coloresDelLogo(page)).toEqual(LOGO_OSCURO);

  await themes.getByRole('radio', { name: 'Claro' }).click();
  await expect.poll(background).toBe('rgb(246, 247, 249)');
  await expect.poll(() => coloresDelLogo(page)).toEqual(LOGO_CLARO);
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

test('la vigilancia del entorno detecta lo que cambió, y solo nombra la variable', () => {
  expect(diferenciasDeEntorno({ A: '1', B: '2' }, { A: '1', B: '2' })).toEqual([]);
  expect(diferenciasDeEntorno({ A: 'valor' }, { A: 'otro' })).toEqual(['A']);
  expect(diferenciasDeEntorno({}, { TMPDIR: 'undefined' })).toEqual(['TMPDIR']);
  expect(diferenciasDeEntorno({ TMPDIR: 'x' }, {})).toEqual(['TMPDIR']);
  // La única que se ignora es la que pone Playwright al transpilar, por su nombre exacto.
  expect(diferenciasDeEntorno({}, { BROWSERSLIST_IGNORE_OLD_DATA: 'true' })).toEqual([]);
  expect(
    diferenciasDeEntorno(
      {},
      {
        BROWSERSLIST_IGNORE_OLD_DATA_X: 'true',
        BROWSERSLIST_IGNORE_OLD: 'true',
        BROWSERSLIST_OTRA: 'true',
        browserslist_ignore_old_data: 'true',
        X_BROWSERSLIST_IGNORE_OLD_DATA: 'true',
      },
    ),
  ).toEqual([
    'BROWSERSLIST_IGNORE_OLD',
    'BROWSERSLIST_IGNORE_OLD_DATA_X',
    'BROWSERSLIST_OTRA',
    'X_BROWSERSLIST_IGNORE_OLD_DATA',
    'browserslist_ignore_old_data',
  ]);
});

test('restaurar una variable que no existía la borra, no guarda el texto "undefined"', () => {
  process.env.QATLAS_PRUEBA_ENTORNO = 'x';
  restaurarEntorno({ QATLAS_PRUEBA_ENTORNO: undefined });
  expect('QATLAS_PRUEBA_ENTORNO' in process.env).toBe(false);
});

test('Escaneos y Ejecuciones dicen que hoy se lanzan desde cada proyecto, y llevan ahí', async () => {
  for (const seccion of ['Escaneos', 'Ejecuciones']) {
    await nav().getByText(seccion, { exact: true }).click();
    await expect(
      page.getByText('Hoy los escaneos se lanzan y se siguen desde el detalle'),
    ).toBeVisible();
    await expect(page.getByText('Llega en: Fase 1 · semana 6')).toHaveCount(0);
    await expect(page.getByText(/: semana 8\./).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Ir a Proyectos' }).click();
  await expect(page.getByRole('heading', { name: 'Proyectos', level: 1 })).toBeVisible();
});
