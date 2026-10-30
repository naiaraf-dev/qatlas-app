import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pareceSqlitePlano, type BaseCifrada } from './conexion';
import { ErrorBoveda } from './errores';
import { escribirAtomico, MARCA_TEMPORAL, TAMANO_MAXIMO_SELLADA } from './sellada';

const MAGIA = Buffer.from('QATB', 'ascii');
const VERSION_COPIA = 1;
const LONGITUD_CABECERA = MAGIA.length + 1 + 4;
const PAGINA_MINIMA = 512;
/** El archivo elegido no es confiable. Las evidencias, cuando existan, ampliarán este formato. */
export const TAMANO_MAXIMO_COPIA = 1024 * 1024 * 1024;

export interface ContenidoCopia {
  sellada: Buffer;
  base: Buffer;
}

/**
 * Formato (ADR 010): "QATB" (4) | versión (1) | largo de la sellada (4, big-endian) | sellada | base.
 * La base sale de VACUUM INTO con la base abierta: conserva el cifrado y la clave, y no copia las
 * páginas libres. Se escribe de forma atómica en el destino. Todo el contenido ya está cifrado.
 */
export function crearCopia(
  base: BaseCifrada,
  sellada: Buffer,
  carpetaTemporal: string,
  destino: string,
): void {
  const temporal = path.join(
    carpetaTemporal,
    `copia.db${MARCA_TEMPORAL}${randomBytes(6).toString('hex')}`,
  );
  try {
    base.prepare('VACUUM INTO ?').run(temporal);
    const datos = readFileSync(temporal);
    if (pareceSqlitePlano(datos)) throw new ErrorBoveda('COPIA_INVALIDA');

    const cabecera = Buffer.alloc(LONGITUD_CABECERA);
    MAGIA.copy(cabecera);
    cabecera.writeUInt8(VERSION_COPIA, MAGIA.length);
    cabecera.writeUInt32BE(sellada.length, MAGIA.length + 1);
    escribirAtomico(destino, Buffer.concat([cabecera, sellada, datos]));
  } finally {
    rmSync(temporal, { force: true });
  }
}

/** Valida la estructura sin descifrar nada. La autenticidad se comprueba al abrirla con la clave. */
export function leerCopia(ruta: string): ContenidoCopia {
  let datos: Buffer;
  try {
    if (statSync(ruta).size > TAMANO_MAXIMO_COPIA) throw new ErrorBoveda('COPIA_INVALIDA');
    datos = readFileSync(ruta);
  } catch {
    throw new ErrorBoveda('COPIA_INVALIDA');
  }
  if (
    datos.length < LONGITUD_CABECERA ||
    !datos.subarray(0, MAGIA.length).equals(MAGIA) ||
    datos.readUInt8(MAGIA.length) !== VERSION_COPIA
  ) {
    throw new ErrorBoveda('COPIA_INVALIDA');
  }
  const largo = datos.readUInt32BE(MAGIA.length + 1);
  const finSellada = LONGITUD_CABECERA + largo;
  if (largo > TAMANO_MAXIMO_SELLADA || datos.length < finSellada + PAGINA_MINIMA) {
    throw new ErrorBoveda('COPIA_INVALIDA');
  }
  const base = datos.subarray(finSellada);
  if (pareceSqlitePlano(base)) throw new ErrorBoveda('COPIA_INVALIDA');
  return { sellada: datos.subarray(LONGITUD_CABECERA, finSellada), base };
}
