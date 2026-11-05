/**
 * El oráculo completo (ESC): el crawler y los chequeos de la app, en un navegador real, detrás del proxy
 * de la app, contra el sandbox con nombres y HTTPS. Compara con `hallazgos-esperados.json`.
 *
 * Es a nivel del runner, no de la interfaz: el contenido mixto necesita una página HTTPS con un
 * certificado de prueba, y la app con razón lo rechaza. Este contexto lo acepta solo acá, y lleva las
 * mismas protecciones que el de la app (`protegerContexto`). El escaneo desde la interfaz, sobre
 * 127.0.0.1, está en `escaneo.e2e.ts`.
 */
import { expect, test } from '@playwright/test';
import type { Browser } from 'playwright-core';
import { EXCLUSIONES_POR_DEFECTO } from '@qatlas/shared';
import {
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type { HallazgoDetectado } from '../packages/runner/src/motor/chequeos';
import { rastrear, type ResultadoRastreo } from '../packages/runner/src/motor/crawler';
import { abrirNavegador, protegerContexto } from '../packages/runner/src/motor/motor';
import { iniciarProxy, type ProxyActivo } from '../packages/runner/src/red/proxy';
import { vigilarEntorno } from './entorno';
import { generarCertificado } from './fixtures/certificado';
import { compararConOraculo, manifiesto, resumenLegible } from './oraculo';

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };

let sitio: SandboxActivo;
let proxy: ProxyActivo;
let navegador: Browser;
let hallazgos: HallazgoDetectado[];
let resultado: ResultadoRastreo;

test.describe.configure({ mode: 'serial', timeout: 240_000 });
vigilarEntorno(test);

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const certificado = generarCertificado([HOST_SITIO]);
  sitio = await iniciarSandbox({
    puerto: 0,
    tls: { key: certificado.key, cert: certificado.cert },
  });
  const politica = {
    urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
    // La API del sandbox está en 127.0.0.1, en otro puerto.
    dominios: [HOST_SITIO, '127.0.0.1'],
    sistemaInterno: false,
    puertosLocales: [sitio.puertoApi, sitio.puertoHttps],
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
  navegador = await abrirNavegador({
    politica,
    proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL },
    timeoutPaginaMs: 10_000,
  });
  // Aceptar el certificado de prueba es solo de este test; lo demás es lo de la app.
  const contexto = await navegador.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
  });
  const vigilancia = await protegerContexto(contexto, politica, {
    soloLectura: true,
    alRegistrar: () => undefined,
  });
  hallazgos = [];
  resultado = await rastrear(
    contexto,
    vigilancia,
    {
      urlBase: politica.urlBase,
      politica,
      maxPaginas: 200,
      maxProfundidad: 2,
      maxMinutos: 10,
      maxRps: 50,
      exclusiones: EXCLUSIONES_POR_DEFECTO,
      timeoutPaginaMs: 10_000,
      soloLectura: true,
    },
    { alPagina: () => undefined, alHallazgo: (h) => hallazgos.push(h) },
  );
});

test.afterAll(async () => {
  await navegador.close();
  await proxy.cerrar();
  await sitio.cerrar();
});

test('cada problema plantado se encuentra, con su tipo, su URL y su severidad', () => {
  const comparacion = compararConOraculo(manifiesto.hallazgos, hallazgos);
  const resumen = resumenLegible(comparacion);
  console.log(resumen);
  test.info().annotations.push({ type: 'oráculo', description: resumen });
  expect(comparacion.faltantes, resumen).toEqual([]);
  expect(comparacion.conOtraSeveridad, resumen).toEqual([]);
});

test('ningún hallazgo sin documentar, y nada sobre las páginas sanas', () => {
  const comparacion = compararConOraculo(manifiesto.hallazgos, hallazgos);
  const resumen = resumenLegible(comparacion);
  expect(comparacion.enPaginasSanas, resumen).toEqual([]);
  expect(comparacion.inesperados, resumen).toEqual([]);
});

test('el recorrido terminó sin salir del alcance ni escribir', () => {
  expect(resultado.detenido).toBeNull();
  expect(resultado.noRecorridosSoloLectura).toBeGreaterThan(0);
  expect(sitio.registro.fugas).toEqual([]);
  expect(sitio.registro.posts).toEqual([]);
  expect(sitio.registro.trampas).toEqual([]);
  expect(sitio.registro.udp).toEqual([]);
});

test('el detalle de un hallazgo lleva lo que puede ser sensible; el título y la clave, no', () => {
  const consola = hallazgos.find((h) => h.tipo === 'console-error');
  expect(consola?.detalle).toContain('Error plantado en el sandbox');
  for (const h of hallazgos) {
    expect(`${h.titulo} ${h.clave}`).not.toContain('Error plantado en el sandbox');
    expect(h.url).not.toContain('?');
  }
});
