import { MensajeDelProxy, type MensajeAlProxy } from '@qatlas/runner';
import type { ProcesoProxy } from './servicio';

/** Lo que necesita del proceso. Sin Electron: se prueba con un emisor falso. */
export interface HijoProxy {
  on(evento: 'message', oyente: (mensaje: unknown) => void): unknown;
  once(evento: 'exit', oyente: () => void): unknown;
  postMessage(mensaje: unknown): void;
  kill(): unknown;
}

/**
 * Hasta que reporta su puerto, una salida es «no arrancó» y la promesa se rechaza. Después, es «se
 * cayó» y avisa a quien escuche. Si cayó antes de que alguien escuchara, avisa al registrarse: esa
 * caída no se puede perder, porque es lo que aborta la ejecución.
 */
export function conectarProxy(
  hijo: HijoProxy,
  datos: Omit<MensajeAlProxy, 'tipo'>,
  alRegistrar: (registro: { destino: string; permitida: boolean; regla: string }) => void,
  tiempoDeInicioMs: number,
): Promise<ProcesoProxy> {
  return new Promise<ProcesoProxy>((resolver, rechazar) => {
    let listo = false;
    let cayo = false;
    let alCaer: (() => void) | undefined;
    const limite = setTimeout(() => {
      hijo.kill();
      rechazar(new Error('El proxy no arrancó.'));
    }, tiempoDeInicioMs);
    hijo.on('message', (crudo) => {
      const mensaje = MensajeDelProxy.safeParse(crudo);
      if (!mensaje.success) return;
      if (mensaje.data.tipo === 'conexion') {
        alRegistrar(mensaje.data);
        return;
      }
      listo = true;
      clearTimeout(limite);
      resolver({
        puerto: mensaje.data.puerto,
        alCaer: (oyente) => {
          if (cayo) oyente();
          else alCaer = oyente;
        },
        detener: () => {
          alCaer = undefined;
          hijo.kill();
        },
      });
    });
    hijo.once('exit', () => {
      clearTimeout(limite);
      cayo = true;
      if (listo) alCaer?.();
      else rechazar(new Error('El proxy terminó al arrancar.'));
    });
    hijo.postMessage({ tipo: 'iniciar', ...datos } satisfies MensajeAlProxy);
  });
}
