import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as comun from '@zxcvbn-ts/language-common';
import * as espanol from '@zxcvbn-ts/language-es-es';

/**
 * Validación de la contraseña maestra (RN-BOV-01, ADR 008). La interfaz la usa para el medidor; el
 * proceso principal la repite y es quien decide. Listas empaquetadas: no descarga nada.
 *
 * Es un subpaquete aparte para que los diccionarios no entren en quien solo usa el contrato IPC.
 */
export const LARGO_MINIMO = 12;
const PUNTAJE_MINIMO = 3;

export type MotivoRechazo = 'corta' | 'comun' | 'debil';

export interface EvaluacionContrasena {
  /** De 0 (muy débil) a 4 (muy fuerte). */
  puntaje: 0 | 1 | 2 | 3 | 4;
  aceptable: boolean;
  motivo?: MotivoRechazo;
}

let analizador: ZxcvbnFactory | undefined;

// Descomprimir los diccionarios lleva un momento: se hace recién con la primera evaluación.
function obtenerAnalizador(): ZxcvbnFactory {
  analizador ??= new ZxcvbnFactory({
    dictionary: { ...comun.dictionary, ...espanol.dictionary },
    graphs: comun.adjacencyGraphs,
    translations: espanol.translations,
  });
  return analizador;
}

/** Cuenta caracteres, no unidades UTF-16: "ñ" o un emoji valen uno. */
function largoEnCaracteres(contrasena: string): number {
  return Array.from(contrasena.normalize('NFC')).length;
}

export function evaluarContrasena(contrasena: string): EvaluacionContrasena {
  const resultado = obtenerAnalizador().check(contrasena);
  const puntaje = resultado.score;

  if (largoEnCaracteres(contrasena) < LARGO_MINIMO) {
    return { puntaje, aceptable: false, motivo: 'corta' };
  }
  const esComun = resultado.sequence.some(
    (parte) =>
      parte.pattern === 'dictionary' &&
      parte.dictionaryName === 'passwords-common' &&
      parte.token.length === contrasena.length,
  );
  if (esComun) return { puntaje: 0, aceptable: false, motivo: 'comun' };
  if (puntaje < PUNTAJE_MINIMO) return { puntaje, aceptable: false, motivo: 'debil' };
  return { puntaje, aceptable: true };
}
