/**
 * TS-03, TS-04 y TS-05 en un navegador real, contra el sandbox (especificación 3.15, ADR 016).
 *
 * El proxy y el motor son los de la app, con un resolvedor inyectado: nada de DNS real ni de internet.
 * Todo intento de fuga va a un dominio reservado, mapeado a este equipo.
 *
 * Hay un control positivo: el mismo sandbox, sin proxy y con `--host-resolver-rules`, recibe cada fuga.
 * Sin él, «no llegó nada» también podría querer decir que el sandbox nunca iba a recibirla.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import {
  CREDENCIALES_DE_PRUEBA,
  HOST_SITIO,
  HOSTS_DE_FUGA,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  REGLAS_RESOLVER,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import {
  abrirContexto,
  abrirNavegador,
  ARGUMENTOS_CHROMIUM,
  presupuestoProbarLogin,
  probarLogin,
  type RegistroNavegador,
} from '../packages/runner/src/motor/motor';
import {
  rastrear,
  type OpcionesRastreo,
  type PaginaVisitada,
} from '../packages/runner/src/motor/crawler';
import {
  iniciarProxy,
  type ProxyActivo,
  type RegistroConexion,
} from '../packages/runner/src/red/proxy';
import type { PoliticaDeRed } from '../packages/runner/src/red/reglas';
import type { IndicadorExito, PasoLogin } from '@qatlas/shared';
import { restaurarEntorno, vigilarEntorno } from './entorno';

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };
const manifiesto = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../apps/sandbox-site/hallazgos-esperados.json'),
    'utf8',
  ),
) as {
  fugas: { id: string; host: string; origen: string }[];
  exclusiones: { url: string; origen: string }[];
  soloLectura: { url: string; origen: string }[];
};

let sitio: SandboxActivo;
let proxy: ProxyActivo = { puerto: 0, cerrar: () => Promise.resolve() };
let navegador: Browser;
let cerrarNavegador: () => Promise<void> = () => Promise.resolve();
let conexiones: RegistroConexion[];
let delNavegador: RegistroNavegador[];

test.describe.configure({ mode: 'serial' });
vigilarEntorno(test);

const politica = (extra: Partial<PoliticaDeRed> = {}): PoliticaDeRed => ({
  urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
  dominios: [HOST_SITIO],
  sistemaInterno: false,
  puertosLocales: [],
  ...extra,
});

/** Un DNS de prueba: lo que el mapa diga, y nada más. */
const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

async function conProxy(p: PoliticaDeRed, resolvedor = resolver): Promise<void> {
  await proxy.cerrar();
  conexiones = [];
  proxy = await iniciarProxy({
    politica: p,
    credencial: CREDENCIAL,
    alRegistrar: (r) => conexiones.push(r),
    resolver: resolvedor,
  });
  await cerrarNavegador();
  navegador = await abrirNavegador({
    politica: { ...p, dominios: [...p.dominios], puertosLocales: [...p.puertosLocales] },
    proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL },
    timeoutPaginaMs: 5000,
  });
  cerrarNavegador = () => navegador.close();
}

const contexto = async (p: PoliticaDeRed, soloLectura = true): Promise<BrowserContext> =>
  (await abrirContexto(navegador, p, { soloLectura, alRegistrar: (r) => delNavegador.push(r) }))
    .contexto;

/** Sin la segunda capa: lo único entre la página y la red es el proxy. */
const contextoSoloProxy = (): Promise<BrowserContext> =>
  navegador.newContext({ serviceWorkers: 'allow' });

/** La línea de comando real del proceso que corre el sitio. Solo procesos que lanzó este test. */
async function lineaDeComandoDelRenderer(instancia: Browser): Promise<string> {
  const cdp = await instancia.newBrowserCDPSession();
  const { processInfo } = (await cdp.send('SystemInfo.getProcessInfo')) as {
    processInfo: { id: number; type: string }[];
  };
  const pid = processInfo.find((p) => p.type === 'renderer')?.id;
  if (pid === undefined) throw new Error('No hay un renderer');
  if (process.platform === 'win32') {
    return execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: 'utf8' },
    );
  }
  return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
}

const asentar = () =>
  new Promise((listo) => {
    setTimeout(listo, 500);
  });

const bloqueadas = () => conexiones.filter((c) => !c.permitida);
const destinoBloqueado = (host: string) =>
  bloqueadas().some((c) => c.destino.startsWith(`${host}:`));

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, demoraLentaMs: 50 });
});

test.afterAll(async () => {
  await cerrarNavegador();
  await proxy.cerrar();
  await sitio.cerrar();
});

test.beforeEach(() => {
  delNavegador = [];
  sitio.registro.fugas.length = 0;
  sitio.registro.posts.length = 0;
  sitio.registro.trampas.length = 0;
  sitio.registro.api.length = 0;
  sitio.registro.puertoNoDeclarado.length = 0;
  sitio.registro.websockets.length = 0;
  sitio.registro.serviceWorkers.length = 0;
});

test.describe('Control: sin proxy, cada fuga llega al sandbox', () => {
  let directo: Browser;
  test.beforeAll(async () => {
    directo = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: [`--host-resolver-rules=${REGLAS_RESOLVER}`],
    });
  });
  test.afterAll(async () => {
    await directo.close();
  });

  test('el mapa de la semana 4 funciona en un navegador real, y las fugas se registran', async () => {
    const pagina = await (await directo.newContext()).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/fuga`);
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/websocket-externo`);
    await pagina.evaluate('window.resultadoWs');
    await pagina
      .goto(`http://${HOST_SITIO}:${sitio.puerto}/redirige-afuera`)
      .catch(() => undefined);
    await expect
      .poll(() => [...new Set(sitio.registro.fugas)].sort())
      .toEqual(
        expect.arrayContaining([
          'analitica.fuga.test',
          'pixel.fuga.example',
          'api.fuga.invalid',
          'redireccion.fuga.test',
          'ws.fuga.example',
        ]),
      );
  });

  test('un service worker sin bloquear sí se registra y sale por su cuenta', async () => {
    // En 127.0.0.1: un service worker exige un contexto seguro.
    const pagina = await (await directo.newContext()).newPage();
    await pagina.goto(`${sitio.url}/service-worker`);
    expect(await pagina.evaluate('window.resultadoSw')).toBe('registrado');
    await expect.poll(() => sitio.registro.fugas).toContain('sw.fuga.invalid');
  });

  test('otro puerto local tampoco tiene ningún freno propio', async () => {
    const pagina = await (await directo.newContext()).newPage();
    await pagina.goto(`${sitio.url}/puerto-no-declarado`);
    expect(await pagina.evaluate('window.resultadoTrampa')).toBe('llego');
    expect(sitio.registro.puertoNoDeclarado).toHaveLength(1);
  });
});

test.describe('TS-04 · Contención, solo con el proxy', () => {
  test.beforeAll(async () => {
    await conProxy(politica());
  });

  test('el mapa de hosts no se usa con proxy: Chromium le pasa el nombre', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    const respuesta = await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/`);
    expect(respuesta?.status()).toBe(200);
    expect(conexiones[0]).toEqual({
      destino: `${HOST_SITIO}:${sitio.puerto}`,
      permitida: true,
      regla: 'loopback-declarado',
    });
  });

  test('cada intento de fuga del manifiesto se bloquea, se registra y no llega', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    for (const origen of ['/fuga', '/websocket-externo', '/service-worker']) {
      await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}${origen}`).catch(() => undefined);
    }
    await pagina
      .goto(`http://${HOST_SITIO}:${sitio.puerto}/redirige-afuera`)
      .catch(() => undefined);
    // El service worker no se puede registrar en http://sandbox.test: va en la prueba de abajo.
    await asentar();
    for (const { host } of manifiesto.fugas.filter((f) => f.id !== 'fuga-service-worker')) {
      expect(destinoBloqueado(host), host).toBe(true);
    }
    expect(sitio.registro.fugas).toEqual([]);
    expect(bloqueadas().every((c) => c.regla === 'fuera-de-dominios')).toBe(true);
  });

  test('cada salto de una redirección se decide: hacia adentro pasa, hacia afuera no', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    const adentro = await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/redirige-adentro`);
    expect(adentro?.url()).toBe(`http://${HOST_SITIO}:${sitio.puerto}/`);
    await expect(
      pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/redirige-afuera`),
    ).rejects.toThrow();
    expect(destinoBloqueado('redireccion.fuga.test')).toBe(true);
    expect(sitio.registro.fugas).toEqual([]);
  });

  test('una navegación directa a otro dominio no sale', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    await expect(pagina.goto(`http://pixel.fuga.example:${sitio.puerto}/`)).rejects.toThrow();
    expect(sitio.registro.fugas).toEqual([]);
  });

  test('un WebSocket a un dominio permitido sí abre, por CONNECT', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/`);
    const resultado = await pagina.evaluate(
      (url) =>
        new Promise((listo) => {
          const ws = new WebSocket(url);
          ws.onopen = () => {
            listo('abierto');
          };
          ws.onerror = () => {
            listo('error');
          };
        }),
      `ws://${HOST_SITIO}:${sitio.puerto}/canal`,
    );
    expect(resultado).toBe('abierto');
    expect(sitio.registro.websockets).toContain(HOST_SITIO);
  });

  test('un WebSocket a otro dominio no llega', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/websocket-externo`);
    expect(await pagina.evaluate('window.resultadoWs')).toBe('error');
    expect(destinoBloqueado('ws.fuga.example')).toBe(true);
    expect(sitio.registro.fugas).toEqual([]);
  });

  test('el sandbox de Chromium está encendido: el sitio probado corre confinado', async () => {
    await (await navegador.newContext()).newPage();
    const linea = await lineaDeComandoDelRenderer(navegador);
    expect(linea).toContain('--type=renderer');
    expect(linea).not.toContain('--no-sandbox');
  });

  test('control: si se apagara, el test lo vería', async () => {
    const sinSandbox = await chromium.launch({
      channel: 'chromium',
      headless: true,
      chromiumSandbox: false,
    });
    await (await sinSandbox.newContext()).newPage();
    expect(await lineaDeComandoDelRenderer(sinSandbox)).toContain('--no-sandbox');
    await sinSandbox.close();
  });

  test('el dominio de fuga nunca llega al DNS', async () => {
    const consultados: string[] = [];
    await conProxy(politica(), (host) => {
      consultados.push(host);
      return resolver(host);
    });
    const pagina = await (await contextoSoloProxy()).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/fuga`);
    await asentar();
    expect(consultados.some((host) => HOSTS_DE_FUGA.includes(host))).toBe(false);
    expect(consultados).toContain(HOST_SITIO);
    await conProxy(politica());
  });
});

test.describe('TS-04 · Service workers', () => {
  test.beforeAll(async () => {
    await conProxy(politica({ urlBase: `${sitio.url}/`, dominios: ['127.0.0.1'] }));
  });

  test('bloqueados: no se registran y el sandbox no recibe nada', async () => {
    const p = politica({ urlBase: `${sitio.url}/`, dominios: ['127.0.0.1'] });
    const pagina = await (await contexto(p)).newPage();
    await pagina.goto(`${sitio.url}/service-worker`);
    await pagina.evaluate('window.resultadoSw');
    // Playwright hace que register() responda sin registrar nada: lo que cuenta es esto.
    const registrados = await pagina.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(registrados).toBe(0);
    await asentar();
    expect(sitio.registro.serviceWorkers).toEqual([]);
    expect(sitio.registro.fugas).toEqual([]);
  });

  test('aun si uno se registrara, su salida también pasa por el proxy', async () => {
    const pagina = await (await contextoSoloProxy()).newPage();
    await pagina.goto(`${sitio.url}/service-worker`);
    expect(await pagina.evaluate('window.resultadoSw')).toBe('registrado');
    await expect.poll(() => destinoBloqueado('sw.fuga.invalid')).toBe(true);
    expect(sitio.registro.fugas).toEqual([]);
  });
});

test.describe('TS-04 · Segunda capa', () => {
  test.beforeAll(async () => {
    await conProxy(politica());
  });

  test('lo que el proxy bloquearía se corta antes y queda registrado, también en el navegador', async () => {
    const pagina = await (await contexto(politica())).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/fuga`);
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/websocket-externo`);
    await pagina.evaluate('window.resultadoWs');
    await asentar();
    const hosts = delNavegador.map((r) => r.destino.split(':')[0]);
    expect(hosts).toEqual(
      expect.arrayContaining([
        'analitica.fuga.test',
        'pixel.fuga.example',
        'api.fuga.invalid',
        'ws.fuga.example',
      ]),
    );
    expect(sitio.registro.fugas).toEqual([]);
  });

  test('un WebSocket permitido abre a través de la segunda capa', async () => {
    const pagina = await (await contexto(politica())).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/`);
    const resultado = await pagina.evaluate(
      (url) =>
        new Promise((listo) => {
          const ws = new WebSocket(url);
          ws.onopen = () => {
            listo('abierto');
          };
          ws.onerror = () => {
            listo('error');
          };
        }),
      `ws://${HOST_SITIO}:${sitio.puerto}/canal`,
    );
    expect(resultado).toBe('abierto');
  });
});

test.describe('TS-03 · Puertos locales', () => {
  test('la API en un puerto declarado llega; otro puerto local, no', async () => {
    const p = politica({
      urlBase: `${sitio.url}/`,
      dominios: ['127.0.0.1'],
      puertosLocales: [sitio.puertoApi],
    });
    await conProxy(p);
    const pagina = await (await contextoSoloProxy()).newPage();

    await pagina.goto(`${sitio.url}/api-en-otro-puerto`);
    expect(await pagina.evaluate('window.resultadoApi')).toBe('api');
    expect(sitio.registro.api).toHaveLength(1);

    await pagina.goto(`${sitio.url}/puerto-no-declarado`);
    // La página ve el 403 del proxy como una respuesta: lo que cuenta es que no llegó.
    await pagina.evaluate('window.resultadoTrampa');
    expect(sitio.registro.puertoNoDeclarado).toEqual([]);
    expect(bloqueadas()).toEqual([
      {
        destino: `127.0.0.1:${sitio.puertoTrampa}`,
        permitida: false,
        regla: 'puerto-local-no-declarado',
      },
    ]);
  });

  test('sin declararla, la misma API no llega', async () => {
    const p = politica({ urlBase: `${sitio.url}/`, dominios: ['127.0.0.1'] });
    await conProxy(p);
    const pagina = await (await contextoSoloProxy()).newPage();
    await pagina.goto(`${sitio.url}/api-en-otro-puerto`);
    expect(await pagina.evaluate('window.resultadoApi')).toBe('error');
    expect(sitio.registro.api).toEqual([]);
  });

  test('al puerto del proxy no se llega', async () => {
    const p = politica({ urlBase: `${sitio.url}/`, dominios: ['127.0.0.1'] });
    await conProxy(p);
    const pagina = await (await contextoSoloProxy()).newPage();
    await expect(pagina.goto(`http://127.0.0.1:${proxy.puerto}/`)).rejects.toThrow();
    expect(bloqueadas().at(-1)?.regla).toBe('puerto-del-proxy');
  });
});

test.describe('DNS rebinding en un navegador real', () => {
  test('un nombre público que resuelve a una IP privada se bloquea', async () => {
    const p = politica({
      urlBase: 'http://publico.example.com/',
      dominios: ['publico.example.com'],
    });
    await conProxy(p, () => Promise.resolve(['10.0.0.1']));
    const pagina = await (await contextoSoloProxy()).newPage();
    await expect(pagina.goto('http://publico.example.com/')).rejects.toThrow();
    // Chromium prueba también https: cada intento se bloquea por lo mismo.
    expect(bloqueadas().length).toBeGreaterThan(0);
    expect(bloqueadas().map((c) => c.destino)).toContain('publico.example.com:80');
    expect(bloqueadas().every((c) => c.regla === 'dns-ip-privada')).toBe(true);
  });

  test('un nombre público que resuelve a loopback no llega al sandbox', async () => {
    const p = politica({
      urlBase: `http://publico.example.com:${sitio.puerto}/`,
      dominios: ['publico.example.com'],
    });
    await conProxy(p, () => Promise.resolve(['127.0.0.1']));
    const antes = sitio.registro.hosts.length;
    const pagina = await (await contextoSoloProxy()).newPage();
    await expect(pagina.goto(`http://publico.example.com:${sitio.puerto}/`)).rejects.toThrow();
    expect(sitio.registro.hosts.slice(antes)).toEqual([]);
    expect(bloqueadas()[0]?.regla).toBe('dns-loopback-no-local');
  });
});

test.describe('Fallar cerrado', () => {
  test('con el proxy caído, el navegador no llega a ningún lado: tampoco en directo', async () => {
    const p = politica();
    await conProxy(p);
    await proxy.cerrar();
    const antes = sitio.registro.hosts.length;
    const pagina = await (await navegador.newContext()).newPage();
    await expect(
      pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/`, { timeout: 5000 }),
    ).rejects.toThrow();
    await expect(pagina.goto(`${sitio.url}/`, { timeout: 5000 })).rejects.toThrow();
    expect(sitio.registro.hosts.slice(antes)).toEqual([]);
  });

  test('con la credencial equivocada, tampoco', async () => {
    const p = politica({ urlBase: `${sitio.url}/`, dominios: ['127.0.0.1'] });
    await conProxy(p);
    const otro = await chromium.launch({
      channel: 'chromium',
      headless: true,
      args: [...ARGUMENTOS_CHROMIUM],
      proxy: { server: `http://127.0.0.1:${proxy.puerto}`, username: 'otro', password: 'otra' },
    });
    const antes = sitio.registro.hosts.length;
    const pagina = await (await otro.newContext()).newPage();
    const respuesta = await pagina.goto(`${sitio.url}/`).catch(() => null);
    expect(respuesta?.status() ?? 407).toBe(407);
    await otro.close();
    expect(sitio.registro.hosts.slice(antes)).toEqual([]);
    expect(conexiones.some((c) => c.regla === 'credencial-invalida')).toBe(true);
  });
});

test.describe('TS-05 · Solo lectura y exclusiones', () => {
  test.describe.configure({ timeout: 180_000 });
  const p = (): PoliticaDeRed => politica();
  test.beforeAll(async () => {
    await conProxy(politica());
  });

  test('control: sin solo lectura, el POST automático llega', async () => {
    const pagina = await (await contexto(p(), false)).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/auto-post`);
    await expect.poll(() => sitio.registro.posts).toEqual(['/formulario/enviar']);
  });

  test('con solo lectura, un POST automático se corta y se registra', async () => {
    const pagina = await (await contexto(p())).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/auto-post`);
    await expect.poll(() => delNavegador.filter((r) => r.regla === 'solo-lectura')).toHaveLength(1);
    expect(sitio.registro.posts).toEqual([]);
  });

  test('con solo lectura, un formulario enviado tampoco llega', async () => {
    const pagina = await (await contexto(p())).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/formulario`);
    await pagina.locator('form button').click();
    await asentar();
    expect(sitio.registro.posts).toEqual([]);
    expect(delNavegador.some((r) => r.regla === 'solo-lectura')).toBe(true);
  });

  /** Un recorrido con el crawler de la app. Devuelve también las páginas y lo que se descartó por WebSocket. */
  async function recorrer(
    opciones: Partial<OpcionesRastreo> = {},
    ahora?: () => number,
    paginas: PaginaVisitada[] = [],
  ) {
    const soloLectura = opciones.soloLectura ?? true;
    const { contexto: c, vigilancia } = await abrirContexto(navegador, p(), {
      soloLectura,
      alRegistrar: (r) => delNavegador.push(r),
    });
    const resultado = await rastrear(
      c,
      vigilancia,
      {
        urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
        politica: p(),
        maxPaginas: 200,
        // Todo lo del sandbox está a un link de la raíz; la trampa necesita más, y lo pide.
        maxProfundidad: 1,
        maxMinutos: 5,
        maxRps: 50,
        exclusiones: ['cerrar sesión', 'eliminar', 'logout'],
        timeoutPaginaMs: 8000,
        soloLectura,
        ...opciones,
      },
      { alPagina: (pagina) => paginas.push(pagina), alHallazgo: () => undefined },
      ahora,
    );
    await c.close();
    return { resultado, paginas, wsDescartados: vigilancia.websocketDescartados() };
  }
  const rutas = (paginas: readonly PaginaVisitada[]) => paginas.map((x) => new URL(x.url).pathname);

  test('en solo lectura: no visita lo excluido, no clickea, no escribe y no sale', async () => {
    const { resultado, paginas, wsDescartados } = await recorrer();
    expect(resultado.linksExcluidos).toBe(2);
    expect(resultado.paginasVisitadas).toBeGreaterThan(10);
    expect(sitio.registro.trampas).toEqual([]);
    expect(sitio.registro.posts).toEqual([]);
    expect(sitio.registro.fugas).toEqual([]);
    expect(sitio.registro.puertoNoDeclarado).toEqual([]);
    // Ningún clic: la ruta de la SPA no se descubrió, y la cobertura no alcanzada se informa.
    expect(rutas(paginas)).not.toContain('/spa/detalle');
    expect(resultado.noRecorridosSoloLectura).toBeGreaterThanOrEqual(3);
    // El WebSocket abrió, pero lo que la página mandó no salió, y se cuenta.
    expect(sitio.registro.wsMensajes).toEqual([]);
    expect(wsDescartados).toBeGreaterThan(0);
    // RN-ESC-04: cada URL se analiza una sola vez. Y la profundidad se respeta.
    const urls = paginas.map((x) => x.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(Math.max(...paginas.map((x) => x.profundidad))).toBe(1);
  });

  test('control: sin solo lectura y sin exclusiones, los botones escriben y el WebSocket llega', async () => {
    const { paginas, wsDescartados } = await recorrer({
      soloLectura: false,
      exclusiones: [],
      // La ruta que descubre un clic queda un nivel más abajo.
      maxProfundidad: 2,
    });
    expect(sitio.registro.posts).toEqual(expect.arrayContaining(['/api/guardar', '/api/eliminar']));
    expect(rutas(paginas)).toContain('/spa/detalle');
    expect(sitio.registro.wsMensajes).toContain('guardar');
    expect(wsDescartados).toBe(0);
    expect(sitio.registro.trampas.length).toBeGreaterThan(0);
    // Un botón que envía un formulario nunca se toca, aun sin solo lectura: el único envío es el
    // automático de /auto-post, que no es un clic.
    expect(sitio.registro.posts.filter((r) => r === '/formulario/enviar')).toEqual([
      '/formulario/enviar',
    ]);
  });

  test('sin solo lectura, las exclusiones valen para botones, por texto o por atributos', async () => {
    const { resultado, paginas } = await recorrer({
      soloLectura: false,
      exclusiones: ['cerrar sesión', 'eliminar', 'guardar'],
      maxProfundidad: 2,
    });
    // «Guardar cambios» por su texto; «Quitar todo» por su data-testid, eliminar-todo.
    expect(sitio.registro.posts).not.toContain('/api/guardar');
    expect(sitio.registro.posts).not.toContain('/api/eliminar');
    // «Ver detalle» no está excluido: se clickeó y descubrió la ruta.
    expect(rutas(paginas)).toContain('/spa/detalle');
    expect(resultado.noRecorridosExclusiones).toBeGreaterThanOrEqual(4);
    expect(sitio.registro.trampas).toEqual([]);
  });

  test('las trampas de URLs infinitas se cortan, y se cuentan', async () => {
    const { resultado, paginas } = await recorrer({ maxProfundidad: 50 });
    const visitadas = rutas(paginas);
    expect(visitadas.filter((r) => r.startsWith('/calendario/')).length).toBeLessThanOrEqual(10);
    expect(visitadas.filter((r) => r === '/buscar').length).toBeLessThanOrEqual(20);
    expect(resultado.urlsDescartadas).toBeGreaterThan(0);
    expect(resultado.detenido).toBeNull();
  });

  test('RN-ESC-05: se detiene en el máximo de páginas y lo dice', async () => {
    const { resultado } = await recorrer({ maxPaginas: 2 });
    expect(resultado.paginasVisitadas).toBe(2);
    expect(resultado.detenido).toBe('max-paginas');
  });

  test('RN-ESC-05: se detiene en el tiempo máximo y lo dice', async () => {
    const vistas: PaginaVisitada[] = [];
    // Después de la primera página, el reloj salta 10 minutos.
    const { resultado } = await recorrer(
      { maxMinutos: 1 },
      () => Date.now() + (vistas.length > 0 ? 600_000 : 0),
      vistas,
    );
    expect(resultado.paginasVisitadas).toBe(1);
    expect(resultado.detenido).toBe('max-tiempo');
  });
});

test.describe('Prueba de login: una contraseña mala nunca da verde', () => {
  const PASOS: PasoLogin[] = [
    { accion: 'rellenar', selector: '#usuario', origen: 'usuario' },
    { accion: 'rellenar', selector: '#clave', origen: 'secreto' },
    { accion: 'click', selector: 'button[type=submit]' },
  ];
  const TIMEOUT_LOGIN_MS = 3000;
  // El test tiene que durar más que `probarLogin`, que siempre responde dentro de su presupuesto: una
  // falla muestra el resultado de QAtlas, no un timeout genérico. Un test llama hasta tres veces.
  test.describe.configure({
    timeout: 3 * presupuestoProbarLogin({ pasos: PASOS, timeoutMs: TIMEOUT_LOGIN_MS }) + 15_000,
  });
  const urlLogin = () => `http://${HOST_SITIO}:${sitio.puerto}/login`;
  const intentar = async (indicador: IndicadorExito, clave: string): Promise<boolean> =>
    probarLogin(await contexto(politica(), false), {
      urlLogin: urlLogin(),
      pasos: PASOS,
      indicador,
      usuario: CREDENCIALES_DE_PRUEBA.usuario,
      secreto: new TextEncoder().encode(clave),
      timeoutMs: TIMEOUT_LOGIN_MS,
    });

  const indicadores = (): [string, IndicadorExito][] => [
    ['url', { tipo: 'url', patron: `http://${HOST_SITIO}:${sitio.puerto}/panel*` }],
    ['aparece', { tipo: 'aparece', selector: 'a[href="/cerrar-sesion"]' }],
    ['desaparece', { tipo: 'desaparece', selector: 'form[action="/login"]' }],
  ];

  test.beforeAll(async () => {
    await conProxy(politica());
  });

  for (const tipo of ['url', 'aparece', 'desaparece'] as const) {
    test(`${tipo}: la contraseña correcta funciona`, async () => {
      const indicador = indicadores().find(([t]) => t === tipo)?.[1] as IndicadorExito;
      expect(await intentar(indicador, CREDENCIALES_DE_PRUEBA.clave)).toBe(true);
    });

    test(`${tipo}: una contraseña mala falla`, async () => {
      const indicador = indicadores().find(([t]) => t === tipo)?.[1] as IndicadorExito;
      expect(await intentar(indicador, 'contrasena-equivocada')).toBe(false);
    });
  }

  test('un indicador que ya se cumple antes de enviar no dice nada: falla', async () => {
    expect(await intentar({ tipo: 'aparece', selector: 'h1' }, CREDENCIALES_DE_PRUEBA.clave)).toBe(
      false,
    );
    expect(
      await intentar(
        { tipo: 'url', patron: `http://${HOST_SITIO}:${sitio.puerto}/*` },
        CREDENCIALES_DE_PRUEBA.clave,
      ),
    ).toBe(false);
    expect(
      await intentar({ tipo: 'desaparece', selector: '#no-existe' }, CREDENCIALES_DE_PRUEBA.clave),
    ).toBe(false);
  });

  test('un selector de un paso que no existe falla, sin tirar el proceso', async () => {
    const resultado = await probarLogin(await contexto(politica(), false), {
      urlLogin: urlLogin(),
      pasos: [{ accion: 'click', selector: '#no-existe' }],
      indicador: { tipo: 'aparece', selector: '#tampoco' },
      usuario: 'x',
      secreto: new Uint8Array([1]),
      timeoutMs: 500,
    });
    expect(resultado).toBe(false);
  });

  test('el arreglo del secreto queda en cero', async () => {
    const secreto = new TextEncoder().encode(CREDENCIALES_DE_PRUEBA.clave);
    await probarLogin(await contexto(politica(), false), {
      urlLogin: urlLogin(),
      pasos: PASOS,
      indicador: { tipo: 'aparece', selector: 'a[href="/cerrar-sesion"]' },
      usuario: CREDENCIALES_DE_PRUEBA.usuario,
      secreto,
      timeoutMs: TIMEOUT_LOGIN_MS,
    });
    expect(secreto.every((byte) => byte === 0)).toBe(true);
  });

  test('un login a otro dominio no sale, aunque esté en los pasos', async () => {
    const resultado = await probarLogin(await contexto(politica(), false), {
      urlLogin: `http://pixel.fuga.example:${sitio.puerto}/login`,
      pasos: PASOS,
      indicador: { tipo: 'aparece', selector: 'h1' },
      usuario: 'x',
      secreto: new Uint8Array([1]),
      timeoutMs: 500,
    });
    expect(resultado).toBe(false);
    expect(sitio.registro.fugas).toEqual([]);
  });
});

test.describe('Perfil en memoria (ADR 018)', () => {
  test('lo que el sitio guarda no llega al disco del perfil', async () => {
    const canario = `CANARIO-perfil-${Date.now()}`;
    const carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-perfil-'));
    const original = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    try {
      process.env.TEMP = carpeta;
      process.env.TMP = carpeta;
      process.env.TMPDIR = carpeta;
      await conProxy(politica());
      const ctx = await contexto(politica(), false);
      const pagina = await ctx.newPage();
      await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/`);
      await ctx.addCookies([
        { name: 'c', value: canario, url: `http://${HOST_SITIO}:${sitio.puerto}/`, expires: 2e9 },
      ]);
      await pagina.evaluate((valor) => {
        localStorage.setItem('k', valor);
        sessionStorage.setItem('k', valor);
      }, canario);
      await pagina.waitForTimeout(1500);

      const archivos = (readdirSync(carpeta, { recursive: true }) as string[])
        .map((n) => path.join(carpeta, n))
        .filter((ruta) => {
          try {
            return statSync(ruta).isFile();
          } catch {
            return false;
          }
        });
      expect(archivos.length).toBeGreaterThan(0);
      const conCanario = archivos.filter((ruta) => {
        try {
          const bytes = readFileSync(ruta);
          return bytes.includes(canario) || bytes.includes(Buffer.from(canario, 'utf16le'));
        } catch {
          // Chromium lo tiene abierto en exclusiva: se revisa al cerrar, abajo.
          return false;
        }
      });
      expect(conCanario).toEqual([]);
      await cerrarNavegador();
      cerrarNavegador = () => Promise.resolve();
      // Lo de Playwright se borra al cerrar: no queda nada para un perfil siguiente.
      await expect
        .poll(() => readdirSync(carpeta).filter((n) => n.startsWith('playwright')))
        .toEqual([]);
    } finally {
      restaurarEntorno(original);
      rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
