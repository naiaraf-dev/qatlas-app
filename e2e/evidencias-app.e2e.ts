/**
 * Las evidencias en la app real (Electron): el visor muestra la captura y el video en un canvas, sin
 * renderizar el sitio y con la CSP cerrada; y activar el modo datos sensibles avisa cuántas evidencias
 * existentes no cumplen y deja eliminarlas, con confirmación, o conservarlas (f6).
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
import type { QatlasApi } from '@qatlas/shared';
import {
  DATOS_SENSIBLES_DE_PRUEBA,
  iniciarSandbox,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import { vigilarEntorno } from './entorno';
import { lanzarApp } from './lanzar';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';

let carpeta: string;
let app: ElectronApplication;
let page: Page;
let sitio: SandboxActivo;
const consola: string[] = [];

test.describe.configure({ mode: 'serial', timeout: 180_000 });
vigilarEntorno(test);

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const ejecuciones = () =>
  page.getByRole('list', { name: 'Ejecuciones del proyecto' }).locator(':scope > li');
const evidencias = () => page.getByRole('region', { name: 'Evidencias de la ejecución' });

/** Lo que el proceso principal dice que existe, por el mismo canal que usa la interfaz. */
const noCumplen = () =>
  page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const proyectos = await qatlas.proyectos.listar();
    const id = proyectos.ok ? proyectos.data[0]?.id : undefined;
    if (!id) throw new Error('sin proyecto');
    const res = await qatlas.evidencias.noCumplenModoSensible({ proyectoId: id });
    if (!res.ok) throw new Error('sin respuesta');
    return res.data;
  });

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-evidencias-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  page.on('console', (mensaje) => consola.push(mensaje.text()));
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await entrada('Repetí la contraseña').fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await boton('Crear bóveda').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

test('un escaneo con fallas deja captura y video, y el visor los muestra en un canvas', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await boton('Crear proyecto').click();
  await entrada('Nombre').fill('Evidencias');
  await entrada('URL base').fill(`${sitio.url}/evidencias/`);
  await boton('Siguiente').click();
  await boton('Siguiente').click();
  await entrada('Solicitudes por segundo').fill('5');
  await entrada('Timeout por página (segundos)').fill('5');
  await entrada('Profundidad').fill('1');
  await boton('Siguiente').click();
  await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
  await boton('Crear proyecto').click();
  await expect(titulo('Evidencias')).toBeVisible();

  await boton('Lanzar ejecución').click();
  await expect(ejecuciones().first()).toContainText('Ejecución: Finalizada', { timeout: 120_000 });
  await expect(ejecuciones().first()).toContainText(
    /Evidencias: [1-9]\d* capturas y [1-9]\d* videos/,
  );
  await boton('Ver resultado').click();

  const ficha = evidencias().getByRole('region', { name: 'Evidencias de /evidencias/ficha' });
  const captura = ficha.getByRole('img', { name: /Captura de la página/ });
  await expect(captura).toBeVisible();
  // Se dibujó: el canvas tiene el tamaño de la imagen, no el de un canvas vacío.
  await expect.poll(() => captura.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(300);
  await expect(ficha.getByText(/No tapa texto suelto/)).toBeVisible();

  const fotograma = ficha.getByRole('img', { name: /Fotograma 1 de \d+/ });
  await expect(fotograma).toBeVisible();
  const video = ficha.locator('figure').filter({ hasText: 'Video del tramo' });
  await expect(video.getByText(/Puede contener datos sensibles/)).toBeVisible();
  await ficha.getByRole('button', { name: 'Siguiente' }).click();
  await expect(ficha.getByRole('img', { name: /Fotograma 2 de \d+/ })).toBeVisible();

  // El snapshot, como texto: nunca HTML renderizado.
  await ficha.getByText('Snapshot del DOM, como texto').click();
  await expect(ficha.getByText(/QAtlas nunca abre el sitio probado/)).toBeVisible();
  // La contraseña y el campo oculto, vaciados.
  await expect(ficha.locator('pre')).toContainText('data-qatlas-enmascarado');
  await expect(ficha.locator('pre')).not.toContainText(DATOS_SENSIBLES_DE_PRUEBA.clave);
  await expect(ficha.locator('pre')).not.toContainText(DATOS_SENSIBLES_DE_PRUEBA.oculto);
  // El sitio no se renderizó en la ventana de QAtlas: ni un iframe, ni sus scripts.
  await expect(page.locator('iframe, webview, object, embed')).toHaveCount(0);
  // Y la CSP no se quejó: nada de data: ni blob:.
  expect(consola.filter((linea) => /Content Security Policy/i.test(linea))).toEqual([]);
});

test('EVI-06: la retención se configura en Bóveda y queda guardada', async () => {
  await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
  const dias = entrada('Días que se guardan');
  await expect(dias).toHaveValue('90');
  await dias.fill('30');
  await boton('Guardar retención').click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  const guardada = await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const res = await qatlas.vault.getSettings();
    return res.ok ? res.data.retencionDias : null;
  });
  expect(guardada).toBe(30);
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await page.getByText('Evidencias', { exact: true }).first().click();
  await expect(titulo('Evidencias')).toBeVisible();
});

test('f6: al activar el modo datos sensibles, avisa y se puede conservar lo que existe', async () => {
  const antes = await noCumplen();
  expect(antes.videos).toBeGreaterThan(0);
  expect(antes.snapshots).toBeGreaterThan(0);

  await boton('Editar proyecto').click();
  await page.getByRole('checkbox', { name: /Modo datos sensibles/ }).check();
  await boton('Guardar cambios').click();
  await expect(
    page.getByText(
      `El proyecto ya tiene ${antes.videos} videos y ${antes.snapshots} snapshots del DOM.`,
    ),
  ).toBeVisible();
  await boton('Conservarlas').click();
  await expect(titulo('Evidencias')).toBeVisible();
  expect(await noCumplen()).toEqual(antes);
});

test('f6: desactivado y activado otra vez, se eliminan con confirmación, y la captura queda', async () => {
  await boton('Editar proyecto').click();
  await page.getByRole('checkbox', { name: /Modo datos sensibles/ }).uncheck();
  await boton('Guardar cambios').click();
  await expect(titulo('Evidencias')).toBeVisible();

  const antes = await noCumplen();
  const total = antes.videos + antes.snapshots;
  await boton('Editar proyecto').click();
  await page.getByRole('checkbox', { name: /Modo datos sensibles/ }).check();
  await boton('Guardar cambios').click();
  await boton(`Eliminar ${total} evidencias`).click();
  // Sin confirmar, nada se borró.
  expect(await noCumplen()).toEqual(antes);
  await expect(
    page.getByText(`Se van a eliminar ${total} evidencias. No se puede deshacer.`),
  ).toBeVisible();
  await boton(`Sí, eliminar ${total} evidencias`).click();
  await expect(titulo('Evidencias')).toBeVisible();
  expect(await noCumplen()).toEqual({ videos: 0, snapshots: 0 });

  await boton('Ver resultado').click();
  const ficha = evidencias().getByRole('region', { name: 'Evidencias de /evidencias/ficha' });
  await expect(ficha.getByRole('img', { name: /Captura de la página/ })).toBeVisible();
  await expect(ficha.getByRole('img', { name: /Fotograma/ })).toHaveCount(0);
});
