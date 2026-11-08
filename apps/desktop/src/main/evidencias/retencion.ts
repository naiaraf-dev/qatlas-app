import type { BaseCifrada } from '@qatlas/db';

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
 * Las evidencias de hallazgos incluidos en reportes no vencen (EVI-06). Los reportes llegan en la semana
 * 9: hasta entonces no hay ninguna. Cuando existan, esta función las lee de la base y la retención las
 * respeta sin cambiar nada más.
 */
// La base se usa desde la semana 9; la firma ya queda fija para los que la llaman.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function evidenciasEnReportes(base: BaseCifrada): ReadonlySet<string> {
  return new Set<string>();
}
