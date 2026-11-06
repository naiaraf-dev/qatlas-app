import type { IndicadorExito, PasoLogin } from '@qatlas/shared';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { decidirUrlSinResolver, type PoliticaDeRed } from '../red/reglas';
import type { Configuracion } from '../protocolo';

/**
 * El navegador de pruebas y lo que hace con él (especificación 3.5 y 3.7). El sitio probado es lo no
 * confiable, y corre en el sandbox de Chromium. Este código nunca devuelve contenido de la página.
 */

export interface RegistroNavegador {
  destino: string;
  permitida: boolean;
  regla: string;
}

export type AlRegistrar = (registro: RegistroNavegador) => void;

/**
 * - `chromiumSandbox`: Playwright lo trae apagado, y el sitio probado es hostil por defecto.
 * - `<-loopback>`: sin esto, Chromium se saltea el proxy para localhost.
 * - WebRTC y QUIC usan UDP, que el proxy no ve: se apagan. El nombre importa: la variante `--force-` de
 *   este flag no hace nada en esta versión, y sin decir nada. Por eso hay un control positivo en los E2E.
 * - `PreconnectToSearch` y `AutofillServerCommunication`: Chromium se conecta solo a su buscador por
 *   defecto y al servicio de autocompletar, al ver un formulario. El proxy los bloquea igual, pero
 *   llenarían el monitor con destinos que el sitio nunca pidió.
 * - No se pasa `--host-resolver-rules`: con proxy, Chromium le manda el nombre sin resolverlo.
 */
export const ARGUMENTOS_CHROMIUM = [
  '--proxy-bypass-list=<-loopback>',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-quic',
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  '--disable-features=PreconnectToSearch,AutofillServerCommunication',
] as const;

export function abrirNavegador(configuracion: Configuracion): Promise<Browser> {
  return chromium.launch({
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [...ARGUMENTOS_CHROMIUM],
    proxy: {
      server: configuracion.proxy.servidor,
      username: configuracion.proxy.usuario,
      password: configuracion.proxy.clave,
    },
  });
}

const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostYPuerto(texto: string): string {
  try {
    const { host } = new URL(texto);
    return host.slice(0, 280) || 'desconocido';
  } catch {
    return 'desconocido';
  }
}

/** Lo que la segunda capa cortó en la página actual, para no confundirlo con un error del sitio. */
export interface Vigilancia {
  bloqueadas: () => string[];
  reiniciar: () => void;
  /** Mensajes de WebSocket que la página quiso mandar y no salieron, por solo lectura. */
  websocketDescartados: () => number;
}

/**
 * Las protecciones de un contexto, aparte de cómo se crea: los tests que necesitan aceptar un
 * certificado de prueba crean el suyo y le aplican exactamente esto.
 *
 * Segunda capa: lo que el proxy bloquearía se corta antes, también por puerto. En solo lectura se
 * cortan las escrituras HTTP y los mensajes que la página manda por WebSocket.
 */
export async function protegerContexto(
  contexto: BrowserContext,
  politica: PoliticaDeRed,
  { soloLectura, alRegistrar }: { soloLectura: boolean; alRegistrar: AlRegistrar },
): Promise<Vigilancia> {
  let bloqueadas: string[] = [];
  let descartados = 0;
  await contexto.route('**/*', async (ruta) => {
    const solicitud = ruta.request();
    const url = solicitud.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      await ruta.fallback();
      return;
    }
    const decision = decidirUrlSinResolver(url, politica);
    if (!decision.permitida) {
      bloqueadas.push(url);
      alRegistrar({ destino: hostYPuerto(url), permitida: false, regla: decision.regla });
      await ruta.abort('blockedbyclient');
      return;
    }
    if (soloLectura && !METODOS_DE_LECTURA.has(solicitud.method())) {
      alRegistrar({ destino: hostYPuerto(url), permitida: false, regla: 'solo-lectura' });
      await ruta.abort('blockedbyclient');
      return;
    }
    await ruta.fallback();
  });
  await contexto.routeWebSocket(/.*/, (socket) => {
    const decision = decidirUrlSinResolver(socket.url(), politica);
    if (!decision.permitida) {
      bloqueadas.push(socket.url());
      alRegistrar({ destino: hostYPuerto(socket.url()), permitida: false, regla: decision.regla });
      void socket.close();
      return;
    }
    const servidor = socket.connectToServer();
    socket.onMessage((mensaje) => {
      if (soloLectura) {
        descartados += 1;
        return;
      }
      servidor.send(mensaje);
    });
  });
  return {
    bloqueadas: () => bloqueadas,
    reiniciar: () => {
      bloqueadas = [];
    },
    websocketDescartados: () => descartados,
  };
}

/**
 * Off-the-record: cookies, almacenamiento y caché quedan en memoria (ADR 018). Los service workers no
 * se registran y las descargas se bloquean.
 */
export async function abrirContexto(
  navegador: Browser,
  politica: PoliticaDeRed,
  opciones: { soloLectura: boolean; alRegistrar: AlRegistrar },
): Promise<{ contexto: BrowserContext; vigilancia: Vigilancia }> {
  const contexto = await navegador.newContext({
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
  });
  return { contexto, vigilancia: await protegerContexto(contexto, politica, opciones) };
}

const esperar = (ms: number) =>
  new Promise((listo) => {
    setTimeout(listo, ms);
  });

function aPatron(glob: string): RegExp {
  const escapado = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '[^?#]*');
  return new RegExp(`^${escapado}$`);
}

/** Sin query ni fragmento: un parámetro no puede hacer que una pantalla de error parezca un éxito. */
function urlSinQuery(texto: string): string {
  const url = new URL(texto);
  return url.origin + url.pathname;
}

async function indicadorCumplido(pagina: Page, indicador: IndicadorExito): Promise<boolean> {
  if (indicador.tipo === 'url') return aPatron(indicador.patron).test(urlSinQuery(pagina.url()));
  const visibles = await pagina.locator(indicador.selector).first().isVisible();
  return indicador.tipo === 'aparece' ? visibles : !visibles;
}

export interface OpcionesLogin {
  urlLogin: string;
  pasos: readonly PasoLogin[];
  indicador: IndicadorExito;
  usuario: string;
  secreto: Uint8Array;
  timeoutMs: number;
}

/**
 * Prueba de login (EVI-01): un contexto sin video, sin traza y sin capturas. Una contraseña mala nunca
 * puede dar verde: el indicador tiene que estar en falso antes de enviar y en verdadero después. Si ya
 * se cumplía antes, no dice nada, y el resultado es «falló».
 *
 * El secreto se borra del arreglo enseguida. `page.fill` exige un string, que no se puede borrar; el
 * proceso termina con la ejecución y es lo que lo limpia de verdad (ADR 017).
 */
export async function probarLogin(
  contexto: BrowserContext,
  { urlLogin, pasos, indicador, usuario, secreto, timeoutMs }: OpcionesLogin,
): Promise<boolean> {
  const pagina = await contexto.newPage();
  pagina.setDefaultTimeout(timeoutMs);
  try {
    await pagina.goto(urlLogin, { timeout: timeoutMs, waitUntil: 'load' });
    if (await indicadorCumplido(pagina, indicador)) return false;
    for (const paso of pasos) {
      if (paso.accion === 'click') {
        await pagina.locator(paso.selector).first().click();
      } else if (paso.accion === 'esperar') {
        await pagina.locator(paso.selector).first().waitFor({ state: 'visible' });
      } else if (paso.origen === 'usuario') {
        await pagina.locator(paso.selector).first().fill(usuario);
      } else {
        await pagina.locator(paso.selector).first().fill(new TextDecoder().decode(secreto));
      }
    }
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (await indicadorCumplido(pagina, indicador)) return true;
      await esperar(100);
    }
    return false;
  } catch {
    // Sin el mensaje: un error de Playwright puede traer texto de la página.
    return false;
  } finally {
    secreto.fill(0);
    await pagina.close().catch(() => undefined);
  }
}
