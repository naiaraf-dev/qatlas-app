/**
 * Los estados de un hallazgo y sus transiciones (especificación 5.1 y 5.2, ADR 047). Sin `electron` ni base:
 * funciones puras, probadas con Vitest.
 *
 * - **Siete estados** (5.2): nuevo, confirmado, descartado, reportado, posiblemente_resuelto, resuelto y
 *   regresion. «Recurrente» no es un estado: es la **aparición** de una ocurrencia (nueva, recurrente o
 *   regresion), que no pisa la decisión de nadie.
 * - **Regresión** solo desde «resuelto»: lo confirmado como corregido que vuelve.
 * - **Posiblemente resuelto:** un hallazgo abierto que no apareció en una ejecución que lo cubrió. Si vuelve,
 *   recupera el estado que tenía, y la aparición es recurrente.
 * - **Resuelto** lo decide la persona (también en lote desde «posiblemente resueltos»).
 * - **Descartado:** sus apariciones se registran sin alerta, y no cambia. Se puede reabrir a mano.
 */
import type { EstadoHallazgo } from '@qatlas/shared';

export type Aparicion = 'nueva' | 'recurrente' | 'regresion';

/** Abiertos: pueden pasar a «posiblemente resuelto» si una ejecución los cubre y no aparecen. */
export const ESTADOS_ABIERTOS: ReadonlySet<EstadoHallazgo> = new Set([
  'nuevo',
  'confirmado',
  'reportado',
  'regresion',
]);

/** Los que pone una persona: en una fusión, gana la última de estas decisiones (ADR 047). */
export const DECISIONES_DE_PERSONA: ReadonlySet<EstadoHallazgo> = new Set([
  'descartado',
  'confirmado',
  'reportado',
  'resuelto',
]);

export interface EstadoActual {
  estado: EstadoHallazgo;
  /** El estado antes de «posiblemente resuelto», para volver a él si reaparece. */
  estadoPrevio: EstadoHallazgo | null;
}

export interface ResultadoAparicion extends EstadoActual {
  aparicion: Aparicion;
  /** Una regresión se destaca en el resumen y en la bandeja (CU-09). */
  alerta: boolean;
}

/** Qué pasa cuando una ejecución encuentra el hallazgo. `null`: es la primera vez. */
export function alAparecer(actual: EstadoActual | null): ResultadoAparicion {
  if (!actual) return { estado: 'nuevo', estadoPrevio: null, aparicion: 'nueva', alerta: false };
  switch (actual.estado) {
    case 'resuelto':
      return { estado: 'regresion', estadoPrevio: null, aparicion: 'regresion', alerta: true };
    case 'posiblemente_resuelto':
      return {
        estado: actual.estadoPrevio ?? 'nuevo',
        estadoPrevio: null,
        aparicion: 'recurrente',
        alerta: false,
      };
    default:
      // Descartado incluido: la ocurrencia se registra, sin alerta, y la decisión no cambia.
      return { ...actual, aparicion: 'recurrente', alerta: false };
  }
}

/** Una ejecución que cubrió el hallazgo y no lo encontró. */
export function alNoAparecerCubierto(actual: EstadoActual): EstadoActual {
  if (!ESTADOS_ABIERTOS.has(actual.estado)) return actual;
  return { estado: 'posiblemente_resuelto', estadoPrevio: actual.estado };
}

export type AccionDePersona =
  | { accion: 'confirmar' }
  | { accion: 'descartar' }
  | { accion: 'resolver' }
  | { accion: 'reabrir' }
  // Al incluirlo en un reporte de bug (semana 9a, ADR 048).
  | { accion: 'reportar' };

/**
 * Lo que hace la persona desde la bandeja. `null`: la acción no corresponde a ese estado (la interfaz no la
 * ofrece; si llegara, se rechaza). «Reportado» lo pone la creación de un reporte de bug.
 */
export function decidir(actual: EstadoActual, accion: AccionDePersona): EstadoActual | null {
  switch (accion.accion) {
    case 'confirmar':
      return ['nuevo', 'regresion', 'posiblemente_resuelto'].includes(actual.estado)
        ? { estado: 'confirmado', estadoPrevio: null }
        : null;
    case 'descartar':
      return actual.estado === 'descartado' ? null : { estado: 'descartado', estadoPrevio: null };
    case 'resolver':
      return actual.estado === 'resuelto' || actual.estado === 'descartado'
        ? null
        : { estado: 'resuelto', estadoPrevio: null };
    case 'reportar':
      return ['nuevo', 'confirmado', 'regresion', 'posiblemente_resuelto', 'reportado'].includes(
        actual.estado,
      )
        ? { estado: 'reportado', estadoPrevio: null }
        : null;
    case 'reabrir':
      // Solo un descartado se reabre a mano: vuelve a «nuevo», sin revisar.
      return actual.estado === 'descartado' ? { estado: 'nuevo', estadoPrevio: null } : null;
  }
}

export interface FilaAFusionar extends EstadoActual {
  /** Cuándo decidió una persona por última vez. Null: nunca. */
  decisionEn: string | null;
  ultimaVezEn: string;
}

/**
 * El estado de varios hallazgos con la misma huella que se fusionan (ADR 047). Gana la última decisión de
 * una persona (descartado, confirmado, reportado o resuelto) sobre los estados automáticos. Sin decisiones,
 * el del que apareció por última vez.
 */
export function estadoAlFusionar(filas: readonly FilaAFusionar[]): EstadoActual & {
  decisionEn: string | null;
} {
  const conDecision = filas
    .filter((f) => f.decisionEn !== null && DECISIONES_DE_PERSONA.has(f.estado))
    .sort((a, b) => (a.decisionEn ?? '').localeCompare(b.decisionEn ?? ''));
  const decision = conDecision.at(-1);
  if (decision) {
    return { estado: decision.estado, estadoPrevio: null, decisionEn: decision.decisionEn };
  }
  const ultima = [...filas].sort((a, b) => a.ultimaVezEn.localeCompare(b.ultimaVezEn)).at(-1);
  return {
    estado: ultima?.estado ?? 'nuevo',
    estadoPrevio: ultima?.estadoPrevio ?? null,
    decisionEn: null,
  };
}
