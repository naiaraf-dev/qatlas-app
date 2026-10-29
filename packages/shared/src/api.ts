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
  privacy: {
    listConnections(
      req: IpcRequest<'privacy:listConnections'>,
    ): Promise<IpcResult<IpcResponse<'privacy:listConnections'>>>;
  };
}
