/**
 * Cuándo una ejecución cubrió un hallazgo (especificación 5.1, ADR 047). Lo que no se recorrió no se da por
 * arreglado.
 *
 * Una ejecución cubre un hallazgo si analizó (la página cargó) una página de la misma forma que alguna de
 * las páginas donde apareció en su última ejecución, **con el mismo contexto**: las dos sin login, o la
 * misma credencial y el mismo rol. Sin funciones de la base: se prueba con Vitest.
 */
import type { CandidatoCobertura, EstadoGuardado, Lugar } from '@qatlas/db';
import { alNoAparecerCubierto } from './estados';
import { formaDeUrl } from './huella';

export interface Contexto {
  credencialId: string | null;
  rol: string | null;
}

const mismoContexto = (a: Contexto, b: Contexto) =>
  a.credencialId === b.credencialId && a.rol === b.rol;

export function cubre(
  contexto: Contexto,
  paginasAnalizadas: readonly string[],
  lugares: readonly Lugar[],
): boolean {
  const formas = new Set(paginasAnalizadas.map(formaDeUrl));
  return lugares.some(
    (lugar) => mismoContexto(contexto, lugar) && formas.has(formaDeUrl(lugar.url)),
  );
}

/**
 * Lo que cambia al terminar una ejecución, para los hallazgos que no aparecieron en ella: los abiertos que
 * cubrió pasan a «posiblemente resuelto», y todos los que cubrió anotan la fecha.
 */
export function decidirCobertura(
  candidatos: readonly CandidatoCobertura[],
  contexto: Contexto,
  paginasAnalizadas: readonly string[],
): { cambios: EstadoGuardado[]; cubiertos: string[] } {
  const cambios: EstadoGuardado[] = [];
  const cubiertos: string[] = [];
  for (const candidato of candidatos) {
    if (!cubre(contexto, paginasAnalizadas, candidato.lugares)) continue;
    cubiertos.push(candidato.id);
    const siguiente = alNoAparecerCubierto(candidato);
    if (siguiente.estado !== candidato.estado) cambios.push({ id: candidato.id, ...siguiente });
  }
  return { cambios, cubiertos };
}
