/**
 * Ayudantes para los E2E de la interfaz (barra lateral y componentes, ADR 042 y 043).
 *
 * - `vigilarCsp`: junta las violaciones de la CSP que Chromium informa por consola. Se engancha apenas se
 *   abre la ventana y sobrevive a las recargas (bloquear recarga la ventana).
 * - `revisarAccesibilidad`: corre axe-core (el mismo del escáner, versión fija) sobre una parte de la
 *   interfaz, con las reglas WCAG 2 A y AA: roles, nombres, estados y contraste. Se inyecta con
 *   `evaluate`, que pasa por el protocolo de depuración y no por la página: no es un script de la app.
 * - `capturar`: adjunta una captura al reporte del test, para revisar el aspecto en los dos modos.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';

export async function crearBoveda(page: Page): Promise<void> {
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(CONTRASENA);
  await page.getByLabel('Repetí la contraseña', { exact: true }).fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await page.getByRole('button', { name: 'Crear bóveda' }).click();
  await expect(
    page.getByRole('heading', { name: 'Te damos la bienvenida a QAtlas', level: 1 }),
  ).toBeVisible();
}

export async function desbloquear(page: Page): Promise<void> {
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(CONTRASENA);
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(
    page.getByRole('heading', { name: 'Te damos la bienvenida a QAtlas', level: 1 }),
  ).toBeVisible();
}

/** Las líneas de consola que son violaciones de la CSP. */
export function vigilarCsp(page: Page): string[] {
  const violaciones: string[] = [];
  page.on('console', (mensaje) => {
    if (/Content Security Policy/i.test(mensaje.text())) violaciones.push(mensaje.text());
  });
  return violaciones;
}

const requerir = createRequire(
  path.join(import.meta.dirname, '..', 'packages/runner/package.json'),
);
let fuenteAxe: string | undefined;

interface ResultadoAxe {
  violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
}

/** Las violaciones de axe dentro de `selector`, como «regla: elemento». */
export async function revisarAccesibilidad(page: Page, selector: string): Promise<string[]> {
  fuenteAxe ??= readFileSync(requerir.resolve('axe-core/axe.min.js'), 'utf8');
  const cargado = await page.evaluate(() => 'axe' in window);
  if (!cargado) await page.evaluate(fuenteAxe);
  const resultado = await page.evaluate(
    async (incluir) =>
      await (
        window as unknown as {
          axe: { run: (c: unknown, o: unknown) => Promise<ResultadoAxe> };
        }
      ).axe.run(
        { include: [incluir] },
        { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } },
      ),
    selector,
  );
  return resultado.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
}

export async function capturar(page: Page, info: TestInfo, nombre: string): Promise<void> {
  await info.attach(nombre, { body: await page.screenshot(), contentType: 'image/png' });
}

/** Cambia el tema con el selector de la barra lateral y espera a que se aplique. */
export async function ponerTema(page: Page, tema: 'Claro' | 'Oscuro'): Promise<void> {
  await transicionesTerminadas(page);
  await page
    .getByRole('radiogroup', { name: 'Tema de la interfaz' })
    .getByRole('radio', { name: tema })
    .check();
  await expect(page.locator('html')).toHaveAttribute(
    'data-theme',
    tema === 'Claro' ? 'light' : 'dark',
  );
}

/**
 * Sin transiciones, para medir el contraste: en el medio de una transición los colores son intermedios, y
 * con la ventana en segundo plano Chromium no las avanza. Con prefers-reduced-motion, el CSS de la app las
 * apaga.
 */
export async function transicionesTerminadas(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
