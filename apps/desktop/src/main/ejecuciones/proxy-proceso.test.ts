import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { conectarProxy, type HijoProxy } from './proxy-proceso';

const DATOS = {
  politica: {
    urlBase: 'http://localhost:5173/',
    dominios: ['localhost'],
    sistemaInterno: false,
    puertosLocales: [],
  },
  credencial: { usuario: 'u', clave: 'c' },
};

function hijoFalso() {
  const eventos = new EventEmitter();
  const hijo = Object.assign(eventos, {
    postMessage: vi.fn(),
    kill: vi.fn(),
  });
  return hijo;
}

const conectar = (hijo: HijoProxy, tiempo = 10_000) =>
  conectarProxy(hijo, DATOS, () => undefined, tiempo);

describe('Proceso del proxy: «no arrancó» o «se cayó»', () => {
  it('si termina antes de reportar su puerto, no arrancó', async () => {
    const hijo = hijoFalso();
    const proxy = conectar(hijo);
    hijo.emit('exit');
    await expect(proxy).rejects.toThrow('El proxy terminó al arrancar.');
  });

  it('si no reporta a tiempo, no arrancó, y se lo corta', async () => {
    const hijo = hijoFalso();
    await expect(conectar(hijo, 5)).rejects.toThrow('El proxy no arrancó.');
    expect(hijo.kill).toHaveBeenCalled();
  });

  it('un mensaje inválido no cuenta como listo', async () => {
    const hijo = hijoFalso();
    const proxy = conectar(hijo);
    hijo.emit('message', { tipo: 'listo', puerto: 'no-es-un-puerto' });
    hijo.emit('exit');
    await expect(proxy).rejects.toThrow('El proxy terminó al arrancar.');
  });

  it('si termina después de reportar, se cayó', async () => {
    const hijo = hijoFalso();
    const pendiente = conectar(hijo);
    hijo.emit('message', { tipo: 'listo', puerto: 49152 });
    const proxy = await pendiente;
    expect(proxy.puerto).toBe(49152);
    const alCaer = vi.fn();
    proxy.alCaer(alCaer);
    expect(alCaer).not.toHaveBeenCalled();
    hijo.emit('exit');
    expect(alCaer).toHaveBeenCalledOnce();
  });

  it('si se cayó antes de que alguien escuchara, avisa al registrarse', async () => {
    const hijo = hijoFalso();
    const pendiente = conectar(hijo);
    hijo.emit('message', { tipo: 'listo', puerto: 49152 });
    hijo.emit('exit');
    const proxy = await pendiente;
    const alCaer = vi.fn();
    proxy.alCaer(alCaer);
    expect(alCaer).toHaveBeenCalledOnce();
  });

  it('detenerlo a propósito no es una caída', async () => {
    const hijo = hijoFalso();
    const pendiente = conectar(hijo);
    hijo.emit('message', { tipo: 'listo', puerto: 49152 });
    const proxy = await pendiente;
    const alCaer = vi.fn();
    proxy.alCaer(alCaer);
    proxy.detener();
    hijo.emit('exit');
    expect(alCaer).not.toHaveBeenCalled();
    expect(hijo.kill).toHaveBeenCalled();
  });

  it('las conexiones llegan a quien las registra', () => {
    const hijo = hijoFalso();
    const alRegistrar = vi.fn();
    void conectarProxy(hijo, DATOS, alRegistrar, 10_000).catch(() => undefined);
    const conexion = { destino: 'x.example:80', permitida: false, regla: 'fuera-de-dominios' };
    hijo.emit('message', { tipo: 'conexion', ...conexion });
    expect(alRegistrar).toHaveBeenCalledWith({ tipo: 'conexion', ...conexion });
    hijo.emit('exit');
  });
});
