import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { _electron, ElectronApplication, Page } from '@playwright/test';

const APP_DIR = path.resolve(import.meta.dirname, '../apps/desktop');

/**
 * Abre la app compilada con su carpeta de datos dentro de `carpeta`: en Windows, %LOCALAPPDATA%; en
 * Linux y macOS, `--user-data-dir`. Nunca toca la bóveda real del equipo.
 */
export async function lanzarApp(
  electron: typeof _electron,
  carpeta: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  mkdirSync(carpeta, { recursive: true });
  const app = await electron.launch({
    args: [APP_DIR, `--user-data-dir=${path.join(carpeta, 'QAtlas')}`],
    // En CI Linux sin entorno gráfico se corre con xvfb-run.
    env: { ...process.env, ELECTRON_RENDERER_URL: '', LOCALAPPDATA: carpeta },
  });
  return { app, page: await app.firstWindow() };
}
