import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crearCifradorArchivo, crearDescifradorArchivo } from '@qatlas/crypto';

/**
 * Los archivos de las evidencias (ADR 035): siempre cifrados, en streaming, con un nombre aleatorio y en
 * una carpeta plana dentro de la carpeta de datos. Ningún byte en claro llega al disco: el cifrador está
 * antes que el archivo, también para lo que todavía no se decidió si se conserva.
 *
 * Sin Electron, para probarlo con Vitest.
 */

const EXTENSION = '.qev';
const NOMBRE_VALIDO = /^[0-9a-f]{32}\.qev$/;

export const carpetaEvidencias = (carpetaDatos: string): string =>
  path.join(carpetaDatos, 'evidencias');

/** Aleatorio: el nombre no dice de qué proyecto, ejecución ni tipo es. */
export const nombreAleatorio = (): string => `${randomBytes(16).toString('hex')}${EXTENSION}`;

function rutaDe(carpeta: string, nombre: string): string {
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error('nombre-invalido');
  return path.join(carpeta, nombre);
}

export interface Escritor {
  readonly archivo: string;
  /** Bytes en claro recibidos hasta ahora. */
  readonly bytes: number;
  /** Respeta la contrapresión del disco: se resuelve cuando hay lugar. */
  escribir: (datos: Buffer) => Promise<void>;
  /** Cierra el archivo con su bloque final. Recién ahí es válido. */
  terminar: () => Promise<void>;
  /** Corta y borra el archivo. Sin la semilla guardada, lo que quede es ilegible. */
  descartar: () => void;
}

/**
 * Un archivo nuevo, cifrado con la clave del proyecto y la semilla de la evidencia. El cifrador se crea
 * enseguida dentro de `conClave`, que puede borrar la clave al volver.
 */
export function crearEscritor(
  carpeta: string,
  conClave: <T>(uso: (clave: Buffer) => T) => T,
  evidenciaId: string,
  semilla: Buffer,
): Escritor {
  mkdirSync(carpeta, { recursive: true, mode: 0o700 });
  const archivo = nombreAleatorio();
  const ruta = rutaDe(carpeta, archivo);
  const cifrador = conClave((clave) => crearCifradorArchivo(clave, evidenciaId, semilla));
  const destino = createWriteStream(ruta, { flags: 'wx', mode: 0o600 });
  // Un error después de descartar (por ejemplo, la carpeta ya no está) no tiene a quién avisar.
  cifrador.on('error', () => undefined);
  destino.on('error', () => undefined);
  const tuberia = pipeline(cifrador, destino);
  tuberia.catch(() => undefined);
  let bytes = 0;
  let descartado = false;
  return {
    archivo,
    get bytes() {
      return bytes;
    },
    escribir: (datos) =>
      new Promise<void>((listo, fallo) => {
        if (descartado) {
          fallo(new Error('descartado'));
          return;
        }
        bytes += datos.length;
        if (cifrador.write(datos)) listo();
        else {
          cifrador.once('drain', listo);
          tuberia.catch(fallo);
        }
      }),
    terminar: async () => {
      cifrador.end();
      await tuberia;
    },
    descartar: () => {
      descartado = true;
      cifrador.destroy();
      destino.destroy();
      void tuberia
        .catch(() => undefined)
        .finally(() => {
          borrarArchivo(carpeta, archivo);
        });
      borrarArchivo(carpeta, archivo);
    },
  };
}

/**
 * Descifra un archivo entero en memoria, hasta `maximo` bytes. Lo recibido solo vale si el stream
 * terminó sin error: un archivo alterado o truncado falla al final.
 */
export async function leerDescifrado(
  carpeta: string,
  conClave: <T>(uso: (clave: Buffer) => T) => T,
  evidenciaId: string,
  semilla: Buffer,
  archivo: string,
  maximo: number,
): Promise<Buffer> {
  const descifrador = conClave((clave) => crearDescifradorArchivo(clave, evidenciaId, semilla));
  const partes: Buffer[] = [];
  let total = 0;
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      total += trozo.length;
      if (total > maximo) {
        listo(new Error('demasiado-grande'));
        return;
      }
      partes.push(trozo);
      listo();
    },
  });
  try {
    await pipeline(createReadStream(rutaDe(carpeta, archivo)), descifrador, destino);
  } catch (error) {
    for (const parte of partes) parte.fill(0);
    throw error;
  }
  return Buffer.concat(partes);
}

export function borrarArchivo(carpeta: string, archivo: string): void {
  try {
    rmSync(rutaDe(carpeta, archivo), { force: true, maxRetries: 3 });
  } catch {
    // Un nombre que no es nuestro no se toca. Sin su semilla, lo que quede es ilegible.
  }
}

/**
 * Lo que está en la carpeta sin fila en la base: de una ejecución cortada, de un tramo descartado o de un
 * proyecto eliminado. Es ilegible (su semilla no está), y se borra igual. Devuelve cuántos.
 */
export function limpiarHuerfanos(carpeta: string, conFila: ReadonlySet<string>): number {
  let nombres: string[];
  try {
    nombres = readdirSync(carpeta);
  } catch {
    return 0;
  }
  let borrados = 0;
  for (const nombre of nombres) {
    if (conFila.has(nombre)) continue;
    rmSync(path.join(carpeta, nombre), { recursive: true, force: true, maxRetries: 3 });
    borrados += 1;
  }
  return borrados;
}
