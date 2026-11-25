/**
 * La fuente del texto que leen los tests con OCR (ADR 039): JetBrains Mono, empaquetada y servida por el
 * propio sandbox, nunca la del sistema. Con la del sistema, el mismo texto se leía en Windows y no en
 * Linux: un `<input>` no hereda la fuente de la página, y el OCR dejaba de leer la nota con Courier New,
 * Times o a 16 px. Monoespaciada, con 0 y O, 1 e I distintos. Licencia OFL-1.1.
 *
 * Es la misma versión que usa la interfaz de la app (`@fontsource-variable/jetbrains-mono`), solo el
 * subconjunto latino, que tiene tildes y eñes. Se sirve en la misma conexión que la página: nada externo.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export const RUTA_FUENTE = '/fuente/control.woff2';

/** La familia, con `monospace` solo por si la fuente no cargara: el control positivo fallaría. */
export const FAMILIA_CONTROL = "'QAtlas Control', monospace";

const requerir = createRequire(import.meta.url);
/** @type {Buffer | undefined} */
let bytes;
export const leerFuenteDeControl = () =>
  (bytes ??= readFileSync(
    requerir.resolve(
      '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    ),
  ));

/**
 * Va en el `<head>` (o al principio del cuerpo). El `preload` hace que el evento `load` espere la fuente:
 * el crawler navega con `waitUntil: 'load'` y captura después, así que la captura ya la tiene. Con
 * `font-display: block`, nunca se dibuja con otra fuente mientras carga.
 */
export const ESTILO_FUENTE = `<link rel="preload" href="${RUTA_FUENTE}" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'QAtlas Control';src:url('${RUTA_FUENTE}') format('woff2');font-weight:100 800;font-display:block}</style>`;

/** Sirve la fuente. Devuelve si atendió la solicitud. */
export function atenderFuente(req, res, ruta) {
  if (req.method !== 'GET' || ruta !== RUTA_FUENTE) return false;
  res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' });
  res.end(leerFuenteDeControl());
  return true;
}
