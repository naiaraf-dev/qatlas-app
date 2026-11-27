/**
 * WebGL en el navegador de pruebas (ADR 041). QAtlas lanza Chromium sin `--enable-unsafe-swiftshader`:
 * en un equipo sin GPU, una página que necesita WebGL falla. Esa falla no es del sitio: el escaneo la
 * informa como cobertura no alcanzada (`noRecorridosSinWebGL`), no como hallazgo.
 *
 * El equipo sin GPU se simula con `control: { sinWebGL: true }` (`--disable-3d-apis`), igual en Windows y
 * en Linux. El caso es `/webgl` del sandbox, que dibuja como una biblioteca de gráficos: canvas suelto y
 * una excepción si no hay WebGL.
 *
 * Controles:
 * - Sin WebGL, la página sí tira la excepción: si no, que no haya hallazgo no probaría nada.
 * - Con WebGL, la página dibuja, y el escaneo no informa nada.
 * - Sin WebGL, una excepción que no es de WebGL (`/excepcion-js`) sigue siendo un hallazgo.
 */
import { expect, test } from '@playwright/test';
import { chromium, type Browser } from 'playwright-core';
import { EXCLUSIONES_POR_DEFECTO } from '@qatlas/shared';
import {
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  MENSAJE_SIN_WEBGL,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type { HallazgoDetectado } from '../packages/runner/src/motor/chequeos';
import { rastrear, type ResultadoRastreo } from '../packages/runner/src/motor/crawler';
import { protegerContexto } from '../packages/runner/src/motor/motor';
import { opcionesChromium } from '../packages/runner/src/motor/opciones-chromium';
import { iniciarProxy, type ProxyActivo } from '../packages/runner/src/red/proxy';
import { vigilarEntorno } from './entorno';
import { vigilarProcesos } from './procesos';

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };

let sitio: SandboxActivo;
let proxy: ProxyActivo;
let politica: {
  urlBase: string;
  dominios: string[];
  sistemaInterno: boolean;
  puertosLocales: number[];
};

test.describe.configure({ mode: 'serial', timeout: 120_000 });
vigilarEntorno(test);

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
  politica = {
    urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
    dominios: [HOST_SITIO],
    sistemaInterno: false,
    puertosLocales: [],
  };
  proxy = await iniciarProxy({
    politica,
    credencial: CREDENCIAL,
    alRegistrar: () => undefined,
    resolver: (host) => {
      const ip = MAPA_DE_HOSTS[host];
      return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
    },
  });
});

test.afterAll(async () => {
  await proxy.cerrar();
  await sitio.cerrar();
});

const abrir = (sinWebGL: boolean): Promise<Browser> =>
  chromium.launch(
    opcionesChromium({
      proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL },
      ...(sinWebGL ? { control: { sinWebGL: true } } : {}),
    }),
  );

/** Escanea solo `ruta` (profundidad 0), con el crawler y los chequeos de la app. */
async function escanear(
  ruta: string,
  sinWebGL: boolean,
): Promise<{ resultado: ResultadoRastreo; hallazgos: HallazgoDetectado[] }> {
  const navegador = await abrir(sinWebGL);
  try {
    const contexto = await navegador.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
    });
    const vigilancia = await protegerContexto(contexto, politica, {
      soloLectura: true,
      alRegistrar: () => undefined,
    });
    const hallazgos: HallazgoDetectado[] = [];
    const resultado = await rastrear(
      contexto,
      vigilancia,
      {
        urlBase: `http://${HOST_SITIO}:${sitio.puerto}${ruta}`,
        politica,
        maxPaginas: 1,
        maxProfundidad: 0,
        maxMinutos: 2,
        maxRps: 50,
        exclusiones: EXCLUSIONES_POR_DEFECTO,
        timeoutPaginaMs: 10_000,
        soloLectura: true,
      },
      { alPagina: () => undefined, alHallazgo: (h) => hallazgos.push(h) },
    );
    return { resultado, hallazgos };
  } finally {
    await navegador.close();
  }
}

const deJavaScript = (hallazgos: HallazgoDetectado[]) =>
  hallazgos.filter((h) => h.tipo === 'error-javascript' || h.tipo === 'console-error');

/** Visita la página directamente y devuelve sus excepciones y si llegó a dibujar. */
async function visitar(sinWebGL: boolean): Promise<{ excepciones: string[]; dibujo: boolean }> {
  const navegador = await abrir(sinWebGL);
  try {
    const pagina = await (await navegador.newContext()).newPage();
    const excepciones: string[] = [];
    pagina.on('pageerror', (error) => excepciones.push(error.message));
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/webgl`);
    const dibujo = (await pagina.locator('#estado-webgl').getAttribute('data-dibujado')) === 'si';
    return { excepciones, dibujo };
  } finally {
    await navegador.close();
  }
}

test(
  'control: sin WebGL, la página del sandbox sí falla; con WebGL, dibuja',
  { tag: ['@seguridad'] },
  async () => {
    const sin = await visitar(true);
    expect(sin.dibujo).toBe(false);
    expect(sin.excepciones).toEqual([MENSAJE_SIN_WEBGL]);
    const con = await visitar(false);
    expect(con.dibujo).toBe(true);
    expect(con.excepciones).toEqual([]);
  },
);

test(
  'sin WebGL: cobertura no alcanzada, y ningún hallazgo de la página',
  { tag: ['@seguridad'] },
  async () => {
    const { resultado, hallazgos } = await escanear('/webgl', true);
    expect(resultado.paginasVisitadas).toBe(1);
    expect(resultado.noRecorridosSinWebGL).toBe(1);
    expect(deJavaScript(hallazgos)).toEqual([]);
  },
);

test(
  'control: con WebGL, el escaneo no informa nada de esa página',
  { tag: ['@seguridad'] },
  async () => {
    const { resultado, hallazgos } = await escanear('/webgl', false);
    expect(resultado.paginasVisitadas).toBe(1);
    expect(resultado.noRecorridosSinWebGL).toBe(0);
    expect(deJavaScript(hallazgos)).toEqual([]);
  },
);

test(
  'control: sin WebGL, una excepción que no es de WebGL sigue siendo un hallazgo',
  { tag: ['@seguridad'] },
  async () => {
    const { resultado, hallazgos } = await escanear('/excepcion-js', true);
    expect(resultado.noRecorridosSinWebGL).toBe(0);
    expect(deJavaScript(hallazgos).map((h) => h.tipo)).toEqual(['error-javascript']);
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
