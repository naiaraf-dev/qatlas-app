import { app, ipcMain, type WebPreferences } from 'electron';
import { IPC_CHANNELS, type IpcChannel } from '@qatlas/shared';
import { createIpcHandler, type HandlerOptions, type IpcImplementation } from './create-handler';
import { REQUIRED_PREFERENCE_VALUES } from '../security/web-preferences';
import type { ConnectionLog } from '../security/network-policy';

export interface IpcDependencies {
  /** Preferencias con las que se creó la ventana principal. */
  getWindowPreferences: () => WebPreferences | undefined;
  connectionLog: ConnectionLog;
  cspActive: boolean;
  dataDirectorySynced: boolean;
}

type Implementations = { [C in IpcChannel]: IpcImplementation<C> };

function buildImplementations(deps: IpcDependencies): Implementations {
  return {
    'app:getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform as 'win32' | 'darwin' | 'linux',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      isPackaged: app.isPackaged,
    }),

    // Reporta las preferencias con las que se creó la ventana. La interfaz
    // además verifica en vivo que no tiene acceso a Node (App.tsx).
    'security:getStatus': () => {
      const actual = (deps.getWindowPreferences() ?? {}) as Record<string, unknown>;
      return {
        contextIsolation: actual.contextIsolation === REQUIRED_PREFERENCE_VALUES.contextIsolation,
        sandbox: actual.sandbox === REQUIRED_PREFERENCE_VALUES.sandbox,
        nodeIntegration: actual.nodeIntegration === true,
        webSecurity: actual.webSecurity !== false,
        cspActive: deps.cspActive,
        networkPolicy: 'deny-by-default' as const,
        telemetry: 'none' as const,
        dataDirectorySynced: deps.dataDirectorySynced,
      };
    },

    'privacy:listConnections': ({ limit }) => deps.connectionLog.list(limit),
  };
}

export function registerIpc(deps: IpcDependencies, options: HandlerOptions): void {
  const implementations = buildImplementations(deps);
  for (const channel of IPC_CHANNELS) {
    registerChannel(channel, implementations[channel], options);
  }
}

function registerChannel<C extends IpcChannel>(
  channel: C,
  implementation: IpcImplementation<C>,
  options: HandlerOptions,
): void {
  ipcMain.handle(channel, createIpcHandler(channel, implementation, options));
}
