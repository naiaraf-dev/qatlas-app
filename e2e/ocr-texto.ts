/**
 * La comparación del OCR y el testigo (ADR 039), sin tesseract: se prueba con Vitest
 * (security-tests/ocr-testigo.test.ts).
 *
 * Un «el secreto no aparece» solo vale si el OCR leyó la imagen. Cada página del sandbox muestra un texto
 * testigo (`TESTIGO_OCR`, apps/sandbox-site/src/testigo.mjs): en cada captura o fotograma revisado, el
 * OCR tiene que leerlo. Si no lo lee, esa imagen no se pudo comprobar, y la aserción falla por eso en
 * lugar de dar por bueno que el secreto no está.
 */

/**
 * Normaliza para comparar lo leído con lo buscado: mayúsculas, sin espacios ni signos, y las
 * confusiones típicas del OCR (O y 0, I, L y 1, S y 5, B y 8) llevadas a una sola forma.
 */
export function normalizar(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

/** Distancia de edición, para tolerar uno o dos caracteres mal leídos. */
function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0] ?? 0;
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const actual = fila[j] ?? 0;
      fila[j] = Math.min(
        actual + 1,
        (fila[j - 1] ?? 0) + 1,
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      anterior = actual;
    }
  }
  return fila[b.length] ?? 0;
}

/**
 * Si el texto leído contiene lo buscado, con hasta `tolerancia` caracteres distintos. Tolerar errores
 * hace que la búsqueda encuentre más, nunca menos: un falso positivo hace fallar el test, no lo aprueba.
 */
export function contiene(leido: string, buscado: string, tolerancia = 2): boolean {
  const texto = normalizar(leido);
  const aguja = normalizar(buscado);
  if (aguja.length === 0) return false;
  if (texto.includes(aguja)) return true;
  for (let inicio = 0; inicio + aguja.length - tolerancia <= texto.length; inicio++) {
    for (const largo of [aguja.length - 1, aguja.length, aguja.length + 1]) {
      const ventana = texto.slice(inicio, inicio + largo);
      if (ventana.length >= aguja.length - tolerancia && distancia(ventana, aguja) <= tolerancia) {
        return true;
      }
    }
  }
  return false;
}

export interface Lectura {
  /** Lo que leyó el OCR. */
  texto: string;
  /** La imagen es de un solo color (una página en blanco mientras navega): no puede tener texto. */
  uniforme: boolean;
}

export type Clasificacion = 'vacia' | 'con-secreto' | 'sin-testigo' | 'comprobada';

/** Qué se puede afirmar de una imagen. Un secreto leído pesa más que la falta de testigo. */
export function clasificar(
  lectura: Lectura,
  secretos: readonly string[],
  testigo: string,
): Clasificacion {
  if (lectura.uniforme) return 'vacia';
  if (secretos.some((s) => contiene(lectura.texto, s))) return 'con-secreto';
  if (!contiene(lectura.texto, testigo)) return 'sin-testigo';
  return 'comprobada';
}

export interface Veredicto {
  resultado: 'limpio' | 'secreto-visible' | 'no-comprobable';
  /** Índices de las imágenes de cada clase, para diagnosticar. */
  porClase: Record<Clasificacion, number[]>;
}

/**
 * - Un secreto leído en cualquier imagen: `secreto-visible`.
 * - Una imagen con algo dibujado donde no se leyó el testigo, o ninguna imagen comprobada:
 *   `no-comprobable` (no se puede afirmar que el secreto no está).
 * - Si no: `limpio`.
 */
export function veredicto(
  lecturas: readonly Lectura[],
  secretos: readonly string[],
  testigo: string,
): Veredicto {
  const porClase: Record<Clasificacion, number[]> = {
    vacia: [],
    'con-secreto': [],
    'sin-testigo': [],
    comprobada: [],
  };
  lecturas.forEach((lectura, i) => {
    porClase[clasificar(lectura, secretos, testigo)].push(i);
  });
  if (porClase['con-secreto'].length > 0) return { resultado: 'secreto-visible', porClase };
  if (porClase['sin-testigo'].length > 0 || porClase.comprobada.length === 0) {
    return { resultado: 'no-comprobable', porClase };
  }
  return { resultado: 'limpio', porClase };
}
