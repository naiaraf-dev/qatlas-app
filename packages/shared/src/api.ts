import type { IpcRequest, IpcResponse, IpcResult, ProgresoEjecucion } from './ipc-contract.js';

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
    setBarraLateral(
      req: IpcRequest<'appearance:setBarraLateral'>,
    ): Promise<IpcResult<IpcResponse<'appearance:setBarraLateral'>>>;
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
  proyectos: {
    listar(): Promise<IpcResult<IpcResponse<'proyectos:listar'>>>;
    obtener(
      req: IpcRequest<'proyectos:obtener'>,
    ): Promise<IpcResult<IpcResponse<'proyectos:obtener'>>>;
    validar(
      req: IpcRequest<'proyectos:validar'>,
    ): Promise<IpcResult<IpcResponse<'proyectos:validar'>>>;
    crear(req: IpcRequest<'proyectos:crear'>): Promise<IpcResult<IpcResponse<'proyectos:crear'>>>;
    actualizar(
      req: IpcRequest<'proyectos:actualizar'>,
    ): Promise<IpcResult<IpcResponse<'proyectos:actualizar'>>>;
    eliminar(
      req: IpcRequest<'proyectos:eliminar'>,
    ): Promise<IpcResult<IpcResponse<'proyectos:eliminar'>>>;
    aceptarAutorizacion(
      req: IpcRequest<'proyectos:aceptarAutorizacion'>,
    ): Promise<IpcResult<IpcResponse<'proyectos:aceptarAutorizacion'>>>;
  };
  credenciales: {
    guardar(
      req: IpcRequest<'credenciales:guardar'>,
    ): Promise<IpcResult<IpcResponse<'credenciales:guardar'>>>;
    reemplazarSecreto(
      req: IpcRequest<'credenciales:reemplazarSecreto'>,
    ): Promise<IpcResult<IpcResponse<'credenciales:reemplazarSecreto'>>>;
    eliminar(
      req: IpcRequest<'credenciales:eliminar'>,
    ): Promise<IpcResult<IpcResponse<'credenciales:eliminar'>>>;
    probarLogin(
      req: IpcRequest<'credenciales:probarLogin'>,
    ): Promise<IpcResult<IpcResponse<'credenciales:probarLogin'>>>;
  };
  ejecuciones: {
    lanzarEscaneo(
      req: IpcRequest<'ejecuciones:lanzarEscaneo'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:lanzarEscaneo'>>>;
    cancelar(
      req: IpcRequest<'ejecuciones:cancelar'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:cancelar'>>>;
    listar(
      req: IpcRequest<'ejecuciones:listar'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:listar'>>>;
    detalle(
      req: IpcRequest<'ejecuciones:detalle'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:detalle'>>>;
    listarTodas(
      req: IpcRequest<'ejecuciones:listarTodas'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:listarTodas'>>>;
    comparar(
      req: IpcRequest<'ejecuciones:comparar'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:comparar'>>>;
    reanudar(
      req: IpcRequest<'ejecuciones:reanudar'>,
    ): Promise<IpcResult<IpcResponse<'ejecuciones:reanudar'>>>;
    /** Devuelve la función para dejar de escuchar. */
    alProgreso(oyente: (progreso: ProgresoEjecucion) => void): () => void;
  };
  evidencias: {
    listar(
      req: IpcRequest<'evidencias:listar'>,
    ): Promise<IpcResult<IpcResponse<'evidencias:listar'>>>;
    obtenerVista(
      req: IpcRequest<'evidencias:obtenerVista'>,
    ): Promise<IpcResult<IpcResponse<'evidencias:obtenerVista'>>>;
    obtenerFotograma(
      req: IpcRequest<'evidencias:obtenerFotograma'>,
    ): Promise<IpcResult<IpcResponse<'evidencias:obtenerFotograma'>>>;
    noCumplenModoSensible(
      req: IpcRequest<'evidencias:noCumplenModoSensible'>,
    ): Promise<IpcResult<IpcResponse<'evidencias:noCumplenModoSensible'>>>;
    resolverModoSensible(
      req: IpcRequest<'evidencias:resolverModoSensible'>,
    ): Promise<IpcResult<IpcResponse<'evidencias:resolverModoSensible'>>>;
  };
  hallazgos: {
    listar(
      req: IpcRequest<'hallazgos:listar'>,
    ): Promise<IpcResult<IpcResponse<'hallazgos:listar'>>>;
    detalle(
      req: IpcRequest<'hallazgos:detalle'>,
    ): Promise<IpcResult<IpcResponse<'hallazgos:detalle'>>>;
    decidir(
      req: IpcRequest<'hallazgos:decidir'>,
    ): Promise<IpcResult<IpcResponse<'hallazgos:decidir'>>>;
    cambiarSeveridad(
      req: IpcRequest<'hallazgos:cambiarSeveridad'>,
    ): Promise<IpcResult<IpcResponse<'hallazgos:cambiarSeveridad'>>>;
    resolverEnLote(
      req: IpcRequest<'hallazgos:resolverEnLote'>,
    ): Promise<IpcResult<IpcResponse<'hallazgos:resolverEnLote'>>>;
  };
}
