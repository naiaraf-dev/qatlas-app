/**
 * El escaneo completo desde la interfaz, en la app real: progreso en vivo, hallazgos por severidad y lo
 * que no se cubrió. Sobre 127.0.0.1, sin ningún comportamiento especial para tests. Compara con el
 * oráculo, menos lo que en 127.0.0.1 no puede aparecer: el login sobre HTTP (es un contexto seguro) y el
 * contenido mixto (no hay HTTPS). Eso lo cubre `escaneo-oraculo.e2e.ts`. Requiere `npm run build`.
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
import { iniciarSandbox, type SandboxActivo } from '../apps/sandbox-site/src/servidor.mjs';
import { vigilarEntorno } from './entorno';
import { lanzarApp } from './lanzar';
import { compararConOraculo, manifiesto, resumenLegible } from './oraculo';

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

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-escaneo-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await entrada('Repetí la contraseña').fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await boton('Crear bóveda').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();

  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await boton('Crear proyecto').click();
  await entrada('Nombre').fill('Sandbox');
  await entrada('URL base').fill(`${sitio.url}/`);
  await boton('Siguiente').click();
  await entrada('Puertos locales adicionales').fill(String(sitio.puertoApi));
  await boton('Siguiente').click();
  await entrada('Solicitudes por segundo').fill('50');
  await entrada('Profundidad').fill('2');
  await entrada('Timeout por página (segundos)').fill('10');
  await boton('Siguiente').click();
  await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
  await boton('Crear proyecto').click();
  await expect(titulo('Sandbox')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

test('el progreso se ve en vivo mientras corre', async () => {
  await boton('Lanzar ejecución').click();
  // Una sola ejecución en este proyecto: la fila es esta.
  await expect(
    page.getByRole('list', { name: 'Ejecuciones del proyecto' }).locator(':scope > li'),
  ).toHaveCount(1);
  // Señal de que está en curso: el sandbox recibió el pedido de la página lenta, y lo retiene.
  await expect.poll(() => sitio.registro.rutas.includes('/lenta'), { timeout: 60_000 }).toBe(true);
  await expect(ejecucion()).toContainText(
    /Página actual: http:\/\/127\.0\.0\.1:\d+\/\S* · Páginas: \d+/,
  );
  await expect(ejecucion()).toContainText(/Hallazgos: [1-9]/);
});

test('termina, y el resumen dice lo que no cubrió', async () => {
  await expect(ejecucion()).toContainText('Ejecución: Finalizada', { timeout: 150_000 });
  const cobertura = ejecucion().getByRole('list', { name: 'Lo que no se cubrió' });
  await expect(cobertura).toContainText(/botones sin tocar por el modo solo lectura/);
  await expect(cobertura).toContainText(/links o botones excluidos/);
  await expect(cobertura).toContainText(
    /mensajes de WebSocket descartados .* No es un error del sitio/,
  );
});

test('los hallazgos se ven por severidad, y los de rendimiento avisan que son orientativos', async () => {
  await boton('Ver resultado').click();
  const resultado = page.getByRole('region', { name: 'Hallazgos de la ejecución' });
  for (const severidad of ['Crítica', 'Alta', 'Media', 'Baja', 'Informativa']) {
    await expect(
      resultado.getByRole('region', { name: `Hallazgos de severidad ${severidad}` }),
    ).toBeVisible();
  }
  const criticos = resultado.getByRole('region', { name: 'Hallazgos de severidad Crítica' });
  await expect(criticos).toContainText('La página responde 500');
  await expect(criticos).toContainText('/error-500');
  const medios = resultado.getByRole('region', { name: 'Hallazgos de severidad Media' });
  await expect(medios).toContainText('/no-existe-1 · link en /links-rotos');
  await expect(
    resultado.getByRole('listitem').filter({ hasText: 'Página lenta' }).first(),
  ).toContainText('Medición orientativa, tomada en este equipo.');
});

test('lo encontrado coincide con el oráculo, sin inesperados', async () => {
  const detalle = await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const proyectos = await qatlas.proyectos.listar();
    const proyectoId = proyectos.ok ? proyectos.data[0]?.id : undefined;
    const lista = await qatlas.ejecuciones.listar({ proyectoId: proyectoId as string });
    const id = lista.ok ? lista.data[0]?.id : undefined;
    const res = await qatlas.ejecuciones.detalle({ ejecucionId: id as string });
    return res.ok ? res.data : null;
  });
  const encontrados = (detalle?.hallazgos ?? []).map((h) => ({
    tipo: h.tipo,
    severidad: h.severidad,
    url: h.url,
    urlOrigen: h.urlOrigen,
    // La clave no viaja a la interfaz: el título y la URL alcanzan para comparar.
    clave: h.titulo.replace(/^Recurso fuera del alcance bloqueado: /, ''),
  }));
  const esperados = manifiesto.hallazgos
    .filter((h) => !h.requiere)
    .map(({ clave, ...resto }) =>
      resto.tipo === 'recurso-externo-bloqueado' && clave ? { ...resto, clave } : resto,
    );
  const comparacion = compararConOraculo(esperados, encontrados);
  const resumen = resumenLegible(comparacion);
  console.log(resumen);
  expect(comparacion.faltantes, resumen).toEqual([]);
  expect(comparacion.conOtraSeveridad, resumen).toEqual([]);
  expect(comparacion.inesperados, resumen).toEqual([]);
  expect(comparacion.enPaginasSanas, resumen).toEqual([]);
  // En solo lectura: ningún botón tocado, nada escrito, nada afuera.
  expect(sitio.registro.posts).toEqual([]);
  expect(sitio.registro.fugas).toEqual([]);
  expect(sitio.registro.trampas).toEqual([]);
});
