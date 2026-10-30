import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { escribirAtomico, MARCA_TEMPORAL } from './sellada';

const NOMBRE_BASE = 'boveda.db';
const NOMBRE_SELLADA = 'boveda.sellada';
const SUFIJO_NUEVO = '.nueva';
const NOMBRE_MARCA = 'instalacion.marca';

export interface RutasBoveda {
  base: string;
  sellada: string;
  baseNueva: string;
  selladaNueva: string;
  marca: string;
}

export function rutasBoveda(carpeta: string): RutasBoveda {
  const base = path.join(carpeta, NOMBRE_BASE);
  const sellada = path.join(carpeta, NOMBRE_SELLADA);
  return {
    base,
    sellada,
    baseNueva: base + SUFIJO_NUEVO,
    selladaNueva: sellada + SUFIJO_NUEVO,
    marca: path.join(carpeta, NOMBRE_MARCA),
  };
}

export type EstadoArchivos = 'sin-boveda' | 'existe' | 'danada';

/** Una bóveda con alguno de sus dos archivos faltantes nunca se trata como "sin bóveda". */
export function estadoArchivos(rutas: RutasBoveda): EstadoArchivos {
  const base = existsSync(rutas.base);
  const sellada = existsSync(rutas.sellada);
  if (!base && !sellada) return 'sin-boveda';
  return base && sellada ? 'existe' : 'danada';
}

function moverSiExiste(origen: string, destino: string): void {
  if (existsSync(origen)) renameSync(origen, destino);
}

function completarInstalacion(rutas: RutasBoveda): void {
  moverSiExiste(rutas.baseNueva, rutas.base);
  moverSiExiste(rutas.selladaNueva, rutas.sellada);
  rmSync(rutas.marca, { force: true });
}

/**
 * Reemplaza la base (ya escrita en `baseNueva`) y el archivo sellado como una unidad. Los dos deben
 * corresponderse: una base nueva con una envoltura vieja dejaría la bóveda inutilizable. La marca es
 * el punto de no retorno, y `recuperarInstalacion` completa lo que un cierre inesperado interrumpa.
 */
export function instalarPar(rutas: RutasBoveda, selladaNueva: Buffer): void {
  escribirAtomico(rutas.selladaNueva, selladaNueva);
  escribirAtomico(rutas.marca, Buffer.from('1', 'ascii'));
  completarInstalacion(rutas);
}

/** Con la marca, termina la instalación. Sin ella, descarta los restos. Borra los temporales. */
export function recuperarInstalacion(carpeta: string): void {
  const rutas = rutasBoveda(carpeta);
  if (existsSync(rutas.marca)) {
    completarInstalacion(rutas);
  } else {
    rmSync(rutas.baseNueva, { force: true });
    rmSync(rutas.selladaNueva, { force: true });
  }
  for (const nombre of readdirSync(carpeta)) {
    if (nombre.includes(MARCA_TEMPORAL)) rmSync(path.join(carpeta, nombre), { force: true });
  }
}
