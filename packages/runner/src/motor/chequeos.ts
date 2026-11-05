import { createHash } from 'node:crypto';
import type { SeveridadHallazgo, TipoHallazgo } from '@qatlas/shared';

/**
 * Los chequeos del escaneo (especificación 6.3), en funciones puras: qué es un hallazgo y con qué
 * severidad. El crawler junta los datos de cada página; acá se decide.
 */

export interface HallazgoDetectado {
  tipo: TipoHallazgo;
  severidad: SeveridadHallazgo;
  /** La página, sin query. */
  url: string;
  /** Dónde estaba el link, para un link roto. */
  urlOrigen: string | null;
  /** Lo que identifica el problema en esa página: regla, código, cookie, host. Sin datos de la página. */
  clave: string;
  titulo: string;
  /** Lo que puede traer contenido de la página. Se guarda cifrado con la clave del proyecto. */
  detalle: string;
}

/** Severidad automática, tabla de 6.3. */
export const SEVERIDAD: Readonly<Record<TipoHallazgo, SeveridadHallazgo>> = {
  'error-http': 'media',
  'link-roto': 'media',
  'recurso-con-error': 'media',
  'error-javascript': 'alta',
  'console-error': 'baja',
  accesibilidad: 'baja',
  rendimiento: 'baja',
  'cookie-insegura': 'alta',
  'contenido-mixto': 'alta',
  'login-sin-cifrar': 'alta',
  'recurso-externo-bloqueado': 'informativa',
};

export function severidadDeAccesibilidad(impacto: string | null | undefined): SeveridadHallazgo {
  if (impacto === 'critical') return 'alta';
  if (impacto === 'serious') return 'media';
  return 'baja';
}

/**
 * Lo que respondió la página misma. `null` si está bien. 5xx es crítica; 404 o 410 al seguir un link,
 * un link roto; cualquier otro 4xx, un error HTTP.
 */
export function hallazgoDeEstado(
  estado: number,
  url: string,
  urlOrigen: string | null,
): HallazgoDetectado | null {
  if (estado >= 500) {
    return {
      tipo: 'error-http',
      severidad: 'critica',
      url,
      urlOrigen,
      clave: String(estado),
      titulo: `La página responde ${estado}`,
      detalle: '',
    };
  }
  if ((estado === 404 || estado === 410) && urlOrigen) {
    return {
      tipo: 'link-roto',
      severidad: SEVERIDAD['link-roto'],
      url,
      urlOrigen,
      clave: String(estado),
      titulo: `Link interno roto (${estado})`,
      detalle: '',
    };
  }
  if (estado >= 400) {
    return {
      tipo: 'error-http',
      severidad: SEVERIDAD['error-http'],
      url,
      urlOrigen,
      clave: String(estado),
      titulo: `La página responde ${estado}`,
      detalle: '',
    };
  }
  return null;
}

/** Lo que cambia entre ejecuciones sin cambiar el problema: números, IDs, horas. */
export function normalizarMensaje(texto: string): string {
  return (texto.split('\n')[0] ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 200);
}

/**
 * La clave de un mensaje: un hash del mensaje normalizado. El mismo problema da la misma clave, para la
 * huella de la semana 8, y el texto, que es de la página, no queda en claro (ADR 023).
 */
export function claveDeMensaje(texto: string): string {
  return `msj:${createHash('sha256').update(normalizarMensaje(texto)).digest('hex').slice(0, 16)}`;
}

/**
 * Criterio de console.error. Se descarta:
 * - «Failed to load resource»: lo cubren los chequeos de HTTP.
 * - «Mixed Content»: es su propio hallazgo.
 * - Lo que nombra un host o una URL que bloqueamos nosotros: ya se informa como recurso bloqueado, y
 *   no es un error del sitio.
 */
export function consoleErrorRelevante(texto: string, bloqueados: readonly string[]): boolean {
  if (texto.startsWith('Failed to load resource')) return false;
  if (texto.includes('Mixed Content')) return false;
  return !bloqueados.some((bloqueado) => texto.includes(bloqueado));
}

export interface CookieAnalizada {
  nombre: string;
  faltaHttpOnly: boolean;
  faltaSecure: boolean;
}

const NOMBRE_DE_SESION = /ses|sid|auth|token|jwt|login/i;

/**
 * Criterio de cookie de sesión insegura. Es de sesión si no vence (sin `Expires` ni `Max-Age`) o si su
 * nombre lo sugiere. Le falta HttpOnly: siempre se marca. Le falta Secure: solo en HTTPS, porque en HTTP
 * el problema es el login sin cifrar. Nunca se guarda el valor: solo el nombre y lo que le falta.
 */
export function analizarCookie(encabezado: string, https: boolean): CookieAnalizada | null {
  const [par = '', ...atributos] = encabezado.split(';').map((parte) => parte.trim());
  const nombre = par.split('=')[0]?.trim() ?? '';
  if (!nombre) return null;
  const tiene = (atributo: string) =>
    atributos.some((a) => a.toLowerCase().split('=')[0] === atributo);
  const deSesion = (!tiene('expires') && !tiene('max-age')) || NOMBRE_DE_SESION.test(nombre);
  if (!deSesion) return null;
  const faltaHttpOnly = !tiene('httponly');
  const faltaSecure = https && !tiene('secure');
  if (!faltaHttpOnly && !faltaSecure) return null;
  return { nombre: nombre.slice(0, 100), faltaHttpOnly, faltaSecure };
}

/**
 * Umbrales de rendimiento. Medición orientativa, tomada en este equipo: sin GPU, por el proxy y con el
 * límite de requests por segundo. Todos con severidad baja.
 */
export const UMBRALES = {
  /** Carga de la página, hasta el evento `load`. */
  cargaMs: 3000,
  /** LCP «malo» según Core Web Vitals. */
  lcpMs: 4000,
  /** Una request que tarda más que esto. */
  requestMs: 2000,
  /** Peso de la página con todos sus recursos. */
  pesoBytes: 3 * 1024 * 1024,
} as const;

export interface Medicion {
  cargaMs: number | null;
  lcpMs: number | null;
  pesoBytes: number;
  requestsLentas: number;
}

export function hallazgosDeRendimiento(url: string, medicion: Medicion): HallazgoDetectado[] {
  const hallazgo = (clave: string, titulo: string, detalle: string): HallazgoDetectado => ({
    tipo: 'rendimiento',
    severidad: SEVERIDAD.rendimiento,
    url,
    urlOrigen: null,
    clave,
    titulo,
    detalle,
  });
  const hallazgos: HallazgoDetectado[] = [];
  if (medicion.cargaMs !== null && medicion.cargaMs >= UMBRALES.cargaMs) {
    hallazgos.push(
      hallazgo('carga', 'Página lenta', `Carga en ${Math.round(medicion.cargaMs)} ms.`),
    );
  }
  if (medicion.lcpMs !== null && medicion.lcpMs > UMBRALES.lcpMs) {
    hallazgos.push(
      hallazgo('lcp', 'LCP lento', `Largest Contentful Paint en ${Math.round(medicion.lcpMs)} ms.`),
    );
  }
  if (medicion.pesoBytes > UMBRALES.pesoBytes) {
    hallazgos.push(
      hallazgo('peso', 'Página pesada', `${Math.round(medicion.pesoBytes / 1024)} KB en total.`),
    );
  }
  if (medicion.requestsLentas > 0) {
    hallazgos.push(
      hallazgo(
        'request-lenta',
        'Requests lentas',
        `${medicion.requestsLentas} requests tardaron más de ${UMBRALES.requestMs} ms.`,
      ),
    );
  }
  return hallazgos;
}

/** Host y puerto de una URL, para un recurso bloqueado. */
export function hostDe(texto: string): string {
  try {
    return new URL(texto).host;
  } catch {
    return '';
  }
}

/** Un elemento se excluye por su texto o sus atributos (RN-ESC-03). */
export function coincideExclusion(
  textos: readonly string[],
  exclusiones: readonly string[],
): boolean {
  const lugar = textos.join(' ').toLowerCase();
  return exclusiones.some((exclusion) => lugar.includes(exclusion.toLowerCase()));
}
