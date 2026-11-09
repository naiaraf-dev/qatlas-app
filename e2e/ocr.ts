/**
 * OCR para TS-06 y TS-01 (ADR 039): tesseract.js, solo en desarrollo. Los datos del idioma salen de
 * `@tesseract.js-data/eng`, fijado por versión exacta y por su hash en el lockfile; el worker corre con
 * la red bloqueada (`fixtures/ocr-sin-red.cjs`) y sin caché en disco. Nada se descarga.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createScheduler, createWorker, OEM, type Scheduler } from 'tesseract.js';

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

/**
 * Normaliza para comparar lo leído con lo buscado: mayúsculas, sin espacios ni signos, y las
 * confusiones típicas del OCR (O y 0, I, L y 1, S y 5, B y 8) llevadas a una sola forma.
 */
export function normalizar(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

/** Distancia de edición, para tolerar uno o dos caracteres mal leídos. */
function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0] ?? 0;
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const actual = fila[j] ?? 0;
      fila[j] = Math.min(
        actual + 1,
        (fila[j - 1] ?? 0) + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      anterior = actual;
    }
  }
  return fila[b.length] ?? 0;
}

/**
 * Si el texto leído contiene lo buscado, con hasta `tolerancia` caracteres distintos. Tolerar errores
 * hace que la búsqueda encuentre más, nunca menos: un falso positivo hace fallar el test, no lo aprueba.
 */
export function contiene(leido: string, buscado: string, tolerancia = 2): boolean {
  const texto = normalizar(leido);
  const aguja = normalizar(buscado);
  if (aguja.length === 0) return false;
  if (texto.includes(aguja)) return true;
  for (let inicio = 0; inicio + aguja.length - tolerancia <= texto.length; inicio++) {
    for (const largo of [aguja.length - 1, aguja.length, aguja.length + 1]) {
      const ventana = texto.slice(inicio, inicio + largo);
      if (ventana.length >= aguja.length - tolerancia && distancia(ventana, aguja) <= tolerancia) {
        return true;
      }
    }
  }
  return false;
}

/** Lee cada imagen distinta una sola vez: los fotogramas repetidos no se vuelven a leer. */
export async function leerTodas(ocr: Ocr, imagenes: readonly Buffer[]): Promise<string[]> {
  const unicas = new Map<string, Buffer>();
  for (const imagen of imagenes) {
    unicas.set(createHash('sha256').update(imagen).digest('hex'), imagen);
  }
  return Promise.all([...unicas.values()].map((imagen) => ocr.leer(imagen)));
}
