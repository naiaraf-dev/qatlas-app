import { iniciarSandbox, PUERTO_POR_DEFECTO } from './servidor.mjs';

// El puerto se puede cambiar; la dirección de escucha no: siempre es 127.0.0.1.
const puerto = Number(process.env.SANDBOX_PUERTO ?? PUERTO_POR_DEFECTO);
if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) {
  throw new Error('SANDBOX_PUERTO no es un puerto válido');
}

const { url } = await iniciarSandbox({ puerto });
console.log(`Sandbox en ${url}`);
