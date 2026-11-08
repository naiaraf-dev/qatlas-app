import type { IndicadorExito, PasoLogin } from '@qatlas/shared';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/**
 * El gestor de contraseñas de Chromium, apagado en la ventana del asistido: sin esto ofrece «Guardar
 * contraseña» al enviar el formulario, y si la persona acepta, la contraseña queda en el perfil. Son
 * preferencias del perfil (no hay un argumento para esto), y una sonda con
 * `chrome://password-manager-internals` mostró que con ellas decide «DROP the password» en lugar de
 * preguntar. La detección de filtraciones también: consultaría un servicio de afuera.
 */
export const PREFERENCIAS_VENTANA = {
  credentials_enable_service: false,
  credentials_enable_autosignin: false,
  profile: { password_manager_enabled: false, password_manager_leak_detection: false },
} as const;

export interface NavegadorVisible {
  /** El único contexto, con la ventana: es el del perfil de la ventana. */
  contexto: BrowserContext;
  /** Cierra la ventana y borra el perfil. */
  cerrar: () => Promise<void>;
}

/**
 * El navegador con ventana del login asistido: los mismos argumentos y el mismo sandbox, detrás del
 * proxy de login, con un perfil propio para poder apagar el gestor de contraseñas. El perfil va dentro
 * de `carpetaPerfil`, la de la ejecución en la carpeta de datos (ADR 018), nunca en el temporal del
 * sistema, y se borra al cerrar; si algo lo corta, se va con la carpeta de la ejecución. Solo para que
 * la persona entre; el escaneo nunca corre acá.
 */
export async function abrirNavegadorVisible(
  proxy: { servidor: string; usuario: string; clave: string },
  carpetaPerfil: string,
): Promise<NavegadorVisible> {
  // Nombre corto: en Linux, la ruta del perfil cuenta para el socket de Chromium (ADR 018).
  const perfil = await mkdtemp(path.join(carpetaPerfil, 'asistido-'));
  const borrarPerfil = () => rm(perfil, { recursive: true, force: true, maxRetries: 5 });
  try {
    await mkdir(path.join(perfil, 'Default'));
    await writeFile(
      path.join(perfil, 'Default', 'Preferences'),
      JSON.stringify(PREFERENCIAS_VENTANA),
    );
    const contexto = await chromium.launchPersistentContext(perfil, {
      channel: 'chromium',
      headless: false,
      chromiumSandbox: true,
      args: [...ARGUMENTOS_CHROMIUM],
      proxy: { server: proxy.servidor, username: proxy.usuario, password: proxy.clave },
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
    });
    return {
      contexto,
      cerrar: async () => {
        await contexto.close().catch(() => undefined);
        await borrarPerfil().catch(() => undefined);
      },
    };
  } catch (error) {
    await borrarPerfil().catch(() => undefined);
    throw error;
  }
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

export const esperar = (ms: number) =>
  new Promise((listo) => {
    setTimeout(listo, ms);
  });

export function aPatron(glob: string): RegExp {
  const escapado = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '[^?#]*');
  return new RegExp(`^${escapado}$`);
}

/** Sin query ni fragmento: un parámetro no puede hacer que una pantalla de error parezca un éxito. */
export function urlSinQuery(texto: string): string {
  const url = new URL(texto);
  return url.origin + url.pathname;
}

/** Se rechaza cuando una operación no termina a tiempo. */
export class LimiteVencido extends Error {
  constructor() {
    super('limite-vencido');
  }
}

/**
 * Acota una operación de Playwright que no tiene timeout propio (`newPage`, `close`, `isVisible`,
 * `evaluate`). Sin esto, una que no responde cuelga la prueba de login entera.
 */
export function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      rechazar(new LimiteVencido());
    }, ms);
  });
  promesa.catch(() => undefined);
  return Promise.race([promesa, vencido]).finally(() => {
    clearTimeout(temporizador);
  });
}

/** Lo máximo que puede tardar una sola lectura del indicador. */
const LECTURA_MS = 1000;

/**
 * El estado actual del indicador, leído una vez. Tira si no se puede leer: quien llama decide.
 *
 * `desaparece` exige evidencia positiva: el elemento no está en un documento que terminó de cargar, y
 * las dos cosas se miran a la vez, en el mismo documento. Durante una navegación el documento viejo ya
 * no está y el nuevo todavía no tiene nada: sin esto, el formulario de una contraseña mala «desaparece»
 * un instante y daría verde.
 */
export async function indicadorCumplido(
  pagina: Page,
  indicador: IndicadorExito,
  limiteMs = LECTURA_MS,
): Promise<boolean> {
  if (indicador.tipo === 'url') return aPatron(indicador.patron).test(urlSinQuery(pagina.url()));
  if (indicador.tipo === 'aparece') {
    return conLimite(pagina.locator(indicador.selector).first().isVisible(), limiteMs);
  }
  const { completo, visibles } = await conLimite(
    pagina.locator(indicador.selector).evaluateAll((elementos) => ({
      completo: document.readyState === 'complete',
      visibles: elementos.some((elemento) => {
        const caja = elemento.getBoundingClientRect();
        return (
          caja.width > 0 && caja.height > 0 && getComputedStyle(elemento).visibility !== 'hidden'
        );
      }),
    })),
    limiteMs,
  );
  return completo && !visibles;
}

/**
 * Espera el indicador: primero mira el estado actual, y después vuelve a mirar hasta el límite. Nunca
 * espera un evento (como la próxima navegación), que se perdería si ya pasó. `desaparece` tiene que
 * cumplirse en dos lecturas seguidas.
 */
export async function esperarIndicador(
  pagina: Page,
  indicador: IndicadorExito,
  timeoutMs: number,
): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  const necesarias = indicador.tipo === 'desaparece' ? 2 : 1;
  let seguidas = 0;
  for (;;) {
    const restante = Math.max(limite - Date.now(), 1);
    const cumplido = await indicadorCumplido(pagina, indicador, Math.min(restante, LECTURA_MS))
      // Una lectura que falla (el documento cambió en el medio, o no respondió) no es un éxito.
      .catch(() => false);
    seguidas = cumplido ? seguidas + 1 : 0;
    if (seguidas >= necesarias) return true;
    if (Date.now() >= limite) return false;
    await esperar(100);
  }
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
  opciones: OpcionesLogin,
): Promise<boolean> {
  // Todo acotado: la respuesta llega en `presupuestoLogin`, aunque Chromium no responda.
  const presupuesto = presupuestoLogin(opciones);
  let pagina: Page | undefined;
  try {
    let abandonada = false;
    const abierta = contexto.newPage();
    // Si se abre después del límite, nadie la usa: se cierra igual.
    abierta.then((p) => (abandonada ? p.close() : undefined)).catch(() => undefined);
    pagina = await conLimite(abierta, opciones.timeoutMs).catch((error: unknown) => {
      abandonada = true;
      throw error;
    });
    return await conLimite(loginEnPagina(pagina, opciones), presupuesto);
  } catch {
    return false;
  } finally {
    opciones.secreto.fill(0);
    if (pagina) await conLimite(pagina.close(), opciones.timeoutMs).catch(() => undefined);
  }
}

/**
 * Lo máximo que tarda `loginEnPagina`: la carga, cada paso y la espera del indicador tienen
 * `timeoutMs` cada uno, más las lecturas del indicador antes de enviar y la última.
 */
export function presupuestoLogin({ pasos, timeoutMs }: Pick<OpcionesLogin, 'pasos' | 'timeoutMs'>) {
  return timeoutMs * (pasos.length + 2) + 2 * LECTURA_MS;
}

/** Lo máximo que tarda `probarLogin`, con la apertura y el cierre de la página. */
export function presupuestoProbarLogin(opciones: Pick<OpcionesLogin, 'pasos' | 'timeoutMs'>) {
  return presupuestoLogin(opciones) + 2 * opciones.timeoutMs;
}

/**
 * El login por formulario en una página que queda abierta: el estado de sesión se toma después. No
 * borra el secreto ni cierra la página; eso es de quien llama.
 */
export async function loginEnPagina(
  pagina: Page,
  { urlLogin, pasos, indicador, usuario, secreto, timeoutMs }: OpcionesLogin,
): Promise<boolean> {
  pagina.setDefaultTimeout(timeoutMs);
  try {
    await pagina.goto(urlLogin, { timeout: timeoutMs, waitUntil: 'load' });
    // Si ya se cumple antes de enviar, no dice nada. Si no se puede leer, tampoco: tira y falla.
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
    return await esperarIndicador(pagina, indicador, timeoutMs);
  } catch {
    // Sin el mensaje: un error de Playwright puede traer texto de la página.
    return false;
  }
}
