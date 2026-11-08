/**
 * Lo que cambia entre ejecuciones sin cambiar el problema: números, IDs, horas. La clave de un hallazgo
 * de consola se calcula sobre el mensaje ya redactado y normalizado (ADR 032), así el mismo problema da
 * la misma clave.
 */
export function normalizarMensaje(texto: string): string {
  return (texto.split('\n')[0] ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 200);
}
