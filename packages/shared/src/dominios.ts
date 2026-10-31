import { parse } from 'tldts';

/**
 * Validación de dominios y URLs de un proyecto (SEG-02, RN-PRY-02 y RN-PRY-05, ADR 011).
 *
 * Funciones puras: las usa el proceso principal, que es quien decide. La interfaz recibe el resultado
 * por `proyectos:validar`, así hay una sola regla. Lo dudoso se rechaza.
 */
export type MotivoDominio =
  | 'vacio'
  | 'invalido'
  | 'esquema-no-permitido'
  | 'credenciales-en-url'
  | 'comodin-invalido'
  | 'comodin-amplio'
  | 'sufijo-publico'
  | 'ip-no-canonica'
  | 'ip-no-permitida'
  | 'localhost-no-exacto'
  | 'requiere-sistema-interno';

export type MotivoAlcance = MotivoDominio | 'sin-dominios' | 'url-fuera-de-dominios';
export type MotivoLogin = MotivoDominio | 'login-fuera-de-dominios' | 'login-sin-cifrar';

export interface OpcionesDominio {
  /** "Sistema interno": habilita IPs privadas y nombres de una etiqueta, solo como host exacto. */
  sistemaInterno?: boolean;
}

export type Resultado<T, M> = ({ ok: true } & T) | { ok: false; motivo: M };

export interface EntradaAlcance {
  urlBase: string;
  dominios: readonly string[];
  sistemaInterno: boolean;
}

export interface ErrorAlcance {
  campo: 'urlBase' | 'dominios';
  motivo: MotivoAlcance;
}

export type ResultadoAlcance =
  { ok: true; urlBase: string; dominios: string[] } | { ok: false; errores: ErrorAlcance[] };

const LARGO_MAXIMO_HOST = 253;
const LARGO_MAXIMO_ENTRADA = 2048;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const NOMBRE_DNS = /^[a-z0-9._-]+$/;
const CON_ESQUEMA = /^([a-z][a-z0-9+.-]*):\/\//i;
// Espacios, controles, barra invertida y arroba: formas conocidas de engañar a un parser de URL.
// eslint-disable-next-line no-control-regex
const CARACTERES_PROHIBIDOS = /[\s\u0000-\u001f\u007f\\@]/;

const LOOPBACK_IP = '127.0.0.1';
const LOCALHOST = 'localhost';
const ETIQUETAS_RESERVADAS = new Set(['example', 'invalid', 'local', 'localhost', 'onion', 'test']);

function esIpPrivada(ip: string): boolean {
  const [a = -1, b = -1] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Por qué no se admite el host, ya normalizado. `null` si se admite. */
function motivoDelHost(
  host: string,
  comodin: boolean,
  sistemaInterno: boolean,
): MotivoDominio | null {
  if (host.startsWith('[')) return 'ip-no-permitida';
  if (IPV4.test(host)) {
    if (comodin) return 'comodin-amplio';
    if (host === LOOPBACK_IP) return null;
    if (!esIpPrivada(host)) return 'ip-no-permitida';
    return sistemaInterno ? null : 'requiere-sistema-interno';
  }
  if (host === LOCALHOST) return comodin ? 'comodin-amplio' : null;
  if (host.endsWith(`.${LOCALHOST}`)) return 'localhost-no-exacto';
  // El parser de URL deja pasar caracteres como `*` en un host: acá solo sigue un nombre DNS.
  if (host.length > LARGO_MAXIMO_HOST || !NOMBRE_DNS.test(host) || host.split('.').includes('')) {
    return 'invalido';
  }

  const analisis = parse(host, {
    allowPrivateDomains: true,
    extractHostname: false,
    detectIp: false,
  });
  if (analisis.hostname === null) return 'invalido';

  if (!host.includes('.')) {
    if (analisis.isIcann === true || ETIQUETAS_RESERVADAS.has(host)) {
      return comodin ? 'comodin-amplio' : 'sufijo-publico';
    }
    if (comodin) return 'comodin-amplio';
    return sistemaInterno ? null : 'requiere-sistema-interno';
  }
  // Sin dominio registrable: el host es un sufijo público, como co.uk o github.io.
  if (analisis.domain === null) return comodin ? 'comodin-amplio' : 'sufijo-publico';
  return null;
}

/**
 * El host tal como se escribió, para detectar las formas alternativas de una IP: el parser de URL
 * convierte 2130706433, 0x7f.1 y 010.0.0.1 en una IPv4 con puntos.
 */
function hostEscrito(texto: string): string {
  const sinEsquema = texto.replace(CON_ESQUEMA, '');
  const hasta = sinEsquema.search(/[/?#]/);
  const autoridad = hasta === -1 ? sinEsquema : sinEsquema.slice(0, hasta);
  return autoridad.replace(/:\d*$/, '').toLowerCase();
}

function hostDeUrl(url: URL, texto: string): Resultado<{ host: string }, MotivoDominio> {
  const { hostname } = url;
  if (IPV4.test(hostname) && hostEscrito(texto) !== hostname) {
    return { ok: false, motivo: 'ip-no-canonica' };
  }
  return { ok: true, host: hostname.endsWith('.') ? hostname.slice(0, -1) : hostname };
}

/** Lee una URL http o https sin decidir todavía si su host se admite. */
function analizarUrl(entrada: string): Resultado<{ url: URL; host: string }, MotivoDominio> {
  const texto = entrada.trim();
  if (!texto) return { ok: false, motivo: 'vacio' };
  if (texto.length > LARGO_MAXIMO_ENTRADA) return { ok: false, motivo: 'invalido' };

  const esquema = CON_ESQUEMA.exec(texto)?.[1]?.toLowerCase();
  if (esquema === undefined) {
    // Esquemas sin "//", como "javascript:" o "mailto:": tampoco son http.
    return {
      ok: false,
      motivo: /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(texto) ? 'esquema-no-permitido' : 'invalido',
    };
  }
  if (esquema !== 'http' && esquema !== 'https')
    return { ok: false, motivo: 'esquema-no-permitido' };
  if (texto.includes('@')) return { ok: false, motivo: 'credenciales-en-url' };
  if (CARACTERES_PROHIBIDOS.test(texto)) return { ok: false, motivo: 'invalido' };

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
  const host = hostDeUrl(url, texto);
  return host.ok ? { ok: true, url, host: host.host } : host;
}

/**
 * Normaliza una entrada de la lista de dominios: minúsculas, punycode, sin esquema, puerto, ruta ni
 * punto final. Un comodín solo es válido como `*.` al principio, y no incluye al dominio mismo.
 */
export function validarDominio(
  entrada: string,
  { sistemaInterno = false }: OpcionesDominio = {},
): Resultado<{ valor: string }, MotivoDominio> {
  const inicial = entrada.trim();
  if (!inicial) return { ok: false, motivo: 'vacio' };
  if (inicial.length > LARGO_MAXIMO_ENTRADA) return { ok: false, motivo: 'invalido' };

  const esquema = CON_ESQUEMA.exec(inicial)?.[1]?.toLowerCase();
  if (esquema !== undefined && esquema !== 'http' && esquema !== 'https') {
    return { ok: false, motivo: 'esquema-no-permitido' };
  }
  if (inicial.includes('@')) return { ok: false, motivo: 'credenciales-en-url' };
  if (CARACTERES_PROHIBIDOS.test(inicial)) return { ok: false, motivo: 'invalido' };

  let texto = inicial.replace(CON_ESQUEMA, '');
  if (texto === '*') return { ok: false, motivo: 'comodin-amplio' };
  const comodin = texto.startsWith('*.');
  if (comodin) texto = texto.slice(2);
  if (texto.includes('*')) return { ok: false, motivo: 'comodin-invalido' };
  if (!texto) return { ok: false, motivo: comodin ? 'comodin-amplio' : 'vacio' };

  let url: URL;
  try {
    url = new URL(`http://${texto}`);
  } catch {
    return { ok: false, motivo: 'invalido' };
  }
  const host = hostDeUrl(url, texto);
  if (!host.ok) return host;

  const motivo = motivoDelHost(host.host, comodin, sistemaInterno);
  if (motivo) return { ok: false, motivo };
  return { ok: true, valor: comodin ? `*.${host.host}` : host.host };
}

/** La URL base normalizada, sin fragmento. Admite puerto y ruta. */
export function validarUrlBase(
  entrada: string,
  { sistemaInterno = false }: OpcionesDominio = {},
): Resultado<{ url: string; host: string }, MotivoDominio> {
  const analisis = analizarUrl(entrada);
  if (!analisis.ok) return analisis;
  const motivo = motivoDelHost(analisis.host, false, sistemaInterno);
  if (motivo) return { ok: false, motivo };
  const { url, host } = analisis;
  url.hash = '';
  if (url.hostname !== host) url.hostname = host;
  return { ok: true, url: url.href, host };
}

/**
 * Coincidencia por etiquetas completas: `lexora.test.evil.com` y `evillexora.test` no pertenecen a
 * `lexora.test`, y `*.lexora.test` no incluye a `lexora.test`.
 */
export function hostPertenece(host: string, patrones: readonly string[]): boolean {
  return patrones.some((patron) =>
    patron.startsWith('*.') ? host.endsWith(patron.slice(1)) : host === patron,
  );
}

/** El host exacto de la URL, no todo su dominio registrable: no amplía el alcance por su cuenta. */
export function proponerDominio(urlBase: string, opciones: OpcionesDominio = {}): string | null {
  const resultado = validarUrlBase(urlBase, opciones);
  return resultado.ok ? resultado.host : null;
}

/** RN-PRY-02 y RN-PRY-05 juntas: devuelve el alcance normalizado o todos los errores. */
export function validarAlcance({
  urlBase,
  dominios,
  sistemaInterno,
}: EntradaAlcance): ResultadoAlcance {
  const errores: ErrorAlcance[] = [];
  const url = validarUrlBase(urlBase, { sistemaInterno });
  if (!url.ok) errores.push({ campo: 'urlBase', motivo: url.motivo });

  const normalizados = new Set<string>();
  for (const dominio of dominios) {
    const resultado = validarDominio(dominio, { sistemaInterno });
    if (resultado.ok) normalizados.add(resultado.valor);
    else errores.push({ campo: 'dominios', motivo: resultado.motivo });
  }
  if (dominios.length === 0) errores.push({ campo: 'dominios', motivo: 'sin-dominios' });

  const lista = [...normalizados];
  if (url.ok && lista.length > 0 && !hostPertenece(url.host, lista)) {
    errores.push({ campo: 'urlBase', motivo: 'url-fuera-de-dominios' });
  }
  return errores.length > 0 || !url.ok
    ? { ok: false, errores }
    : { ok: true, urlBase: url.url, dominios: lista };
}

function loginHttpSiempreAdmitido(host: string): boolean {
  return host === LOCALHOST || host === LOOPBACK_IP || host.endsWith('.test');
}

/**
 * La URL de login debe estar dentro de los dominios del proyecto: ahí se va a enviar el secreto. En
 * http viaja sin cifrar, así que hace falta la opción explícita, salvo en equipos locales y `.test`.
 */
export function validarUrlLogin(
  entrada: string,
  { dominios, permitirLoginHttp }: { dominios: readonly string[]; permitirLoginHttp: boolean },
): Resultado<{ url: string }, MotivoLogin> {
  const analisis = analizarUrl(entrada);
  if (!analisis.ok) return analisis;
  const { url, host } = analisis;
  if (!hostPertenece(host, dominios)) return { ok: false, motivo: 'login-fuera-de-dominios' };
  if (url.protocol === 'http:' && !permitirLoginHttp && !loginHttpSiempreAdmitido(host)) {
    return { ok: false, motivo: 'login-sin-cifrar' };
  }
  url.hash = '';
  if (url.hostname !== host) url.hostname = host;
  return { ok: true, url: url.href };
}
