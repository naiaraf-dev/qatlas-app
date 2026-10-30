import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeTheme, powerMonitor, protocol } from 'electron';
import { DetectorInactividad } from './boveda/inactividad';
import type { ServicioBoveda } from './boveda/servicio';
import type { ServicioProyectos } from './proyectos/servicio';
import { applyHardening } from './hardening';
import { registerIpc } from './ipc/register';
import { makeSenderCheck } from './ipc/create-handler';
import { APP_HOST, APP_ORIGIN, APP_SCHEME, resolveAppRequest } from './security/app-protocol';
import { buildCsp } from './security/csp';
import { isLikelySyncedPath, resolveDataDirectory } from './security/data-dir';
import { verificarNativos, type ModuloNativo } from './security/nativos';
import { ConnectionLog } from './security/network-policy';
import { SECURE_WEB_PREFERENCES } from './security/web-preferences';

/** Lo define electron.vite.config.ts en el build. */
declare const __QATLAS_NATIVOS__: readonly ModuloNativo[];

/**
 * Punto de entrada del proceso principal de QAtlas.
 * Todo lo que va antes de `app.whenReady()` debe ejecutarse al cargar el módulo.
 */

// --- Antes de que la app esté lista -------------------------------------------

// Sandbox de Chromium obligatorio para todos los renderers, aunque alguien
// olvide la opción al crear una ventana.
app.enableSandbox();

// Una sola instancia: evita dos procesos escribiendo la misma bóveda.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Bóveda en almacenamiento local, nunca en una carpeta sincronizada por defecto.
const dataDirectory = resolveDataDirectory(process.platform, process.env, app.getPath('userData'));
app.setPath('userData', dataDirectory);
app.setPath('sessionData', path.join(dataDirectory, 'session'));
const dataDirectorySynced = isLikelySyncedPath(dataDirectory);

// Esquema propio para la interfaz empaquetada.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;
const rendererDir = path.join(import.meta.dirname, '../renderer');
const connectionLog = new ConnectionLog();

let mainWindow: BrowserWindow | null = null;
let saliendo = false;

const requerir = createRequire(import.meta.url);
const MS_POR_MINUTO = 60_000;
const INTERVALO_INACTIVIDAD_MS = 5_000;
// El límite real lo fija la configuración cifrada al desbloquear.
const inactividad = new DetectorInactividad(15 * MS_POR_MINUTO, performance.now());

const allowedOrigins = devServerOrigin ? [APP_ORIGIN, devServerOrigin] : [APP_ORIGIN];
const isAllowedOrigin = makeSenderCheck(allowedOrigins);

// --- Interfaz empaquetada vía app:// ------------------------------------------

function registerAppProtocol(): void {
  const csp = buildCsp({ dev: false });
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveAppRequest(request.url, rendererDir);
    if (!resolved.ok) return new Response(null, { status: resolved.status });
    try {
      const body = await readFile(resolved.filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': resolved.mimeType,
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Referrer-Policy': 'no-referrer',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

// --- Ventana principal ----------------------------------------------------------

let mainWindowPreferences: Electron.WebPreferences | undefined;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'QAtlas',
    // Mismo fondo que la interfaz, para que no haya un destello al abrir.
    backgroundColor: windowBackground(),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // Repetidos de forma explícita para que el análisis estático
      // (Electronegativity) y las revisiones de código los vean acá mismo.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      disableBlinkFeatures: 'Auxclick',
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      devTools: !app.isPackaged,
    },
  });
  mainWindowPreferences = { ...SECURE_WEB_PREFERENCES, devTools: !app.isPackaged };

  const onThemeChange = (): void => {
    window.setBackgroundColor(windowBackground());
  };
  nativeTheme.on('updated', onThemeChange);
  window.on('closed', () => {
    nativeTheme.off('updated', onThemeChange);
  });

  // Lo escucha el proceso principal, no la interfaz: un XSS no puede evitar el bloqueo.
  window.webContents.on('input-event', () => {
    inactividad.registrarActividad(performance.now());
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
  }
  return window;
}

function windowBackground(): string {
  // Debe coincidir con --qa-bg en styles.css.
  return nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f6f7f9';
}

// --- Arranque --------------------------------------------------------------------

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/**
 * Verifica los módulos nativos ANTES de cargarlos. Por eso el servicio de la bóveda, que los
 * importa, se carga de forma dinámica recién acá (ADR 007, TS-07).
 */
async function cargarServicios(): Promise<{
  boveda: ServicioBoveda;
  proyectos: ServicioProyectos;
} | null> {
  const carpetaDelPaquete = (paquete: string): string =>
    path.dirname(requerir.resolve(`${paquete}/package.json`));
  if (!verificarNativos(__QATLAS_NATIVOS__, { carpetaDelPaquete })) return null;

  const { ServicioBoveda: Servicio } = await import('./boveda/servicio');
  const { ServicioProyectos: Proyectos } = await import('./proyectos/servicio');
  const boveda = new Servicio({
    carpeta: dataDirectory,
    alBloquear: () => {
      // Las pantallas previas al desbloqueo siguen al sistema: la preferencia está cifrada.
      nativeTheme.themeSource = 'system';
      // Recargar descarta todo el estado de la interfaz: vuelve al desbloqueo sin datos.
      if (!saliendo) mainWindow?.webContents.reload();
    },
    alDesbloquear: ({ tema, bloqueoMinutos }) => {
      nativeTheme.themeSource = tema;
      inactividad.cambiarLimite(bloqueoMinutos * MS_POR_MINUTO);
      inactividad.registrarActividad(performance.now());
    },
  });
  return { boveda, proyectos: new Proyectos(boveda) };
}

function vigilarBloqueo(boveda: ServicioBoveda): void {
  const bloquear = (): void => {
    boveda.bloquear();
  };
  powerMonitor.on('suspend', bloquear);
  powerMonitor.on('lock-screen', bloquear);
  app.on('before-quit', () => {
    saliendo = true;
    bloquear();
  });
  setInterval(() => {
    if (boveda.estado() === 'desbloqueada' && inactividad.venció(performance.now())) bloquear();
  }, INTERVALO_INACTIVIDAD_MS).unref();
}

void app.whenReady().then(async () => {
  if (app.isPackaged) Menu.setApplicationMenu(null);

  const servicios = await cargarServicios();
  if (!servicios) {
    dialog.showErrorBox(
      'QAtlas no puede iniciar',
      'Un componente de la aplicación fue modificado o no se encuentra. Por seguridad no se ejecuta nada. Volvé a instalar QAtlas.',
    );
    app.exit(1);
    return;
  }
  const { boveda, proyectos } = servicios;
  vigilarBloqueo(boveda);

  applyHardening({
    devServerOrigin,
    connectionLog,
    isAllowedNavigation: isAllowedOrigin,
  });
  registerAppProtocol();
  registerIpc(
    {
      getWindowPreferences: () => mainWindowPreferences,
      getWindow: () => mainWindow,
      connectionLog,
      cspActive: true,
      dataDirectorySynced,
      boveda,
      proyectos,
      alCambiarBloqueoMinutos: (minutos) => {
        inactividad.cambiarLimite(minutos * MS_POR_MINUTO);
      },
    },
    {
      isAllowedSender: isAllowedOrigin,
      isVaultLocked: () => boveda.estado() !== 'desbloqueada',
      onRejected: (channel, code) => {
        // Sin datos de la solicitud: solo canal y motivo.
        console.warn(`[ipc] rechazado ${channel}: ${code}`);
      },
    },
  );

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
