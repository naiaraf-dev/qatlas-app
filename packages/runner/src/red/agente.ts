import { Socket } from 'node:net';
import type { ReglaBloqueo } from './reglas';

export interface IntentoBloqueado {
  destino: string;
  regla: Extract<ReglaBloqueo, 'agente-node'>;
}

interface OpcionesConexion {
  host?: string;
  port?: number;
  path?: string;
}

function destinoDe(argumentos: unknown[]): OpcionesConexion {
  const primero = Array.isArray(argumentos[0]) ? (argumentos[0] as unknown[])[0] : argumentos[0];
  if (typeof primero === 'object' && primero !== null) return primero;
  if (typeof primero === 'string') return { path: primero };
  return { port: Number(primero), host: typeof argumentos[1] === 'string' ? argumentos[1] : '' };
}

/**
 * El agente de red del runner (especificación 3.5, ADR 017). Toda conexión de Node pasa por
 * `Socket.connect`, también `http`, `https`, `tls` y las conexiones por nombre.
 *
 * Valida el destino contra la lista permitida. Hoy esa lista está vacía: Playwright habla con el
 * navegador por un pipe y el runner no necesita red propia.
 *
 * Es cooperativo: protege de un error de nuestro código o de una dependencia que quiera salir, no de
 * código malicioso dentro del proceso. Ver el modelo de amenazas.
 */
export function instalarAgente(
  permitidos: ReadonlySet<string>,
  alBloquear: (intento: IntentoBloqueado) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- se llama con `apply`, con su `this`
  const original = Socket.prototype.connect;
  const guardado = function (this: Socket, ...argumentos: unknown[]): Socket {
    const { host = 'localhost', port, path } = destinoDe(argumentos);
    const destino = path ?? `${host}:${String(port)}`;
    if (!permitidos.has(destino)) {
      alBloquear({ destino: destino.slice(0, 280), regla: 'agente-node' });
      // Falla como una conexión rechazada, sin haber tocado la red.
      queueMicrotask(() => {
        this.destroy(Object.assign(new Error('Conexión bloqueada'), { code: 'EACCES' }));
      });
      return this;
    }
    return (original as (...args: unknown[]) => Socket).apply(this, argumentos);
  };
  Socket.prototype.connect = guardado;
  return () => {
    Socket.prototype.connect = original;
  };
}
