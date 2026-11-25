/**
 * Cómo se lanza el navegador de pruebas (especificación 3.5, ADR 016, 020 y 041). Es la única forma: la
 * usan el runner, la ventana del login asistido y todos los tests. `security-tests/navegador-verificado`
 * lo exige en cada `launch`.
 *
 * Sin `electron` ni red: se prueba con Vitest.
 */

/**
 * Las funciones de Chromium que Playwright 1.64.1 apaga con su propio `--disable-features`
 * (`chromiumSwitches.ts`). Chromium se queda solo con el **último** `--disable-features` de la línea de
 * comando: si QAtlas pasa el suyo, el de Playwright deja de valer. Hasta el 2026-11-25 pasaba eso, y se
 * volvían a encender la elegibilidad de AI Mode (`www.google.com/async/folae`), la hora de red
 * (`clients2.google.com`), las sugerencias de optimización, la traducción y `HttpsUpgrades`, entre otras.
 * Por eso se repiten acá. `e2e/navegador-ruido.e2e.ts` compara esta lista con la que Playwright pone de
 * verdad: al subir Playwright, si agrega una, el test falla hasta sumarla.
 */
export const FUNCIONES_APAGADAS_POR_PLAYWRIGHT = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'BlockOriginHeaderModificationOnRedirect',
  'AvoidCorsURLLoaderRestartOnRedirect',
  'Translate',
  'AutoDeElevate',
  'OptimizationHints',
  'NetworkTimeServiceQuerying',
  'AimEnabled',
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
] as const;

/**
 * Las que QAtlas apaga además. Chromium se conecta solo a estos servicios: el proxy los bloquea igual,
 * pero llenarían el monitor con destinos que el sitio nunca pidió.
 * - `PreconnectToSearch`: su buscador por defecto.
 * - `AutofillServerCommunication`: el servicio de autocompletar, al ver un formulario.
 */
export const FUNCIONES_APAGADAS_POR_QATLAS = [
  'PreconnectToSearch',
  'AutofillServerCommunication',
] as const;

export const FUNCIONES_APAGADAS: readonly string[] = [
  ...new Set<string>([...FUNCIONES_APAGADAS_POR_PLAYWRIGHT, ...FUNCIONES_APAGADAS_POR_QATLAS]),
];

/**
 * Lo que el proxy no ve, apagado:
 * - `<-loopback>`: sin esto, Chromium se saltea el proxy para localhost.
 * - WebRTC y QUIC usan UDP. El nombre importa: la variante `--force-` de este flag no hace nada en esta
 *   versión, y sin decir nada. Por eso hay un control positivo en los E2E.
 * - No se pasa `--host-resolver-rules`: con proxy, Chromium le manda el nombre sin resolverlo.
 */
export const ARGUMENTOS_DE_RED = [
  '--proxy-bypass-list=<-loopback>',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-quic',
] as const;

export const ARGUMENTOS_CHROMIUM: readonly string[] = [
  ...ARGUMENTOS_DE_RED,
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  `--disable-features=${FUNCIONES_APAGADAS.join(',')}`,
];

export interface ProxyDelNavegador {
  servidor: string;
  usuario: string;
  clave: string;
}

export interface OpcionesChromium {
  proxy?: ProxyDelNavegador;
  /** Por defecto, sin ventana. Solo el login asistido la abre. */
  headless?: boolean;
  /** Más funciones para apagar: van en el mismo y único `--disable-features`. */
  funcionesApagadas?: readonly string[];
  /** Argumentos de más. Nunca `--disable-features` ni `--enable-features`: pisarían la lista. */
  argumentos?: readonly string[];
  /**
   * Solo para los controles positivos de los tests: sacar un freno para mostrar que hace falta. Nunca en
   * la app (`security-tests/navegador-verificado` lo verifica).
   */
  control?: {
    sinSandbox?: boolean;
    sinArgumentosDeRed?: boolean;
    funcionesEncendidas?: readonly string[];
  };
}

export interface OpcionesDeLanzamiento {
  channel: 'chromium';
  headless: boolean;
  chromiumSandbox: boolean;
  args: string[];
  proxy?: { server: string; username: string; password: string };
}

const PISA_FUNCIONES = /^--(disable|enable)-features(=|$)/;

/**
 * Las opciones de `launch` y `launchPersistentContext`:
 * - `channel: 'chromium'`: el Chromium completo, verificado por su hash (ADR 020); nunca el headless shell.
 * - `chromiumSandbox`: Playwright lo trae apagado, y el sitio probado es hostil por defecto.
 * - Un solo `--disable-features`, con lo de Playwright y lo de QAtlas.
 */
export function opcionesChromium(opciones: OpcionesChromium = {}): OpcionesDeLanzamiento {
  const {
    proxy,
    headless = true,
    funcionesApagadas = [],
    argumentos = [],
    control = {},
  } = opciones;
  for (const argumento of argumentos) {
    if (PISA_FUNCIONES.test(argumento)) {
      throw new Error(
        'opcionesChromium: las funciones van en funcionesApagadas, nunca como argumento',
      );
    }
  }
  const encendidas = new Set(control.funcionesEncendidas ?? []);
  const funciones = [...new Set([...FUNCIONES_APAGADAS, ...funcionesApagadas])].filter(
    (f) => !encendidas.has(f),
  );
  const base = ARGUMENTOS_CHROMIUM.filter(
    (a) =>
      !PISA_FUNCIONES.test(a) &&
      !(control.sinArgumentosDeRed && (ARGUMENTOS_DE_RED as readonly string[]).includes(a)),
  );
  return {
    channel: 'chromium',
    headless,
    chromiumSandbox: control.sinSandbox !== true,
    args: [...base, ...argumentos, `--disable-features=${funciones.join(',')}`],
    ...(proxy
      ? { proxy: { server: proxy.servidor, username: proxy.usuario, password: proxy.clave } }
      : {}),
  };
}
