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
 * Hoy queda una brecha conocida: un UDP sin conectar en 0.0.0.0 mientras la página usa WebRTC. El test de
 * cierre la reproduce con `test.fail` (ver abajo), y otro test exige que no vuelva nada de lo que ya se
 * cerró.
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
import { describir, detallar, fueraDeLoopback, socketsDe, type Socket } from './sockets';

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

/**
 * Lo que ADR 045 ya cerró, si vuelve: todo socket fuera de loopback salvo un UDP en 0.0.0.0 en un puerto
 * efímero, que es la brecha conocida.
 */
const yaCerrados = (sockets: readonly Socket[]): Socket[] =>
  fueraDeLoopback(sockets).filter(
    (s) => s.protocolo === 'TCP' || s.direccion !== '0.0.0.0' || s.puerto === 5353,
  );

test(
  'lo que se cerró sigue cerrado: ni TCP en escucha, ni el 5353, ni ::, ni una IP de la red',
  { tag: ['@seguridad'] },
  async () => {
    const { sockets, procesosVistos } = await observar();
    expect(procesosVistos).toBeGreaterThan(1);
    expect(yaCerrados(sockets).map(detallar)).toEqual([]);
    expect(sockets.filter((s) => s.protocolo === 'TCP').map(describir)).toEqual([]);
  },
);

/*
 * Brecha conocida (ADR 045, E-46). Mientras una página usa WebRTC, Chromium liga un UDP sin conectar en
 * 0.0.0.0, en un puerto efímero. El CI de Linux lo mostró así en dos intentos: «UDP · local 0.0.0.0
 * puerto 53086 / 38423 · remoto 0.0.0.0 puerto 0 · estado sin conectar». No es un sondeo conectado:
 * acepta paquetes de cualquier interfaz mientras existe. No hay opción de Chromium que lo evite. La
 * solución es la regla de firewall de entrada del instalador para el Chromium empaquetado (semana 10).
 *
 * Marcado con `test.fail`, como la fuga de la básica: lo de abajo es lo que debería pasar. Si un día deja
 * de fallar, el test falla y avisa: hay que revisar el ADR 045 y sacar la marca.
 */
test(
  'brecha conocida (semana 10): el navegador de la app no escucha fuera de loopback mientras una página usa WebRTC',
  { tag: ['@seguridad'] },
  async () => {
    test.fail();
    const { sockets, procesosVistos } = await observar();
    // Control: se miraron los procesos de Chromium, no una lista vacía.
    expect(procesosVistos).toBeGreaterThan(1);
    // Si falla, el detalle de cada socket va al log y al reporte: local, remoto y estado (ADR 045).
    const culpables = [
      ...fueraDeLoopback(sockets),
      ...sockets.filter((s) => s.protocolo === 'TCP' && !fueraDeLoopback([s]).length),
    ];
    for (const socket of culpables) {
      const detalle = detallar(socket);
      console.log(`[webrtc-sin-escucha] ${detalle}`);
      test.info().annotations.push({ type: 'socket fuera de loopback', description: detalle });
    }
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
    // Y el filtro de «lo que se cerró» los ve: el responder mDNS o el socket en ::.
    expect(yaCerrados(sockets).length).toBeGreaterThan(0);
  },
);

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
