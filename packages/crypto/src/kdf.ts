import { ErrorCripto } from './errores';

/** Entrada completa de Argon2id (RFC 9106). `secreto` y `datosAsociados` solo los usan los vectores. */
export interface EntradaArgon2id {
  contrasena: Buffer;
  salt: Buffer;
  memoriaKiB: number;
  iteraciones: number;
  paralelismo: number;
  longitud: number;
  secreto?: Buffer;
  datosAsociados?: Buffer;
}

/**
 * Interfaz de la implementación de Argon2id. Cambiar de librería solo requiere otra
 * función con esta firma: el resultado de Argon2id no depende de la implementación.
 */
export type ImplementacionArgon2id = (entrada: EntradaArgon2id) => Promise<Buffer>;

/** Parámetros que se guardan junto al resultado, para poder subirlos en el futuro. */
export interface ParametrosKdf {
  algoritmo: 'argon2id';
  version: 19;
  memoriaKiB: number;
  iteraciones: number;
  paralelismo: number;
}

/** 64 MiB y 3 iteraciones (especificación 3.4); 4 carriles como recomienda RFC 9106, sección 4. */
export const PARAMETROS_POR_DEFECTO: Readonly<ParametrosKdf> = {
  algoritmo: 'argon2id',
  version: 19,
  memoriaKiB: 64 * 1024,
  iteraciones: 3,
  paralelismo: 4,
};

export const LONGITUD_SALT = 16;
export const LONGITUD_CLAVE = 32;

// Los parámetros se leen del disco antes de autenticarlos. El piso impide una rebaja;
// el techo impide agotar la memoria o colgar el desbloqueo con un archivo manipulado.
const MAX_MEMORIA_KIB = 2 * 1024 * 1024;
const MAX_ITERACIONES = 64;
const MAX_PARALELISMO = 16;

function enRango(valor: unknown, minimo: number, maximo: number): boolean {
  return Number.isSafeInteger(valor) && (valor as number) >= minimo && (valor as number) <= maximo;
}

/** Falla cerrado ante parámetros desconocidos o fuera de rango. */
export function validarParametros(parametros: ParametrosKdf): void {
  // Vienen del disco: los tipos no garantizan nada en tiempo de ejecución.
  const { algoritmo, version }: { algoritmo: string; version: number } = parametros;
  const valido =
    algoritmo === 'argon2id' &&
    version === 19 &&
    enRango(parametros.memoriaKiB, PARAMETROS_POR_DEFECTO.memoriaKiB, MAX_MEMORIA_KIB) &&
    enRango(parametros.iteraciones, PARAMETROS_POR_DEFECTO.iteraciones, MAX_ITERACIONES) &&
    enRango(parametros.paralelismo, 1, MAX_PARALELISMO);
  if (!valido) throw new ErrorCripto('PARAMETROS');
}

/** Deriva la KEK. Quien la recibe debe borrarla con `borrar`. */
export async function derivarKek(
  contrasena: Buffer,
  salt: Buffer,
  parametros: ParametrosKdf,
  implementacion: ImplementacionArgon2id,
): Promise<Buffer> {
  validarParametros(parametros);
  if (contrasena.length === 0 || salt.length !== LONGITUD_SALT) {
    throw new ErrorCripto('PARAMETROS');
  }
  return implementacion({
    contrasena,
    salt,
    memoriaKiB: parametros.memoriaKiB,
    iteraciones: parametros.iteraciones,
    paralelismo: parametros.paralelismo,
    longitud: LONGITUD_CLAVE,
  });
}
