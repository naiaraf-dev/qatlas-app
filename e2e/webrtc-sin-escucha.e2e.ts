/**
 * El navegador de pruebas no acepta conexiones de la red (ADR 045, especificación 3.5). Con las opciones
 * de la app (`opcionesChromium`, sin controles) y detrás del proxy real, mientras una página usa WebRTC,
 * ningún proceso de Chromium tiene un socket TCP en escucha ni un socket UDP ligado fuera de loopback:
 * falla con 0.0.0.0, :: o una IP de la red.
 *
 * Los procesos se identifican por PID: los descendientes del proceso del test lanzados después de abrir
 * el navegador (`e2e/arbol-procesos.ts`). Los sockets se miran varias veces mientras la página negocia,
 * porque los de WebRTC pueden durar poco.
 *
 * Control positivo: sin los argumentos de red (`sinArgumentosDeRed`), el mismo test sí los ve. Ese
 * control abre sockets a propósito: en Windows puede aparecer el aviso del firewall, que se responde
 * «Cancelar» (CONTRIBUTING).
 */
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import {
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import {
  opcionesChromium,
  type OpcionesChromium,
} from '../packages/runner/src/motor/opciones-chromium';
import { iniciarProxy } from '../packages/runner/src/red/proxy';
import { descendientes, procesos } from './arbol-procesos';
import { vigilarEntorno } from './entorno';
import { vigilarProcesos } from './procesos';
import { describir, fueraDeLoopback, socketsDe, type Socket } from './sockets';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
vigilarEntorno(test);

const CREDENCIAL = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };
/** Cuánto se mira mientras la página negocia, y cada cuánto. */
const OBSERVACION_MS = 4000;
const INTERVALO_MS = 250;

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

/** Abre `/webrtc` con estas opciones y devuelve todos los sockets que vio en los procesos de Chromium. */
async function observar(extra: Pick<OpcionesChromium, 'control'> = {}): Promise<{
  sockets: Socket[];
  procesosVistos: number;
}> {
  const proxy = await iniciarProxy({
    politica: {
      urlBase: `http://${HOST_SITIO}:${sitio.puerto}/`,
      dominios: [HOST_SITIO],
      sistemaInterno: false,
      puertosLocales: [],
    },
    credencial: CREDENCIAL,
    alRegistrar: () => undefined,
    resolver: (host: string) => {
      const ip = MAPA_DE_HOSTS[host];
      return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
    },
  });
  const antes = Date.now();
  const navegador = await chromium.launch(
    opcionesChromium({
      proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL },
      ...extra,
    }),
  );
  const vistos = new Map<string, Socket>();
  const pids = new Set<number>();
  try {
    const pagina = await (await navegador.newContext()).newPage();
    await pagina.goto(`http://${HOST_SITIO}:${sitio.puerto}/webrtc`);
    const fin = Date.now() + OBSERVACION_MS;
    while (Date.now() < fin) {
      // Solo los procesos que nacieron con este navegador: los PID se reutilizan.
      const deChromium = descendientes(procesos(), process.pid).filter(
        (p) => p.creado >= antes - 1000,
      );
      for (const p of deChromium) pids.add(p.pid);
      for (const s of socketsDe(deChromium.map((p) => p.pid))) {
        vistos.set(`${s.protocolo} ${s.pid} ${s.direccion} ${String(s.puerto)}`, s);
      }
      await new Promise((listo) => setTimeout(listo, INTERVALO_MS));
    }
  } finally {
    await navegador.close();
    await proxy.cerrar();
  }
  return { sockets: [...vistos.values()], procesosVistos: pids.size };
}

test(
  'el navegador de la app no escucha fuera de loopback mientras una página usa WebRTC',
  { tag: ['@seguridad'] },
  async () => {
    const { sockets, procesosVistos } = await observar();
    // Control: se miraron los procesos de Chromium, no una lista vacía.
    expect(procesosVistos).toBeGreaterThan(1);
    expect(fueraDeLoopback(sockets).map(describir)).toEqual([]);
    // Y TCP en escucha, ninguno: Playwright habla con Chromium por una tubería, no por un puerto.
    expect(sockets.filter((s) => s.protocolo === 'TCP').map(describir)).toEqual([]);
  },
);

test(
  'control: sin los argumentos de red, el mismo test ve los sockets fuera de loopback',
  { tag: ['@seguridad'] },
  async () => {
    // Abre sockets a propósito: en Windows puede aparecer el aviso del firewall; se responde «Cancelar».
    const { sockets } = await observar({ control: { sinArgumentosDeRed: true } });
    expect(fueraDeLoopback(sockets).some((s) => s.protocolo === 'UDP')).toBe(true);
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
