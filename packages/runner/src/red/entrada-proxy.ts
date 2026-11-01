import { MensajeAlProxy, type MensajeDelProxy } from '../protocolo';
import { iniciarProxy, type ProxyActivo } from './proxy';

/** Punto de entrada del proceso del proxy: un `utilityProcess` sin claves, base ni disco de la app. */

interface PuertoPadre {
  postMessage(mensaje: unknown): void;
  once(evento: 'message', oyente: (evento: { data: unknown }) => void): void;
}

const puerto = (process as unknown as { parentPort: PuertoPadre }).parentPort;
const enviar = (mensaje: MensajeDelProxy): void => {
  puerto.postMessage(mensaje);
};

let activo: ProxyActivo | undefined;

puerto.once('message', ({ data }) => {
  const mensaje = MensajeAlProxy.safeParse(data);
  // Fallar cerrado: sin una configuración válida el proceso termina y la ejecución no empieza.
  if (!mensaje.success) process.exit(1);
  const { politica, credencial } = mensaje.data;
  iniciarProxy({
    politica,
    credencial,
    alRegistrar: ({ destino, permitida, regla }) => {
      enviar({ tipo: 'conexion', destino: destino.slice(0, 300), permitida, regla });
    },
  }).then(
    (proxy) => {
      activo = proxy;
      enviar({ tipo: 'listo', puerto: proxy.puerto });
    },
    () => {
      process.exit(1);
    },
  );
});

process.on('SIGTERM', () => {
  void activo?.cerrar().finally(() => {
    process.exit(0);
  });
});
