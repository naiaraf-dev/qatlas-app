import { idsDeEvidenciasEnReportes, type BaseCifrada } from '@qatlas/db';

/**
 * Retención de las evidencias (EVI-06, ADR 038). Sin Electron, para probarlo con Vitest.
 */

export const RETENCION_MINIMA_DIAS = 1;
export const RETENCION_MAXIMA_DIAS = 3650;
const MS_POR_DIA = 24 * 60 * 60_000;

/** Lo creado antes de esta fecha vence. */
export function fechaDeCorte(ahora: number, dias: number): string {
  const acotados = Math.min(RETENCION_MAXIMA_DIAS, Math.max(RETENCION_MINIMA_DIAS, dias));
  return new Date(ahora - acotados * MS_POR_DIA).toISOString();
}

/**
 * Las evidencias de hallazgos incluidos en reportes no vencen (EVI-06, ADR 048): las de las páginas donde
 * aparecieron, y las de sus ejecuciones que no son de una página (traza, HAR).
 */
export function evidenciasEnReportes(base: BaseCifrada): ReadonlySet<string> {
  return idsDeEvidenciasEnReportes(base);
}
