/**
 * El escaneo autenticado desde la interfaz, en la app real (requiere `npm run build`): la credencial se
 * crea en el formulario, se elige al lanzar, y el resultado dice el rol. Sin ningún comportamiento
 * especial para tests: la app sobre 127.0.0.1 y el proveedor en localhost.
 *
 * El login asistido abre la ventana del navegador de pruebas desde el runner, que es un
 * `utilityProcess`: el test no la puede manejar, y no hace falta. La credencial entra por una pantalla
 * que solo pide el segundo factor, y el test lo aprueba cuando el sandbox lo pidió. Lo que se escribe en
 * esa ventana está en `ts-06-login-asistido.e2e.ts`.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  iniciarSandbox,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import { vigilarEntorno } from './entorno';
import { lanzarApp } from './lanzar';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';

let carpeta: string;
let app: ElectronApplication;
let page: Page;
let sitio: SandboxActivo;

test.describe.configure({ mode: 'serial', timeout: 180_000 });
vigilarEntorno(test);

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const ejecucion = () =>
  page.getByRole('list', { name: 'Ejecuciones del proyecto' }).locator(':scope > li').first();

async function agregarCredencial(
  datos: { nombre: string; rol: string; urlLogin: string } & (
    { estrategia: 'formulario'; usuario: string; secreto: string } | { estrategia: 'asistido' }
  ),
) {
  await boton('Agregar credencial').click();
  await entrada('Nombre de la credencial').fill(datos.nombre);
  await entrada('Rol').fill(datos.rol);
  await entrada('Forma de login').selectOption(datos.estrategia);
  if (datos.estrategia === 'formulario') {
    await entrada('Usuario').fill(datos.usuario);
    await entrada('Secreto').fill(datos.secreto);
    await entrada('URL de login').fill(datos.urlLogin);
  } else {
    await expect(entrada('Secreto')).toHaveCount(0);
    await entrada('URL donde se abre la ventana').fill(datos.urlLogin);
  }
  await entrada('Tipo de indicador').selectOption('aparece');
  await entrada('Valor del indicador').fill('#menu-usuario');
  await boton('Guardar credencial').click();
  await expect(page.getByRole('heading', { name: datos.nombre })).toBeVisible();
}

test.beforeAll(async () => {
  sitio = await iniciarSandbox({
    puerto: 0,
    hosts: { app: '127.0.0.1', idp: 'localhost', portal: 'localhost' },
  });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-autenticado-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await entrada('Repetí la contraseña').fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await boton('Crear bóveda').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();

  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await boton('Crear proyecto').click();
  await entrada('Nombre').fill('App del sandbox');
  await entrada('URL base').fill(`${sitio.url}/app/inicio`);
  await boton('Siguiente').click();
  await boton('Siguiente').click();
  await entrada('Solicitudes por segundo').fill('50');
  await entrada('Timeout por página (segundos)').fill('10');
  await boton('Siguiente').click();
  await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
  await boton('Crear proyecto').click();
  await expect(titulo('App del sandbox')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

test('sin credenciales, la única opción es el escaneo anónimo', async () => {
  const opciones = page.getByLabel('Iniciar sesión con').locator('option');
  await expect(opciones).toHaveText(['Sin credencial: escaneo anónimo']);
});

test('formulario: el escaneo entra con el rol elegido y nunca toca «Salir»', async () => {
  await agregarCredencial({
    nombre: 'Administración',
    rol: 'admin',
    estrategia: 'formulario',
    usuario: USUARIOS_APP.admin.usuario,
    secreto: USUARIOS_APP.admin.clave,
    urlLogin: `${sitio.url}/app/login`,
  });
  await page.getByLabel('Iniciar sesión con').selectOption({ label: 'admin · Administración' });
  await boton('Lanzar ejecución').click();
  await expect(ejecucion()).toContainText('Ejecución con el rol admin: Finalizada', {
    timeout: 120_000,
  });
  await expect(ejecucion()).toContainText(
    'Logins: 1 (0 por sesión vencida, 0 renovaciones planificadas).',
  );
  expect(sitio.autenticacion.registro.logins).toEqual([{ via: 'formulario', rol: 'admin' }]);
  expect(sitio.autenticacion.registro.rutasConSesion).toContain('/app/admin/usuarios');
  expect(sitio.autenticacion.registro.rutasConSesion).not.toContain('/app/salir');

  await boton('Ver resultado').click();
  const medios = page
    .getByRole('region', { name: 'Hallazgos de la ejecución' })
    .getByRole('region', { name: 'Hallazgos de severidad Media' });
  await expect(medios).toContainText('Parámetro sensible en la URL: token');
  await expect(medios).toContainText('/app/compartir');
  // La contraseña no aparece en la pantalla.
  expect(await page.content()).not.toContain(USUARIOS_APP.admin.clave);
});

test('asistido: avisa que se abre una ventana, espera el segundo factor y entra', async () => {
  await agregarCredencial({
    nombre: 'Con teléfono',
    rol: 'admin con segundo factor',
    estrategia: 'asistido',
    urlLogin: `${sitio.url}/app/login-push`,
  });
  await expect(page.getByText('Secreto: ninguno, entrás a mano en la ventana.')).toBeVisible();
  await page
    .getByLabel('Iniciar sesión con')
    .selectOption({ label: 'admin con segundo factor · Con teléfono' });
  await expect(page.getByText(/Se va a abrir una ventana del navegador de pruebas/)).toBeVisible();
  const temporalAntes = new Set(readdirSync(os.tmpdir()));
  await boton('Lanzar ejecución').click();

  // Señal: la ventana llegó a la pantalla del segundo factor. Mientras tanto, la app lo dice.
  await expect
    .poll(() => sitio.autenticacion.registro.segundoFactor, { timeout: 60_000 })
    .toBeGreaterThan(0);
  // El perfil de la ventana está dentro de la carpeta de la ejecución, en la de datos (ADR 018 y 028),
  // y no en el temporal del sistema.
  const perfiles = path.join(carpeta, 'QAtlas', 'perfiles');
  const [deLaEjecucion] = readdirSync(perfiles);
  expect(
    readdirSync(path.join(perfiles, deLaEjecucion ?? '')).filter((n) => n.startsWith('asistido-')),
  ).toHaveLength(1);
  expect(
    readdirSync(os.tmpdir()).filter((n) => !temporalAntes.has(n) && n.includes('asistido')),
  ).toEqual([]);
  await expect(ejecucion()).toContainText('Entrá en la ventana del navegador de pruebas');
  sitio.autenticacion.aprobarSegundoFactor();

  await expect(ejecucion()).toContainText(
    'Ejecución con el rol admin con segundo factor: Finalizada',
    { timeout: 120_000 },
  );
  expect(sitio.autenticacion.registro.logins.at(-1)).toEqual({ via: 'mfa', rol: 'admin' });
  // Al terminar, la carpeta de la ejecución se borra, con el perfil de la ventana adentro.
  await expect.poll(() => readdirSync(perfiles)).toEqual([]);
});
