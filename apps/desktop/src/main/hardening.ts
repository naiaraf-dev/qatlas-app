import { app, session, type Session, type WebContents } from 'electron';
import { buildCsp } from './security/csp';
import { decideUiRequest, type ConnectionLog } from './security/network-policy';

/**
 * Endurecimiento global de Electron (especificación 3.6). Se aplica una sola
 * vez, al iniciar, a la sesión por defecto y a todo WebContents que se cree.
 */
export interface HardeningContext {
  devServerOrigin: string | undefined;
  connectionLog: ConnectionLog;
  isAllowedNavigation: (url: string) => boolean;
}

export function hardenSession(target: Session, ctx: HardeningContext): void {
  // Ningún permiso del navegador: cámara, micrófono, ubicación, notificaciones,
  // portapapeles, USB, etc.
  target.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  target.setPermissionCheckHandler(() => false);
  target.setDevicePermissionHandler(() => false);

  // Red: denegar por defecto (segunda capa, después de la CSP).
  target.webRequest.onBeforeRequest((details, callback) => {
    const decision = decideUiRequest(details.url, { devServerOrigin: ctx.devServerOrigin });
    if (!decision.allowed) {
      ctx.connectionLog.record({
        origin: 'interfaz',
        url: details.url,
        allowed: false,
        rule: decision.rule,
      });
    }
    callback({ cancel: !decision.allowed });
  });

  // CSP para las respuestas del servidor de desarrollo. En producción la CSP
  // la pone el protocolo app:// en cada respuesta.
  if (ctx.devServerOrigin) {
    const csp = buildCsp({ dev: true, devServerOrigin: ctx.devServerOrigin });
    target.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }
}

export function hardenAllWebContents(ctx: HardeningContext): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    // Sin <webview>.
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });

    // La ventana nunca navega fuera de la propia interfaz.
    const blockNavigation = (event: Electron.Event, url: string): void => {
      if (!ctx.isAllowedNavigation(url)) event.preventDefault();
    };
    contents.on('will-navigate', blockNavigation);
    contents.on('will-redirect', blockNavigation);

    // Nunca se abren ventanas nuevas. Abrir links externos en el navegador del
    // sistema (solo HTTPS y con confirmación) se implementa más adelante, a
    // través de un canal IPC propio (especificación 3.6, "Links externos").
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

export function applyHardening(ctx: HardeningContext): void {
  hardenSession(session.defaultSession, ctx);
  hardenAllWebContents(ctx);
}
