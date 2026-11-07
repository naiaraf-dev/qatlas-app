/**
 * La autenticación básica que pone QAtlas (ADR 025), con Chromium real: el encabezado `Authorization` va
 * solo al origen exacto de la URL base, nunca sobre http sin «Permitir login sin cifrar», nunca a otro
 * origen (un recurso de la página, otro host, otro puerto u otro esquema). Hay controles positivos: con
 * https y con la opción, sí va.
 *
 * La fuga conocida: después de una redirección del origen base a otro origen, Chromium sigue mandando el
 * encabezado que le puso la ruta, y la ruta no ve ese pedido. Por eso la básica llega en la fase 2 y el
 * proceso principal no la deja crear ni lanzar (ADR 025). El último test la reproduce, marcado con
 * `test.fail`: si un día deja de fugar, falla, y hay que revisar el ADR.
 *
 * Dos servidores locales, uno https (certificado de prueba) y uno http. `localhost` y `127.0.0.1` son
 * orígenes distintos sobre el mismo servidor. El navegador no lleva proxy: lo que se prueba es la ruta.
 */
import { createServer as crearHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as crearHttps } from 'node:https';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { chromium, type Browser } from 'playwright-core';
import { ARGUMENTOS_CHROMIUM } from '../packages/runner/src/motor/motor';
import { ponerBasica } from '../packages/runner/src/motor/sesion';
import { vigilarEntorno } from './entorno';
import { generarCertificado } from './fixtures/certificado';

const USUARIO = 'ana';
const CLAVE = 'clave-basica-de-prueba-41';
const ESPERADO = `Basic ${Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64')}`;

interface Pedido {
  /** Esquema, host y puerto, como lo vio el servidor. */
  origen: string;
  ruta: string;
  autorizacion: string | undefined;
}

const pedidos: Pedido[] = [];

function atender(esquema: 'http' | 'https') {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `${esquema}://${req.headers.host ?? ''}`);
    pedidos.push({
      origen: url.origin,
      ruta: url.pathname,
      autorizacion: req.headers.authorization,
    });
    if (url.pathname === '/pagina') {
      const otro = url.searchParams.get('otro') ?? '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Página</title><img src="${otro}/recurso.png" alt="">`);
      return;
    }
    if (url.pathname === '/redirigir') {
      res.writeHead(302, { location: url.searchParams.get('a') ?? '/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  };
}

const escuchar = (servidor: ReturnType<typeof crearHttp>) =>
  new Promise<number>((resolver) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolver((servidor.address() as AddressInfo).port);
    });
  });

test.describe.configure({ mode: 'serial' });
vigilarEntorno(test);

let navegador: Browser;
let servidorHttps: ReturnType<typeof crearHttp>;
let servidorHttp: ReturnType<typeof crearHttp>;
let S = '';
let S_OTRO = '';
let H = '';
let H_OTRO = '';

test.beforeAll(async () => {
  const certificado = generarCertificado(['localhost', '127.0.0.1']);
  servidorHttps = crearHttps({ key: certificado.key, cert: certificado.cert }, atender('https'));
  servidorHttp = crearHttp(atender('http'));
  const puertoHttps = await escuchar(servidorHttps);
  const puertoHttp = await escuchar(servidorHttp);
  S = `https://localhost:${puertoHttps}`;
  S_OTRO = `https://127.0.0.1:${puertoHttps}`;
  H = `http://localhost:${puertoHttp}`;
  H_OTRO = `http://127.0.0.1:${puertoHttp}`;
  navegador = await chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [...ARGUMENTOS_CHROMIUM],
  });
});

test.afterAll(async () => {
  await navegador.close();
  await new Promise((r) => servidorHttps.close(r));
  await new Promise((r) => servidorHttp.close(r));
});

/** Abre una URL en un contexto con la básica para `origen`, y devuelve lo que vieron los servidores. */
async function visitar(
  url: string,
  basica: { origen: string; permitirHttp: boolean },
): Promise<Pedido[]> {
  pedidos.length = 0;
  // Aceptar el certificado de prueba es solo de este test.
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true });
  try {
    await ponerBasica(contexto, { usuario: USUARIO, clave: CLAVE, ...basica });
    const pagina = await contexto.newPage();
    await pagina.goto(url, { waitUntil: 'load' });
    return pedidos.filter((p) => p.ruta !== '/favicon.ico');
  } finally {
    await contexto.close();
  }
}

const de = (lista: Pedido[], origen: string, ruta: string) => {
  const encontrado = lista.find((p) => p.origen === origen && p.ruta === ruta);
  if (!encontrado) throw new Error(`Nadie pidió ${ruta} a ${origen}`);
  return encontrado;
};

test('https: va al origen base, y no a un recurso de otro origen', async () => {
  const vistos = await visitar(`${S}/pagina?otro=${S_OTRO}`, { origen: S, permitirHttp: false });
  expect(de(vistos, S, '/pagina').autorizacion).toBe(ESPERADO);
  expect(de(vistos, S_OTRO, '/recurso.png').autorizacion).toBeUndefined();
});

// Dentro del mismo origen la conserva (Chromium la arrastra, y ahí corresponde).
test('https: una redirección dentro del mismo origen la conserva', async () => {
  const mismo = await visitar(`${S}/redirigir?a=${S}/destino`, { origen: S, permitirHttp: false });
  expect(de(mismo, S, '/redirigir').autorizacion).toBe(ESPERADO);
  expect(de(mismo, S, '/destino').autorizacion).toBe(ESPERADO);
});

test('http sin «Permitir login sin cifrar»: nunca, ni en el origen base ni después de redirigir', async () => {
  const basica = { origen: H, permitirHttp: false };
  const vistos = await visitar(`${H}/pagina?otro=${H_OTRO}`, basica);
  expect(vistos.length).toBeGreaterThan(1);
  expect(vistos.every((p) => p.autorizacion === undefined)).toBe(true);
  const redirigido = await visitar(`${H}/redirigir?a=${H}/destino`, basica);
  expect(redirigido.every((p) => p.autorizacion === undefined)).toBe(true);
});

test('http con la opción: solo al origen base, nunca a otro', async () => {
  const vistos = await visitar(`${H}/pagina?otro=${H_OTRO}`, { origen: H, permitirHttp: true });
  expect(de(vistos, H, '/pagina').autorizacion).toBe(ESPERADO);
  expect(de(vistos, H_OTRO, '/recurso.png').autorizacion).toBeUndefined();
});

test('fuga conocida (fase 2): una redirección a otro origen se lleva el encabezado', async () => {
  // Esperado que falle mientras Chromium arrastre el encabezado: lo de abajo es lo que debería pasar.
  test.fail();
  const casos = [
    { basica: { origen: S, permitirHttp: false }, desde: S, destinos: [S_OTRO, H, H_OTRO] },
    { basica: { origen: H, permitirHttp: true }, desde: H, destinos: [H_OTRO, S] },
  ];
  for (const { basica, desde, destinos } of casos) {
    for (const destino of destinos) {
      const vistos = await visitar(`${desde}/redirigir?a=${destino}/destino`, basica);
      expect(de(vistos, desde, '/redirigir').autorizacion).toBe(ESPERADO);
      expect.soft(de(vistos, destino, '/destino').autorizacion).toBeUndefined();
    }
  }
});
