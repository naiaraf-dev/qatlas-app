/**
 * Reportes de bug y exportación guiada en la app real (3.9, CU-05, ADR 048), con el escáner real y el sandbox:
 *
 * 1. Desde Hallazgos se crea un reporte; el texto que la persona escribe pasa por la redacción (TS-01): el
 *    secreto de una credencial del proyecto no sale en el Markdown ni en el ZIP. Control: un testigo escrito
 *    en el mismo campo sí sale.
 * 2. La vista previa dice «Este archivo no está cifrado»; con alertas, exportar pide confirmación
 *    (RN-REP-03). Una carpeta sincronizada avisa, y cancelar no escribe nada.
 * 3. TS-14: el PDF real de `printToPDF` sale sin software de origen, sin fechas ni título, y solo con las
 *    fuentes empaquetadas. Control: el mismo `printToPDF` sin la limpieza sí dice Skia y Chromium.
 *    El ZIP lleva nombres por ID y las capturas sin metadatos.
 * 4. Captura anotada: lo tapado no lo lee el OCR en la imagen exportada, que sí muestra el testigo; el
 *    archivo no tiene metadatos ni capas. Control: la misma captura sin tapar sí muestra el dato.
 * 5. axe sobre la lista y el editor, en los dos modos.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import {
  DATOS_SENSIBLES_DE_PRUEBA,
  iniciarSandbox,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import { problemasDeMetadatos } from '../apps/desktop/src/main/reportes/pdf-limpieza';
import { fuentesDelPdf } from '../apps/desktop/src/main/reportes/plantillas';
import { chunksDePng, decodificarPng } from '../apps/desktop/src/main/reportes/png';
import { leerZip } from '../apps/desktop/src/main/reportes/zip';
import { elegirOpcion } from './controles';
import { vigilarEntorno } from './entorno';
import { crearBoveda, ponerTema, revisarAccesibilidad, transicionesTerminadas } from './interfaz';
import { lanzarApp } from './lanzar';
import { contiene, crearOcr, esperarSinSecretos } from './ocr';
import { TESTIGO_OCR } from '../apps/sandbox-site/src/testigo.mjs';
import { vigilarProcesos } from './procesos';

let carpeta: string;
let app: ElectronApplication;
let page: Page;
let sitio: SandboxActivo;
let proyectoId: string;

// Inventados y armados por partes: el canario es el secreto de una credencial del proyecto.
const CANARIO = ['canario', 'reporte', '7Kq2', 'Zx91', 'Lm40'].join('-');
const TESTIGO = ['TESTIGO', 'REPORTE', '5531'].join('-');

test.describe.configure({ mode: 'serial', timeout: 240_000 });
vigilarEntorno(test);

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const nav = () => page.getByRole('navigation', { name: 'Principal' });
const campo = (etiqueta: string) =>
  page.getByLabel(etiqueta, { exact: true }).and(page.locator('input, textarea'));
const estado = (texto: string | RegExp) => page.getByRole('status').filter({ hasText: texto });

const FILTROS = {
  proyectoId: null,
  estados: [],
  severidades: [],
  tipos: [],
  soloRegresiones: false,
  incluirDescartados: false,
  soloSinCobertura: false,
};

const entrada = (): ProyectoEntrada => ({
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Reportes',
  descripcion: '',
  urlBase: `${sitio.url}/evidencias/`,
  dominios: ['127.0.0.1'],
  puertosLocales: [],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
  dominiosAutenticacion: [],
  maxRps: 10,
  maxPaginas: 4,
  maxProfundidad: 1,
  timeoutPaginaSegundos: 10,
});

/** Lo que el diálogo nativo devolvería: la ruta nace en el proceso principal, nunca en la interfaz. */
async function simularDestino(ruta: string, aceptaSincronizada = true): Promise<void> {
  await app.evaluate(
    ({ dialog }, { destino, acepta }) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: destino });
      dialog.showMessageBox = () =>
        Promise.resolve({ response: acepta ? 1 : 0, checkboxChecked: false });
    },
    { destino: ruta, acepta: aceptaSincronizada },
  );
}

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-reportes-'));
  mkdirSync(path.join(carpeta, 'salida'));
  ({ app, page } = await lanzarApp(electron, carpeta));
  await crearBoveda(page);
  proyectoId = await page.evaluate(
    async ({ proyecto, secreto, login }) => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const validado = await qatlas.proyectos.validar({ proyecto });
      if (!validado.ok || !validado.data.declaracion) throw new Error('proyecto inválido');
      const creado = await qatlas.proyectos.crear({
        proyecto,
        aceptacion: { aceptada: true, ...validado.data.declaracion },
      });
      if (!creado.ok || creado.data.resultado !== 'creado') throw new Error('no se creó');
      const credencial = await qatlas.credenciales.guardar({
        proyectoId: creado.data.id,
        nombre: 'Prueba',
        rol: 'admin',
        estrategia: 'formulario',
        usuario: 'ana@example.com',
        urlLogin: login,
        pasosLogin: [{ accion: 'click', selector: 'button' }],
        indicadorExito: { tipo: 'aparece', selector: '#panel' },
        secreto,
      });
      if (!credencial.ok || credencial.data.resultado !== 'guardada')
        throw new Error('sin credencial');
      const lanzada = await qatlas.ejecuciones.lanzarEscaneo({
        proyectoId: creado.data.id,
        credencialId: null,
      });
      if (!lanzada.ok || lanzada.data.resultado !== 'encolada') throw new Error('no se lanzó');
      return creado.data.id;
    },
    { proyecto: entrada(), secreto: CANARIO, login: `${sitio.url}/login` },
  );
  // La señal: la ejecución del proyecto, terminada.
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const { qatlas } = window as unknown as { qatlas: QatlasApi };
          const res = await qatlas.ejecuciones.listar({ proyectoId: id });
          return res.ok ? res.data[0]?.estado : undefined;
        }, proyectoId),
      { timeout: 120_000 },
    )
    .toBe('finalizada');
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

const salida = (nombre: string) => path.join(carpeta, 'salida', nombre);

test(
  'desde Hallazgos se crea el reporte, y lo que se escribe pasa por la redacción',
  { tag: ['@interfaz', '@seguridad', '@lento'] },
  async () => {
    await nav().getByText('Hallazgos', { exact: true }).click();
    await expect(titulo('Hallazgos')).toBeVisible();
    const fila = page
      .getByRole('listitem')
      .filter({ hasText: '/evidencias/ficha' })
      .filter({ has: page.getByRole('button', { name: /^Crear un reporte con «/ }) })
      .first();
    await fila.getByRole('button', { name: /^Crear un reporte con «/ }).click();
    await expect(titulo('Reporte de bug')).toBeVisible();
    await expect(campo('Pasos para reproducir')).toHaveValue(/\/evidencias\/ficha/);

    await campo('Resultado obtenido').fill(`Se ve ${TESTIGO} y la clave ${CANARIO} en pantalla.`);
    await boton('Guardar').click();
    await expect(page.getByText(/El detector tapó \d+ posibles secretos/)).toBeVisible();
    // Lo guardado vuelve redactado: la persona ve qué se tapó.
    await expect(campo('Resultado obtenido')).not.toHaveValue(new RegExp(CANARIO));
    await expect(campo('Resultado obtenido')).toHaveValue(new RegExp(TESTIGO));
  },
);

test(
  'ZIP y Markdown: no está cifrado, confirmación de alertas, nombres por ID, y sin el canario (TS-01)',
  { tag: ['@interfaz', '@seguridad', '@lento'] },
  async () => {
    await elegirOpcion(page, 'Formato', 'ZIP sin cifrar (Markdown con las capturas)');
    await boton('Ver exactamente qué sale').click();
    const vista = page.getByRole('region', { name: 'Vista previa' });
    await expect(vista.getByText('Este archivo no está cifrado.')).toBeVisible();
    await expect(vista.getByText(/paquete cifrado \(\.qatlas-paquete\)/)).toBeVisible();
    await expect(campo('Texto del reporte, tal como sale')).not.toHaveValue(new RegExp(CANARIO));

    // RN-REP-03: con alertas sin revisar, exportar espera la confirmación.
    await expect(boton('Exportar…')).toBeDisabled();
    await page
      .getByRole('checkbox', {
        name: 'Revisé las redacciones y las alertas, y quiero exportar igual',
      })
      .check();

    // Una carpeta sincronizada avisa; con «Cancelar», no se escribe nada.
    const sincronizada = path.join(carpeta, 'salida', 'OneDrive', 'reporte.zip');
    await simularDestino(sincronizada, false);
    await boton('Exportar…').click();
    await expect(estado('Se canceló: no se guardó ningún archivo.')).toBeVisible();
    expect(existsSync(sincronizada)).toBe(false);

    await simularDestino(salida('reporte.zip'));
    await boton('Exportar…').click();
    await expect(estado(/Se exportó el reporte/)).toBeVisible();
    const entradas = leerZip(readFileSync(salida('reporte.zip')));
    const nombres = entradas.map((e) => e.nombre);
    expect(nombres.slice(0, 2)).toEqual(['reporte.md', 'leeme.txt']);
    const capturas = nombres.slice(2);
    expect(capturas.length).toBeGreaterThan(0);
    for (const nombre of capturas) expect(nombre).toMatch(/^evidencias\/[0-9a-f-]{36}\.png$/);
    for (const e of entradas.filter((x) => x.nombre.endsWith('.png'))) {
      expect(chunksDePng(Buffer.from(e.datos))).toEqual(['IHDR', 'IDAT', 'IEND']);
    }
    const markdown = Buffer.from(entradas[0]?.datos ?? []).toString('utf8');
    expect(markdown).toContain(TESTIGO);
    expect(markdown).not.toContain(CANARIO);
    for (const e of entradas)
      expect(Buffer.from(e.datos).toString('latin1')).not.toContain(CANARIO);

    await elegirOpcion(page, 'Formato', 'Markdown (solo texto)');
    await boton('Ver exactamente qué sale').click();
    await page
      .getByRole('checkbox', {
        name: 'Revisé las redacciones y las alertas, y quiero exportar igual',
      })
      .check();
    await simularDestino(salida('reporte.md'));
    await boton('Exportar…').click();
    await expect(estado(/Se exportó el reporte/)).toBeVisible();
    const texto = readFileSync(salida('reporte.md'), 'utf8');
    expect(texto).toContain(TESTIGO);
    expect(texto).not.toContain(CANARIO);
    // El Markdown suelto no lleva imágenes: solo el ZIP.
    expect(texto).not.toMatch(/!\[/);
  },
);

test(
  'TS-14: el PDF real sale sin software de origen, fechas ni título, y con las fuentes empaquetadas',
  { tag: ['@seguridad', '@lento'] },
  async () => {
    // Control: el mismo printToPDF, sin la limpieza, dice quién lo hizo.
    const crudo = await app.evaluate(async ({ BrowserWindow }) => {
      const ventana = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
      });
      try {
        // Texto con una fuente del sistema, para el control de las fuentes.
        await ventana.loadURL(
          'data:text/html;charset=utf-8,<p style="font-family:Arial">Control</p>',
        );
        return Buffer.from(await ventana.webContents.printToPDF({})).toString('latin1');
      } finally {
        ventana.destroy();
      }
    });
    expect(crudo).toMatch(/Skia/);
    expect(problemasDeMetadatos(Buffer.from(crudo, 'latin1')).length).toBeGreaterThan(0);
    const delSistema = fuentesDelPdf(Buffer.from(crudo, 'latin1'));
    expect(delSistema.length, 'control: el PDF crudo tiene fuentes').toBeGreaterThan(0);
    expect(
      delSistema.some((f) => !/^(QAtlas|Inter|JetBrains)/.test(f)),
      'control: una del sistema',
    ).toBe(true);

    await elegirOpcion(page, 'Formato', 'PDF');
    await boton('Ver exactamente qué sale').click();
    await page
      .getByRole('checkbox', {
        name: 'Revisé las redacciones y las alertas, y quiero exportar igual',
      })
      .check();
    await simularDestino(salida('reporte.pdf'));
    await boton('Exportar…').click();
    await expect(estado(/Se exportó el reporte/)).toBeVisible({ timeout: 60_000 });
    const pdf = readFileSync(salida('reporte.pdf'));
    const latin1 = pdf.toString('latin1');
    expect(latin1.startsWith('%PDF-')).toBe(true);
    expect(problemasDeMetadatos(pdf)).toEqual([]);
    expect(latin1).not.toMatch(/Skia|Chromium|Electron|QAtlas Reporte/);
    expect(latin1).not.toMatch(/\/(CreationDate|ModDate|Producer|Creator|Title)\s*\(\S/);
    const fuentes = fuentesDelPdf(pdf);
    expect(fuentes.length).toBeGreaterThan(0);
    for (const fuente of fuentes) expect(fuente).toMatch(/^(QAtlas|Inter|JetBrains)/);
  },
);

test(
  'captura anotada: el OCR no lee lo tapado, sí el testigo; sin metadatos (control: sin tapar se lee)',
  { tag: ['@seguridad', '@ocr', '@lento'] },
  async () => {
    const dato = DATOS_SENSIBLES_DE_PRUEBA.nombre;
    await page.getByRole('button', { name: 'Anotar y exportar esta captura…' }).first().click();
    const anotador = page.getByRole('region', { name: 'Anotador de la captura' });
    const lienzo = anotador.getByRole('img', { name: /Captura con \d+ anotaciones/ });
    await expect
      .poll(() => lienzo.evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(300);
    const { ancho, alto } = await lienzo.evaluate((c: HTMLCanvasElement) => ({
      ancho: c.width,
      alto: c.height,
    }));
    // Se tapa todo menos la esquina del testigo (arriba a la derecha): el dato queda tapado.
    const libreAncho = Math.round(ancho * 0.35);
    const libreAlto = Math.min(120, Math.round(alto * 0.15));
    for (const recuadro of [
      { x: 0, y: 0, ancho: ancho - libreAncho, alto },
      { x: ancho - libreAncho, y: libreAlto, ancho: libreAncho, alto: alto - libreAlto },
    ]) {
      await campo('Desde la izquierda').fill(String(recuadro.x));
      await campo('Desde arriba').fill(String(recuadro.y));
      await campo('Ancho').fill(String(recuadro.ancho));
      await campo('Alto').fill(String(recuadro.alto));
      await anotador.getByRole('button', { name: 'Agregar tapado' }).click();
    }
    await expect(
      anotador.getByRole('list', { name: 'Anotaciones' }).getByRole('listitem'),
    ).toHaveCount(2);
    await simularDestino(salida('anotada.png'));
    await anotador.getByRole('button', { name: 'Exportar la captura anotada…' }).click();
    await expect(estado(/Se exportó la captura anotada/)).toBeVisible();

    const anotada = readFileSync(salida('anotada.png'));
    // Sin capas ni metadatos: solo la imagen.
    expect(chunksDePng(anotada)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const imagen = decodificarPng(anotada);
    expect([imagen.ancho, imagen.alto]).toEqual([ancho, alto]);
    const centro = (Math.floor(alto / 2) * ancho + Math.floor(ancho / 4)) * 4;
    expect([...imagen.datos.subarray(centro, centro + 4)]).toEqual([0, 0, 0, 255]);

    const ocr = await crearOcr();
    try {
      await esperarSinSecretos(ocr, [anotada], [dato], 'reportes-anotada');
      // Control: la misma captura, exportada sin tapar, sí muestra el dato y el testigo.
      await simularDestino(salida('control.png'));
      await page.evaluate(async () => {
        const { qatlas } = window as unknown as { qatlas: QatlasApi };
        const lista = await qatlas.reportes.listar({ proyectoId: null });
        const reporteId = lista.ok ? (lista.data[0]?.id ?? '') : '';
        const reporte = await qatlas.reportes.obtener({ reporteId });
        const captura = reporte.ok
          ? reporte.data?.evidencias.find((e) => e.clase === 'captura')
          : undefined;
        const vista = await qatlas.evidencias.obtenerVista({ evidenciaId: captura?.id ?? '' });
        if (!captura || !vista.ok || vista.data?.tipo !== 'imagen') throw new Error('sin imagen');
        await qatlas.reportes.exportarCaptura({
          reporteId,
          evidenciaId: captura.id,
          imagen: vista.data.datos,
          tapados: [],
        });
      });
      const leido = await ocr.leer(readFileSync(salida('control.png')));
      expect(contiene(leido, TESTIGO_OCR), 'control: el testigo').toBe(true);
      expect(contiene(leido, dato), 'control: el dato sin tapar').toBe(true);
    } finally {
      await ocr.cerrar();
    }
  },
);

test(
  'la lista y el editor de reportes pasan axe en los dos modos',
  // @lento: necesita el escaneo del beforeAll, y así va a la misma parte que el resto del archivo.
  { tag: ['@interfaz', '@lento'] },
  async () => {
    // Prepara su propio estado: no depende de que otro test haya dejado un reporte o el editor abierto.
    const reporteId = await page.evaluate(async (filtros) => {
      const { qatlas } = window as unknown as { qatlas: QatlasApi };
      const lista = await qatlas.reportes.listar({ proyectoId: null });
      const existente = lista.ok ? lista.data[0]?.id : undefined;
      if (existente) return existente;
      const hallazgos = await qatlas.hallazgos.listar(filtros);
      const reportable = hallazgos.ok
        ? hallazgos.data.find((h) => !['descartado', 'resuelto'].includes(h.estado))
        : undefined;
      if (!reportable) throw new Error('sin hallazgos para reportar');
      const creado = await qatlas.reportes.crear({ hallazgoIds: [reportable.id] });
      if (!creado.ok || creado.data.resultado !== 'creado') throw new Error('no se creó');
      return creado.data.reporteId;
    }, FILTROS);

    await nav().getByText('Reportes', { exact: true }).click();
    await expect(titulo('Reportes')).toBeVisible();
    const fila = page
      .getByRole('list', { name: 'Reportes de bug' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Abrir «/ }) });
    await expect(fila).toHaveCount(1);
    await transicionesTerminadas(page);
    for (const tema of ['Claro', 'Oscuro'] as const) {
      await ponerTema(page, tema);
      expect(await revisarAccesibilidad(page, 'main'), `lista, ${tema}`).toEqual([]);
    }

    await fila.getByRole('button', { name: /^Abrir «/ }).click();
    await expect(titulo('Reporte de bug')).toBeVisible();
    expect(reporteId).toMatch(/^[0-9a-f-]{36}$/);
    await transicionesTerminadas(page);
    for (const tema of ['Claro', 'Oscuro'] as const) {
      await ponerTema(page, tema);
      expect(await revisarAccesibilidad(page, 'main'), `editor, ${tema}`).toEqual([]);
    }
    await ponerTema(page, 'Claro');
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
