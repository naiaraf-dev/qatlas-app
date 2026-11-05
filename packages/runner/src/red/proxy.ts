import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  createServer,
  request as solicitudHttp,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { connect, isIP, type AddressInfo, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  decidirNombre,
  decidirResolucion,
  normalizarHost,
  type Decision,
  type PoliticaDeRed,
  type ReglaBloqueo,
} from './reglas';

/** Devuelve todas las IPs del nombre. Se inyecta: los tests no usan DNS real ni internet. */
export type Resolvedor = (host: string) => Promise<readonly string[]>;

export interface RegistroConexion {
  /** Solo host y puerto: una ruta o una query pueden tener tokens. */
  destino: string;
  permitida: boolean;
  regla: Decision['regla'];
}

export interface OpcionesProxy {
  politica: PoliticaDeRed;
  /** Una por ejecución: el proxy termina con la ejecución, y la credencial con él. */
  credencial: { usuario: string; clave: string };
  alRegistrar: (registro: RegistroConexion) => void;
  resolver?: Resolvedor;
}

export interface ProxyActivo {
  puerto: number;
  cerrar: () => Promise<void>;
}

const resolverDelSistema: Resolvedor = async (host) =>
  (await lookup(host, { all: true, order: 'verbatim' })).map(({ address }) => address);

const LOCALHOST = 'localhost';
const TIEMPO_CONEXION_MS = 15_000;
const ENCABEZADOS_DE_SALTO = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function esperadoDe({ usuario, clave }: OpcionesProxy['credencial']): Buffer {
  return Buffer.from(`Basic ${Buffer.from(`${usuario}:${clave}`).toString('base64')}`);
}

type Autenticacion = 'valida' | 'ausente' | 'invalida';

function autenticar(req: IncomingMessage, esperado: Buffer): Autenticacion {
  const recibida = req.headers['proxy-authorization'];
  if (recibida === undefined) return 'ausente';
  const bytes = Buffer.from(recibida);
  return bytes.length === esperado.length && timingSafeEqual(bytes, esperado)
    ? 'valida'
    : 'invalida';
}

/** Host y puerto de un CONNECT. `null` si no se entiende. */
function destinoDeConnect(objetivo: string): { host: string; puerto: number } | null {
  const coincidencia = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(objetivo);
  if (!coincidencia) return null;
  const puerto = Number(coincidencia[2]);
  if (puerto < 1 || puerto > 65535) return null;
  return { host: normalizarHost(coincidencia[1] ?? ''), puerto };
}

function cerrarConEstado(socket: Duplex, estado: number, texto: string, extra = ''): void {
  socket.end(
    `HTTP/1.1 ${estado} ${texto}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`,
  );
}

const PEDIR_CREDENCIAL = 'Proxy-Authenticate: Basic realm="qatlas"\r\n';

/**
 * Proxy de salida de una ejecución (especificación 3.5, ADR 016).
 *
 * - Escucha solo en 127.0.0.1, en un puerto que elige el sistema.
 * - Sin interceptar TLS: en HTTPS decide por el host del CONNECT y no ve nada de lo que viaja adentro.
 * - Resuelve una sola vez, valida todas las IPs y se conecta a una IP validada, nunca al nombre: un
 *   DNS que cambie de respuesta entre el chequeo y la conexión no tiene dónde meterse.
 * - No sigue redirecciones: cada salto es otra solicitud del navegador, y se decide igual.
 */
export function iniciarProxy(opciones: OpcionesProxy): Promise<ProxyActivo> {
  const { politica, alRegistrar } = opciones;
  const resolver = opciones.resolver ?? resolverDelSistema;
  const esperado = esperadoDe(opciones.credencial);
  const sockets = new Set<Socket>();
  let puertoPropio = 0;

  const registrar = (destino: string, decision: Decision): void => {
    alRegistrar({ destino, permitida: decision.permitida, regla: decision.regla });
  };
  const bloqueo = (regla: ReglaBloqueo): Decision => ({ permitida: false, regla });

  /** Decide y devuelve a qué IP conectarse. Registra el resultado, permitido o bloqueado. */
  async function decidir(host: string, puerto: number): Promise<string | null> {
    const destino = `${host}:${puerto}`;
    const nombre = decidirNombre(host, politica);
    if (!nombre.permitida) {
      registrar(destino, nombre);
      return null;
    }
    if (puerto === puertoPropio) {
      registrar(destino, bloqueo('puerto-del-proxy'));
      return null;
    }
    let ips: readonly string[];
    try {
      // Una IP literal y localhost no pasan por el DNS: nadie puede redefinirlos.
      if (isIP(host)) ips = [host];
      else if (host === LOCALHOST) ips = ['127.0.0.1'];
      else ips = await resolver(host);
    } catch {
      ips = [];
    }
    const decision = decidirResolucion(host, puerto, ips, politica);
    registrar(destino, decision);
    return decision.permitida ? (ips[0] ?? null) : null;
  }

  function atenderSolicitud(req: IncomingMessage, res: ServerResponse): void {
    const rechazar = (estado: number) => {
      // La marca le dice al crawler que este 403 es del proxy y no un error del sitio.
      res.writeHead(estado, {
        'content-length': 0,
        connection: 'close',
        ...(estado === 403 ? { 'x-qatlas-bloqueado': '1' } : {}),
      });
      res.end();
    };
    const autenticacion = autenticar(req, esperado);
    if (autenticacion !== 'valida') {
      if (autenticacion === 'invalida') {
        registrar('proxy', bloqueo('credencial-invalida'));
      }
      res.writeHead(407, {
        'proxy-authenticate': 'Basic realm="qatlas"',
        'content-length': 0,
      });
      res.end();
      return;
    }

    let url: URL;
    try {
      // Un proxy recibe la URL completa. Una ruta sola es alguien que le habla como a un servidor.
      url = new URL(req.url ?? '');
    } catch {
      registrar('desconocido', bloqueo('solicitud-invalida'));
      rechazar(400);
      return;
    }
    if (url.protocol !== 'http:') {
      registrar(url.host.slice(0, 280) || 'desconocido', bloqueo('solicitud-invalida'));
      rechazar(400);
      return;
    }
    const host = normalizarHost(url.hostname);
    const puerto = Number(url.port) || 80;

    void decidir(host, puerto).then((ip) => {
      if (ip === null) {
        rechazar(403);
        return;
      }
      const encabezados: Record<string, string | string[]> = {};
      for (const [nombre, valor] of Object.entries(req.headers)) {
        if (valor !== undefined && !ENCABEZADOS_DE_SALTO.has(nombre)) encabezados[nombre] = valor;
      }
      // El destino es el de la URL que se validó, no un Host que el sitio haya podido elegir.
      encabezados.host = url.host;
      encabezados.connection = 'close';

      const salida = solicitudHttp(
        {
          host: ip,
          port: puerto,
          method: req.method,
          path: url.pathname + url.search,
          headers: encabezados,
          setHost: false,
          timeout: TIEMPO_CONEXION_MS,
        },
        (respuesta) => {
          res.writeHead(respuesta.statusCode ?? 502, respuesta.rawHeaders);
          respuesta.pipe(res);
          respuesta.on('error', () => res.destroy());
        },
      );
      const fallar = () => {
        if (res.headersSent) res.destroy();
        else rechazar(502);
      };
      salida.on('error', fallar);
      salida.on('timeout', () => salida.destroy());
      req.pipe(salida);
    });
  }

  function atenderConnect(req: IncomingMessage, cliente: Duplex, inicio: Buffer): void {
    cliente.on('error', () => cliente.destroy());
    const autenticacion = autenticar(req, esperado);
    if (autenticacion !== 'valida') {
      if (autenticacion === 'invalida') {
        registrar('proxy', bloqueo('credencial-invalida'));
      }
      cerrarConEstado(cliente, 407, 'Proxy Authentication Required', PEDIR_CREDENCIAL);
      return;
    }
    const objetivo = destinoDeConnect(req.url ?? '');
    if (!objetivo) {
      registrar('desconocido', bloqueo('solicitud-invalida'));
      cerrarConEstado(cliente, 400, 'Bad Request');
      return;
    }
    void decidir(objetivo.host, objetivo.puerto).then((ip) => {
      if (ip === null) {
        cerrarConEstado(cliente, 403, 'Forbidden');
        return;
      }
      const salida = connect({ host: ip, port: objetivo.puerto, timeout: TIEMPO_CONEXION_MS });
      salida.once('connect', () => {
        salida.setTimeout(0);
        cliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (inicio.length > 0) salida.write(inicio);
        salida.pipe(cliente);
        cliente.pipe(salida);
      });
      salida.once('timeout', () => salida.destroy());
      salida.on('error', () => {
        if (cliente.writable) cerrarConEstado(cliente, 502, 'Bad Gateway');
      });
      salida.on('close', () => cliente.destroy());
      cliente.on('close', () => salida.destroy());
      sockets.add(salida);
      salida.on('close', () => sockets.delete(salida));
    });
  }

  const servidor = createServer(atenderSolicitud);
  servidor.on('connect', atenderConnect);
  // Chromium abre los WebSockets con CONNECT. Un Upgrade directo no pasó por esa decisión.
  servidor.on('upgrade', (_req, socket: Duplex) => {
    socket.on('error', () => socket.destroy());
    registrar('desconocido', bloqueo('upgrade-directo'));
    cerrarConEstado(socket, 403, 'Forbidden');
  });
  servidor.on('clientError', (_error, socket) => {
    socket.destroy();
  });
  servidor.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolverInicio, rechazarInicio) => {
    servidor.once('error', rechazarInicio);
    servidor.listen(0, '127.0.0.1', () => {
      servidor.off('error', rechazarInicio);
      puertoPropio = (servidor.address() as AddressInfo).port;
      resolverInicio({
        puerto: puertoPropio,
        cerrar: () =>
          new Promise((listo) => {
            servidor.close(() => {
              listo();
            });
            for (const socket of sockets) socket.destroy();
          }),
      });
    });
  });
}
