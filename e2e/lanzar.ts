import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { _electron, ElectronApplication, Page } from '@playwright/test';
import { chromium } from 'playwright-core';

const APP_DIR = path.resolve(import.meta.dirname, '../apps/desktop');

/**
 * Dónde están los navegadores de este equipo. Hay que decirlo: `carpeta` reemplaza %LOCALAPPDATA%,
 * que es donde Playwright los busca por defecto. Es una variable estándar de Playwright.
 */
function rutaNavegadores(): string {
  const partes = chromium.executablePath().split(path.sep);
  const indice = partes.findIndex((parte) => /^chromium-\d+$/.test(parte));
  return partes.slice(0, indice).join(path.sep);
}

/**
 * Abre la app compilada con su carpeta de datos dentro de `carpeta`: en Windows, %LOCALAPPDATA%; en
 * Linux y macOS, `--user-data-dir`. Nunca toca la bóveda real del equipo.
 */
export async function lanzarApp(
  electron: typeof _electron,
  carpeta: string,
  entorno: Record<string, string> = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  mkdirSync(carpeta, { recursive: true });
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${path.join(carpeta, 'QAtlas')}`],
    // En CI Linux sin entorno gráfico se corre con xvfb-run.
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      LOCALAPPDATA: carpeta,
      PLAYWRIGHT_BROWSERS_PATH: rutaNavegadores(),
      ...entorno,
    },
  });
  return { app, page: await app.firstWindow() };
}
