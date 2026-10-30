/**
 * E2E de proyectos (CU-01, CU-02): crear con autorización, editar, reautorizar, credenciales y
 * eliminar, en los dos modos. Carpeta temporal y datos inventados. Requiere `npm run build` antes.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
import { lanzarApp } from './lanzar';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const SECRETO = 'CANARIO-clave-de-prueba-inventada-41';
const SECRETO_NUEVO = 'CANARIO-otra-clave-inventada-58';

let carpeta: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-proyectos-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await page.getByLabel('Contraseña maestra', { exact: true }).fill(CONTRASENA);
  await page.getByLabel('Repetí la contraseña', { exact: true }).fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await page.getByRole('button', { name: 'Crear bóveda' }).click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const siguiente = () => boton('Siguiente').click();

test('Inicio habilita "Crear proyecto" y abre el asistente', async () => {
  await boton('Crear proyecto').click();
  await expect(titulo('Nuevo proyecto')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '1. Datos' })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

test('el asistente propone el dominio de la URL y rechaza los comodines amplios', async () => {
  await expect(boton('Siguiente')).toBeDisabled();
  await entrada('Nombre').fill('Lexora');
  await entrada('URL base').fill('HTTPS://App.Lexora.test/inicio');
  await siguiente();

  const dominios = entrada('Dominios permitidos');
  await expect(dominios).toHaveValue('app.lexora.test');

  await dominios.fill('*.com');
  await siguiente();
  await expect(page.getByText('demasiado amplio')).toBeVisible();
  await expect(titulo('Nuevo proyecto')).toBeVisible();

  await dominios.fill('lexora.test.evil.example');
  await siguiente();
  await expect(page.getByText('tiene que pertenecer a un dominio permitido')).toBeVisible();

  await dominios.fill('app.lexora.test');
  await siguiente();
});

test('los límites y el modo solo lectura traen sus valores por defecto', async () => {
  await expect(entrada('Solicitudes por segundo')).toHaveValue('2');
  await expect(entrada('Máximo de páginas')).toHaveValue('200');
  await expect(entrada('Profundidad')).toHaveValue('5');
  await expect(entrada('Timeout por página (segundos)')).toHaveValue('30');
  await expect(page.getByRole('checkbox', { name: /Modo solo lectura/ })).toBeChecked();
  await expect(entrada('Exclusiones')).toHaveValue(/logout/);
  await expect(page.getByRole('checkbox', { name: /Modo datos sensibles/ })).not.toBeChecked();
  await siguiente();
});

test('la autorización es el último paso: sin marcar, no se puede crear', async () => {
  await expect(page.getByText('Declaración de autorización')).toBeVisible();
  await expect(page.getByText('https://app.lexora.test/inicio · app.lexora.test')).toBeVisible();
  const casilla = page.getByRole('checkbox', { name: 'Acepto esta declaración' });
  await expect(casilla).not.toBeChecked();
  await expect(boton('Crear proyecto')).toBeDisabled();
  await casilla.check();
  await expect(boton('Crear proyecto')).toBeEnabled();
  await boton('Crear proyecto').click();

  await expect(titulo('Lexora')).toBeVisible();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
});

test('la lista muestra el proyecto', async () => {
  await boton('Volver').click();
  await expect(titulo('Proyectos')).toBeVisible();
  await page.getByRole('button', { name: /Lexora/ }).click();
  await expect(titulo('Lexora')).toBeVisible();
});

test('un nombre repetido se rechaza sin distinguir mayúsculas', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await boton('Crear proyecto').click();
  await entrada('Nombre').fill('LEXORA');
  await entrada('URL base').fill('https://otra.lexora.test/');
  await siguiente();
  await expect(page.getByText('Ya hay un proyecto con ese nombre')).toBeVisible();
  await boton('Cancelar').click();
  await page.getByRole('button', { name: /Lexora/ }).click();
});

test('credenciales: guarda el secreto, solo muestra "configurado" y exige una URL permitida', async () => {
  await boton('Agregar credencial').click();
  await entrada('Nombre de la credencial').fill('Usuario de prueba');
  await entrada('Usuario').fill('ana@example.com');
  await entrada('Secreto').fill(SECRETO);
  await entrada('URL de login').fill('https://evil.example/login');
  await boton('Guardar credencial').click();
  await expect(page.getByText('dentro de los dominios permitidos')).toBeVisible();

  await entrada('Secreto').fill(SECRETO);
  await entrada('URL de login').fill('https://app.lexora.test/login');
  await boton('Guardar credencial').click();

  await expect(page.getByText(/Secreto: configurado/)).toBeVisible();
  const pagina = await page.content();
  expect(pagina).not.toContain(SECRETO);
});

test('"Probar login" está visible y deshabilitado, con cuándo llega', async () => {
  await expect(boton('Probar login')).toBeDisabled();
  await expect(page.getByText('Llega en: semana 5')).toBeVisible();
});

test('el secreto se puede reemplazar, nunca ver', async () => {
  await boton('Reemplazar secreto').click();
  await expect(entrada('Secreto nuevo')).toHaveValue('');
  await expect(page.getByText('conservan el secreto viejo')).toBeVisible();
  await entrada('Secreto nuevo').fill(SECRETO_NUEVO);
  await boton('Guardar secreto').click();
  await expect(page.getByText(/Secreto: configurado/)).toBeVisible();
  expect(await page.content()).not.toContain(SECRETO_NUEVO);
});

test('el secreto no queda en ningún archivo de la carpeta de datos', () => {
  const datos = path.join(carpeta, 'QAtlas');
  for (const nombre of readdirSync(datos, { withFileTypes: true })) {
    if (!nombre.isFile()) continue;
    const contenido = readFileSync(path.join(datos, nombre.name));
    expect(contenido.includes(SECRETO)).toBe(false);
    expect(contenido.includes(SECRETO_NUEVO)).toBe(false);
  }
});

test('editar sin cambiar el alcance mantiene la autorización', async () => {
  await boton('Editar proyecto').click();
  await entrada('Solicitudes por segundo').fill('5');
  await expect(page.getByText('Cambiaste el alcance')).toBeHidden();
  await boton('Guardar cambios').click();
  await expect(titulo('Lexora')).toBeVisible();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
});

test('activar el login sin cifrar muestra un aviso claro y no invalida la autorización', async () => {
  await boton('Editar proyecto').click();
  const opcion = page.getByRole('checkbox', { name: /Permitir login sin cifrar/ });
  await expect(opcion).not.toBeChecked();
  await opcion.check();
  await expect(page.getByText('pueden viajar sin cifrar')).toBeVisible();
  await opcion.uncheck();
  await boton('Cancelar').click();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
});

test('una opción relajada rechaza lo que siempre está prohibido', async () => {
  await boton('Editar proyecto').click();
  await page.getByRole('checkbox', { name: /Sistema interno/ }).check();
  await entrada('Dominios permitidos').fill('169.254.169.254');
  await boton('Guardar cambios').click();
  await expect(page.getByText('Esa IP no se admite')).toBeVisible();
  await boton('Cancelar').click();
});

test('cambiar el alcance invalida la autorización y exige aceptarla de nuevo', async () => {
  await boton('Editar proyecto').click();
  await entrada('URL base').fill('https://app.lexora.test/otra');
  await expect(page.getByText('Cambiaste el alcance')).toBeVisible();
  await boton('Guardar cambios').click();

  await expect(page.getByText('Cambió el alcance: hay que aceptarla de nuevo')).toBeVisible();
  await expect(page.getByText('no se puede ejecutar nada')).toBeVisible();
  await expect(page.getByText('https://app.lexora.test/otra · app.lexora.test')).toBeVisible();

  const casilla = page.getByRole('checkbox', { name: 'Acepto esta declaración' });
  await expect(casilla).not.toBeChecked();
  await expect(boton('Aceptar autorización')).toBeDisabled();
  await casilla.check();
  await boton('Aceptar autorización').click();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
  await expect(page.getByText(/^Aceptada el/)).toBeVisible();
});

test('los datos sobreviven a bloquear y desbloquear, y con la bóveda bloqueada no hay nada', async () => {
  await boton('Bloquear').click();
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  expect(await page.content()).not.toContain('Lexora');
  const res = await page.evaluate(() =>
    (window as unknown as { qatlas: QatlasApi }).qatlas.proyectos.listar(),
  );
  expect(res).toEqual({ ok: false, error: 'BOVEDA_BLOQUEADA' });

  await entrada('Contraseña maestra').fill(CONTRASENA);
  await boton('Desbloquear').click();
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await expect(page.getByRole('button', { name: /Lexora/ })).toBeVisible();
});

for (const tema of ['Claro', 'Oscuro'] as const) {
  test(`el detalle se ve bien en modo ${tema}`, async () => {
    await page.getByRole('radio', { name: tema }).click();
    await page.getByRole('button', { name: /Lexora/ }).click();
    await expect(titulo('Lexora')).toBeVisible();
    const esperado = tema === 'Oscuro' ? 'dark' : 'light';
    await expect(page.locator('html')).toHaveAttribute('data-theme', esperado);
    // El fondo y el texto no son el mismo color: el token se aplicó.
    const { fondo, texto } = await page.evaluate(() => ({
      fondo: getComputedStyle(document.querySelector('.bg-bg') as Element).backgroundColor,
      texto: getComputedStyle(document.querySelector('h1') as Element).color,
    }));
    expect(fondo).not.toBe(texto);
    await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  });
}

test('eliminar exige escribir el nombre y avisa de las copias', async () => {
  await page.getByRole('button', { name: /Lexora/ }).click();
  await expect(page.getByText('copias de seguridad anteriores todavía contienen')).toBeVisible();
  const eliminar = boton('Eliminar definitivamente');
  await expect(eliminar).toBeDisabled();
  await entrada('Para confirmar, escribí «Lexora»').fill('lexora');
  await expect(eliminar).toBeDisabled();
  await entrada('Para confirmar, escribí «Lexora»').fill('Lexora');
  await eliminar.click();

  await expect(titulo('Proyectos')).toBeVisible();
  await expect(page.getByText('Todavía no hay proyectos.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Lexora/ })).toBeHidden();
});

test('el nombre queda libre y el proyecto no vuelve al desbloquear', async () => {
  await boton('Bloquear').click();
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await boton('Desbloquear').click();
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await expect(page.getByText('Todavía no hay proyectos.')).toBeVisible();
});
