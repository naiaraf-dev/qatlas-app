import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {
  ErrorCripto,
  validarParametros,
  type BovedaSellada,
  type ParametrosKdf,
} from '@qatlas/crypto';
import { ErrorBoveda } from './errores';

const FORMATO = 'qatlas.sellada';
const VERSION_FORMATO = 1;
const LONGITUD_SALT = 16;
/** Muy por encima de lo real: un archivo manipulado no puede agotar la memoria. */
export const TAMANO_MAXIMO_SELLADA = 64 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Marca de los temporales: `recuperarInstalacion` borra lo que quede de un cierre inesperado. */
export const MARCA_TEMPORAL = '.tmp-';

export interface OperacionesArchivo {
  renombrar: (origen: string, destino: string) => void;
}

const OPERACIONES_REALES: OperacionesArchivo = { renombrar: renameSync };

/** Hace durable el rename. Windows no permite abrir una carpeta así: ahí alcanza con el rename. */
function sincronizarCarpeta(carpeta: string): void {
  if (process.platform === 'win32') return;
  const descriptor = openSync(carpeta, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Escritura atómica: temporal en la misma carpeta, fsync y rename. Un cierre inesperado deja el
 * archivo anterior intacto o el nuevo completo, nunca uno a medio escribir.
 */
export function escribirAtomico(
  ruta: string,
  datos: Buffer,
  operaciones: OperacionesArchivo = OPERACIONES_REALES,
): void {
  const temporal = `${ruta}${MARCA_TEMPORAL}${randomBytes(6).toString('hex')}`;
  try {
    const descriptor = openSync(temporal, 'wx', 0o600);
    try {
      writeSync(descriptor, datos);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    operaciones.renombrar(temporal, ruta);
    sincronizarCarpeta(path.dirname(ruta));
  } catch (error) {
    rmSync(temporal, { force: true });
    throw error;
  }
}

export function serializarSellada(sellada: BovedaSellada): Buffer {
  return Buffer.from(
    JSON.stringify({
      formato: FORMATO,
      version: VERSION_FORMATO,
      boveda: sellada.version,
      kdf: sellada.kdf,
      salt: sellada.salt.toString('base64'),
      maestraEnvuelta: sellada.maestraEnvuelta.toString('base64'),
    }),
    'utf8',
  );
}

function aBytes(valor: unknown): Buffer {
  if (typeof valor !== 'string' || !BASE64.test(valor)) throw new ErrorBoveda('SELLADA_INVALIDA');
  return Buffer.from(valor, 'base64');
}

/**
 * Lee el contenido sin confiar en él. Los parámetros de Argon2id se rechazan si están por debajo
 * de los mínimos o por encima de los máximos: alguien con acceso al disco no puede bajarlos para
 * facilitar la fuerza bruta. Además están autenticados en la envoltura de la clave maestra.
 */
export function analizarSellada(datos: Buffer): BovedaSellada {
  if (datos.length > TAMANO_MAXIMO_SELLADA) throw new ErrorBoveda('SELLADA_INVALIDA');
  let crudo: unknown;
  try {
    crudo = JSON.parse(datos.toString('utf8'));
  } catch {
    throw new ErrorBoveda('SELLADA_INVALIDA');
  }
  if (typeof crudo !== 'object' || crudo === null) throw new ErrorBoveda('SELLADA_INVALIDA');
  const campos = crudo as Record<string, unknown>;
  if (
    campos.formato !== FORMATO ||
    campos.version !== VERSION_FORMATO ||
    typeof campos.boveda !== 'number' ||
    typeof campos.kdf !== 'object' ||
    campos.kdf === null
  ) {
    throw new ErrorBoveda('SELLADA_INVALIDA');
  }
  const salt = aBytes(campos.salt);
  const maestraEnvuelta = aBytes(campos.maestraEnvuelta);
  if (salt.length !== LONGITUD_SALT) throw new ErrorBoveda('SELLADA_INVALIDA');

  const { algoritmo, version, memoriaKiB, iteraciones, paralelismo } = campos.kdf as ParametrosKdf;
  const kdf: ParametrosKdf = { algoritmo, version, memoriaKiB, iteraciones, paralelismo };
  try {
    validarParametros(kdf);
  } catch (error) {
    if (error instanceof ErrorCripto) throw new ErrorBoveda('SELLADA_INVALIDA');
    throw error;
  }
  return { version: campos.boveda, kdf, salt, maestraEnvuelta };
}

export function leerSellada(ruta: string): BovedaSellada {
  let datos: Buffer;
  try {
    datos = readFileSync(ruta);
  } catch {
    throw new ErrorBoveda('SELLADA_INVALIDA');
  }
  return analizarSellada(datos);
}
