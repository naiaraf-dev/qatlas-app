import type { IpcRequest, IpcResponse, IpcResult } from './ipc-contract.js';

/**
 * API que el preload expone en `window.qatlas`.
 * Funciones específicas por canal: la interfaz nunca recibe `ipcRenderer`.
 */
export interface QatlasApi {
  app: {
    getInfo(): Promise<IpcResult<IpcResponse<'app:getInfo'>>>;
  };
  security: {
    getStatus(): Promise<IpcResult<IpcResponse<'security:getStatus'>>>;
  };
  appearance: {
    get(): Promise<IpcResult<IpcResponse<'appearance:get'>>>;
    setTheme(
      req: IpcRequest<'appearance:setTheme'>,
    ): Promise<IpcResult<IpcResponse<'appearance:setTheme'>>>;
  };
  privacy: {
    listConnections(
      req: IpcRequest<'privacy:listConnections'>,
    ): Promise<IpcResult<IpcResponse<'privacy:listConnections'>>>;
  };
  vault: {
    getStatus(): Promise<IpcResult<IpcResponse<'vault:getStatus'>>>;
    create(req: IpcRequest<'vault:create'>): Promise<IpcResult<IpcResponse<'vault:create'>>>;
    unlock(req: IpcRequest<'vault:unlock'>): Promise<IpcResult<IpcResponse<'vault:unlock'>>>;
    lock(): Promise<IpcResult<IpcResponse<'vault:lock'>>>;
    getSettings(): Promise<IpcResult<IpcResponse<'vault:getSettings'>>>;
    setSettings(
      req: IpcRequest<'vault:setSettings'>,
    ): Promise<IpcResult<IpcResponse<'vault:setSettings'>>>;
    createBackup(): Promise<IpcResult<IpcResponse<'vault:createBackup'>>>;
    restoreBackup(
      req: IpcRequest<'vault:restoreBackup'>,
    ): Promise<IpcResult<IpcResponse<'vault:restoreBackup'>>>;
  };
}
