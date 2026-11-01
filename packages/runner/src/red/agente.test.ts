import { createServer, get, type Server } from 'node:http';
import { connect as conectarTcp, type AddressInfo } from 'node:net';
import { connect as conectarTls } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instalarAgente, type IntentoBloqueado } from './agente';

let servidor: Server;
let puerto: number;
let llegadas: number;
let intentos: IntentoBloqueado[];
let desinstalar: () => void;

beforeEach(async () => {
  llegadas = 0;
  intentos = [];
  servidor = createServer((_req, res) => {
    llegadas += 1;
    res.end('ok');
  });
  await new Promise<void>((listo) => {
    servidor.listen(0, '127.0.0.1', listo);
  });
  puerto = (servidor.address() as AddressInfo).port;
});

afterEach(async () => {
  desinstalar();
  servidor.closeAllConnections();
  await new Promise((listo) => servidor.close(listo));
});

const instalar = (permitidos: string[] = []) => {
  desinstalar = instalarAgente(new Set(permitidos), (i) => intentos.push(i));
};

const error = (socket: NodeJS.EventEmitter): Promise<NodeJS.ErrnoException> =>
  new Promise((listo) => {
    socket.on('error', listo);
  });

describe('Agente de red del runner', () => {
  it('bloquea un socket y lo registra', async () => {
    instalar();
    const e = await error(conectarTcp(puerto, '127.0.0.1'));
    expect(e.code).toBe('EACCES');
    expect(intentos).toEqual([{ destino: `127.0.0.1:${puerto}`, regla: 'agente-node' }]);
    expect(llegadas).toBe(0);
  });

  it('bloquea http', async () => {
    instalar();
    const e = await error(get(`http://127.0.0.1:${puerto}/`));
    expect(e.code).toBe('EACCES');
    expect(llegadas).toBe(0);
  });

  it('bloquea tls', async () => {
    instalar();
    const e = await error(conectarTls({ host: '127.0.0.1', port: puerto }));
    expect(e.code).toBe('EACCES');
    expect(intentos).toHaveLength(1);
  });

  it('un nombre también: no llega al DNS', async () => {
    instalar();
    const e = await error(conectarTcp({ host: 'evil.example', port: 443 }));
    expect(e.code).toBe('EACCES');
    expect(intentos[0]?.destino).toBe('evil.example:443');
  });

  it('un destino en la lista pasa', async () => {
    instalar([`127.0.0.1:${puerto}`]);
    await new Promise<void>((listo, fallar) => {
      get(`http://127.0.0.1:${puerto}/`, (res) => {
        res.resume();
        res.on('end', listo);
      }).on('error', fallar);
    });
    expect(llegadas).toBe(1);
    expect(intentos).toEqual([]);
  });

  it('al desinstalarlo, vuelve el comportamiento normal', async () => {
    instalar();
    desinstalar();
    await new Promise<void>((listo, fallar) => {
      get(`http://127.0.0.1:${puerto}/`, (res) => {
        res.resume();
        res.on('end', listo);
      }).on('error', fallar);
    });
    expect(llegadas).toBe(1);
  });
});
