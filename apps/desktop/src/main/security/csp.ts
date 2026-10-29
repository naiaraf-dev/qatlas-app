/**
 * Content Security Policy de la interfaz (especificación 3.5).
 *
 * Producción: la interfaz solo carga sus propios archivos y no puede abrir
 * ninguna conexión (`connect-src 'none'`): todo pasa por IPC.
 *
 * Desarrollo: Vite necesita estilos y un script inline para la recarga en
 * caliente, y un WebSocket al servidor local. Esta política NUNCA se usa en la
 * app empaquetada.
 */
export function buildCsp(options: { dev: boolean; devServerOrigin?: string }): string {
  if (options.dev) {
    const origin = options.devServerOrigin ?? 'http://localhost:5173';
    const ws = origin.replace(/^http/, 'ws');
    return [
      "default-src 'none'",
      `script-src 'self' 'unsafe-inline' ${origin}`,
      `style-src 'self' 'unsafe-inline' ${origin}`,
      `img-src 'self' data: blob: ${origin}`,
      `font-src 'self' ${origin}`,
      `connect-src 'self' ${origin} ${ws}`,
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "media-src 'self' blob:",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
