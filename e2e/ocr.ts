/**
 * OCR para TS-06 y TS-01 (ADR 039): tesseract.js, solo en desarrollo. Los datos del idioma salen de
 * `@tesseract.js-data/eng`, fijado por versión exacta y por su hash en el lockfile; el worker corre con
 * la red bloqueada (`fixtures/ocr-sin-red.cjs`) y sin caché en disco. Nada se descarga.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import { createScheduler, createWorker, OEM, type Scheduler } from 'tesseract.js';
import { TESTIGO_OCR } from '../apps/sandbox-site/src/servidor.mjs';
import { opcionesChromium } from '../packages/runner/src/motor/opciones-chromium';
import { veredicto, type Veredicto } from './ocr-texto';

const requerir = createRequire(import.meta.url);

/** Los datos del idioma, del paquete fijado. LSTM entero: el modelo por defecto de tesseract.js. */
export const RUTA_IDIOMA = path.join(
  path.dirname(requerir.resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int',
);
const TRABAJADOR = path.join(import.meta.dirname, 'fixtures', 'ocr-sin-red.cjs');

export interface Ocr {
  leer: (imagen: Buffer) => Promise<string>;
  cerrar: () => Promise<void>;
}

/**
 * `langPath`: sin pasarlo, tesseract.js descarga los datos de un CDN. Solo el test de la descarga
 * bloqueada lo deja vacío.
 */
export async function crearOcr({
  trabajadores = 2,
  langPath = RUTA_IDIOMA,
}: { trabajadores?: number; langPath?: string } = {}): Promise<Ocr> {
  const planificador: Scheduler = createScheduler();
  try {
    for (let i = 0; i < trabajadores; i++) {
      // Con `errorHandler`, tesseract.js 7 no rechaza `createWorker` cuando falla la carga: se queda
      // esperando. Sin él, tira el error dentro de un evento y corta el proceso. Así falla bien.
      let rechazar: (error: Error) => void = () => undefined;
      const fallo = new Promise<never>((_, r) => {
        rechazar = r;
      });
      const trabajador = await Promise.race([
        createWorker('eng', OEM.LSTM_ONLY, {
          workerPath: TRABAJADOR,
          ...(langPath ? { langPath } : {}),
          cacheMethod: 'none',
          gzip: true,
          logger: () => undefined,
          errorHandler: (error: unknown) => {
            rechazar(new Error(`ocr: ${String(error)}`));
          },
        }),
        fallo,
      ]);
      planificador.addWorker(trabajador);
    }
  } catch (error) {
    await planificador.terminate();
    throw error;
  }
  return {
    leer: async (imagen) => {
      const { data } = await planificador.addJob('recognize', imagen);
      return data.text;
    },
    cerrar: async () => {
      await planificador.terminate();
    },
  };
}

// La comparación y el testigo viven en un módulo sin tesseract, que se prueba con Vitest.
export { contiene, normalizar } from './ocr-texto';

/** Lee cada imagen distinta una sola vez: los fotogramas repetidos no se vuelven a leer. */
export async function leerTodas(ocr: Ocr, imagenes: readonly Buffer[]): Promise<string[]> {
  const unicas = new Map<string, Buffer>();
  for (const imagen of imagenes) {
    unicas.set(createHash('sha256').update(imagen).digest('hex'), imagen);
  }
  return Promise.all([...unicas.values()].map((imagen) => ocr.leer(imagen)));
}

/** Las imágenes distintas, una vez cada una (los fotogramas se repiten mucho). */
function unicas(imagenes: readonly Buffer[]): Buffer[] {
  const mapa = new Map<string, Buffer>();
  for (const imagen of imagenes)
    mapa.set(createHash('sha256').update(imagen).digest('hex'), imagen);
  return [...mapa.values()];
}

/**
 * Si cada imagen es de un solo color (una página en blanco mientras navega): no puede tener texto. La
 * decodifica el Chromium verificado, sin dependencias nuevas. Un píxel de cada cuatro alcanza.
 */
export async function uniformes(imagenes: readonly Buffer[]): Promise<boolean[]> {
  const navegador = await chromium.launch(opcionesChromium());
  try {
    const pagina = await navegador.newPage();
    const salida: boolean[] = [];
    for (const imagen of imagenes) {
      salida.push(
        await pagina.evaluate(async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const mapa = await createImageBitmap(new Blob([bytes]));
          const lienzo = new OffscreenCanvas(mapa.width, mapa.height);
          const contexto = lienzo.getContext('2d');
          if (!contexto) return false;
          contexto.drawImage(mapa, 0, 0);
          const { data } = contexto.getImageData(0, 0, mapa.width, mapa.height);
          let minimo = 255;
          let maximo = 0;
          for (let i = 0; i < data.length; i += 16) {
            const luz =
              ((data[i] ?? 0) * 299 + (data[i + 1] ?? 0) * 587 + (data[i + 2] ?? 0) * 114) / 1000;
            minimo = Math.min(minimo, luz);
            maximo = Math.max(maximo, luz);
          }
          return maximo - minimo < 24;
        }, imagen.toString('base64')),
      );
    }
    return salida;
  } finally {
    await navegador.close();
  }
}

/**
 * «Ningún secreto en estas imágenes», con testigo: cada imagen con algo dibujado tiene que mostrar
 * `TESTIGO_OCR` leído por el OCR. Si alguna no lo muestra, o ninguna se pudo comprobar, falla como «no
 * se pudo comprobar». Si falla, adjunta esas imágenes y lo que leyó (quedan en el artifact del CI).
 */
export async function esperarSinSecretos(
  ocr: Ocr,
  imagenes: readonly Buffer[],
  secretos: readonly string[],
  nombre: string,
): Promise<Veredicto> {
  const distintas = unicas(imagenes);
  const [textos, vacias] = await Promise.all([
    Promise.all(distintas.map((imagen) => ocr.leer(imagen))),
    uniformes(distintas),
  ]);
  const lecturas = textos.map((texto, i) => ({ texto, uniforme: vacias[i] ?? false }));
  const resultado = veredicto(lecturas, secretos, TESTIGO_OCR);
  if (resultado.resultado !== 'limpio') {
    const info = test.info();
    const problema = [...resultado.porClase['con-secreto'], ...resultado.porClase['sin-testigo']];
    // Como archivos en la carpeta del test: test-results es lo que el CI sube si falla.
    for (const i of problema.slice(0, 20)) {
      const imagen = info.outputPath(`${nombre}-imagen-${String(i)}.png`);
      const lectura = info.outputPath(`${nombre}-lectura-${String(i)}.txt`);
      writeFileSync(imagen, distintas[i] ?? Buffer.alloc(0));
      writeFileSync(lectura, lecturas[i]?.texto ?? '');
      await info.attach(`${nombre}-imagen-${String(i)}`, { path: imagen });
      await info.attach(`${nombre}-lectura-${String(i)}.txt`, { path: lectura });
    }
  }
  const resumen = `${nombre}: ${String(resultado.porClase.comprobada.length)} comprobadas, ${String(resultado.porClase.vacia.length)} vacías, ${String(resultado.porClase['sin-testigo'].length)} sin testigo, ${String(resultado.porClase['con-secreto'].length)} con un secreto`;
  expect(resultado.resultado, resumen).toBe('limpio');
  return resultado;
}
