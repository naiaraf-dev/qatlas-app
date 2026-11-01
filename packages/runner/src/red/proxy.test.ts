import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import {
  connect,
  createServer as servidorTcp,
  type AddressInfo,
  type Server as Tcp,
} from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { iniciarProxy, type ProxyActivo, type RegistroConexion, type Resolvedor } from './proxy';
import type { PoliticaDeRed } from './reglas';

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-un-solo-uso' };
const AUTORIZACION = `Basic ${Buffer.from('ejecucion:clave-de-un-solo-uso').toString('base64')}`;

let destino: Server;
let puertoDestino: number;
let eco: Tcp;
let puertoEco: number;
let recibidos: { url: string; headers: IncomingHttpHeaders }[];
let proxy: ProxyActivo | undefined;
let registros: RegistroConexion[];
let consultas: string[];

const escuchar = (servidor: Server | Tcp): Promise<number> =>
  new Promise((listo) => {
    servidor.listen(0, '127.0.0.1', () => {
      listo((servidor.address() as AddressInfo).port);
    });
  });

beforeEach(async () => {
  recibidos = [];
  registros = [];
  consultas = [];
  destino = createServer((req, res) => {
    recibidos.push({ url: req.url ?? '', headers: req.headers });
    res.setHeader('x-llego', 'si');
    res.end('hola');
  });
  puertoDestino = await escuchar(destino);
  eco = servidorTcp((socket) => {
    socket.on('error', () => undefined);
    socket.pipe(socket);
  });
  puertoEco = await escuchar(eco);
});

afterEach(async () => {
  await proxy?.cerrar();
  proxy = undefined;
  destino.closeAllConnections();
  await new Promise((listo) => destino.close(listo));
  await new Promise((listo) => eco.close(listo));
});

function politica(extra: Partial<PoliticaDeRed> = {}): PoliticaDeRed {
  return {
    urlBase: `http://lexora.test:${puertoDestino}/`,
    dominios: ['lexora.test', 'localhost', '127.0.0.1', 'publico.example.com'],
    sistemaInterno: false,
    puertosLocales: [puertoEco],
    ...extra,
  };
}

async function iniciar(
  mapa: Record<string, string[]> = { 'lexora.test': ['127.0.0.1'] },
  extra: Partial<PoliticaDeRed> = {},
): Promise<ProxyActivo> {
  const resolver: Resolvedor = (host) => {
    consultas.push(host);
    const ips = mapa[host];
    return ips ? Promise.resolve(ips) : Promise.reject(new Error('ENOTFOUND'));
  };
  proxy = await iniciarProxy({
    politica: politica(extra),
    credencial: CREDENCIAL,
    alRegistrar: (r) => registros.push(r),
    resolver,
  });
  return proxy;
}

interface Respuesta {
  estado: number;
  cuerpo: string;
  encabezados: IncomingHttpHeaders;
}

function pedir(
  url: string,
  {
    autorizacion = AUTORIZACION,
    metodo = 'GET',
    host,
  }: { autorizacion?: string | null; metodo?: string; host?: string } = {},
): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: proxy?.puerto,
        method: metodo,
        path: url,
        headers: {
          ...(autorizacion ? { 'proxy-authorization': autorizacion } : {}),
          ...(host ? { host } : {}),
        },
      },
      (res) => {
        let cuerpo = '';
        res.setEncoding('utf8');
        res.on('data', (t: string) => (cuerpo += t));
        res.on('end', () => {
          resolver({ estado: res.statusCode ?? 0, cuerpo, encabezados: res.headers });
        });
      },
    );
    req.on('error', rechazar);
    req.end();
  });
}

/** Un CONNECT a mano. Devuelve la primera línea de la respuesta y el socket abierto. */
function conectar(
  objetivo: string,
  autorizacion: string | null = AUTORIZACION,
): Promise<{ linea: string; socket: ReturnType<typeof connect> }> {
  return new Promise((resolver, rechazar) => {
    const socket = connect(proxy?.puerto ?? 0, '127.0.0.1');
    socket.on('error', rechazar);
    socket.once('data', (datos) => {
      resolver({ linea: datos.toString().split('\r\n')[0] ?? '', socket });
    });
    const credencial = autorizacion ? `Proxy-Authorization: ${autorizacion}\r\n` : '';
    socket.write(`CONNECT ${objetivo} HTTP/1.1\r\nHost: ${objetivo}\r\n${credencial}\r\n`);
  });
}

describe('Credencial de la ejecución', () => {
  it('sin credencial pide autenticarse y no llega a ningún lado', async () => {
    await iniciar();
    const res = await pedir(`http://lexora.test:${puertoDestino}/`, { autorizacion: null });
    expect(res.estado).toBe(407);
    expect(res.encabezados['proxy-authenticate']).toContain('Basic');
    expect(recibidos).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it('el primer intento sin credencial no se registra: Chromium siempre empieza así', async () => {
    await iniciar();
    await pedir(`http://lexora.test:${puertoDestino}/`, { autorizacion: null });
    expect(registros).toEqual([]);
  });

  it('una credencial incorrecta se rechaza y se registra', async () => {
    await iniciar();
    const otra = `Basic ${Buffer.from('ejecucion:otra').toString('base64')}`;
    const res = await pedir(`http://lexora.test:${puertoDestino}/`, { autorizacion: otra });
    expect(res.estado).toBe(407);
    expect(registros).toEqual([
      { destino: 'proxy', permitida: false, regla: 'credencial-invalida' },
    ]);
  });

  it('CONNECT también la exige', async () => {
    await iniciar();
    const { linea, socket } = await conectar(`lexora.test:${puertoEco}`, null);
    socket.destroy();
    expect(linea).toContain('407');
  });

  it('al cerrar, deja de escuchar', async () => {
    const { puerto, cerrar } = await iniciar();
    await cerrar();
    proxy = undefined;
    const error = await new Promise((listo) => {
      const socket = connect(puerto, '127.0.0.1');
      socket.on('error', listo);
    });
    expect(error).toMatchObject({ code: 'ECONNREFUSED' });
  });
});

describe('HTTP', () => {
  it('lo permitido llega, con el Host de la URL y sin la credencial del proxy', async () => {
    await iniciar();
    const url = `http://lexora.test:${puertoDestino}/ruta?x=1`;
    const res = await pedir(url);
    expect(res.estado).toBe(200);
    expect(res.cuerpo).toBe('hola');
    expect(recibidos[0]?.url).toBe('/ruta?x=1');
    expect(recibidos[0]?.headers.host).toBe(`lexora.test:${puertoDestino}`);
    expect(recibidos[0]?.headers['proxy-authorization']).toBeUndefined();
  });

  it('un Host elegido por el sitio no decide el destino', async () => {
    await iniciar();
    const res = await pedir(`http://evil.example:${puertoDestino}/`, {
      host: `lexora.test:${puertoDestino}`,
    });
    expect(res.estado).toBe(403);
    expect(recibidos).toEqual([]);
  });

  it('lo no permitido se bloquea sin consultar el DNS, y se registra con su regla', async () => {
    await iniciar();
    expect((await pedir('http://evil.example/datos?token=abc')).estado).toBe(403);
    expect(consultas).toEqual([]);
    expect(registros).toEqual([
      { destino: 'evil.example:80', permitida: false, regla: 'fuera-de-dominios' },
    ]);
  });

  it('el registro nunca guarda la ruta ni la query', async () => {
    await iniciar();
    await pedir(`http://lexora.test:${puertoDestino}/secreto?token=abc`);
    expect(JSON.stringify(registros)).not.toMatch(/secreto|token|abc/);
    expect(registros[0]).toEqual({
      destino: `lexora.test:${puertoDestino}`,
      permitida: true,
      regla: 'loopback-declarado',
    });
  });

  it('no sigue redirecciones: cada salto es otra solicitud', async () => {
    destino.removeAllListeners('request');
    destino.on('request', (_req, res) => {
      res.writeHead(302, { location: 'http://evil.example/' });
      res.end();
    });
    await iniciar();
    const res = await pedir(`http://lexora.test:${puertoDestino}/`);
    expect(res.estado).toBe(302);
    expect(res.encabezados.location).toBe('http://evil.example/');
    expect(registros).toHaveLength(1);
  });

  it('una ruta sola, sin URL completa, se rechaza', async () => {
    await iniciar();
    expect((await pedir('/solo-ruta')).estado).toBe(400);
    expect(registros[0]?.regla).toBe('solicitud-invalida');
  });

  it('un esquema que no es http se rechaza', async () => {
    await iniciar();
    expect((await pedir('ftp://lexora.test/')).estado).toBe(400);
  });

  it('el destino caído responde 502', async () => {
    await iniciar({ 'lexora.test': ['127.0.0.1'] }, { puertosLocales: [1] });
    expect((await pedir('http://lexora.test:1/')).estado).toBe(502);
  });

  it('un Upgrade directo se rechaza: los WebSockets van por CONNECT', async () => {
    await iniciar();
    const linea = await new Promise<string>((listo) => {
      const socket = connect(proxy?.puerto ?? 0, '127.0.0.1');
      socket.once('data', (d) => {
        listo(d.toString().split('\r\n')[0] ?? '');
        socket.destroy();
      });
      socket.write(
        `GET http://lexora.test:${puertoDestino}/ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
    });
    expect(linea).toContain('403');
    expect(registros[0]?.regla).toBe('upgrade-directo');
  });
});

describe('CONNECT: túnel sin interceptar', () => {
  it('los bytes pasan tal cual, sin mirarlos', async () => {
    await iniciar();
    const { linea, socket } = await conectar(`lexora.test:${puertoEco}`);
    expect(linea).toContain('200');
    const binario = Buffer.from([0x16, 0x03, 0x01, 0x00, 0xff, 0x0d, 0x0a]);
    const respuesta = await new Promise<Buffer>((listo) => {
      socket.once('data', listo);
      socket.write(binario);
    });
    socket.destroy();
    expect(respuesta.equals(binario)).toBe(true);
  });

  it('decide por el host del CONNECT, y lo bloqueado se registra', async () => {
    await iniciar();
    const { linea, socket } = await conectar('evil.example:443');
    socket.destroy();
    expect(linea).toContain('403');
    expect(registros).toEqual([
      { destino: 'evil.example:443', permitida: false, regla: 'fuera-de-dominios' },
    ]);
  });

  it.each(['sin-puerto', 'lexora.test:', 'lexora.test:99999', 'lexora.test:0', ':443'])(
    'un destino que no se entiende se rechaza: %s',
    async (objetivo) => {
      await iniciar();
      const { linea, socket } = await conectar(objetivo);
      socket.destroy();
      expect(linea).toContain('400');
    },
  );

  it('loopback a un puerto no declarado se bloquea', async () => {
    await iniciar();
    const { linea, socket } = await conectar('localhost:1');
    socket.destroy();
    expect(linea).toContain('403');
    expect(registros[0]?.regla).toBe('puerto-local-no-declarado');
  });

  it('al puerto del propio proxy no se llega, aunque esté declarado', async () => {
    const activo = await iniciar();
    await activo.cerrar();
    proxy = await iniciarProxy({
      politica: politica(),
      credencial: CREDENCIAL,
      alRegistrar: (r) => registros.push(r),
    });
    const { linea, socket } = await conectar(`localhost:${proxy.puerto}`);
    socket.destroy();
    expect(linea).toContain('403');
    expect(registros.at(-1)?.regla).toBe('puerto-del-proxy');
  });
});

describe('DNS rebinding: resuelve una vez y conecta a la IP validada', () => {
  it('un nombre público que resuelve a una IP privada se bloquea', async () => {
    await iniciar({ 'publico.example.com': ['10.0.0.1'] });
    const { linea, socket } = await conectar('publico.example.com:443');
    socket.destroy();
    expect(linea).toContain('403');
    expect(registros[0]).toEqual({
      destino: 'publico.example.com:443',
      permitida: false,
      regla: 'dns-ip-privada',
    });
  });

  it('un nombre público que resuelve a loopback no llega al servicio local', async () => {
    await iniciar({ 'publico.example.com': ['127.0.0.1'] });
    const res = await pedir(`http://publico.example.com:${puertoDestino}/`);
    expect(res.estado).toBe(403);
    expect(recibidos).toEqual([]);
    expect(registros[0]?.regla).toBe('dns-loopback-no-local');
  });

  it('una respuesta con una IP prohibida bloquea el nombre, aunque traiga otra válida', async () => {
    await iniciar({ 'publico.example.com': ['8.8.8.8', '169.254.169.254'] });
    const { linea, socket } = await conectar('publico.example.com:443');
    socket.destroy();
    expect(linea).toContain('403');
    expect(registros[0]?.regla).toBe('dns-ip-prohibida');
  });

  it('una segunda respuesta distinta del DNS no cambia a dónde se conecta', async () => {
    let vuelta = 0;
    proxy = await iniciarProxy({
      politica: politica(),
      credencial: CREDENCIAL,
      alRegistrar: (r) => registros.push(r),
      // Primero una IP que pasa el chequeo; si se volviera a consultar, otra.
      resolver: () => {
        vuelta += 1;
        return Promise.resolve(vuelta === 1 ? ['127.0.0.1'] : ['10.0.0.1']);
      },
    });
    const res = await pedir(`http://lexora.test:${puertoDestino}/`);
    expect(res.estado).toBe(200);
    expect(vuelta).toBe(1);
  });

  it('localhost no pasa por el DNS: nadie lo puede redefinir', async () => {
    await iniciar({ localhost: ['8.8.8.8'] });
    expect((await pedir(`http://localhost:${puertoDestino}/`)).estado).toBe(200);
    expect(consultas).toEqual([]);
    expect(registros[0]?.regla).toBe('loopback-declarado');
  });

  it('un DNS que falla, bloquea', async () => {
    await iniciar({});
    expect((await pedir(`http://lexora.test:${puertoDestino}/`)).estado).toBe(403);
    expect(registros[0]?.regla).toBe('dns-sin-respuesta');
  });
});

describe('Red del propio proxy', () => {
  it('escucha solo en 127.0.0.1', async () => {
    const { puerto } = await iniciar();
    expect(puerto).toBeGreaterThan(0);
    // Otra interfaz de loopback: si escuchara en todas, esta conexión entraría.
    const error = await new Promise((listo) => {
      const socket = connect(puerto, '127.0.0.2');
      socket.on('connect', () => {
        socket.destroy();
        listo('conecto');
      });
      socket.on('error', (e: NodeJS.ErrnoException) => {
        listo(e.code);
      });
    });
    expect(error).not.toBe('conecto');
  });
});
