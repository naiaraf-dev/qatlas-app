export const CARPETAS_TEMPORALES: string[];
export function validarRutaTemporal(
  entrada: unknown,
  opciones?: { raiz?: string; git?: (args: string[]) => string },
): string;
