import type { IndicadorExito, PasoLogin } from '@qatlas/shared';
import type { Browser, BrowserContext, Page, Request } from 'playwright-core';
import { decidirNombre, decidirUrlSinResolver, type PoliticaDeRed } from '../red/reglas';
import { SEVERIDAD, type HallazgoDetectado } from './chequeos';
import {
  esperar,
  indicadorCumplido,
  loginEnPagina,
  protegerContexto,
  urlSinQuery,
  type AlRegistrar,
  type Vigilancia,
} from './motor';

/**
 * El login y la sesión de un escaneo autenticado (semana 6b, ADR 025 a 028).
 *
 * El login corre en un contexto propio, sin grabar nada, detrás del proxy de login (alcance más
 * dominios de autenticación). Lo que sale de ahí es el estado de sesión (cookies y almacenamiento),
 * filtrado a los dominios del alcance y sin ningún valor que contenga un secreto. El escaneo usa un
 * contexto nuevo con ese estado, detrás del proxy del escaneo: nunca pasa por la URL de login ni por un
 * dominio de autenticación.
 */

export type Estrategia = 'formulario' | 'sso' | 'token-url' | 'asistido' | 'basica';

export interface DatosAutenticacion {
  estrategia: Estrategia;
  urlLogin: string;
  pasos: readonly PasoLogin[];
  indicador: IndicadorExito | null;
  usuario: string;
  dominiosAutenticacion: readonly string[];
  /** Cuánto dura la sesión como máximo, si el proyecto lo dice. Se renueva un minuto antes. */
  sesionMaxMs: number | null;
}

export interface ProxyDeContexto {
  servidor: string;
  usuario: string;
  clave: string;
}

/** Lo que trae `storageState`. Solo vive en memoria; en el proceso principal, cifrado (ADR 026). */
export interface EstadoSesion {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

export type ResultadoLogin =
  | {
      resultado: 'ok';
      estado: EstadoSesion;
      /** Donde se confirmó el login, sin query: ahí se vuelve para saber si la sesión sigue. */
      urlComprobacion: string;
      /** Lo que el sitio guardaba con la contraseña adentro: se quitó del estado. */
      secretosEnAlmacenamiento: {
        tipo: 'cookie' | 'localStorage';
        nombre: string;
        origen: string;
      }[];
    }
  | { resultado: 'fallo' | 'ventana-cerrada' | 'tiempo-agotado' };

/**
 * Lo que un escaneo autenticado nunca toca: cerraría la sesión. Se suman a las exclusiones del proyecto.
 */
export const EXCLUSIONES_DE_CIERRE = [
  'logout',
  'log-out',
  'log out',
  'signout',
  'sign-out',
  'sign out',
  'salir',
  'cerrar sesión',
  'cerrar sesion',
  'cerrar-sesion',
  'desconectar',
] as const;

/** El login asistido: cuánto se espera a la persona y cada cuánto se mira el indicador. */
export const ESPERA_ASISTIDO_MS = 5 * 60_000;
const INTERVALO_ASISTIDO_MS = 500;
/** Se renueva un poco antes de que venza. */
export const MARGEN_RENOVACION_MS = 60_000;
/** Una sesión guardada nunca dura más que esto, diga lo que diga el sitio. */
export const VIDA_MAXIMA_ESTADO_MS = 12 * 60 * 60_000;

/** Las formas en que un secreto puede aparecer guardado. Menos de 4 caracteres no se busca. */
export function variantesDeSecreto(secreto: string): string[] {
  if (secreto.length < 4) return [];
  const bytes = Buffer.from(secreto, 'utf8');
  return [
    ...new Set([
      secreto,
      encodeURIComponent(secreto),
      bytes.toString('base64').replace(/=+$/, ''),
      bytes.toString('base64url'),
    ]),
  ];
}

/**
 * Lo que se guarda del estado: solo los dominios del alcance (las cookies del proveedor de identidad
 * no le sirven al escaneo), y nada que contenga un secreto. Pura, para probarla sin navegador.
 */
export function depurarEstado(
  estado: EstadoSesion,
  politica: PoliticaDeRed,
  secretos: readonly string[],
): {
  estado: EstadoSesion;
  encontrados: { tipo: 'cookie' | 'localStorage'; nombre: string; origen: string }[];
} {
  const variantes = secretos.flatMap(variantesDeSecreto);
  const contiene = (valor: string) => variantes.some((v) => valor.includes(v));
  const encontrados: { tipo: 'cookie' | 'localStorage'; nombre: string; origen: string }[] = [];
  const cookies = estado.cookies.filter((cookie) => {
    const host = cookie.domain.replace(/^\./, '');
    if (!decidirNombre(host, politica).permitida) return false;
    if (contiene(cookie.value)) {
      encontrados.push({ tipo: 'cookie', nombre: cookie.name.slice(0, 100), origen: host });
      return false;
    }
    return true;
  });
  const origins = estado.origins
    .filter((o) => decidirUrlSinResolver(o.origin, politica).permitida)
    .map((o) => ({
      origin: o.origin,
      localStorage: o.localStorage.filter((item) => {
        if (!contiene(item.value)) return true;
        encontrados.push({
          tipo: 'localStorage',
          nombre: item.name.slice(0, 100),
          origen: o.origin,
        });
        return false;
      }),
    }));
  return { estado: { cookies, origins }, encontrados };
}

/** Un hallazgo por cada lugar donde el sitio guardó la contraseña. Sin el valor. */
export function hallazgosDeSecretos(
  encontrados: { tipo: 'cookie' | 'localStorage'; nombre: string; origen: string }[],
  url: string,
): HallazgoDetectado[] {
  return encontrados.map((e) => ({
    tipo: 'secreto-en-almacenamiento',
    severidad: SEVERIDAD['secreto-en-almacenamiento'],
    url,
    urlOrigen: null,
    clave: `${e.tipo}:${e.nombre}`,
    titulo:
      e.tipo === 'cookie'
        ? 'El sitio guarda la contraseña en una cookie'
        : 'El sitio guarda la contraseña en localStorage',
    detalle: '',
  }));
}

export interface SenalesDePagina {
  /** URL final de la navegación principal, o null si falló. */
  urlFinal: string | null;
  estado: number | null;
  /** El 403 lo puso nuestro proxy: no es del sitio. */
  bloqueadaPorNosotros: boolean;
  /** Hosts de navegaciones principales que cortamos (una redirección a otro dominio). */
  navegacionesBloqueadas: readonly string[];
  /** El campo de contraseña del login está en la pantalla. */
  formularioDeLogin: boolean;
}

export type MotivoDeSospecha =
  | 'url-de-login'
  | 'dominio-de-autenticacion'
  | 'no-autorizado'
  | 'prohibido'
  | 'formulario-de-login';

/**
 * Lo que hace sospechar que la sesión venció. Es solo una sospecha: un 403 puede ser del rol, y una
 * pantalla con contraseña puede ser «cambiar contraseña». Se confirma antes de actuar.
 */
export function motivoDeSospecha(
  senales: SenalesDePagina,
  datos: Pick<DatosAutenticacion, 'urlLogin' | 'dominiosAutenticacion'>,
): MotivoDeSospecha | null {
  const enAutenticacion = (host: string) =>
    datos.dominiosAutenticacion.some((d) =>
      d.startsWith('*.') ? host.endsWith(d.slice(1)) : host === d,
    );
  if (senales.navegacionesBloqueadas.some(enAutenticacion)) return 'dominio-de-autenticacion';
  if (senales.urlFinal) {
    let final: URL | null;
    try {
      final = new URL(senales.urlFinal);
    } catch {
      final = null;
    }
    if (final && enAutenticacion(final.hostname)) return 'dominio-de-autenticacion';
    if (final && urlSinQuery(final.href) === urlSinQuery(datos.urlLogin)) return 'url-de-login';
  }
  if (senales.estado === 401) return 'no-autorizado';
  if (senales.estado === 403 && !senales.bloqueadaPorNosotros) return 'prohibido';
  if (senales.formularioDeLogin) return 'formulario-de-login';
  return null;
}

/** El selector del campo del secreto, si el login lo dice; si no, cualquier contraseña. */
export function selectorDeContrasena(datos: Pick<DatosAutenticacion, 'pasos'>): string {
  const paso = datos.pasos.find((p) => p.accion === 'rellenar' && p.origen === 'secreto');
  return paso?.selector ?? 'input[type=password]';
}

const NOMBRE_DE_CONTRASENA = /pass|clave|contra|pwd|secret/i;

/**
 * Lo que la persona escribió como contraseña en el login asistido, para sacarlo del estado. Solo en la
 * memoria de este proceso. Se toma de los campos de contraseña y de los formularios que se envían.
 */
class ContrasenasEscritas {
  readonly valores = new Set<string>();
  private readonly nombres = new Set<string>();

  async mirar(pagina: Page): Promise<void> {
    const campos = pagina.locator('input[type=password]');
    const cantidad = Math.min(await campos.count().catch(() => 0), 5);
    for (let i = 0; i < cantidad; i++) {
      const campo = campos.nth(i);
      const nombre = await campo.getAttribute('name', { timeout: 200 }).catch(() => null);
      if (nombre) this.nombres.add(nombre);
      const valor = await campo.inputValue({ timeout: 200 }).catch(() => '');
      if (valor.length >= 4) this.valores.add(valor);
    }
  }

  alEnviar(solicitud: Request): void {
    if (solicitud.method() !== 'POST') return;
    const cuerpo = solicitud.postData();
    if (!cuerpo) return;
    const agregar = (nombre: string, valor: unknown) => {
      if (typeof valor !== 'string' || valor.length < 4) return;
      if (this.nombres.has(nombre) || NOMBRE_DE_CONTRASENA.test(nombre)) this.valores.add(valor);
    };
    try {
      const json = JSON.parse(cuerpo) as unknown;
      if (json && typeof json === 'object') {
        for (const [nombre, valor] of Object.entries(json)) agregar(nombre, valor);
        return;
      }
    } catch {
      // No es JSON: un formulario.
    }
    for (const [nombre, valor] of new URLSearchParams(cuerpo)) agregar(nombre, valor);
  }

  vaciar(): void {
    this.valores.clear();
    this.nombres.clear();
  }
}

export interface OpcionesDeLogin {
  datos: DatosAutenticacion;
  /** El proxy de login: alcance más dominios de autenticación. */
  proxy: ProxyDeContexto;
  politica: PoliticaDeRed;
  /** Se borra al terminar. Null en el login asistido. */
  secreto: Uint8Array | null;
  timeoutMs: number;
  alRegistrar: AlRegistrar;
  /** Abre el navegador con ventana del login asistido, detrás del proxy de login. */
  abrirVisible: (proxy: ProxyDeContexto) => Promise<Browser>;
  /** Las cookies y el almacenamiento de la sesión se filtran a este alcance (el del escaneo). */
  politicaDelEscaneo: PoliticaDeRed;
  /** La autenticación básica se manda solo a este origen. */
  origenBase: string;
  ahora?: () => number;
}

export interface CredencialBasica {
  usuario: string;
  clave: string;
  /** Solo a este origen: nunca a otro dominio del alcance ni a uno de afuera. */
  origen: string;
}

/**
 * La autenticación básica, puesta por QAtlas en cada pedido al origen base. Las `httpCredentials` de
 * Playwright no llegan detrás de un proxy por contexto: Chromium nunca las manda (lo mostró una sonda).
 * Se registra antes de las protecciones, así corre después de ellas: lo bloqueado nunca la lleva.
 */
async function ponerBasica(contexto: BrowserContext, basica: CredencialBasica): Promise<void> {
  const valor = `Basic ${Buffer.from(`${basica.usuario}:${basica.clave}`, 'utf8').toString('base64')}`;
  await contexto.route('**/*', async (ruta) => {
    const solicitud = ruta.request();
    let origen: string;
    try {
      origen = new URL(solicitud.url()).origin;
    } catch {
      origen = '';
    }
    if (origen !== basica.origen) {
      await ruta.fallback();
      return;
    }
    await ruta.fallback({ headers: { ...solicitud.headers(), authorization: valor } });
  });
}

const contextoDeLogin = async (
  navegador: Browser,
  proxy: ProxyDeContexto | null,
  basica?: CredencialBasica,
): Promise<BrowserContext> => {
  const contexto = await navegador.newContext({
    ...(proxy
      ? { proxy: { server: proxy.servidor, username: proxy.usuario, password: proxy.clave } }
      : {}),
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
  });
  if (basica) await ponerBasica(contexto, basica);
  return contexto;
};

/**
 * Entra con la estrategia de la credencial. Ningún contexto de login graba video, traza ni HAR (TS-06).
 * El secreto se borra del arreglo al terminar, salga como salga.
 */
export async function iniciarSesion(
  navegador: Browser,
  opciones: OpcionesDeLogin,
): Promise<ResultadoLogin> {
  const { datos, secreto } = opciones;
  const texto = secreto ? new TextDecoder().decode(secreto) : '';
  try {
    if (datos.estrategia === 'asistido') return await loginAsistido(opciones);
    const basica =
      datos.estrategia === 'basica'
        ? { usuario: datos.usuario, clave: texto, origen: opciones.origenBase }
        : undefined;
    const contexto = await contextoDeLogin(navegador, opciones.proxy, basica);
    try {
      await protegerContexto(contexto, opciones.politica, {
        soloLectura: false,
        alRegistrar: opciones.alRegistrar,
      });
      const pagina = await contexto.newPage();
      pagina.setDefaultTimeout(opciones.timeoutMs);
      const entro = await entrar(pagina, datos, texto, opciones.timeoutMs, secreto);
      if (!entro) return { resultado: 'fallo' };
      return await tomarEstado(contexto, pagina, opciones, secretosDe(datos, texto));
    } finally {
      await contexto.close().catch(() => undefined);
    }
  } catch {
    // Sin el mensaje: un error de Playwright puede traer texto de la página.
    return { resultado: 'fallo' };
  } finally {
    secreto?.fill(0);
  }
}

/** En el enlace con token, el valor de cada parámetro también es secreto. */
function secretosDe(datos: DatosAutenticacion, texto: string): string[] {
  if (!texto) return [];
  if (datos.estrategia !== 'token-url') return [texto];
  try {
    return [texto, ...[...new URL(texto).searchParams.values()].filter((v) => v.length >= 8)];
  } catch {
    return [texto];
  }
}

async function esperarIndicador(
  pagina: Page,
  indicador: IndicadorExito,
  timeoutMs: number,
): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await indicadorCumplido(pagina, indicador).catch(() => false)) return true;
    await esperar(100);
  }
  return false;
}

async function entrar(
  pagina: Page,
  datos: DatosAutenticacion,
  texto: string,
  timeoutMs: number,
  secreto: Uint8Array | null,
): Promise<boolean> {
  switch (datos.estrategia) {
    case 'formulario':
    case 'sso':
      if (!datos.indicador || !secreto) return false;
      // En SSO, la URL de login redirige al proveedor y los pasos se hacen allá.
      return loginEnPagina(pagina, {
        urlLogin: datos.urlLogin,
        pasos: datos.pasos,
        indicador: datos.indicador,
        usuario: datos.usuario,
        secreto: new TextEncoder().encode(texto),
        timeoutMs,
      });
    case 'token-url':
      if (!datos.indicador || !texto) return false;
      await pagina.goto(texto, { timeout: timeoutMs, waitUntil: 'load' });
      return esperarIndicador(pagina, datos.indicador, timeoutMs);
    case 'basica': {
      const respuesta = await pagina.goto(datos.urlLogin, {
        timeout: timeoutMs,
        waitUntil: 'load',
      });
      if (!respuesta || respuesta.status() === 401) return false;
      return datos.indicador ? esperarIndicador(pagina, datos.indicador, timeoutMs) : true;
    }
    default:
      return false;
  }
}

async function tomarEstado(
  contexto: BrowserContext,
  pagina: Page,
  opciones: OpcionesDeLogin,
  secretos: readonly string[],
): Promise<ResultadoLogin> {
  const crudo: EstadoSesion = await contexto.storageState();
  const { estado, encontrados } = depurarEstado(crudo, opciones.politicaDelEscaneo, secretos);
  return {
    resultado: 'ok',
    estado,
    urlComprobacion: urlSinQuery(pagina.url()),
    secretosEnAlmacenamiento: encontrados,
  };
}

/**
 * Una ventana del navegador de pruebas, detrás del proxy de login y con el sandbox de Chromium. La
 * persona entra a mano; QAtlas mira el indicador cada medio segundo. Nada de esta ventana se graba,
 * y lo que se escriba como contraseña se saca del estado antes de guardarlo.
 */
async function loginAsistido(opciones: OpcionesDeLogin): Promise<ResultadoLogin> {
  const { datos } = opciones;
  if (!datos.indicador) return { resultado: 'fallo' };
  const ahora = opciones.ahora ?? Date.now;
  const visible = await opciones.abrirVisible(opciones.proxy);
  const escritas = new ContrasenasEscritas();
  try {
    const contexto = await contextoDeLogin(visible, null);
    await protegerContexto(contexto, opciones.politica, {
      soloLectura: false,
      alRegistrar: opciones.alRegistrar,
    });
    contexto.on('request', (solicitud) => {
      escritas.alEnviar(solicitud);
    });
    const pagina = await contexto.newPage();
    let cerrada = false;
    pagina.on('close', () => {
      cerrada = true;
    });
    await pagina
      .goto(datos.urlLogin, { timeout: opciones.timeoutMs, waitUntil: 'load' })
      .catch(() => undefined);
    const limite = ahora() + ESPERA_ASISTIDO_MS;
    while (ahora() < limite) {
      // `cerrada` cambia en el evento de cierre, mientras se espera.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cerrada) return { resultado: 'ventana-cerrada' };
      await escritas.mirar(pagina);
      if (await indicadorCumplido(pagina, datos.indicador).catch(() => false)) {
        return await tomarEstado(contexto, pagina, opciones, [...escritas.valores]);
      }
      await esperar(INTERVALO_ASISTIDO_MS);
    }
    return { resultado: 'tiempo-agotado' };
  } catch {
    return { resultado: 'fallo' };
  } finally {
    escritas.vaciar();
    await visible.close().catch(() => undefined);
  }
}

/** El contexto del escaneo con una sesión: el proxy del navegador, que es el del escaneo. */
export async function contextoConSesion(
  navegador: Browser,
  estado: EstadoSesion | null,
  politica: PoliticaDeRed,
  opciones: {
    soloLectura: boolean;
    alRegistrar: AlRegistrar;
    basica?: CredencialBasica | undefined;
  },
): Promise<{ contexto: BrowserContext; vigilancia: Vigilancia }> {
  const contexto = await navegador.newContext({
    ...(estado ? { storageState: estado } : {}),
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
  });
  if (opciones.basica) await ponerBasica(contexto, opciones.basica);
  const vigilancia = await protegerContexto(contexto, politica, opciones);
  return { contexto, vigilancia };
}
