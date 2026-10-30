import { randomBytes } from 'node:crypto';
import { abrir, PROPOSITO, sellar } from './aead';
import { ErrorCripto } from './errores';
import {
  derivarKek,
  LONGITUD_CLAVE,
  LONGITUD_SALT,
  PARAMETROS_POR_DEFECTO,
  type ImplementacionArgon2id,
  type ParametrosKdf,
} from './kdf';
import { argon2idReferencia } from './kdf-argon2';
import { borrar } from './memoria';

const VERSION_BOVEDA = 1;

/** Lo que se guarda en `boveda_meta` (semana 3). No contiene nada en claro. */
export interface BovedaSellada {
  version: number;
  kdf: ParametrosKdf;
  salt: Buffer;
  maestraEnvuelta: Buffer;
}

export interface OpcionesKdf {
  parametros?: ParametrosKdf;
  implementacion?: ImplementacionArgon2id;
}

export interface BovedaNueva {
  sellada: BovedaSellada;
  /** En claro: quien la recibe debe borrarla al bloquear. */
  maestra: Buffer;
}

// Los parámetros y el salt van en el AAD: alterarlos en disco invalida la envoltura.
function contextoMaestra(kdf: ParametrosKdf, salt: Buffer): string {
  return [
    VERSION_BOVEDA,
    kdf.algoritmo,
    kdf.version,
    kdf.memoriaKiB,
    kdf.iteraciones,
    kdf.paralelismo,
    salt.toString('hex'),
  ].join('|');
}

async function envolverMaestra(
  contrasena: Buffer,
  maestra: Buffer,
  opciones: OpcionesKdf,
): Promise<BovedaSellada> {
  const kdf = { ...(opciones.parametros ?? PARAMETROS_POR_DEFECTO) };
  const salt = randomBytes(LONGITUD_SALT);
  const kek = await derivarKek(
    contrasena,
    salt,
    kdf,
    opciones.implementacion ?? argon2idReferencia,
  );
  try {
    const maestraEnvuelta = sellar(kek, PROPOSITO.MAESTRA, contextoMaestra(kdf, salt), maestra);
    return { version: VERSION_BOVEDA, kdf, salt, maestraEnvuelta };
  } finally {
    borrar(kek);
  }
}

/** Genera la clave maestra (256 bits aleatorios) y la envuelve con la KEK. */
export async function crearBoveda(
  contrasena: Buffer,
  opciones: OpcionesKdf = {},
): Promise<BovedaNueva> {
  const maestra = randomBytes(LONGITUD_CLAVE);
  try {
    return { sellada: await envolverMaestra(contrasena, maestra, opciones), maestra };
  } catch (error) {
    borrar(maestra);
    throw error;
  }
}

/** Contraseña incorrecta y datos alterados dan el mismo error (AUTENTICACION). */
export async function abrirBoveda(
  contrasena: Buffer,
  sellada: BovedaSellada,
  implementacion: ImplementacionArgon2id = argon2idReferencia,
): Promise<Buffer> {
  if (sellada.version !== VERSION_BOVEDA) throw new ErrorCripto('VERSION');
  const kek = await derivarKek(contrasena, sellada.salt, sellada.kdf, implementacion);
  try {
    const contexto = contextoMaestra(sellada.kdf, sellada.salt);
    return abrir(kek, PROPOSITO.MAESTRA, contexto, sellada.maestraEnvuelta);
  } finally {
    borrar(kek);
  }
}

/**
 * Vuelve a envolver la misma clave maestra con la contraseña nueva y un salt nuevo. No
 * toca ningún otro dato. No rota la clave maestra: una copia vieja de la bóveda sigue
 * abriéndose con la contraseña vieja (ver README).
 */
export async function cambiarContrasena(
  actual: Buffer,
  nueva: Buffer,
  sellada: BovedaSellada,
  opciones: OpcionesKdf = {},
): Promise<BovedaSellada> {
  const implementacion = opciones.implementacion ?? argon2idReferencia;
  const maestra = await abrirBoveda(actual, sellada, implementacion);
  try {
    return await envolverMaestra(nueva, maestra, {
      parametros: opciones.parametros ?? sellada.kdf,
      implementacion,
    });
  } finally {
    borrar(maestra);
  }
}
