import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * El oráculo del escáner: compara lo encontrado con `hallazgos-esperados.json`. Cada esperado tiene que
 * aparecer con su tipo, su URL y su severidad; cualquier hallazgo que no esté documentado es inesperado.
 */
export interface Esperado {
  id: string;
  tipo: string;
  url: string;
  severidad: string;
  clave?: string;
  origen?: string;
  requiere?: 'nombre' | 'https';
}

export interface Encontrado {
  tipo: string;
  severidad: string;
  url: string;
  urlOrigen: string | null;
  clave: string;
}

export interface Manifiesto {
  hallazgos: Esperado[];
  paginasSanas: string[];
}

export const manifiesto = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../apps/sandbox-site/hallazgos-esperados.json'),
    'utf8',
  ),
) as Manifiesto;

const ruta = (url: string) => new URL(url).pathname;

/** Un host esperado sin puerto vale para cualquier puerto: el del sandbox cambia en cada corrida. */
function mismaClave(esperada: string | undefined, encontrada: string): boolean {
  if (esperada === undefined) return true;
  return encontrada === esperada || encontrada.startsWith(`${esperada}:`);
}

function coincide(esperado: Esperado, encontrado: Encontrado): boolean {
  return (
    esperado.tipo === encontrado.tipo &&
    esperado.url === ruta(encontrado.url) &&
    mismaClave(esperado.clave, encontrado.clave) &&
    (esperado.origen === undefined ||
      (encontrado.urlOrigen !== null && ruta(encontrado.urlOrigen) === esperado.origen))
  );
}

export interface ResultadoOraculo {
  encontrados: string[];
  /** Esperados que no aparecieron. */
  faltantes: string[];
  /** Esperados que aparecieron con otra severidad. */
  conOtraSeveridad: string[];
  /** Hallazgos que no están en el manifiesto. */
  inesperados: string[];
  /** Hallazgos sobre las páginas sanas: falsos positivos seguros. */
  enPaginasSanas: string[];
}

export function compararConOraculo(
  esperados: readonly Esperado[],
  encontrados: readonly Encontrado[],
): ResultadoOraculo {
  const describir = (h: Encontrado) =>
    `${h.tipo} · ${ruta(h.url)} · ${h.severidad} · ${h.clave}${h.urlOrigen ? ` · desde ${ruta(h.urlOrigen)}` : ''}`;
  const resultado: ResultadoOraculo = {
    encontrados: [],
    faltantes: [],
    conOtraSeveridad: [],
    inesperados: [],
    enPaginasSanas: [],
  };
  for (const esperado of esperados) {
    const iguales = encontrados.filter((h) => coincide(esperado, h));
    if (iguales.length === 0) resultado.faltantes.push(esperado.id);
    else if (iguales.some((h) => h.severidad === esperado.severidad)) {
      resultado.encontrados.push(esperado.id);
    } else resultado.conOtraSeveridad.push(`${esperado.id}: ${iguales[0]?.severidad ?? ''}`);
  }
  for (const encontrado of encontrados) {
    if (manifiesto.paginasSanas.includes(ruta(encontrado.url))) {
      resultado.enPaginasSanas.push(describir(encontrado));
    }
    if (!esperados.some((e) => coincide(e, encontrado))) {
      resultado.inesperados.push(describir(encontrado));
    }
  }
  return resultado;
}

export function resumenLegible({
  encontrados,
  faltantes,
  conOtraSeveridad,
  inesperados,
  enPaginasSanas,
}: ResultadoOraculo): string {
  const lista = (titulo: string, items: readonly string[]) =>
    `${titulo}: ${items.length}${items.length ? `\n  - ${items.join('\n  - ')}` : ''}`;
  return [
    'Oráculo del escáner',
    lista('Encontrados', encontrados),
    lista('Faltantes', faltantes),
    lista('Con otra severidad', conOtraSeveridad),
    lista('Inesperados', inesperados),
    lista('En páginas sanas', enPaginasSanas),
  ].join('\n');
}
