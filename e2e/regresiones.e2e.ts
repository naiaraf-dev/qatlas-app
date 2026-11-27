/**
 * El criterio de terminado de la fase 1: «un bug reintroducido se detecta como regresión» (CU-09, ADR 047),
 * con la app real, el escáner real y el sandbox.
 *
 * El proyecto escanea una sola página plantada (`/excepcion-js`, máximo 1 página). El test arregla y
 * reintroduce el bug desde su proceso (`sitio.arreglar`), sin endpoint HTTP:
 *
 * 1. Escaneo: el hallazgo aparece como «nuevo».
 * 2. Control: se arregla el bug, pero la ejecución recorre otra página (`/sana`): no se da por arreglado.
 * 3. Recorriendo su página, queda «posiblemente resuelto».
 * 4. La persona lo confirma como resuelto en lote, desde la bandeja.
 * 5. Control: sin reintroducirlo, un escaneo más no da regresión.
 * 6. Reintroducido: «regresión», destacada en la bandeja y en el resumen de la ejecución.
 *
 * Al final, axe sobre las tres páginas nuevas en los dos modos.
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
import {
  EXCLUSIONES_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  type ProyectoEntrada,
  type QatlasApi,
} from '@qatlas/shared';
import { iniciarSandbox, type SandboxActivo } from '../apps/sandbox-site/src/servidor.mjs';
import { elegirOpcion } from './controles';
import { vigilarEntorno } from './entorno';
import { crearBoveda, ponerTema, revisarAccesibilidad, transicionesTerminadas } from './interfaz';
import { lanzarApp } from './lanzar';
import { vigilarProcesos } from './procesos';

let carpeta: string;
let app: ElectronApplication;
let page: Page;
let sitio: SandboxActivo;
let proyectoId: string;

test.describe.configure({ mode: 'serial', timeout: 180_000 });
vigilarEntorno(test);

const FILTROS = {
  proyectoId: null,
  estados: [],
  severidades: [],
  tipos: [],
  soloRegresiones: false,
  incluirDescartados: true,
  soloSinCobertura: false,
};

const entradaCon = (inicio: string): ProyectoEntrada => ({
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Regresiones',
  descripcion: '',
  urlBase: `${sitio.url}${inicio}`,
  dominios: ['127.0.0.1'],
  puertosLocales: [],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
  dominiosAutenticacion: [],
  maxRps: 20,
  maxPaginas: 1,
  maxProfundidad: 1,
  timeoutPaginaSegundos: 10,
});

/** Crea o edita el proyecto con la API real de la app, y acepta su autorización. */
async function guardarProyecto(inicio: string): Promise<string> {
  return page.evaluate(
    async ({ entrada, id }) => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const validado = await qatlas.proyectos.validar({ proyecto: entrada, ...(id ? { id } : {}) });
      if (!validado.ok || !validado.data.declaracion) throw new Error('proyecto inválido');
      const aceptacion = { aceptada: true as const, ...validado.data.declaracion };
      if (!id) {
        const creado = await qatlas.proyectos.crear({ proyecto: entrada, aceptacion });
        if (!creado.ok || creado.data.resultado !== 'creado') throw new Error('no se creó');
        return creado.data.id;
      }
      const editado = await qatlas.proyectos.actualizar({ id, proyecto: entrada });
      if (!editado.ok || editado.data.resultado !== 'actualizado') throw new Error('no se editó');
      if (!editado.data.autorizacion.vigente) {
        const aceptada = await qatlas.proyectos.aceptarAutorizacion({ id, aceptacion });
        if (!aceptada.ok || aceptada.data.resultado !== 'aceptada')
          throw new Error('sin autorización');
      }
      return id;
    },
    { entrada: entradaCon(inicio), id: proyectoId as string | undefined },
  );
}

/** Lanza un escaneo y espera la señal: la ejecución, por su ID, terminada. */
async function escanear(): Promise<string> {
  const id = await page.evaluate(async (proyecto) => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const res = await qatlas.ejecuciones.lanzarEscaneo({
      proyectoId: proyecto,
      credencialId: null,
    });
    if (!res.ok || res.data.resultado !== 'encolada') throw new Error(JSON.stringify(res));
    return res.data.ejecucionId;
  }, proyectoId);
  await expect
    .poll(() => ejecucion(id).then((e) => e?.estado), { timeout: 90_000 })
    .toBe('finalizada');
  return id;
}

const ejecucion = (id: string) =>
  page.evaluate(
    async ({ proyecto, id: buscada }) => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const res = await qatlas.ejecuciones.listar({ proyectoId: proyecto });
      return res.ok ? (res.data.find((e) => e.id === buscada) ?? null) : null;
    },
    { proyecto: proyectoId, id },
  );

/** El hallazgo de la excepción plantada: el único de tipo error-javascript del proyecto. */
const excepcion = () =>
  page.evaluate(
    async ({ filtros, proyecto }) => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const res = await qatlas.hallazgos.listar({ ...filtros, proyectoId: proyecto });
      if (!res.ok) throw new Error('bandeja');
      const filas = res.data.filter((f) => f.tipo === 'error-javascript');
      if (filas.length > 1)
        throw new Error(`${String(filas.length)} hallazgos de la misma excepción`);
      return filas[0] ?? null;
    },
    { filtros: FILTROS, proyecto: proyectoId },
  );

const nav = () => page.getByRole('navigation', { name: 'Principal' });
const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-regresiones-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await crearBoveda(page);
  proyectoId = await guardarProyecto('/excepcion-js');
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

test('1. el primer escaneo encuentra la excepción: nuevo', { tag: ['@interfaz'] }, async () => {
  const id = await escanear();
  expect(await excepcion()).toMatchObject({ estado: 'nuevo', ocurrencias: 1 });
  expect((await ejecucion(id))?.resumen).toMatchObject({ hallazgosNuevos: 1, regresiones: 0 });
});

test(
  '2. control: arreglado, pero sin recorrer su página, no se da por arreglado',
  { tag: ['@interfaz'] },
  async () => {
    sitio.arreglar('js-excepcion');
    await guardarProyecto('/sana');
    await escanear();
    expect(sitio.registro.rutas).toContain('/sana');
    expect(await excepcion()).toMatchObject({ estado: 'nuevo' });
  },
);

test(
  '3. recorriendo su página, sin el bug: posiblemente resuelto',
  { tag: ['@interfaz'] },
  async () => {
    await guardarProyecto('/excepcion-js');
    const id = await escanear();
    expect(await excepcion()).toMatchObject({ estado: 'posiblemente_resuelto' });
    expect((await ejecucion(id))?.resumen.posiblementeResueltos).toBe(1);
  },
);

test(
  '4. la persona lo confirma como resuelto en lote, desde la bandeja',
  { tag: ['@interfaz'] },
  async () => {
    const fila = await excepcion();
    await nav().getByText('Hallazgos', { exact: true }).click();
    await expect(titulo('Hallazgos')).toBeVisible();
    await elegirOpcion(page, 'Estado', 'Posiblemente resuelto');
    const item = page.getByRole('article', { name: fila?.titulo ?? '' });
    await expect(item).toContainText('Estado: Posiblemente resuelto');
    await item.getByRole('checkbox', { name: `Seleccionar «${fila?.titulo ?? ''}»` }).check();
    await page.getByRole('button', { name: 'Confirmar como resueltos (1)' }).click();
    const dialogo = page.getByRole('alertdialog', { name: 'Confirmar como resueltos' });
    await dialogo.getByRole('button', { name: 'Confirmar' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Se confirmaron como resueltos 1 hallazgos' }),
    ).toHaveCount(1);
    expect(await excepcion()).toMatchObject({ estado: 'resuelto' });
  },
);

test('5. control: sin reintroducirlo, no hay regresión', { tag: ['@interfaz'] }, async () => {
  const id = await escanear();
  expect(await excepcion()).toMatchObject({ estado: 'resuelto' });
  expect((await ejecucion(id))?.resumen.regresiones).toBe(0);
});

test(
  '6. reintroducido: regresión, destacada en la bandeja y en el resumen',
  { tag: ['@interfaz'] },
  async () => {
    sitio.reintroducir('js-excepcion');
    const id = await escanear();
    expect(await excepcion()).toMatchObject({ estado: 'regresion', ultimaAparicion: 'regresion' });
    expect((await ejecucion(id))?.resumen.regresiones).toBe(1);

    // En la bandeja: la alerta arriba y el hallazgo marcado.
    await nav().getByText('Proyectos', { exact: true }).click();
    await nav().getByText('Hallazgos', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Regresiones' })).toContainText(
      '1 regresión: un hallazgo resuelto volvió a aparecer.',
    );
    await expect(
      page.getByText('Regresión: estaba resuelto y volvió a aparecer.').first(),
    ).toBeVisible();

    // En el resumen de la ejecución, en el proyecto.
    await nav().getByText('Ejecuciones', { exact: true }).click();
    await expect(
      page.getByRole('list', { name: 'Ejecuciones de todos los proyectos' }),
    ).toContainText('1 regresión');
  },
);

test(
  'las páginas Hallazgos, Ejecuciones y Escaneos pasan axe en los dos modos',
  { tag: ['@interfaz'] },
  async () => {
    for (const pagina of ['Hallazgos', 'Ejecuciones', 'Escaneos']) {
      await nav().getByText(pagina, { exact: true }).click();
      await expect(titulo(pagina)).toBeVisible();
      await transicionesTerminadas(page);
      for (const tema of ['Claro', 'Oscuro'] as const) {
        await ponerTema(page, tema);
        expect(await revisarAccesibilidad(page, 'main'), `${pagina}, ${tema}`).toEqual([]);
      }
    }
    await ponerTema(page, 'Claro');
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
