/**
 * La huella de un hallazgo (especificación 5.1, ADR 046): reconoce el mismo problema entre ejecuciones del
 * proyecto, sin guardar texto de la página en claro.
 *
 * huella = HMAC-SHA-256(subclave del proyecto, versión · tipo · alcance · clave)
 *
 * - **Tipo:** el chequeo que lo encontró.
 * - **Alcance:** dónde está el problema, según el tipo (`ALCANCE_POR_TIPO`): el sitio (el origen), el destino
 *   (la URL rota) o la forma de la página (la URL sin query, con los segmentos con dígitos como `#`).
 * - **Clave:** qué problema es, sin lo que cambia entre corridas. Para un mensaje, el HMAC del mensaje
 *   redactado y normalizado (ADR 032), con la normalización v2.
 * - **Afuera:** el título, la severidad, los selectores, el rol y el detalle. Un selector cambia con cada build.
 *
 * Sin `electron`: se prueba con Vitest y dentro de Electron (`test:crypto:electron`).
 */
import { createHmac } from 'node:crypto';
import type { TipoHallazgo } from '@qatlas/shared';

/** La versión de la normalización de los mensajes. Se guarda en cada hallazgo: si cambia, se recalcula. */
export const VERSION_NORMALIZACION = 2;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Un token hexadecimal de 6 o más caracteres con letras y dígitos: un hash de bundle, un ID corto. */
const HEXADECIMAL = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,}\b/gi;
/** Un código de estado HTTP nombrado como tal: distingue «status code 404» de «status code 500». */
const ANTES_DE_UN_ESTADO = /(?:status(?: code)?|code|http|c[oó]digo|estado)\s*[:=]?\s*$/i;

/**
 * La normalización v2 de un mensaje de consola o de una excepción (ADR 046). Sobre el texto ya redactado.
 *
 * - Solo la primera línea: la pila cambia con cada build.
 * - UUID y tokens hexadecimales con letras y dígitos (hashes de bundle, IDs cortos): `<id>`.
 * - Los números: `#`. Salvo un código de estado HTTP nombrado como tal, que distingue dos errores.
 *
 * La v1 (`normalizarMensaje` de `@qatlas/redaction`) no sacaba los hashes ni los IDs hexadecimales: el
 * mismo error salía como nuevo después de cada deploy.
 */
export function normalizarMensajeV2(texto: string): string {
  const linea = (texto.split('\n')[0] ?? '').trim();
  const sinIds = linea.replace(UUID, '<id>').replace(HEXADECIMAL, '<id>');
  return sinIds
    .replace(/\d+/g, (numero, posicion: number) =>
      /^[1-5]\d\d$/.test(numero) && ANTES_DE_UN_ESTADO.test(sinIds.slice(0, posicion))
        ? numero
        : '#',
    )
    .slice(0, 200);
}

export type Alcance = 'sitio' | 'destino' | 'forma';

/**
 * Dónde está cada tipo de problema:
 * - **sitio:** lo que es del origen, no de una página: una cookie, un host bloqueado, un secreto guardado
 *   en el navegador.
 * - **destino:** un link roto es la URL rota, no cada página que la enlaza.
 * - **forma:** lo demás es de la página; el mismo error en `/producto/12` y en `/producto/98` es uno.
 */
export const ALCANCE_POR_TIPO: Readonly<Record<TipoHallazgo, Alcance>> = {
  'error-http': 'forma',
  'link-roto': 'destino',
  'recurso-con-error': 'forma',
  'error-javascript': 'forma',
  'console-error': 'forma',
  accesibilidad: 'forma',
  rendimiento: 'forma',
  'cookie-insegura': 'sitio',
  'contenido-mixto': 'forma',
  'login-sin-cifrar': 'forma',
  'recurso-externo-bloqueado': 'sitio',
  'parametro-sensible': 'forma',
  'secreto-en-almacenamiento': 'sitio',
};

/** Una ruta con los segmentos que tienen dígitos como `#` (como las trampas de la ADR 022). */
export function formaDeRuta(ruta: string): string {
  return ruta
    .split('/')
    .map((segmento) => (/\d/.test(segmento) ? '#' : segmento))
    .join('/');
}

/** La URL sin query ni fragmento, con la forma de su ruta. Si no es una URL, el texto tal cual. */
export function formaDeUrl(texto: string): string {
  try {
    const url = new URL(texto);
    return url.origin + formaDeRuta(url.pathname);
  } catch {
    return texto;
  }
}

function sinQuery(texto: string): string {
  try {
    const url = new URL(texto);
    return url.origin + url.pathname;
  } catch {
    return texto;
  }
}

function origen(texto: string): string {
  try {
    return new URL(texto).origin;
  } catch {
    return texto;
  }
}

/** El alcance de un hallazgo, a partir de su URL (ya redactada y sin query). */
export function alcanceDe(tipo: TipoHallazgo, url: string): string {
  switch (ALCANCE_POR_TIPO[tipo]) {
    case 'sitio':
      return origen(url);
    case 'destino':
      return sinQuery(url);
    case 'forma':
      return formaDeUrl(url);
  }
}

/**
 * La clave sin lo que cambia entre corridas. Un recurso con error es «estado ruta»: la ruta del recurso va
 * por su forma, como la de la página (`404 /img/123.png` → `404 /img/#`).
 */
export function claveEstable(tipo: TipoHallazgo, clave: string): string {
  if (tipo !== 'recurso-con-error') return clave;
  const m = /^(\d{3}) (\/.*)$/.exec(clave);
  return m ? `${m[1] ?? ''} ${formaDeRuta(m[2] ?? '')}` : clave;
}

const VERSION_HUELLA = 'h1';

/** La huella: HMAC-SHA-256 con la subclave de huellas del proyecto. Determinística dentro del proyecto. */
export function huellaDe(
  subclave: Buffer,
  hallazgo: { tipo: TipoHallazgo; url: string; clave: string },
): string {
  const alcance = alcanceDe(hallazgo.tipo, hallazgo.url);
  const clave = claveEstable(hallazgo.tipo, hallazgo.clave);
  const hmac = createHmac('sha256', subclave)
    .update([VERSION_HUELLA, hallazgo.tipo, alcance, clave].join('\0'))
    .digest('hex');
  return `${VERSION_HUELLA}:${hmac}`;
}
