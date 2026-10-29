import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, Menu, protocol } from 'electron';
import { applyHardening } from './hardening';
import { registerIpc } from './ipc/register';
import { makeSenderCheck } from './ipc/create-handler';
import { APP_HOST, APP_ORIGIN, APP_SCHEME, resolveAppRequest } from './security/app-protocol';
import { buildCsp } from './security/csp';
import { isLikelySyncedPath, resolveDataDirectory } from './security/data-dir';
import { ConnectionLog } from './security/network-policy';
import { SECURE_WEB_PREFERENCES } from './security/web-preferences';

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
    backgroundColor: '#0f172a',
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

// --- Arranque --------------------------------------------------------------------

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

void app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);

  applyHardening({
    devServerOrigin,
    connectionLog,
    isAllowedNavigation: isAllowedOrigin,
  });
  registerAppProtocol();
  registerIpc(
    {
      getWindowPreferences: () => mainWindowPreferences,
      connectionLog,
      cspActive: true,
      dataDirectorySynced,
    },
    {
      isAllowedSender: isAllowedOrigin,
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
