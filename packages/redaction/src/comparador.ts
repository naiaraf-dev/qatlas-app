/**
 * Busca el valor exacto de los secretos de las credenciales de un proyecto sin guardarlos (ADR 031).
 *
 * Al crearse, calcula el HMAC-SHA-256 de cada variante del secreto (tal cual, codificado para URL o para
 * un formulario, en base64, base64url y hexadecimal) con una clave aleatoria propia, y desde ahí solo
 * guarda el largo y el HMAC de cada variante. Buscar es recorrer el texto con una ventana de cada largo y
 * comparar HMAC.
 *
 * Tradeoff: el largo de cada variante queda en memoria, y quien tuviera a la vez la clave y los HMAC
 * podría probar candidatos. Los dos viven solo en la memoria del proceso que redacta, y se descartan al
 * terminar la ejecución. Los valores de menos de 4 caracteres no se buscan: darían falsos positivos.
 */
import { createHmac, randomBytes } from 'node:crypto';

export const LARGO_MINIMO_SECRETO = 4;

export interface Coincidencia {
  inicio: number;
  fin: number;
}

/** Las formas en que un secreto suele aparecer escrito. */
export function variantesDeSecreto(secreto: string): string[] {
  if (secreto.length < LARGO_MINIMO_SECRETO) return [];
  const bytes = Buffer.from(secreto, 'utf8');
  const variantes = [
    secreto,
    encodeURIComponent(secreto),
    encodeURIComponent(secreto).replace(/%20/g, '+'),
    bytes.toString('base64'),
    bytes.toString('base64').replace(/=+$/, ''),
    bytes.toString('base64url'),
    bytes.toString('hex'),
    bytes.toString('hex').toUpperCase(),
  ];
  return [...new Set(variantes)].filter((v) => v.length >= LARGO_MINIMO_SECRETO);
}

export class ComparadorDeSecretos {
  private clave: Buffer;
  private readonly porLargo = new Map<number, Set<string>>();

  private constructor(secretos: readonly Uint8Array[]) {
    this.clave = randomBytes(32);
    for (const secreto of secretos) {
      const texto = Buffer.from(secreto).toString('utf8');
      for (const variante of variantesDeSecreto(texto)) {
        const conjunto = this.porLargo.get(variante.length) ?? new Set<string>();
        conjunto.add(this.hmac(variante));
        this.porLargo.set(variante.length, conjunto);
      }
    }
  }

  /** Quien lo crea borra los secretos que le pasó; el comparador no los conserva. */
  static crear(secretos: readonly Uint8Array[]): ComparadorDeSecretos {
    return new ComparadorDeSecretos(secretos);
  }

  /** Un comparador que no busca nada: para un proyecto sin credenciales. */
  static vacio(): ComparadorDeSecretos {
    return new ComparadorDeSecretos([]);
  }

  get estaVacio(): boolean {
    return this.porLargo.size === 0;
  }

  private hmac(texto: string): string {
    return createHmac('sha256', this.clave).update(texto, 'utf8').digest('hex');
  }

  /** Dónde aparece algún secreto, en posiciones del texto. Sin superposiciones por largo. */
  buscar(texto: string): Coincidencia[] {
    const coincidencias: Coincidencia[] = [];
    for (const [largo, hmacs] of this.porLargo) {
      for (let i = 0; i + largo <= texto.length; i++) {
        if (hmacs.has(this.hmac(texto.slice(i, i + largo)))) {
          coincidencias.push({ inicio: i, fin: i + largo });
          i += largo - 1;
        }
      }
    }
    return coincidencias;
  }

  /** Al terminar la ejecución: borra la clave y olvida los HMAC. */
  descartar(): void {
    this.clave.fill(0);
    this.clave = Buffer.alloc(0);
    this.porLargo.clear();
  }
}
