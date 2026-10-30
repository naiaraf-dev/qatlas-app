/**
 * Declaración de autorización (SEG-01, RN-PRY-01 y RN-PRY-03, ADR 014).
 *
 * Un texto publicado no se modifica: un test congela su hash. Un cambio de fondo se agrega como
 * versión nueva y obliga a aceptar de nuevo en todos los proyectos.
 */
export const VERSION_DECLARACION = 1;

export const PLANTILLA_DECLARACION = `Declaración de autorización

Declaro que:
1. Soy titular de este sistema o cuento con autorización de quien lo es para probarlo, y esa autorización cubre las pruebas que voy a ejecutar.
2. El alcance se limita a esta URL base y estos dominios: {url_base} · {dominios}.
3. Entiendo que QAtlas navega y envía solicitudes automáticas, y que eso puede generar carga, registros o cambios de datos, aun en modo solo lectura.
4. Voy a respetar los límites y las políticas de uso del sistema. QAtlas no verifica esta autorización: la responsabilidad de contar con ella es mía.

Esta aceptación se guarda solo en este equipo.`;

/** Lo que la declaración autoriza. La opción "Sistema interno" cambia a qué se puede llegar. */
export interface AlcanceAutorizado {
  urlBase: string;
  dominios: readonly string[];
  sistemaInterno: boolean;
}

export interface AutorizacionAceptada extends AlcanceAutorizado {
  version: number;
  invalidada: boolean;
}

export type MotivoSinAutorizacion = 'sin-aceptar' | 'version-anterior' | 'alcance-cambiado';

export type ResultadoAutorizacion =
  { vigente: true } | { vigente: false; motivo: MotivoSinAutorizacion };

export function renderizarDeclaracion({
  urlBase,
  dominios,
}: Pick<AlcanceAutorizado, 'urlBase' | 'dominios'>): string {
  // Con funciones de reemplazo: un `$` en una URL no se interpreta como patrón.
  return PLANTILLA_DECLARACION.replace('{url_base}', () => urlBase).replace('{dominios}', () =>
    dominios.join(', '),
  );
}

function mismoAlcance(a: AlcanceAutorizado, b: AlcanceAutorizado): boolean {
  const ordenar = (lista: readonly string[]) => JSON.stringify([...lista].sort());
  return (
    a.urlBase === b.urlBase &&
    a.sistemaInterno === b.sistemaInterno &&
    ordenar(a.dominios) === ordenar(b.dominios)
  );
}

/**
 * RN-PRY-01: el chequeo que usa el runner antes de ejecutar nada. Exige que no se haya invalidado y,
 * además, compara el alcance: si la marca faltara por un error, igual falla cerrado.
 */
export function verificarAutorizacion(
  alcance: AlcanceAutorizado,
  aceptada: AutorizacionAceptada | null | undefined,
  versionVigente: number = VERSION_DECLARACION,
): ResultadoAutorizacion {
  if (!aceptada) return { vigente: false, motivo: 'sin-aceptar' };
  if (aceptada.version !== versionVigente) return { vigente: false, motivo: 'version-anterior' };
  if (aceptada.invalidada || !mismoAlcance(alcance, aceptada))
    return { vigente: false, motivo: 'alcance-cambiado' };
  return { vigente: true };
}
