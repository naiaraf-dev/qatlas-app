/**
 * Los componentes propios de la interfaz (ADR 042), en sus pantallas reales y SOLO con el teclado: cada
 * uno sigue su patrón de las APG (roles, estados, teclas y foco). Con capturas en los dos modos y axe
 * (roles, nombres, contraste) con cada uno abierto.
 *
 * La CSP: todo el recorrido, con cada componente abierto (listas desplegadas, ayudas, avisos), sin
 * ninguna violación. Control positivo: un <style> inyectado a propósito se detecta.
 *
 * El deslizador del visor y el diálogo de confirmación necesitan evidencias de un escaneo: van en
 * `evidencias-app.e2e.ts`, con el mismo control de la CSP.
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
  type TestInfo,
} from '@playwright/test';
import { elegirConTeclado, listaDesplegable } from './controles';
import {
  capturar,
  crearBoveda,
  ponerTema,
  revisarAccesibilidad,
  transicionesTerminadas,
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
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-componentes-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  csp = vigilarCsp(page);
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const campo = (etiqueta: string) =>
  page.getByLabel(etiqueta, { exact: true }).and(page.locator('input, textarea'));
const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });

/** axe sobre `selector` y una captura, en los dos modos. Vuelve al modo claro. */
async function enLosDosModos(info: TestInfo, nombre: string, selector: string): Promise<void> {
  await transicionesTerminadas(page);
  for (const tema of ['Claro', 'Oscuro'] as const) {
    if (await page.getByRole('radiogroup', { name: 'Tema de la interfaz' }).isVisible()) {
      await ponerTema(page, tema);
    } else {
      // Antes de crear la bóveda no hay selector de tema: se emula el del sistema.
      await page.emulateMedia({ colorScheme: tema === 'Claro' ? 'light' : 'dark' });
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        tema === 'Claro' ? 'light' : 'dark',
      );
    }
    expect(await revisarAccesibilidad(page, selector), `${nombre}, ${tema}`).toEqual([]);
    await capturar(page, info, `${nombre}-${tema.toLowerCase()}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test(
  'Desplegable (disclosure): Enter y Espacio abren y cierran, con aria-expanded',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    const disparador = boton('Ya tengo una copia de seguridad');
    await disparador.focus();
    await expect(disparador).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(disparador).toHaveAttribute('aria-expanded', 'true');
    await expect(boton('Elegir copia y restaurar')).toBeVisible();
    await enLosDosModos(info, 'desplegable-abierto', 'main');
    await page.keyboard.press('Space');
    await expect(disparador).toHaveAttribute('aria-expanded', 'false');
  },
);

test(
  'Casilla (checkbox): Espacio marca y desmarca; la deshabilitada no se enfoca',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    const casilla = page.getByRole('checkbox', { name: /no hay recuperación/ });
    await casilla.focus();
    await page.keyboard.press('Space');
    await expect(casilla).toBeChecked();
    await page.keyboard.press('Space');
    await expect(casilla).not.toBeChecked();
    const deshabilitada = page.getByRole('checkbox', { name: /Buscar actualizaciones/ });
    await expect(deshabilitada).toBeDisabled();
    // La ayuda es su descripción, no parte del nombre.
    await expect(deshabilitada).toHaveAccessibleDescription(/Llega en: semana 10/);
    await page.keyboard.press('Space');
    await enLosDosModos(info, 'casillas', 'main');
    await crearBoveda(page);
  },
);

test(
  'Selector de tema (radio group): las flechas cambian la opción',
  { tag: ['@interfaz'] },
  async () => {
    const grupo = page.getByRole('radiogroup', { name: 'Tema de la interfaz' });
    await grupo.getByRole('radio', { name: 'Claro' }).check();
    await grupo.getByRole('radio', { name: 'Claro' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(grupo.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
    await expect(grupo.getByRole('radio', { name: 'Oscuro' })).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('ArrowLeft');
    await expect(grupo.getByRole('radio', { name: 'Claro' })).toBeChecked();
  },
);

test(
  'Ayuda emergente (tooltip): aparece al enfocar con el teclado y Escape la cierra',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    await page.keyboard.press('Control+B');
    const proyectos = page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('button', { name: 'Proyectos' });
    await page
      .getByRole('navigation', { name: 'Principal' })
      .getByRole('button', { name: 'Inicio' })
      .focus();
    await page.keyboard.press('Tab');
    await expect(proyectos).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText('Proyectos');
    await enLosDosModos(info, 'ayuda-emergente', 'body');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await page.keyboard.press('Control+B');
  },
);

test(
  'Campo numérico (spinbutton): las flechas suben y bajan, y se puede escribir',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    await boton('Crear proyecto').click();
    await campo('Nombre').fill('Componentes');
    await campo('URL base').fill('https://app.example.test/');
    await boton('Siguiente').click();
    await boton('Siguiente').click();
    const profundidad = campo('Profundidad');
    await expect(profundidad).toHaveValue('5');
    await profundidad.focus();
    await page.keyboard.press('ArrowUp');
    await expect(profundidad).toHaveValue('6');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(profundidad).toHaveValue('4');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('3');
    await page.keyboard.press('Tab');
    await expect(profundidad).toHaveValue('3');
    // Anunciado en español.
    await expect(profundidad).toHaveAttribute('aria-roledescription', 'Campo de número');
    await enLosDosModos(info, 'campos-numericos', 'main');
    await boton('Siguiente').click();
    await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
    await boton('Crear proyecto').click();
    await expect(titulo('Componentes')).toBeVisible();
  },
);

test(
  'Selector (listbox): Enter abre, flechas recorren, Enter elige, Escape cierra y el foco vuelve',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    await boton('Agregar credencial').click();
    await elegirConTeclado(page, 'Forma de login', 'Login asistido');
    await elegirConTeclado(page, 'Forma de login', 'Formulario de login');

    // Abierta: la opción que no está disponible se ve, deshabilitada. Abierta es modal (una capa tapa el
    // resto), así que el modo se cambia antes de abrirla.
    const disparador = listaDesplegable(page, 'Forma de login');
    const lista = page.getByRole('listbox');
    for (const tema of ['Claro', 'Oscuro'] as const) {
      await ponerTema(page, tema);
      await disparador.focus();
      await page.keyboard.press('Enter');
      await expect(lista).toBeVisible();
      await expect(
        lista.getByRole('option', { name: /Autenticación HTTP básica \(llega en/ }),
      ).toBeDisabled();
      expect(await revisarAccesibilidad(page, 'body'), `selector abierto, ${tema}`).toEqual([]);
      await capturar(page, info, `selector-abierto-${tema.toLowerCase()}`);
      await page.keyboard.press('Escape');
      await expect(lista).toBeHidden();
      await expect(disparador).toBeFocused();
    }
    await ponerTema(page, 'Claro');
    await boton('Cancelar').click();
  },
);

test(
  'Aviso pasajero (toast): se anuncia en una región de estado y se cierra con el teclado',
  { tag: ['@interfaz'] },
  async () => {
    const info = test.info();
    await app.evaluate(
      ({ dialog }, destino) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: destino });
      },
      path.join(carpeta, 'copia.qatlas'),
    );
    await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
    await boton('Crear copia de seguridad').click();
    const region = page.getByRole('status', { name: 'Avisos' });
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toContainText('Copia creada.');
    await enLosDosModos(info, 'aviso', 'section[aria-label="Avisos"]');
    const cerrar = region.getByRole('button', { name: 'Cerrar aviso' });
    await cerrar.focus();
    await page.keyboard.press('Enter');
    await expect(region).not.toContainText('Copia creada.');
  },
);

test('las barras de scroll usan los tokens', { tag: ['@interfaz'] }, async () => {
  const color = await page.locator('aside').evaluate((e) => getComputedStyle(e).scrollbarColor);
  expect(color).not.toBe('auto');
});

test(
  'CSP: ninguna violación en todo el recorrido, con cada componente abierto',
  { tag: ['@interfaz'] },
  () => {
    expect(csp).toEqual([]);
  },
);

test(
  'control positivo: un <style> inyectado a propósito se detecta',
  { tag: ['@interfaz'] },
  async () => {
    await page.evaluate(() => {
      const estilo = document.createElement('style');
      estilo.textContent = 'body { outline: 1px solid red; }';
      document.head.append(estilo);
    });
    await expect.poll(() => csp.length).toBeGreaterThan(0);
    expect(csp.join('\n')).toMatch(/style-src/);
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
