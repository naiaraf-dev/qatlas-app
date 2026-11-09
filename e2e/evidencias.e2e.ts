/**
 * Las evidencias de un escaneo, con la app en este proceso (`app-en-proceso.ts`): el navegador, el proxy y
 * el runner reales, contra el sandbox.
 *
 * - TS-06 completo: la contraseña (un canario) no aparece en ningún fotograma del video ni en ninguna
 *   captura (OCR), ni en la traza ni en el HAR, en las cuatro estrategias. El sandbox la muestra como
 *   texto en el login («mostrar contraseña» y el token en la primera vista): si el login se grabara,
 *   estaría en los fotogramas. Control positivo: un video grabado a propósito con el canario a la vista
 *   sí lo tiene, y el OCR lo encuentra.
 * - EVI-02 y EVI-05: lo que se tapa en las capturas y en el snapshot, con un control sin enmascarar.
 * - EVI-07: una página sin fallas no deja video.
 * - Punto 6: mientras corre una ejecución con video y traza, ningún archivo de la carpeta de datos, del
 *   perfil ni del temporal tiene contenido de la página en claro, ni hay imágenes o videos sin cifrar.
 */
import { randomInt } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import {
  CAMPOS_DEL_FORMULARIO,
  DATOS_SENSIBLES_DE_PRUEBA as DATOS,
  HOST_IDP,
  iniciarSandbox,
  USUARIOS_APP,
  valorDeCampo,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import { archivosCon, armar, conTemporal, enTexto, type AppEnProceso } from './app-en-proceso';
import { vigilarEntorno } from './entorno';
import { contiene, crearOcr, leerTodas, type Ocr } from './ocr';

/** Único en cada corrida y fácil de leer con OCR: letras y números grandes. */
const CANARIO = `CANARIO-TS06-${String(randomInt(100000, 999999))}`;

test.describe.configure({ mode: 'serial', timeout: 600_000 });
vigilarEntorno(test);

let sitio: SandboxActivo;
let ocr: Ocr;
const temporalDelSistema = os.tmpdir();

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, canario: CANARIO });
  ocr = await crearOcr();
});

test.afterAll(async () => {
  await ocr.cerrar();
  await sitio.cerrar();
});

/** Corre `cuerpo` con una app nueva en una carpeta propia, y la cierra y la borra al final. */
async function conApp(cuerpo: (app: AppEnProceso, raiz: string) => Promise<void>): Promise<void> {
  const raiz = mkdtempSync(path.join(temporalDelSistema, 'qatlas-evidencias-'));
  let abierta: AppEnProceso | undefined;
  try {
    await conTemporal(path.join(raiz, 'tmp'), async () => {
      const app = await armar(raiz, sitio);
      abierta = app;
      await cuerpo(app, raiz);
      expect(app.runnersTerminados()).toBe(true);
      app.boveda.bloquear();
    });
  } finally {
    abierta?.boveda.bloquear();
    rmSync(raiz, { recursive: true, force: true, maxRetries: 3 });
  }
}

const leidos = (imagenes: readonly Buffer[]) => leerTodas(ocr, imagenes);
const algunoContiene = (textos: readonly string[], buscado: string) =>
  textos.some((texto) => contiene(texto, buscado));

/** Las evidencias de la página con esa ruta en una ejecución. */
function dePagina(app: AppEnProceso, ejecucionId: string, ruta: string) {
  const pagina = app.ejecuciones
    .detalle(ejecucionId)
    ?.paginas.find((p) => new URL(p.url).pathname === ruta);
  return app.evidencias.listar(ejecucionId).filter((e) => pagina && e.paginaId === pagina.id);
}

test('TS-06: la contraseña no aparece en ningún fotograma, captura, traza ni HAR, en las cuatro estrategias', async () => {
  await conApp(async (app) => {
    const { origen, crearProyecto, credencial, ejecuciones, escanear, evidenciasDe } = app;
    const proyecto = crearProyecto('App', '/app/inicio', [HOST_IDP]);
    const ids = [
      credencial(proyecto, 'admin', 'formulario', `${origen}/app/login`, CANARIO),
      credencial(proyecto, 'admin-sso', 'sso', `${origen}/app/sso`, CANARIO),
      credencial(
        proyecto,
        'admin-enlace',
        'token-url',
        '',
        sitio.autenticacion.emitirEnlace('admin', { reutilizable: true, token: CANARIO }),
      ),
    ];
    const ejecucionesHechas: string[] = [];
    for (const id of ids) ejecucionesHechas.push(await escanear(proyecto, id));

    // El asistido: la persona escribe la contraseña en la ventana, que la muestra como texto.
    const asistido = credencial(proyecto, 'admin-asistido', 'asistido', `${origen}/app/login`);
    const lanzada = ejecuciones.lanzarEscaneo(proyecto, asistido);
    if (lanzada.resultado !== 'encolada') throw new Error(lanzada.motivo);
    await expect
      .poll(() => app.ventana()?.contexto.pages()[0]?.url() ?? '', { timeout: 60_000 })
      .toContain('/app/login');
    const ventana = app.ventana()?.contexto.pages()[0];
    if (!ventana) throw new Error('No se abrió la ventana');
    await ventana.locator('#usuario').fill(USUARIOS_APP.admin.usuario);
    await ventana.locator('#clave').fill(CANARIO);
    // Control dentro del test: en el login, la contraseña estuvo a la vista y el OCR la lee.
    const pantallaDelLogin = await ventana.screenshot({
      type: 'jpeg',
      quality: 70,
      timeout: 10_000,
    });
    expect(contiene(await ocr.leer(pantallaDelLogin), CANARIO)).toBe(true);
    await ventana.locator('button[type=submit]').click();
    await expect
      .poll(() => ejecuciones.listar(proyecto).find((e) => e.id === lanzada.ejecucionId)?.estado, {
        timeout: 240_000,
      })
      .toBe('finalizada');
    ejecucionesHechas.push(lanzada.ejecucionId);

    for (const id of ejecucionesHechas) {
      const { fotogramas, capturas, textos } = await evidenciasDe(id);
      // Hubo video, capturas, traza y HAR: el test no pasa porque no se grabó nada.
      expect(fotogramas.length, id).toBeGreaterThan(0);
      expect(capturas.length, id).toBeGreaterThan(0);
      expect(textos.map((t) => t.tipo)).toEqual(expect.arrayContaining(['traza', 'har']));
      // Entró de verdad: la traza tiene la página con sesión.
      expect(textos.find((t) => t.tipo === 'traza')?.texto).toContain('/app/informes');

      expect(enTexto(textos.map((t) => t.texto).join('\n'), CANARIO), id).toEqual([]);
      const enImagenes = await leidos([...fotogramas, ...capturas]);
      expect(algunoContiene(enImagenes, CANARIO), id).toBe(false);
    }
  });
});

test('control positivo de TS-06: un video grabado con el canario a la vista lo tiene, y el OCR lo encuentra', async () => {
  await conApp(async (app) => {
    const proyecto = app.crearProyecto('Visible', '/evidencias/visible', [], { maxPaginas: 1 });
    const id = await app.escanear(proyecto, null);
    const { fotogramas, lista } = await app.evidenciasDe(id);
    expect(lista.some((e) => e.tipo === 'video')).toBe(true);
    expect(algunoContiene(await leidos(fotogramas), CANARIO)).toBe(true);
  });
});

test('EVI-02 y EVI-07: se tapan las contraseñas y los selectores sensibles; una página sin fallas no deja video', async () => {
  await conApp(async (app) => {
    const proyecto = app.crearProyecto('Ficha', '/evidencias/', [], {
      selectoresSensibles: ['.dato-sensible'],
      maxProfundidad: 1,
    });
    const id = await app.escanear(proyecto, null);

    const ficha = dePagina(app, id, '/evidencias/ficha');
    expect(ficha.map((e) => e.tipo).sort()).toEqual(['captura', 'snapshot-dom', 'video']);
    const captura = await app.evidencias.vista(ficha.find((e) => e.tipo === 'captura')?.id ?? '');
    if (captura?.tipo !== 'imagen') throw new Error('sin captura');
    const [leido = ''] = await leidos([Buffer.from(captura.datos)]);
    // Control: el OCR lee la captura (lo que no está tapado se ve).
    expect(contiene(leido, DATOS.nombre)).toBe(true);
    expect(contiene(leido, DATOS.nota)).toBe(true);
    for (const dato of [DATOS.documento, DATOS.email, DATOS.telefono]) {
      expect(contiene(leido, dato), dato).toBe(false);
    }

    // El snapshot: texto, con lo sensible vaciado.
    const snapshot = await app.evidencias.vista(
      ficha.find((e) => e.tipo === 'snapshot-dom')?.id ?? '',
    );
    if (snapshot?.tipo !== 'texto') throw new Error('sin snapshot');
    expect(snapshot.texto).toContain(DATOS.nombre);
    expect(snapshot.texto).toContain('[ENMASCARADO]');
    for (const dato of [DATOS.documento, DATOS.email, DATOS.telefono, DATOS.clave, DATOS.oculto]) {
      expect(snapshot.texto, dato).not.toContain(dato);
    }
    expect(snapshot.texto).not.toMatch(/<script>[^<]/);

    // EVI-07: la página sin fallas no tiene video ni captura.
    expect(dePagina(app, id, '/evidencias/limpia')).toEqual([]);
  });
});

test('control de EVI-02: sin selectores sensibles, el OCR lee el documento en la captura', async () => {
  await conApp(async (app) => {
    const proyecto = app.crearProyecto('Sin selectores', '/evidencias/ficha', [], {
      maxPaginas: 1,
    });
    const id = await app.escanear(proyecto, null);
    const { capturas } = await app.evidenciasDe(id);
    expect(algunoContiene(await leidos(capturas), DATOS.documento)).toBe(true);
  });
});

test('EVI-05: con el modo datos sensibles, sin video ni snapshots, y todos los campos tapados', async () => {
  await conApp(async (app) => {
    const proyecto = app.crearProyecto('Sensible', '/evidencias/', [], {
      modoDatosSensibles: true,
      maxProfundidad: 1,
    });
    const id = await app.escanear(proyecto, null);
    const { lista, capturas, textos } = await app.evidenciasDe(id);
    expect(lista.some((e) => e.tipo === 'video' || e.tipo === 'snapshot-dom')).toBe(false);
    expect(lista.filter((e) => e.tipo === 'captura').every((e) => e.modoSensible)).toBe(true);
    expect(capturas.length).toBeGreaterThanOrEqual(2);
    const enCapturas = await leidos(capturas);
    // Control: la captura se lee.
    expect(algunoContiene(enCapturas, DATOS.nombre)).toBe(true);
    expect(algunoContiene(enCapturas, DATOS.nota)).toBe(false);
    for (let n = 1; n <= CAMPOS_DEL_FORMULARIO; n++) {
      expect(algunoContiene(enCapturas, valorDeCampo(n)), valorDeCampo(n)).toBe(false);
    }
    expect(textos.find((t) => t.tipo === 'traza')?.texto).not.toContain('"clase":"snapshot"');
  });
});

/** Las firmas de los formatos de imagen y video, y lo que deja la grabación de Playwright. */
const IMAGEN_O_VIDEO = /\.(png|jpe?g|webm|mp4|trace|har|network)$/i;
function esImagenOVideo(ruta: string): boolean {
  if (IMAGEN_O_VIDEO.test(ruta)) return true;
  try {
    const inicio = readFileSync(ruta).subarray(0, 8);
    return (
      (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) ||
      inicio.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
      inicio.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    );
  } catch {
    return false;
  }
}

function archivos(carpeta: string, desde = 0): string[] {
  const salida: string[] = [];
  const recorrer = (actual: string) => {
    let nombres: string[];
    try {
      nombres = readdirSync(actual);
    } catch {
      return;
    }
    for (const nombre of nombres) {
      const ruta = path.join(actual, nombre);
      try {
        const info = statSync(ruta);
        if (info.isDirectory()) recorrer(ruta);
        else if (info.mtimeMs >= desde) salida.push(ruta);
      } catch {
        // Se borró mientras se miraba.
      }
    }
  };
  recorrer(carpeta);
  return salida;
}

test('punto 6: mientras corre con video y traza, nada de la página queda en claro en ningún archivo', async () => {
  await conApp(async (app, raiz) => {
    const proyecto = app.crearProyecto('En claro', '/evidencias/', [], {
      selectoresSensibles: ['.dato-sensible'],
      maxProfundidad: 1,
    });
    const inicio = Date.now() - 1000;
    const marcas = [DATOS.nombre, DATOS.nota, DATOS.documento, valorDeCampo(7)];
    const hallado = new Set<string>();
    // Lo que sea del sistema y no del test: del temporal del sistema solo se mira lo nuevo, y solo
    // contenido de la página o restos de la grabación de Playwright.
    const mirar = () => {
      for (const carpeta of [app.datos, app.temporal]) {
        for (const ruta of archivos(carpeta)) {
          if (esImagenOVideo(ruta)) hallado.add(`imagen o video: ${path.relative(raiz, ruta)}`);
        }
        for (const marca of marcas) {
          for (const ruta of archivosCon(carpeta, marca)) hallado.add(`${marca} en ${ruta}`);
        }
      }
      for (const ruta of archivos(temporalDelSistema, inicio)) {
        if (ruta.startsWith(raiz)) continue;
        if (/playwright-artifacts|\.webm$|\.trace$/.test(ruta)) hallado.add(`temporal: ${ruta}`);
        try {
          const contenido = readFileSync(ruta);
          for (const marca of marcas) {
            if (contenido.includes(Buffer.from(marca))) hallado.add(`temporal con ${marca}`);
          }
        } catch {
          // Un archivo de otro proceso, abierto o ya borrado.
        }
      }
    };
    const lanzada = app.ejecuciones.lanzarEscaneo(proyecto, null);
    if (lanzada.resultado !== 'encolada') throw new Error(lanzada.motivo);
    let vueltas = 0;
    let terminada = false;
    while (!terminada) {
      mirar();
      vueltas += 1;
      const estado = app.ejecuciones
        .listar(proyecto)
        .find((e) => e.id === lanzada.ejecucionId)?.estado;
      terminada = estado === 'finalizada' || estado === 'fallida' || estado === 'cancelada';
      await new Promise((listo) => setTimeout(listo, 100));
    }
    mirar();
    // Se miró de verdad mientras corría, y la ejecución grabó: hay video y capturas cifrados.
    expect(vueltas).toBeGreaterThan(5);
    const { lista } = await app.evidenciasDe(lanzada.ejecucionId);
    expect(lista.map((e) => e.tipo)).toEqual(
      expect.arrayContaining(['video', 'captura', 'traza', 'har']),
    );
    expect([...hallado]).toEqual([]);
  });
});

test('control del punto 6: la traza de Playwright sí deja la página en claro, y la búsqueda la encuentra', async () => {
  // Lo que QAtlas no usa: la grabación de Playwright escribe mientras graba (ADR 036 y 037).
  const carpeta = mkdtempSync(path.join(temporalDelSistema, 'qatlas-control-traza-'));
  const navegador = await chromium.launch({ tracesDir: carpeta });
  try {
    const contexto = await navegador.newContext();
    // Con la traza de Playwright Test activa, ya está empezada y escribe en el mismo `tracesDir`.
    await contexto.tracing.start({ snapshots: true }).catch(() => undefined);
    const pagina = await contexto.newPage();
    await pagina.goto(`${sitio.url}/evidencias/ficha`, { timeout: 10_000 });
    await expect(pagina.getByText(DATOS.nombre)).toBeVisible({ timeout: 10_000 });
    // Sin parar la traza: lo que hay en disco mientras graba.
    expect(archivos(carpeta).some(esImagenOVideo)).toBe(true);
    expect(archivosCon(carpeta, DATOS.nombre).length).toBeGreaterThan(0);
  } finally {
    await navegador.close();
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
  }
});
