/**
 * Por qué no arrancó el navegador. Es para el log del proceso principal: la interfaz solo dice que no
 * está disponible. Funciones puras. Al lanzarlo todavía no se abrió ningún sitio ni viajó ningún secreto.
 */
export type CausaNavegador = 'ruta' | 'perfil-ruta-larga' | 'sandbox' | 'dependencias' | 'otra';

const LARGO_MAXIMO_DETALLE = 300;

/**
 * Chromium crea su socket de instancia única en `TMPDIR`, y el runner lo apunta al perfil. En Linux y
 * macOS, la ruta de un socket Unix no puede pasar de 107 bytes.
 */
const LARGO_MAXIMO_SOCKET = 107;
const SUFIJO_SOCKET = '/.org.chromium.Chromium.XXXXXX/SingletonSocket';

export function perfilDemasiadoLargo(carpetaTemporal: string, plataforma: string): boolean {
  if (plataforma === 'win32') return false;
  return Buffer.byteLength(carpetaTemporal + SUFIJO_SOCKET) > LARGO_MAXIMO_SOCKET;
}

export function causaDeFalla(mensaje: string): CausaNavegador {
  if (/Executable doesn't exist|ENOENT/i.test(mensaje)) return 'ruta';
  if (/sandbox|namespace/i.test(mensaje)) return 'sandbox';
  if (/shared librar|error while loading|Host system is missing/i.test(mensaje)) {
    return 'dependencias';
  }
  return 'otra';
}

/** Solo las líneas de error de Chromium, sin rutas: el log del CI es público. */
export function detalleDeFalla(mensaje: string): string {
  return mensaje
    .split(/\r?\n/)
    .filter((linea) => /FATAL|ERROR:|error while loading|Executable doesn't exist/i.test(linea))
    .map((linea) => linea.replace(/(?:[A-Za-z]:)?[\\/][^\s:'"]*[\\/][^\s:'"]*/g, '<ruta>').trim())
    .join(' | ')
    .slice(0, LARGO_MAXIMO_DETALLE);
}
