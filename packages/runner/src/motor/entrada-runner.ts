import type { MensajeDelRunner } from '../protocolo';
import { instalarAgente } from '../red/agente';
import { crearRunner } from './runner';

/**
 * Punto de entrada del runner: un «utilityProcess» por ejecución (ADR 017). Recibe solo la
 * configuración y, para un login, el secreto. No conoce la bóveda ni las claves. Al terminar, el
 * proceso se va, y con él lo que quedó en su memoria.
 */

interface PuertoPadre {
  postMessage(mensaje: unknown): void;
  on(evento: 'message', oyente: (evento: { data: unknown }) => void): void;
}

const puerto = (process as unknown as { parentPort: PuertoPadre }).parentPort;
const enviar = (mensaje: MensajeDelRunner): void => {
  puerto.postMessage(mensaje);
};

// Lista vacía: el runner no necesita red propia. Playwright habla con Chromium por un pipe.
instalarAgente(new Set(), ({ destino, regla }) => {
  enviar({ tipo: 'conexion', proceso: 'runner', destino, permitida: false, regla });
});

const runner = crearRunner({
  enviar,
  // El proceso principal lo arranca con la carpeta de la ejecución como directorio de trabajo, dentro
  // de la carpeta de datos (ADR 018). No se toma del temporal: si TEMP faltara, igual queda ahí.
  carpetaPerfil: process.cwd(),
  alTerminar: (codigo) => {
    process.exit(codigo);
  },
});
puerto.on('message', ({ data }) => {
  runner.recibir(data);
});
