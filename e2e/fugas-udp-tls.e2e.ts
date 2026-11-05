/**
 * Lo que el proxy no ve (WebRTC y QUIC, sobre UDP) y lo que no debe ver (una sesión TLS completa por el
 * túnel). En un navegador real, con los argumentos del motor (ADR 016).
 *
 * Cada caso tiene su control positivo: sin esos argumentos, el receptor UDP del sandbox sí recibe
 * paquetes. Los resultados con direcciones se comparan sin imprimirlas: una falla no deja ninguna IP del
 * equipo en un log público.
 */
import { networkInterfaces } from 'node:os';
import { connect as conectarTcp } from 'node:net';
import { connect as conectarTls, type TLSSocket } from 'node:tls';
import { expect, test } from '@playwright/test';
import { chromium, type Browser } from 'playwright-core';
import {
  CREDENCIALES_DE_PRUEBA,
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import {
  abrirContexto,
  abrirNavegador,
  ARGUMENTOS_CHROMIUM,
} from '../packages/runner/src/motor/motor';
import {
  iniciarProxy,
  type ProxyActivo,
  type RegistroConexion,
} from '../packages/runner/src/red/proxy';
import type { PoliticaDeRed } from '../packages/runner/src/red/reglas';
import { vigilarEntorno } from './entorno';
import { generarCertificado, type CertificadoDePrueba } from './fixtures/certificado';

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };
const HOST_QUIC = 'quic.fuga.test';
const CANARIO_RUTA = 'ruta-canario-que-el-proxy-no-ve';
const FLAGS_SIN_MDNS = 'WebRtcHideLocalIpsWithMdns';

let sitio: SandboxActivo;
let certificado: CertificadoDePrueba;
let proxy: ProxyActivo;
let navegador: Browser;
let conexiones: RegistroConexion[];

test.describe.configure({ mode: 'serial' });
vigilarEntorno(test);

const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

async function conMotor(politica: PoliticaDeRed, argumentos: string[] = []): Promise<Browser> {
  conexiones = [];
  proxy = await iniciarProxy({
    politica,
    credencial: CREDENCIAL,
    alRegistrar: (r) => conexiones.push(r),
    resolver,
  });
  const servidor = `http://127.0.0.1:${proxy.puerto}`;
  if (argumentos.length === 0) {
    return abrirNavegador({
      politica: {
        ...politica,
        dominios: [...politica.dominios],
        puertosLocales: [...politica.puertosLocales],
      },
      proxy: { servidor, ...CREDENCIAL },
      timeoutPaginaMs: 5000,
    });
  }
  return chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [...ARGUMENTOS_CHROMIUM, ...argumentos],
    proxy: { server: servidor, username: CREDENCIAL.usuario, password: CREDENCIAL.clave },
  });
}

async function cerrar(): Promise<void> {
  await navegador.close();
  await proxy.cerrar();
}

interface ResultadoRtc {
  candidatos: string[];
  sdp: string;
}

async function resultadoWebrtc(instancia: Browser): Promise<ResultadoRtc> {
  const pagina = await (await instancia.newContext()).newPage();
  await pagina.goto(`${sitio.url}/webrtc`);
  return pagina.evaluate<ResultadoRtc>('window.resultadoRtc');
}

/** Las direcciones reales del equipo, sin las de loopback. */
const direccionesDelEquipo = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal)
    .map((i) => i?.address as string);

const exponeUnaDireccion = ({ candidatos, sdp }: ResultadoRtc) => {
  const texto = `${candidatos.join('\n')}\n${sdp}`;
  return direccionesDelEquipo().some((direccion) => texto.includes(direccion));
};

test.beforeAll(async () => {
  certificado = generarCertificado([HOST_SITIO, HOST_QUIC]);
  sitio = await iniciarSandbox({
    puerto: 0,
    demoraLentaMs: 50,
    tls: { key: certificado.key, cert: certificado.cert },
  });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

test.beforeEach(() => {
  sitio.registro.udp.length = 0;
  sitio.registro.tls.length = 0;
  sitio.registro.https.length = 0;
  sitio.registro.fugas.length = 0;
});

test.describe('WebRTC', () => {
  const POLITICA = (): PoliticaDeRed => ({
    urlBase: `${sitio.url}/`,
    dominios: ['127.0.0.1'],
    sistemaInterno: false,
    puertosLocales: [],
  });

  test('control: sin los argumentos, llega al receptor UDP y expone una dirección del equipo', async () => {
    const directo = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: [`--disable-features=${FLAGS_SIN_MDNS}`],
    });
    const resultado = await resultadoWebrtc(directo);
    await directo.close();
    expect(sitio.registro.udp.length).toBeGreaterThan(0);
    expect(resultado.candidatos.length).toBeGreaterThan(0);
    expect(exponeUnaDireccion(resultado)).toBe(true);
  });

  test('con los argumentos del motor: nada llega, sin candidatos y sin direcciones', async () => {
    navegador = await conMotor(POLITICA());
    const resultado = await resultadoWebrtc(navegador);
    await cerrar();
    expect(sitio.registro.udp).toEqual([]);
    expect(resultado.candidatos).toEqual([]);
    expect(exponeUnaDireccion(resultado)).toBe(false);
  });

  test('tampoco expone nada sin la ocultación por mDNS: el freno no depende de ella', async () => {
    navegador = await conMotor(POLITICA(), [
      `--disable-features=PreconnectToSearch,AutofillServerCommunication,${FLAGS_SIN_MDNS}`,
    ]);
    const resultado = await resultadoWebrtc(navegador);
    await cerrar();
    expect(sitio.registro.udp).toEqual([]);
    expect(resultado.candidatos).toEqual([]);
    expect(exponeUnaDireccion(resultado)).toBe(false);
  });

  test('el contexto de la app tampoco: la segunda capa no cambia el resultado', async () => {
    const politica = POLITICA();
    navegador = await conMotor(politica);
    const { contexto } = await abrirContexto(navegador, politica, {
      soloLectura: true,
      alRegistrar: () => undefined,
    });
    const pagina = await contexto.newPage();
    await pagina.goto(`${sitio.url}/webrtc`);
    const resultado = await pagina.evaluate<ResultadoRtc>('window.resultadoRtc');
    await cerrar();
    expect(sitio.registro.udp).toEqual([]);
    expect(resultado.candidatos).toEqual([]);
  });
});

test.describe('QUIC / HTTP3', () => {
  const forzar = () => `--origin-to-force-quic-on=${HOST_QUIC}:${sitio.puertoUdp}`;
  const urlQuic = () => `https://${HOST_QUIC}:${sitio.puertoUdp}/`;

  test('control: sin los argumentos, llega al receptor UDP', async () => {
    const directo = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: ['--enable-quic', forzar(), `--host-resolver-rules=MAP ${HOST_QUIC} 127.0.0.1`],
    });
    const pagina = await (await directo.newContext({ ignoreHTTPSErrors: true })).newPage();
    await pagina.goto(urlQuic(), { timeout: 4000 }).catch(() => undefined);
    await directo.close();
    expect(sitio.registro.udp.length).toBeGreaterThan(0);
  });

  test('con los argumentos del motor, aunque se fuerce y el destino esté permitido: nada', async () => {
    navegador = await conMotor(
      {
        urlBase: urlQuic(),
        dominios: [HOST_QUIC],
        sistemaInterno: false,
        puertosLocales: [],
      },
      [forzar()],
    );
    const pagina = await (await navegador.newContext({ ignoreHTTPSErrors: true })).newPage();
    await pagina.goto(urlQuic(), { timeout: 4000 }).catch(() => undefined);
    await pagina.waitForTimeout(500);
    await cerrar();
    expect(sitio.registro.udp).toEqual([]);
    // Lo intentó por TCP, por el túnel: el proxy lo vio.
    expect(conexiones.some((c) => c.destino === `${HOST_QUIC}:${sitio.puertoUdp}`)).toBe(true);
  });

  test('un sitio que anuncia HTTP3 con Alt-Svc tampoco saca UDP', async () => {
    const politica: PoliticaDeRed = {
      urlBase: `https://${HOST_SITIO}:${sitio.puertoHttps}/`,
      dominios: [HOST_SITIO],
      sistemaInterno: false,
      puertosLocales: [],
    };
    navegador = await conMotor(politica);
    const pagina = await (await navegador.newContext({ ignoreHTTPSErrors: true })).newPage();
    const respuesta = await pagina.goto(politica.urlBase);
    expect((await respuesta?.allHeaders())?.['alt-svc']).toContain('h3=');
    await pagina.reload();
    await pagina.reload();
    await pagina.waitForTimeout(500);
    await cerrar();
    expect(sitio.registro.udp).toEqual([]);
  });
});

test.describe('HTTPS: sesión TLS completa por el túnel', () => {
  const politica = (): PoliticaDeRed => ({
    urlBase: `https://${HOST_SITIO}:${sitio.puertoHttps}/`,
    dominios: [HOST_SITIO],
    sistemaInterno: false,
    puertosLocales: [],
  });

  test('la app no acepta un certificado que no conoce', async () => {
    navegador = await conMotor(politica());
    const { contexto } = await abrirContexto(navegador, politica(), {
      soloLectura: true,
      alRegistrar: () => undefined,
    });
    const pagina = await contexto.newPage();
    await expect(pagina.goto(politica().urlBase)).rejects.toThrow(/CERT/);
    await cerrar();
    expect(sitio.registro.https).toEqual([]);
  });

  test('aceptado solo en este test: la sesión llega y el proxy no ve nada de adentro', async () => {
    navegador = await conMotor(politica());
    // Esta opción existe solo acá. Un test estático verifica que la app no la use.
    const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
    const pagina = await contexto.newPage();
    const respuesta = await pagina.goto(`${politica().urlBase}${CANARIO_RUTA}`);
    expect(respuesta?.status()).toBe(404);
    expect((await respuesta?.securityDetails())?.protocol).toMatch(/TLS 1\.[23]/);
    expect((await respuesta?.securityDetails())?.subjectName).toBe(
      'Certificado de prueba de QAtlas',
    );

    await pagina.goto(`${politica().urlBase}login`);
    await pagina.locator('#usuario').fill(CREDENCIALES_DE_PRUEBA.usuario);
    await pagina.locator('#clave').fill(CREDENCIALES_DE_PRUEBA.clave);
    await pagina.locator('button[type=submit]').click();
    await expect(pagina.locator('a[href="/cerrar-sesion"]')).toBeVisible();
    await cerrar();

    // Del lado del sitio llegó todo, por TLS.
    expect(sitio.registro.tls.length).toBeGreaterThan(0);
    expect(sitio.registro.https).toContain(`/${CANARIO_RUTA}`);
    expect(sitio.registro.https).toContain('POST /login');
    // Del lado del proxy, solo host y puerto.
    expect(conexiones.length).toBeGreaterThan(0);
    for (const conexion of conexiones) {
      expect(conexion.destino).toBe(`${HOST_SITIO}:${sitio.puertoHttps}`);
    }
    const visto = JSON.stringify(conexiones);
    expect(visto).not.toContain(CANARIO_RUTA);
    expect(visto).not.toContain(CREDENCIALES_DE_PRUEBA.clave);
  });

  test('sin interceptar: quien se conecta verifica el certificado original del servidor', async () => {
    navegador = await conMotor(politica());
    const socket = conectarTcp(proxy.puerto, '127.0.0.1');
    await new Promise<void>((listo, fallar) => {
      socket.once('error', fallar);
      socket.once('connect', () => {
        const autorizacion = Buffer.from(`${CREDENCIAL.usuario}:${CREDENCIAL.clave}`).toString(
          'base64',
        );
        const objetivo = `${HOST_SITIO}:${sitio.puertoHttps}`;
        socket.write(
          `CONNECT ${objetivo} HTTP/1.1\r\nHost: ${objetivo}\r\nProxy-Authorization: Basic ${autorizacion}\r\n\r\n`,
        );
      });
      socket.once('data', (datos) => {
        expect(datos.toString()).toContain('200');
        listo();
      });
    });
    // Con verificación completa, y este certificado como única autoridad.
    const tls: TLSSocket = conectarTls({
      socket,
      servername: HOST_SITIO,
      ca: certificado.cert,
      rejectUnauthorized: true,
    });
    await new Promise<void>((listo, fallar) => {
      tls.once('secureConnect', listo);
      tls.once('error', fallar);
    });
    expect(tls.authorized).toBe(true);
    expect(tls.getPeerCertificate().fingerprint256).toBe(certificado.huella);
    const respuesta = await new Promise<string>((listo) => {
      let texto = '';
      tls.on('data', (d: Buffer) => {
        texto += d.toString();
      });
      tls.on('end', () => {
        listo(texto);
      });
      tls.write(`GET / HTTP/1.1\r\nHost: ${HOST_SITIO}\r\nConnection: close\r\n\r\n`);
    });
    tls.destroy();
    await cerrar();
    expect(respuesta).toContain('Sandbox de QAtlas');
  });

  test('HTTPS a un dominio fuera de la lista no abre el túnel', async () => {
    navegador = await conMotor(politica());
    const pagina = await (await navegador.newContext({ ignoreHTTPSErrors: true })).newPage();
    await expect(pagina.goto(`https://pixel.fuga.example:${sitio.puertoHttps}/`)).rejects.toThrow();
    await cerrar();
    expect(sitio.registro.fugas).toEqual([]);
    expect(conexiones).toEqual([
      {
        destino: `pixel.fuga.example:${sitio.puertoHttps}`,
        permitida: false,
        regla: 'fuera-de-dominios',
      },
    ]);
  });
});
