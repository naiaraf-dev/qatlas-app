import type { ConnectionEntry } from '@qatlas/shared';

/**
 * Política de red de la interfaz: denegar por defecto (especificación 3.5).
 *
 * Es la SEGUNDA capa: la primera es la CSP (`connect-src 'none'`). Esta capa
 * intercepta en el proceso principal cualquier request de la ventana de QAtlas
 * que haya pasado la CSP y la cancela si no es un recurso propio.
 */
export interface UiNetworkContext {
  /** Origen del servidor de Vite en desarrollo; undefined en la app empaquetada. */
  devServerOrigin: string | undefined;
}

export type Decision = { allowed: true; rule: string } | { allowed: false; rule: string };

const ALWAYS_ALLOWED_SCHEMES = new Set(['app:', 'data:', 'blob:']);

export function decideUiRequest(rawUrl: string, ctx: UiNetworkContext): Decision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, rule: 'url-invalida' };
  }

  if (ALWAYS_ALLOWED_SCHEMES.has(url.protocol)) {
    if (url.protocol === 'app:' && url.host !== 'qatlas') {
      return { allowed: false, rule: 'app-host-desconocido' };
    }
    return { allowed: true, rule: `esquema-local:${url.protocol}` };
  }

  if (ctx.devServerOrigin) {
    const dev = new URL(ctx.devServerOrigin);
    const sameHost = url.hostname === dev.hostname && url.port === dev.port;
    const devProtocol = url.protocol === 'http:' || url.protocol === 'ws:';
    if (sameHost && devProtocol) return { allowed: true, rule: 'servidor-de-desarrollo' };
    if (url.protocol === 'devtools:') return { allowed: true, rule: 'devtools-desarrollo' };
  }

  return { allowed: false, rule: 'denegar-por-defecto' };
}

/**
 * Registro en memoria de conexiones (permitidas y bloqueadas).
 * Fase 1, semana 8: se persiste cifrado en la tabla `conexion`.
 * Las URLs se guardan sin query string ni fragmento: pueden contener tokens.
 */
export class ConnectionLog {
  private entries: ConnectionEntry[] = [];
  private nextId = 0;

  constructor(private readonly maxEntries = 1000) {}

  record(entry: Omit<ConnectionEntry, 'id' | 'timestamp' | 'destination'> & { url: string }): void {
    const { url, ...rest } = entry;
    this.entries.push({
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      destination: sanitizeUrlForLog(url),
      ...rest,
    });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  list(limit: number): ConnectionEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}

/** Quita credenciales, query string y fragmento de una URL antes de registrarla. */
export function sanitizeUrlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2048);
  } catch {
    return '[url-invalida]';
  }
}
