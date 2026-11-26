/**
 * El navegador de la app no se conecta a nada que el sitio no haya pedido (ADR 041), con el Chromium
 * completo y las opciones de la app (`opcionesChromium`), detrás del proxy real.
 *
 * Se mira en dos lugares:
 * - El net-log de Chromium: todo lo que el navegador intenta. Solo se admiten los dos servicios conocidos
 *   que Chromium no deja apagar por línea de comando, y solo sin la credencial del proxy: sin ella, el
 *   proxy no decide destino ni abre conexión.
 * - El registro del proxy, que es lo que ve el monitor de conexiones. Muestra todo lo que se intentó: el
 *   sitio con su regla, y cada servicio interno, bloqueado con `servicio-interno-navegador`.
 *
 * Control positivo: con la elegibilidad de AI Mode y la hora de red encendidas (lo que pasaba con el
 * segundo `--disable-features`), el net-log las ve.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import {
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import {
  FUNCIONES_APAGADAS_POR_QATLAS,
  opcionesChromium,
  type OpcionesChromium,
} from '../packages/runner/src/motor/opciones-chromium';
import { iniciarProxy, type RegistroConexion } from '../packages/runner/src/red/proxy';
import { vigilarEntorno } from './entorno';
import { DE_GOOGLE, delSitio } from './ruido';
import { vigilarProcesos } from './procesos';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
vigilarEntorno(test);

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };

/**
 * Lo que Chromium 156 intenta sin que haya cómo apagarlo por línea de comando. Sale por el contexto del
 * sistema o del perfil por defecto, que no tienen la credencial del proxy: recibe 407 y nunca se
 * autentica. Si alguno llegara a autenticarse, o apareciera otro, el test falla.
 * - `accounts.google.com`: el reconciliador de cuentas (`ListAccounts`).
 * - `update.googleapis.com`: la instalación a pedido del manifiesto de modelos locales de la guía de
 *   optimización; no es la actualización de fondo, que `--disable-component-update` sí apaga.
 */
const CONOCIDOS_SIN_CREDENCIAL = new Set(['accounts.google.com', 'update.googleapis.com']);

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

interface NetLog {
  constants: { logEventTypes: Record<string, number> };
  events: { type: number; source: { id: number }; params?: Record<string, unknown> }[];
}

interface Observado {
  /** Lo que el proxy registró: lo que ve el monitor. */
  registradas: RegistroConexion[];
  /** Cada host que Chromium intentó, según su net-log, sin el del proxy. */
  intentados: Set<string>;
  /** Los hosts a los que Chromium mandó la credencial del proxy en un túnel. */
  conCredencial: Set<string>;
}

/**
 * Abre el navegador como la app, visita páginas del sandbox sin recursos externos, espera quieto y
 * devuelve lo que se intentó. El net-log va a una carpeta temporal que se borra al terminar.
 */
async function observar(
  espera: number,
  extra: Pick<OpcionesChromium, 'control'> = {},
): Promise<Observado> {
  const registradas: RegistroConexion[] = [];
  const proxy = await iniciarProxy({
    politica: {
      urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
      dominios: [HOST_SITIO],
      sistemaInterno: false,
      puertosLocales: [],
    },
    credencial: CREDENCIAL,
    alRegistrar: (r) => registradas.push(r),
    resolver: (host: string) => {
      const ip = MAPA_DE_HOSTS[host];
      return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
    },
  });
  const carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-netlog-'));
  const netlog = path.join(carpeta, 'netlog.json');
  try {
    const navegador = await chromium.launch(
      opcionesChromium({
        proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL },
        argumentos: [`--log-net-log=${netlog}`, '--net-log-capture-mode=Default'],
        ...extra,
      }),
    );
    try {
      // Dos contextos, como el runner: cada uno es otro perfil para los servicios de Chromium.
      for (const ruta of ['/evidencias/limpia', '/evidencias/ficha']) {
        const contexto = await navegador.newContext();
        const pagina = await contexto.newPage();
        await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}${ruta}`);
        await contexto.close();
      }
      await new Promise((listo) => setTimeout(listo, espera));
    } finally {
      // Al cerrar, Chromium termina de escribir el net-log.
      await navegador.close();
    }
    return {
      registradas,
      ...leerNetLog(readFileSync(netlog, 'utf8'), `127.0.0.1:${proxy.puerto}`),
    };
  } finally {
    await proxy.cerrar();
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** `delProxy`: el net-log anota la dirección del proxy como una URL más; esa sola, con su puerto, no cuenta. */
function leerNetLog(
  texto: string,
  delProxy: string,
): Pick<Observado, 'intentados' | 'conCredencial'> {
  const log = JSON.parse(texto) as NetLog;
  const tipo = (nombre: string) => log.constants.logEventTypes[nombre];
  const intentados = new Set<string>();
  const conCredencial = new Set<string>();
  for (const evento of log.events) {
    const url = evento.params?.url;
    if (typeof url === 'string' && /^(https?|wss?):/.test(url)) {
      const { host, hostname } = new URL(url);
      if (host !== delProxy) intentados.add(hostname);
    }
    // Los encabezados del CONNECT: en el modo Default, la credencial aparece como «[N bytes were stripped]».
    if (evento.type === tipo('HTTP_TRANSACTION_SEND_TUNNEL_HEADERS')) {
      const encabezados = (evento.params?.headers ?? []) as string[];
      const host = encabezados
        .find((h) => h.startsWith('Host: '))
        ?.slice(6)
        .replace(/:\d+$/, '');
      if (host && encabezados.some((h) => h.toLowerCase().startsWith('proxy-authorization'))) {
        conCredencial.add(host);
      }
    }
  }
  return { intentados, conCredencial };
}

test('Playwright no apaga nada que la app no apague: un solo --disable-features efectivo', async () => {
  const navegador = await chromium.launch(opcionesChromium());
  try {
    // La línea de comandos real del navegador, como la muestra Chromium. La CDP no la da sin
    // `--enable-automation`, que Playwright ya no pasa.
    const pagina = await (await navegador.newContext()).newPage();
    await pagina.goto('chrome://version');
    const linea = ((await pagina.locator('#command_line').textContent()) ?? '').split(/\s+/);
    const listas = linea
      .filter((a) => a.startsWith('--disable-features='))
      .map((a) => a.slice('--disable-features='.length).split(','));
    // Chromium usa el último. Debe incluir todo lo que pide Playwright (el primero) y lo de QAtlas.
    const efectiva = listas.at(-1) ?? [];
    const pedidas = new Set([...listas.flat(), ...FUNCIONES_APAGADAS_POR_QATLAS]);
    expect([...pedidas].filter((f) => !efectiva.includes(f))).toEqual([]);
    // Control: Playwright sí pone el suyo, así que la comparación prueba algo.
    expect(listas.length).toBeGreaterThan(1);
    expect(listas[0]).toContain('AimEnabled');
  } finally {
    await navegador.close();
  }
});

test('sin ruido: Chromium no intenta nada más que lo conocido, y el monitor lo muestra todo', async () => {
  // ListAccounts reintenta a los 1, 4 y 12 segundos: la espera los cubre.
  const { registradas, intentados, conCredencial } = await observar(15_000);
  // El sitio, con su regla; nada de Google ni de nadie más con otra regla.
  const internos = registradas.filter((r) => r.regla === 'servicio-interno-navegador');
  expect([...new Set(delSitio(registradas).map((r) => r.destino))]).toEqual([
    `${HOST_SITIO}:${sitio.puerto}`,
  ]);
  expect(internos.every((r) => !r.permitida)).toBe(true);
  const hostsInternos = new Set(internos.map((r) => r.destino.replace(/:\d+$/, '')));
  expect([...hostsInternos].filter((h) => !CONOCIDOS_SIN_CREDENCIAL.has(h))).toEqual([]);
  // Transparencia: todo lo que Chromium intentó está en el monitor (lo del sitio o como interno).
  const enElMonitor = new Set(registradas.map((r) => r.destino.replace(/:\d+$/, '')));
  expect([...intentados].filter((h) => !enElMonitor.has(h))).toEqual([]);
  // Lo que Chromium intentó: el sitio y, como mucho, los conocidos, siempre sin credencial.
  const otros = [...intentados].filter((h) => h !== HOST_SITIO);
  expect(otros.filter((h) => !CONOCIDOS_SIN_CREDENCIAL.has(h))).toEqual([]);
  expect([...conCredencial].filter((h) => h !== HOST_SITIO)).toEqual([]);
  // Control: el net-log ve los túneles al sitio con credencial (si no, la última aserción no prueba nada).
  expect(intentados.has(HOST_SITIO)).toBe(true);
});

test('control: con los servicios que Playwright apaga encendidos, el net-log los ve', async () => {
  const { intentados } = await observar(3_000, {
    control: { funcionesEncendidas: ['AimEnabled', 'NetworkTimeServiceQuerying'] },
  });
  const deGoogle = [...intentados].filter((h) => DE_GOOGLE.test(h));
  expect(deGoogle).toEqual(expect.arrayContaining([expect.stringMatching(/google\.com$/)]));
  expect(deGoogle.some((h) => !CONOCIDOS_SIN_CREDENCIAL.has(h))).toBe(true);
  // Control de la expresión: reconoce los dominios de Google y no el sitio.
  expect(DE_GOOGLE.test('www.google.com')).toBe(true);
  expect(DE_GOOGLE.test(HOST_SITIO)).toBe(false);
});

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
