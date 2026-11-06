import { app, ipcMain, nativeTheme, type BrowserWindow, type WebPreferences } from 'electron';
import { IPC_CHANNELS, type IpcChannel } from '@qatlas/shared';
import { createIpcHandler, type HandlerOptions, type IpcImplementation } from './create-handler';
import { elegirCopiaARestaurar, elegirDestinoDeCopia } from '../boveda/dialogos';
import type { ServicioBoveda } from '../boveda/servicio';
import type { ServicioEjecuciones } from '../ejecuciones/servicio';
import type { ServicioProyectos } from '../proyectos/servicio';
import { REQUIRED_PREFERENCE_VALUES } from '../security/web-preferences';
import type { ConnectionLog } from '../security/network-policy';

export interface IpcDependencies {
  /** Preferencias con las que se creó la ventana principal. */
  getWindowPreferences: () => WebPreferences | undefined;
  getWindow: () => BrowserWindow | null;
  connectionLog: ConnectionLog;
  cspActive: boolean;
  dataDirectorySynced: boolean;
  boveda: ServicioBoveda;
  proyectos: ServicioProyectos;
  ejecuciones: ServicioEjecuciones;
  alCambiarBloqueoMinutos: (minutos: number) => void;
}

type Implementations = { [C in IpcChannel]: IpcImplementation<C> };

function buildImplementations(deps: IpcDependencies): Implementations {
  const { boveda, proyectos, ejecuciones } = deps;
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

    // Las de la interfaz, en memoria, y las de las ejecuciones, en la base cifrada.
    'privacy:listConnections': ({ limit }) => {
      const todas = [...deps.connectionLog.list(limit), ...ejecuciones.conexionesRecientes(limit)];
      return todas
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit)
        .map((conexion, id) => ({ ...conexion, id }));
    },

    // El tema lo decide nativeTheme: cambia la barra de título de la ventana y
    // la media query prefers-color-scheme de la interfaz al mismo tiempo.
    // La preferencia se guarda en la configuración cifrada: con la bóveda
    // bloqueada no se conoce, y las pantallas siguen al sistema.
    'appearance:get': () => currentAppearance(),
    'appearance:setTheme': ({ preference }) => {
      boveda.cambiarConfiguracion({ tema: preference });
      nativeTheme.themeSource = preference;
      return currentAppearance();
    },

    'vault:getStatus': () => ({
      estado: boveda.estado(),
      esperaSegundos: boveda.esperaSegundos(),
    }),
    'vault:create': async ({ contrasena, confirmacion }) => {
      if (contrasena !== confirmacion) return { resultado: 'rechazada', motivo: 'no-coincide' };
      // Esta decisión la toma el asistente cuando las actualizaciones existan (semana 10).
      return boveda.crear(contrasena, false);
    },
    'vault:unlock': ({ contrasena }) => boveda.desbloquear(contrasena),
    'vault:lock': () => {
      boveda.bloquear();
      return { estado: 'bloqueada' };
    },
    'vault:getSettings': () => ({ bloqueoMinutos: boveda.configuracion().bloqueoMinutos }),
    'vault:setSettings': ({ bloqueoMinutos }) => {
      const guardada = boveda.cambiarConfiguracion({ bloqueoMinutos }).bloqueoMinutos;
      deps.alCambiarBloqueoMinutos(guardada);
      return { bloqueoMinutos: guardada };
    },
    'vault:createBackup': async () => {
      const destino = await elegirDestinoDeCopia(deps.getWindow());
      if (!destino) return { resultado: 'cancelada' };
      boveda.crearCopia(destino);
      return { resultado: 'creada' };
    },
    'vault:restoreBackup': async ({ contrasena }) => {
      const estado = boveda.estado();
      if (estado === 'bloqueada') return { resultado: 'rechazada' };
      const origen = await elegirCopiaARestaurar(deps.getWindow(), estado === 'danada');
      if (!origen) return { resultado: 'cancelada' };
      return boveda.restaurar(origen, contrasena);
    },

    'proyectos:listar': () => proyectos.listar(),
    'proyectos:obtener': ({ id }) => proyectos.obtener(id),
    'proyectos:validar': ({ proyecto, id }) => proyectos.validar(proyecto, id),
    'proyectos:crear': ({ proyecto, aceptacion }) => proyectos.crear(proyecto, aceptacion),
    'proyectos:actualizar': ({ id, proyecto }) => {
      const respuesta = proyectos.actualizar(id, proyecto);
      if (respuesta.resultado === 'actualizado' && !respuesta.autorizacion.vigente) {
        ejecuciones.cortarDeProyecto(id);
      }
      return respuesta;
    },
    'proyectos:eliminar': ({ id, nombreConfirmacion }) => {
      ejecuciones.cortarDeProyecto(id);
      return proyectos.eliminar(id, nombreConfirmacion);
    },
    'proyectos:aceptarAutorizacion': ({ id, aceptacion }) =>
      proyectos.aceptarAutorizacion(id, aceptacion),
    'credenciales:guardar': (solicitud) => proyectos.guardarCredencial(solicitud),
    'credenciales:reemplazarSecreto': ({ proyectoId, credencialId, secreto }) =>
      proyectos.reemplazarSecreto(proyectoId, credencialId, secreto),
    'credenciales:eliminar': ({ proyectoId, credencialId }) =>
      proyectos.eliminarCredencial(proyectoId, credencialId),
    'credenciales:probarLogin': ({ proyectoId, credencialId }) =>
      ejecuciones.probarLogin(proyectoId, credencialId),
    'ejecuciones:lanzarEscaneo': ({ proyectoId, credencialId }) =>
      ejecuciones.lanzarEscaneo(proyectoId, credencialId),
    'ejecuciones:reanudar': ({ ejecucionId }) => ejecuciones.reanudar(ejecucionId),
    'ejecuciones:cancelar': ({ ejecucionId }) => ejecuciones.cancelar(ejecucionId),
    'ejecuciones:listar': ({ proyectoId }) => ejecuciones.listar(proyectoId),
    'ejecuciones:detalle': ({ ejecucionId }) => ejecuciones.detalle(ejecucionId),
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

function currentAppearance() {
  return {
    preference: nativeTheme.themeSource,
    effective: nativeTheme.shouldUseDarkColors ? ('dark' as const) : ('light' as const),
  };
}
