/**
 * Cómo se manejan desde los E2E los controles propios de la interfaz (ADR 042), como lo haría una persona.
 *
 * - `elegirOpcion`: abre la lista y elige la opción por su nombre visible. Reemplaza a `selectOption`,
 *   que solo sirve para un `<select>` nativo.
 * - `elegirConTeclado`: lo mismo sin mouse (patrón listbox de las APG): foco, Enter abre, flechas y Enter
 *   eligen.
 */
import { expect, type Locator, type Page } from '@playwright/test';

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * El botón de una lista desplegable. Su nombre accesible es «<valor elegido> <etiqueta>» (React Aria lo
 * arma con aria-labelledby), así que se busca por la etiqueta al final.
 */
export function listaDesplegable(page: Page, etiqueta: string): Locator {
  return page.getByRole('button', { name: new RegExp(`${escapar(etiqueta)}$`) });
}

export async function elegirOpcion(page: Page, etiqueta: string, opcion: string): Promise<void> {
  await listaDesplegable(page, etiqueta).click();
  const lista = page.getByRole('listbox');
  await expect(lista).toBeVisible();
  await lista.getByRole('option', { name: opcion, exact: true }).click();
  await expect(lista).toBeHidden();
  await expect(listaDesplegable(page, etiqueta)).toContainText(opcion);
}

/** Sin mouse: Tab hasta el botón (o foco directo), Enter abre, flechas recorren, Enter elige. */
export async function elegirConTeclado(
  page: Page,
  etiqueta: string,
  opcion: string,
): Promise<void> {
  const boton = listaDesplegable(page, etiqueta);
  await boton.focus();
  await page.keyboard.press('Enter');
  const lista = page.getByRole('listbox');
  await expect(lista).toBeVisible();
  const objetivo = lista.getByRole('option', { name: opcion, exact: true });
  // Abre en la opción elegida: se busca hacia abajo y, si no está, hacia arriba (no da la vuelta).
  const enfocada = async () => (await objetivo.getAttribute('data-focused')) !== null;
  for (const tecla of ['ArrowDown', 'ArrowUp']) {
    for (let i = 0; i < 20 && !(await enfocada()); i++) await page.keyboard.press(tecla);
    if (await enfocada()) break;
  }
  await expect(objetivo).toHaveAttribute('data-focused', 'true');
  await page.keyboard.press('Enter');
  await expect(lista).toBeHidden();
  await expect(boton).toContainText(opcion);
  // El foco vuelve al botón (APG).
  await expect(boton).toBeFocused();
}

/** El nombre visible de cada estrategia de login (como en Credenciales). */
export const NOMBRE_DE_ESTRATEGIA = {
  formulario: 'Formulario de login',
  sso: 'SSO con redirección',
  'token-url': 'Enlace con token',
  asistido: 'Login asistido',
  basica: 'Autenticación HTTP básica',
} as const;
