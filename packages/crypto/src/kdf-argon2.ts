import argon2 from 'argon2';
import { ErrorCripto } from './errores';
import type { ImplementacionArgon2id } from './kdf';

/**
 * Argon2id con la implementación de referencia en C (paquete `argon2`; ver
 * docs/decisiones/005). Es el único archivo que conoce a la librería. El módulo nativo
 * copia la contraseña, borra su copia y la memoria interna al terminar, y calcula
 * fuera del hilo principal.
 */
export const argon2idReferencia: ImplementacionArgon2id = async (entrada) => {
  try {
    return await argon2.hash(entrada.contrasena, {
      type: argon2.argon2id,
      version: 0x13,
      raw: true,
      salt: entrada.salt,
      memoryCost: entrada.memoriaKiB,
      timeCost: entrada.iteraciones,
      parallelism: entrada.paralelismo,
      hashLength: entrada.longitud,
      ...(entrada.secreto ? { secret: entrada.secreto } : {}),
      ...(entrada.datosAsociados ? { associatedData: entrada.datosAsociados } : {}),
    });
  } catch {
    throw new ErrorCripto('PARAMETROS');
  }
};
