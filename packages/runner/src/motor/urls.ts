/**
 * Qué URLs recorre el crawler (RN-ESC-04): cada una se analiza una sola vez, y una trampa de URLs
 * infinitas se corta. Funciones puras.
 *
 * Normalización:
 * - Sin fragmento: `#seccion` es la misma página.
 * - Host en minúsculas y sin el puerto por defecto (lo hace el parser de URL).
 * - Parámetros ordenados por nombre y valor: `?b=2&a=1` y `?a=1&b=2` son la misma.
 * - Sin barra final, salvo en la raíz: `/panel/` y `/panel` son la misma.
 * - Solo http y https, y como máximo 2048 caracteres.
 */
export const LARGO_MAXIMO_URL = 2048;

export function normalizarUrl(texto: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(texto, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  const parametros = [...url.searchParams.entries()].sort(([a, va], [b, vb]) =>
    a === b ? va.localeCompare(vb) : a.localeCompare(b),
  );
  url.search = new URLSearchParams(parametros).toString();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  }
  const resultado = url.href;
  return resultado.length > LARGO_MAXIMO_URL ? null : resultado;
}

/** La URL sin query: lo que se guarda en claro. La query puede traer tokens. */
export function sinQuery(texto: string): string {
  const url = new URL(texto);
  return url.origin + url.pathname;
}

/** La forma de una ruta: los segmentos con números se reemplazan. `/calendario/2026/11` → `/calendario/#/#`. */
export function formaDeRuta(texto: string): string {
  const url = new URL(texto);
  const forma = url.pathname
    .split('/')
    .map((segmento) => (/\d/.test(segmento) ? '#' : segmento))
    .join('/');
  return url.origin + forma;
}

export interface Pendiente {
  url: string;
  profundidad: number;
  /** La página donde estaba el link. `null` para la URL base. */
  origen: string | null;
}

export type Resultado = 'agregada' | 'repetida' | 'trampa';

export const LIMITES_DE_TRAMPA = { variantesPorRuta: 20, rutasPorForma: 10 } as const;

/**
 * La cola del recorrido, en anchura. Contra trampas: hasta 20 variantes de query por ruta y hasta 10
 * rutas por forma. Así un calendario o un parámetro que cambia siempre no llenan el máximo de páginas.
 */
export class Frontera {
  private readonly cola: Pendiente[] = [];
  private readonly vistas = new Set<string>();
  private readonly variantes = new Map<string, number>();
  private readonly rutasPorForma = new Map<string, Set<string>>();
  descartadasPorTrampa = 0;

  agregar(url: string, profundidad: number, origen: string | null): Resultado {
    if (this.vistas.has(url)) return 'repetida';
    const ruta = sinQuery(url);
    const forma = formaDeRuta(url);
    const variantes = this.variantes.get(ruta) ?? 0;
    const rutas = this.rutasPorForma.get(forma) ?? new Set<string>();
    const rutaNueva = !rutas.has(ruta);
    if (
      variantes >= LIMITES_DE_TRAMPA.variantesPorRuta ||
      (rutaNueva && rutas.size >= LIMITES_DE_TRAMPA.rutasPorForma)
    ) {
      this.descartadasPorTrampa += 1;
      return 'trampa';
    }
    this.vistas.add(url);
    this.variantes.set(ruta, variantes + 1);
    rutas.add(ruta);
    this.rutasPorForma.set(forma, rutas);
    this.cola.push({ url, profundidad, origen });
    return 'agregada';
  }

  /** Para una URL a la que se llegó por una redirección: cuenta como vista. */
  marcarVista(url: string): void {
    this.vistas.add(url);
  }

  siguiente(): Pendiente | undefined {
    return this.cola.shift();
  }

  get quedan(): number {
    return this.cola.length;
  }
}
