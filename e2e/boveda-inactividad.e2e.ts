/**
 * TS-09 en la app real: el bloqueo automático por inactividad (ADR 044 lo separó de boveda.e2e.ts). Son
 * esperas reales de más de un minuto: van en su propia parte del CI, con su bóveda, sin depender del
 * orden de otro archivo.
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
import { vigilarEntorno } from './entorno';
import { CONTRASENA, crearBoveda } from './interfaz';
import { lanzarApp } from './lanzar';
import { vigilarProcesos } from './procesos';

let carpeta: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });
vigilarEntorno(test);

test.beforeAll(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-inactividad-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await crearBoveda(page);
  await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) =>
  page.getByLabel(etiqueta, { exact: true }).and(page.locator('input, textarea'));

async function desbloquear(): Promise<void> {
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Desbloquear' }).click();
}

/** Aísla la ventana del mouse y del teclado reales del equipo, solo durante una espera. */
async function aislarVentana(): Promise<() => Promise<void>> {
  // La ventana está visible en el equipo: un movimiento del mouse encima o una tecla real
  // reiniciarían el contador. setFocusable solo existe en Windows y macOS; en Linux el CI corre bajo
  // xvfb, sin teclado real.
  await app.evaluate(({ BrowserWindow }) => {
    const ventana = BrowserWindow.getAllWindows()[0];
    ventana?.setIgnoreMouseEvents(true);
    if (process.platform !== 'linux') ventana?.setFocusable(false);
    ventana?.blur();
  });
  if (process.platform === 'win32') {
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocusable()),
    ).toBe(false);
  }
  const sinFoco = await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused()))
    .toBe(false)
    .then(
      () => true,
      () => false,
    );
  if (!sinFoco) {
    // En CI no hay entrada humana, así que no hay excusa: si la ventana sigue enfocada, algo cambió.
    // En un equipo con gente, cerca de 1 de cada 20 veces isFocused() sigue en verdadero en Windows, y
    // ni repetir blur ni minimizar lo cambian. Ahí solo se anota: una tecla real puede atrasar el
    // bloqueo, lo que haría fallar la espera de TS-09, nunca pasarla en falso.
    if (process.env.CI) throw new Error('En CI, la ventana no debería conservar el foco.');
    test.info().annotations.push({ type: 'aviso', description: 'La ventana conservó el foco.' });
  }
  return async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const ventana = BrowserWindow.getAllWindows()[0];
      ventana?.setIgnoreMouseEvents(false);
      if (process.platform !== 'linux') ventana?.setFocusable(true);
    });
  };
}

test(
  'TS-09: bloqueo automático por inactividad con el mínimo de 1 minuto',
  { tag: ['@interfaz', '@seguridad', '@lento'] },
  async () => {
    test.setTimeout(120_000);
    const minutos = entrada('Minutos sin actividad');
    await minutos.fill('1');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardado.')).toBeVisible();
    const restaurar = await aislarVentana();
    try {
      await expect(titulo('Bóveda bloqueada')).toBeVisible({ timeout: 90_000 });
    } finally {
      await restaurar();
    }
  },
);

test(
  'la actividad reinicia el contador: una tecla a los 40 s la deja abierta a los 70 s',
  { tag: ['@interfaz', '@seguridad', '@lento'] },
  async () => {
    test.setTimeout(180_000);
    await desbloquear();
    await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
    const inicio = Date.now();
    const hasta = (segundos: number) =>
      page.waitForTimeout(segundos * 1000 - (Date.now() - inicio));
    const restaurar = await aislarVentana();
    try {
      await hasta(40);
      await page.keyboard.press('Shift');
      await hasta(70);
      await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
      await expect(titulo('Bóveda bloqueada')).toHaveCount(0);
      // 60 s después de la tecla, más el intervalo de 5 s con el que se revisa.
      await expect(titulo('Bóveda bloqueada')).toBeVisible({ timeout: 45_000 });
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(99_000);
    } finally {
      await restaurar();
    }
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
