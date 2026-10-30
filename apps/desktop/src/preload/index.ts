import { contextBridge, ipcRenderer } from 'electron';
import type { IpcChannel, QatlasApi } from '@qatlas/shared';

/**
 * Puente mínimo entre la interfaz y el proceso principal (especificación 3.6).
 *
 * - Se expone un objeto con funciones específicas por canal; nunca `ipcRenderer`.
 * - Solo se importan TIPOS de @qatlas/shared: el preload no tiene dependencias
 *   en tiempo de ejecución (requisito del sandbox).
 * - Toda validación ocurre en el proceso principal: el preload no confía en sí mismo.
 */
const invoke = (channel: IpcChannel, payload?: unknown): Promise<never> =>
  ipcRenderer.invoke(channel, payload) as Promise<never>;

const api: QatlasApi = {
  app: {
    getInfo: () => invoke('app:getInfo'),
  },
  security: {
    getStatus: () => invoke('security:getStatus'),
  },
  appearance: {
    get: () => invoke('appearance:get'),
    setTheme: (req) => invoke('appearance:setTheme', req),
  },
  privacy: {
    listConnections: (req) => invoke('privacy:listConnections', req),
  },
  vault: {
    getStatus: () => invoke('vault:getStatus'),
    create: (req) => invoke('vault:create', req),
    unlock: (req) => invoke('vault:unlock', req),
    lock: () => invoke('vault:lock'),
    getSettings: () => invoke('vault:getSettings'),
    setSettings: (req) => invoke('vault:setSettings', req),
    createBackup: () => invoke('vault:createBackup'),
    restoreBackup: (req) => invoke('vault:restoreBackup', req),
  },
};

contextBridge.exposeInMainWorld('qatlas', Object.freeze(api));
