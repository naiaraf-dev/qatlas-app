/**
 * Entropía de Shannon, para decidir si un valor **en un contexto sospechoso** parece un secreto. Fuera de
 * contexto no se usa: un UUID, el hash de un asset o un nonce tienen entropía alta y no son secretos.
 */
export function entropia(texto: string): number {
  if (texto.length === 0) return 0;
  const cuentas = new Map<string, number>();
  for (const caracter of texto) cuentas.set(caracter, (cuentas.get(caracter) ?? 0) + 1);
  let total = 0;
  for (const cuenta of cuentas.values()) {
    const p = cuenta / texto.length;
    total -= p * Math.log2(p);
  }
  return total;
}

export const LARGO_MINIMO_ENTROPIA = 20;
export const ENTROPIA_MINIMA = 3.5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hashes hexadecimales comunes (MD5, SHA-1, SHA-256, SHA-512): identificadores, no secretos. */
const HASH_HEX = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i;
/** `integrity="sha256-…"` de un recurso: un hash público. */
const INTEGRIDAD = /^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/;

/** Lo que nunca cuenta como secreto por entropía, aunque esté en un contexto sospechoso. */
export function esExcluidoPorEntropia(valor: string): boolean {
  return UUID.test(valor) || HASH_HEX.test(valor) || INTEGRIDAD.test(valor) || /^\d+$/.test(valor);
}

export function pareceSecreto(valor: string): boolean {
  return (
    valor.length >= LARGO_MINIMO_ENTROPIA &&
    !esExcluidoPorEntropia(valor) &&
    entropia(valor) >= ENTROPIA_MINIMA
  );
}
