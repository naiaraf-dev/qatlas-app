import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Integridad de los módulos nativos (ADR 007).
 *
 * Los `.node` no pueden vivir dentro del asar, así que su validación de integridad no los cubre. El
 * build calcula sus SHA-256 y los deja dentro del bundle, que sí está cubierto. Antes de cargar un
 * módulo se comparan: si falta o no coincide, no se ejecuta nada (fallar cerrado).
 */
export interface ModuloNativo {
  paquete: string;
  /** Relativo a la carpeta del paquete, con barras normales. */
  archivo: string;
  sha256: string;
}

export interface DependenciasVerificacion {
  /** Carpeta del paquete instalado. */
  carpetaDelPaquete: (paquete: string) => string;
  leer?: (ruta: string) => Buffer;
}

/** En el paquete instalado, los `.node` están fuera del asar: en `app.asar.unpacked`. */
export function rutaFueraDelAsar(ruta: string): string {
  return ruta.replace(/\.asar([\\/])/, '.asar.unpacked$1');
}

/** Devuelve true solo si hay al menos un módulo y todos coinciden. No informa rutas ni hashes. */
export function verificarNativos(
  manifiesto: readonly ModuloNativo[],
  dependencias: DependenciasVerificacion,
): boolean {
  const leer = dependencias.leer ?? readFileSync;
  if (manifiesto.length === 0) return false;
  return manifiesto.every(({ paquete, archivo, sha256 }) => {
    try {
      const ruta = rutaFueraDelAsar(path.join(dependencias.carpetaDelPaquete(paquete), archivo));
      return createHash('sha256').update(leer(ruta)).digest('hex') === sha256;
    } catch {
      return false;
    }
  });
}
