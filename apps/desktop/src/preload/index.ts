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
  proyectos: {
    listar: () => invoke('proyectos:listar'),
    obtener: (req) => invoke('proyectos:obtener', req),
    validar: (req) => invoke('proyectos:validar', req),
    crear: (req) => invoke('proyectos:crear', req),
    actualizar: (req) => invoke('proyectos:actualizar', req),
    eliminar: (req) => invoke('proyectos:eliminar', req),
    aceptarAutorizacion: (req) => invoke('proyectos:aceptarAutorizacion', req),
  },
  credenciales: {
    guardar: (req) => invoke('credenciales:guardar', req),
    reemplazarSecreto: (req) => invoke('credenciales:reemplazarSecreto', req),
    eliminar: (req) => invoke('credenciales:eliminar', req),
    probarLogin: (req) => invoke('credenciales:probarLogin', req),
  },
  ejecuciones: {
    lanzarEscaneo: (req) => invoke('ejecuciones:lanzarEscaneo', req),
    cancelar: (req) => invoke('ejecuciones:cancelar', req),
    listar: (req) => invoke('ejecuciones:listar', req),
    detalle: (req) => invoke('ejecuciones:detalle', req),
    reanudar: (req) => invoke('ejecuciones:reanudar', req),
    // Solo los datos: la interfaz nunca recibe el evento de IPC ni `ipcRenderer`.
    alProgreso: (oyente) => {
      const escuchar = (_evento: unknown, progreso: unknown) => {
        oyente(progreso as never);
      };
      ipcRenderer.on('ejecuciones:progreso', escuchar);
      return () => {
        ipcRenderer.removeListener('ejecuciones:progreso', escuchar);
      };
    },
  },
  evidencias: {
    listar: (req) => invoke('evidencias:listar', req),
    obtenerVista: (req) => invoke('evidencias:obtenerVista', req),
    obtenerFotograma: (req) => invoke('evidencias:obtenerFotograma', req),
    noCumplenModoSensible: (req) => invoke('evidencias:noCumplenModoSensible', req),
    resolverModoSensible: (req) => invoke('evidencias:resolverModoSensible', req),
  },
};

contextBridge.exposeInMainWorld('qatlas', Object.freeze(api));
