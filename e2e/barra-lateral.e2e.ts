/**
 * La barra lateral colapsable (ADR 043), en la app real: el botón con su estado accesible, solo íconos
 * con ayuda emergente al colapsar, el ítem activo, Ctrl+B (que no actúa escribiendo), la preferencia
 * cifrada que vuelve al desbloquear, la animación que respeta prefers-reduced-motion, el contenido que
 * aprovecha el ancho, axe (roles, nombres y contraste) y capturas en los dos modos, sin violaciones de
 * la CSP.
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
  capturar,
  crearBoveda,
  desbloquear,
  ponerTema,
  revisarAccesibilidad,
  vigilarCsp,
} from './interfaz';
import { lanzarApp } from './lanzar';
import { vigilarProcesos } from './procesos';

let app: ElectronApplication;
let page: Page;
let carpeta: string;
let csp: string[];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-barra-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  csp = vigilarCsp(page);
  await crearBoveda(page);
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const barra = () => page.getByRole('complementary', { name: 'Barra lateral' });
const alternar = () => page.getByRole('button', { name: /la barra lateral$/ });
const item = (nombre: string) =>
  page.getByRole('navigation', { name: 'Principal' }).getByRole('button', { name: nombre });
const ancho = async (selector: string) =>
  (await page.locator(selector).first().boundingBox())?.width ?? 0;

test(
  'expandida por defecto: el botón dice qué hace y a qué controla',
  { tag: ['@interfaz'] },
  async () => {
    await expect(alternar()).toHaveAccessibleName('Contraer la barra lateral');
    await expect(alternar()).toHaveAttribute('aria-expanded', 'true');
    await expect(alternar()).toHaveAttribute('aria-keyshortcuts', 'Control+B');
    const controla = await alternar().getAttribute('aria-controls');
    expect(controla).toBeTruthy();
    await expect(barra()).toHaveAttribute('id', controla ?? '');
    await expect(item('Proyectos')).toContainText('Proyectos');
  },
);

test(
  'colapsar: solo íconos, los nombres siguen accesibles y el contenido gana ancho',
  { tag: ['@interfaz'] },
  async () => {
    const antes = await ancho('main');
    await alternar().click();
    await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
    await expect(alternar()).toHaveAccessibleName('Expandir la barra lateral');
    await expect.poll(() => ancho('aside')).toBeLessThan(100);
    // El nombre sigue en el árbol accesible, pero no se ve.
    await expect(item('Proyectos')).toHaveAccessibleName('Proyectos');
    const texto = item('Proyectos').locator('span');
    expect((await texto.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await expect.poll(() => ancho('main')).toBeGreaterThan(antes + 150);
    // Bloquear y el tema siguen ahí, con nombre.
    await expect(page.getByRole('button', { name: 'Bloquear' })).toBeVisible();
    await expect(
      page.getByRole('radiogroup', { name: 'Tema de la interfaz' }).getByRole('radio'),
    ).toHaveCount(3);
  },
);

test(
  'colapsada: la ayuda aparece con el mouse y con el teclado, y Escape la cierra',
  { tag: ['@interfaz'] },
  async () => {
    await item('Proyectos').hover();
    await expect(page.getByRole('tooltip')).toHaveText('Proyectos');
    await page.mouse.move(900, 500);
    await expect(page.getByRole('tooltip')).toBeHidden();

    // Con el teclado: Tab desde Inicio llega a Proyectos y muestra su nombre.
    await item('Inicio').focus();
    await page.keyboard.press('Tab');
    await expect(item('Proyectos')).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText('Proyectos');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
  },
);

test(
  'el ítem activo se distingue por aria-current, el fondo y una barra (no solo color)',
  { tag: ['@interfaz'] },
  async () => {
    await expect(item('Inicio')).toHaveAttribute('aria-current', 'page');
    await expect(item('Proyectos')).not.toHaveAttribute('aria-current');
    const fondo = (nombre: string) =>
      item(nombre).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await fondo('Inicio')).not.toBe(await fondo('Proyectos'));
    const marca = await item('Inicio').evaluate((e) => getComputedStyle(e, '::before').width);
    expect(marca).toBe('3px');
  },
);

test(
  'Ctrl+B expande y colapsa, pero no mientras se escribe en un campo',
  { tag: ['@interfaz'] },
  async () => {
    await page.keyboard.press('Control+B');
    await expect(alternar()).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Control+B');
    await expect(alternar()).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'Crear proyecto', exact: true }).click();
    const nombre = page.getByLabel('Nombre', { exact: true });
    await nombre.focus();
    await page.keyboard.press('Control+B');
    await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
    await nombre.blur();
    await item('Inicio').click();
  },
);

test(
  'se recuerda al desbloquear; con la bóveda bloqueada vale el valor por defecto',
  { tag: ['@interfaz'] },
  async () => {
    await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Control+Shift+L');
    await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeVisible();
    // Bloqueada no se conoce: está cifrada.
    const bloqueada = await page.evaluate(async () => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const res = await qatlas.appearance.get();
      return res.ok ? res.data.barraLateral : null;
    });
    expect(bloqueada).toBe('expandida');
    await desbloquear(page);
    await expect(alternar()).toHaveAttribute('aria-expanded', 'false');
  },
);

test('la animación es corta y respeta prefers-reduced-motion', { tag: ['@interfaz'] }, async () => {
  const duracion = () => barra().evaluate((e) => getComputedStyle(e).transitionDuration);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await duracion()).toBe('0.2s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await duracion()).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test(
  'axe sin violaciones (roles, nombres, contraste) y capturas, en los dos modos y los dos estados',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    for (const tema of ['Claro', 'Oscuro'] as const) {
      await ponerTema(page, tema);
      for (const estado of ['colapsada', 'expandida'] as const) {
        const expandida = (await alternar().getAttribute('aria-expanded')) === 'true';
        if (expandida !== (estado === 'expandida')) await alternar().click();
        await expect(alternar()).toHaveAttribute('aria-expanded', String(estado === 'expandida'));
        // Que termine la animación antes de medir el contraste y capturar.
        await page.waitForTimeout(300);
        expect(await revisarAccesibilidad(page, 'aside'), `${tema}, ${estado}`).toEqual([]);
        await capturar(page, info, `barra-${estado}-${tema.toLowerCase()}`);
      }
    }
  },
);

test('sin violaciones de la CSP en todo el recorrido', { tag: ['@interfaz'] }, () => {
  expect(csp).toEqual([]);
});

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
