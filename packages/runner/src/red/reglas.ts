import { BlockList, isIP } from 'node:net';
import { esHostLocal, hostPertenece } from '@qatlas/shared/dominios';

/**
 * Las reglas de salida de una ejecución (especificación 3.5, ADR 016). Funciones puras: las usan el
 * proxy y la segunda capa del navegador, así hay una sola regla. Lo dudoso se bloquea.
 */
export interface PoliticaDeRed {
  urlBase: string;
  dominios: readonly string[];
  sistemaInterno: boolean;
  /** Declarados en el proyecto, además del puerto de la URL base. */
  puertosLocales: readonly number[];
}

export type ReglaBloqueo =
  | 'fuera-de-dominios'
  | 'puerto-no-permitido'
  | 'puerto-local-no-declarado'
  | 'puerto-del-proxy'
  | 'dns-sin-respuesta'
  | 'dns-ip-prohibida'
  | 'dns-ip-privada'
  | 'dns-loopback-no-local'
  | 'solicitud-invalida'
  | 'upgrade-directo'
  | 'credencial-invalida'
  | 'agente-node'
  | 'solo-lectura';

export type ReglaPermiso = 'dominio-permitido' | 'loopback-declarado' | 'ip-interna-declarada';

export type Decision =
  { permitida: true; regla: ReglaPermiso } | { permitida: false; regla: ReglaBloqueo };

export type ClaseIp = 'loopback' | 'privada' | 'prohibida' | 'publica';

function lista(subredes: readonly (readonly [string, number])[], familia: 'ipv4' | 'ipv6') {
  const bloques = new BlockList();
  for (const [red, prefijo] of subredes) bloques.addSubnet(red, prefijo, familia);
  return bloques;
}

const LOOPBACK_V4 = lista([['127.0.0.0', 8]], 'ipv4');
const PRIVADAS_V4 = lista(
  [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
  ],
  'ipv4',
);
// Incluye link-local, y con ella el servicio de metadatos de la nube: nunca se admite (ADR 011).
const PROHIBIDAS_V4 = lista(
  [
    ['0.0.0.0', 8],
    ['100.64.0.0', 10],
    ['169.254.0.0', 16],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ],
  'ipv4',
);
// Las redes privadas IPv6 tampoco: "Sistema interno" habilita solo los rangos privados IPv4.
const PROHIBIDAS_V6 = lista(
  [
    ['::', 96],
    ['64:ff9b::', 96],
    ['100::', 64],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ],
  'ipv6',
);

function clasificarV4(ip: string): ClaseIp {
  if (LOOPBACK_V4.check(ip, 'ipv4')) return 'loopback';
  if (PRIVADAS_V4.check(ip, 'ipv4')) return 'privada';
  return PROHIBIDAS_V4.check(ip, 'ipv4') ? 'prohibida' : 'publica';
}

/** Lo que no se puede interpretar como IP también es prohibido. */
export function clasificarIp(ip: string): ClaseIp {
  const familia = isIP(ip);
  if (familia === 4) return clasificarV4(ip);
  if (familia !== 6) return 'prohibida';
  const minusculas = ip.toLowerCase();
  // Una IPv4 escrita como IPv6: vale lo que valga la IPv4 de adentro.
  const mapeada = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(minusculas)?.[1];
  if (mapeada) return clasificarV4(mapeada);
  if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(minusculas)) return 'prohibida';
  if (PROHIBIDAS_V6.check(ip, 'ipv6') && minusculas !== '::1') return 'prohibida';
  return minusculas === '::1' ? 'loopback' : 'publica';
}

const puertoPorDefecto = (url: URL) => (url.protocol === 'https:' ? 443 : 80);

/** La URL base ya está incluida, si su host es local. Cualquier otro puerto local se bloquea. */
export function puertosLocalesPermitidos(politica: PoliticaDeRed): ReadonlySet<number> {
  const url = new URL(politica.urlBase);
  const puertos = new Set(politica.puertosLocales);
  if (esHostLocal(url.hostname)) puertos.add(Number(url.port) || puertoPorDefecto(url));
  return puertos;
}

/** Hosts no locales: 80, 443 y el puerto explícito de la URL base, si tiene. */
function puertosRemotosPermitidos(politica: PoliticaDeRed): ReadonlySet<number> {
  const { port } = new URL(politica.urlBase);
  return new Set(port ? [80, 443, Number(port)] : [80, 443]);
}

export function normalizarHost(host: string): string {
  const sinCorchetes = host.startsWith('[') ? host.slice(1, -1) : host;
  const minusculas = sinCorchetes.toLowerCase();
  return minusculas.endsWith('.') ? minusculas.slice(0, -1) : minusculas;
}

const FUERA: Decision = { permitida: false, regla: 'fuera-de-dominios' };

/** Antes de resolver: un nombre fuera de la lista nunca llega al DNS. */
export function decidirNombre(hostCrudo: string, politica: PoliticaDeRed): Decision {
  const host = normalizarHost(hostCrudo);
  return hostPertenece(host, politica.dominios)
    ? { permitida: true, regla: 'dominio-permitido' }
    : FUERA;
}

/**
 * Después de resolver. Se evalúan todas las IPs: si alguna está prohibida se bloquea el nombre
 * completo, aunque otra sea válida, porque quien controla el DNS elige cuál se usa.
 */
export function decidirResolucion(
  hostCrudo: string,
  puerto: number,
  ips: readonly string[],
  politica: PoliticaDeRed,
): Decision {
  const host = normalizarHost(hostCrudo);
  const nombre = decidirNombre(host, politica);
  if (!nombre.permitida) return nombre;
  if (ips.length === 0) return { permitida: false, regla: 'dns-sin-respuesta' };

  const clases = new Set(ips.map(clasificarIp));
  if (clases.has('prohibida')) return { permitida: false, regla: 'dns-ip-prohibida' };
  if (clases.has('loopback') && !esHostLocal(host)) {
    return { permitida: false, regla: 'dns-loopback-no-local' };
  }
  // "Sistema interno" exige el host exacto: un comodín no alcanza para llegar a una IP privada.
  if (clases.has('privada') && !(politica.sistemaInterno && politica.dominios.includes(host))) {
    return { permitida: false, regla: 'dns-ip-privada' };
  }
  if (clases.has('loopback')) {
    return puertosLocalesPermitidos(politica).has(puerto)
      ? { permitida: true, regla: 'loopback-declarado' }
      : { permitida: false, regla: 'puerto-local-no-declarado' };
  }
  if (!puertosRemotosPermitidos(politica).has(puerto)) {
    return { permitida: false, regla: 'puerto-no-permitido' };
  }
  return clases.has('privada')
    ? { permitida: true, regla: 'ip-interna-declarada' }
    : { permitida: true, regla: 'dominio-permitido' };
}

/** Sin DNS, lo que la segunda capa del navegador puede decidir con solo mirar la URL. */
export function decidirUrlSinResolver(texto: string, politica: PoliticaDeRed): Decision {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { permitida: false, regla: 'solicitud-invalida' };
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    return { permitida: false, regla: 'solicitud-invalida' };
  }
  return decidirNombre(url.hostname, politica);
}
