/**
 * Nombres sensibles de parámetros, campos y encabezados. Se comparan por **segmentos** (como el chequeo
 * de parámetros sensibles de la semana 6b): `access_token`, `apiKey` y `X-Auth-Token` lo son;
 * `tokenizer` y `authors`, no.
 */

/** `accessToken` → access, token; `X-API-Key` → x, api, key. */
export function segmentosDeNombre(nombre: string): string[] {
  return nombre
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_.\-[\]]+/)
    .filter(Boolean)
    .map((segmento) => segmento.toLowerCase());
}

/** Un segmento de estos hace sensible al nombre entero. */
export const SEGMENTOS_SENSIBLES: ReadonlySet<string> = new Set([
  'token',
  'code',
  'session',
  'sessionid',
  'sid',
  'jwt',
  'apikey',
  'password',
  'passwd',
  'pwd',
  'secret',
  'auth',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'credentials',
  'credencial',
  'credenciales',
  'clave',
  'contrasena',
  'contraseña',
  'otp',
  'pin',
  'signature',
]);

/**
 * Sensible por nombre: el valor se redacta siempre, sea como sea. Un segmento, o dos o tres seguidos
 * unidos (`X-API-Key` → «apikey», `session_id` → «sessionid»).
 */
export function esNombreSensible(nombre: string): boolean {
  const segmentos = segmentosDeNombre(nombre);
  for (let desde = 0; desde < segmentos.length; desde++) {
    for (let largo = 1; largo <= 3 && desde + largo <= segmentos.length; largo++) {
      if (SEGMENTOS_SENSIBLES.has(segmentos.slice(desde, desde + largo).join(''))) return true;
    }
  }
  return false;
}

/**
 * Sospechoso: el nombre contiene una de estas palabras, aunque no sea un segmento (`apiKeyId`,
 * `x-signing-key`). El valor se redacta solo si además parece un secreto (largo y entropía alta).
 */
const FRAGMENTOS_SOSPECHOSOS = [
  'key',
  'token',
  'secret',
  'pass',
  'auth',
  'cred',
  'sig',
  'priv',
  'sess',
  'cookie',
];

export function esNombreSospechoso(nombre: string): boolean {
  const minusculas = nombre.toLowerCase();
  return FRAGMENTOS_SOSPECHOSOS.some((fragmento) => minusculas.includes(fragmento));
}

/** Los encabezados que siempre se redactan (EVI-03). */
export const ENCABEZADOS_SENSIBLES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);
