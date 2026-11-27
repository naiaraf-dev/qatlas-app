/** Tipos de `diagnostico-atestaciones.mjs`, para los tests (ADR 044). */
export interface AnalisisDeAtestaciones {
  tipos: string[];
  keyids: string[];
  completa: boolean;
  motivo: string | null;
}
export function analizarAtestaciones(texto: string): AnalisisDeAtestaciones;
export function rutaDelContenido(cache: string, integridad: string): string;
export function atestacionesEnCache(
  cache: string,
): (AnalisisDeAtestaciones & { paquete: string; guardada: string })[];
