import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** Sin Electron, para poder probarlo con Vitest. */

/**
 * Lo único del entorno que un proceso de la ejecución hereda. Sin esto, hereda todo.
 *
 * Sin `SystemDrive`, Windows no expande la variable y Chromium crea una carpeta literal llamada
 * `%SystemDrive%` en su directorio de trabajo: lo mostró la verificación del hash del navegador.
 */
const VARIABLES_PERMITIDAS = [
  'SystemRoot',
  'SystemDrive',
  'ProgramData',
  'SYSTEMROOT',
  'WINDIR',
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
];

export function entornoMinimo(
  origen: NodeJS.ProcessEnv,
  extra: Record<string, string>,
): Record<string, string> {
  const entorno: Record<string, string> = {};
  for (const nombre of VARIABLES_PERMITIDAS) {
    const valor = origen[nombre];
    if (valor !== undefined) entorno[nombre] = valor;
  }
  return { ...entorno, ...extra };
}

/** Dentro de la carpeta de datos, no en el temporal del sistema (ADR 018). */
export const carpetaPerfiles = (carpetaDatos: string): string =>
  path.join(carpetaDatos, 'perfiles');

/**
 * Solo el comienzo del ID: corre una ejecución a la vez, y en Linux Chromium crea un socket Unix dentro
 * de esta carpeta, con un límite de 107 bytes. Con el ID entero no entraba.
 */
export const carpetaPerfil = (carpetaDatos: string, ejecucionId: string): string =>
  path.join(carpetaPerfiles(carpetaDatos), ejecucionId.slice(0, 8));

/** Al arrancar: lo que haya quedado es de una ejecución cortada. */
export function limpiarPerfilesHuerfanos(carpetaDatos: string): void {
  const carpeta = carpetaPerfiles(carpetaDatos);
  let nombres: string[];
  try {
    nombres = readdirSync(carpeta);
  } catch {
    return;
  }
  for (const nombre of nombres) {
    rmSync(path.join(carpeta, nombre), { recursive: true, force: true, maxRetries: 3 });
  }
}
