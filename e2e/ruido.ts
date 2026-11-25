/**
 * Lo que el navegador no puede pedir por su cuenta (ADR 041): cualquier servicio de Google o de
 * Chromium. Lo usan los tests de ruido del navegador y del monitor de la app.
 */
export const DE_GOOGLE =
  /(^|\.)(google|googleapis|gstatic|gvt1|gvt2|googleusercontent|doubleclick|chrome|chromium)\.[a-z]+$/;

/**
 * Lo que el proxy registró para el sitio, sin los pedidos del navegador por su cuenta (regla
 * `servicio-interno-navegador`, ADR 041). Esos se prueban en `navegador-ruido.e2e.ts`.
 */
export function delSitio<T extends { regla: string }>(registros: readonly T[]): T[] {
  return registros.filter((r) => r.regla !== 'servicio-interno-navegador');
}
