/**
 * El testigo del OCR (ADR 039): un texto fijo, no secreto, en toda página HTML del sandbox. Los tests que
 * dicen «el secreto no aparece» en una captura o un fotograma exigen que el OCR lea el testigo en esa
 * imagen: si no lo lee, no pueden afirmar nada y fallan como «no se pudo comprobar».
 *
 * - Arriba a la derecha, `position: fixed`: se ve en cualquier fotograma, aunque la página se mueva.
 * - Negro sobre blanco, 28 px, sin borde (con el texto pegado a un borde, el OCR no lo lee), con la fuente
 *   empaquetada (no la del sistema) y `font-display: swap`: está
 *   visible desde el primer cuadro, aunque la fuente todavía cargue.
 * - `aria-hidden`: no es contenido para el lector de pantalla, ni para los chequeos del escáner.
 * - Se inserta en un solo lugar (`conTestigoEnHtml`), en las respuestas HTML del servidor.
 */
import { RUTA_FUENTE } from './fuente.mjs';

export const TESTIGO_OCR = 'TESTIGO OCR 2468';

export const HTML_TESTIGO =
  `<style>@font-face{font-family:'QAtlas Testigo';src:url('${RUTA_FUENTE}') format('woff2');font-weight:100 800;font-display:swap}</style>` +
  `<div aria-hidden="true" data-qatlas-testigo style="position:fixed;top:8px;right:12px;z-index:2147483647;` +
  `background:#fff;color:#000;font:700 28px 'QAtlas Testigo',monospace;padding:6px 14px;` +
  `pointer-events:none">${TESTIGO_OCR}</div>`;

/** El HTML con el testigo al principio del cuerpo (o donde el navegador abre el cuerpo). */
export function conTestigoEnHtml(html) {
  for (const marca of [/<body\b[^>]*>/i, /<\/head>/i, /<\/title>/i, /<!doctype html>/i]) {
    const m = marca.exec(html);
    if (m)
      return (
        html.slice(0, m.index + m[0].length) + HTML_TESTIGO + html.slice(m.index + m[0].length)
      );
  }
  return HTML_TESTIGO + html;
}

const esHtml = (tipo) => typeof tipo === 'string' && tipo.toLowerCase().startsWith('text/html');

/**
 * Envuelve la respuesta: si es HTML y se manda de una vez (`end`), le agrega el testigo y corrige el
 * `content-length`. Lo que se manda por partes (`write`) pasa sin cambios.
 */
export function instalarTestigo(res) {
  const writeHead = res.writeHead.bind(res);
  const write = res.write.bind(res);
  const end = res.end.bind(res);
  /** @type {unknown[] | null} */
  let cabecera = null;
  const enviarCabecera = () => {
    if (cabecera) writeHead(...cabecera);
    cabecera = null;
  };
  res.writeHead = (...args) => {
    cabecera = args;
    return res;
  };
  res.write = (...args) => {
    enviarCabecera();
    return write(...args);
  };
  res.end = (cuerpo, ...resto) => {
    const encabezados = cabecera ? cabecera.find((a) => a && typeof a === 'object') : undefined;
    const tipo = encabezados?.['content-type'] ?? res.getHeader('content-type');
    if (esHtml(tipo) && (typeof cuerpo === 'string' || Buffer.isBuffer(cuerpo))) {
      const nuevo = Buffer.from(conTestigoEnHtml(cuerpo.toString()));
      if (encabezados && 'content-length' in encabezados) {
        encabezados['content-length'] = nuevo.length;
      } else if (res.getHeader('content-length') !== undefined) {
        res.setHeader('content-length', nuevo.length);
      }
      enviarCabecera();
      return end(nuevo, ...resto);
    }
    enviarCabecera();
    return end(cuerpo, ...resto);
  };
}
