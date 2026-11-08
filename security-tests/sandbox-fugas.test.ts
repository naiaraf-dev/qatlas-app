/**
 * Las fugas de secretos del sandbox (semana 7, TS-01 y TS-13): cada página filtra lo que dice el manifiesto,
 * y la opción `canario` lo vuelve la contraseña del admin y el token de un enlace. Sin navegador.
 */
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANARIO_POR_DEFECTO,
  HOST_SITIO,
  iniciarSandbox,
  JWT_DE_PRUEBA,
  PEM_DE_PRUEBA,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import manifiesto from '../apps/sandbox-site/hallazgos-esperados.json';

let sitio: SandboxActivo | undefined;

afterEach(async () => {
  await sitio?.cerrar();
  sitio = undefined;
});

function pedir(
  activo: SandboxActivo,
  ruta: string,
  opciones: { metodo?: string; cuerpo?: string; cookie?: string } = {},
): Promise<{ estado: number; encabezados: Record<string, unknown>; cuerpo: string }> {
  return new Promise((listo, fallo) => {
    const pedido = request(
      {
        host: '127.0.0.1',
        port: activo.puerto,
        method: opciones.metodo ?? 'GET',
        path: ruta,
        headers: {
          host: `${HOST_SITIO}:${activo.puerto}`,
          ...(opciones.cookie ? { cookie: opciones.cookie } : {}),
          ...(opciones.cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (t: string) => (texto += t));
        res.on('end', () => {
          listo({ estado: res.statusCode ?? 0, encabezados: res.headers, cuerpo: texto });
        });
      },
    );
    pedido.on('error', fallo);
    pedido.end(opciones.cuerpo);
  });
}

describe('Fugas de secretos del sandbox (semana 7)', () => {
  it('los secretos de prueba tienen la forma que el detector busca, y son inventados', () => {
    expect(JWT_DE_PRUEBA).toMatch(/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/);
    expect(PEM_DE_PRUEBA).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/,
    );
    expect(PEM_DE_PRUEBA).toContain('Relleno0De0Prueba');
    expect(CANARIO_POR_DEFECTO).toMatch(/^CANARIO-/);
  });

  it('cada página filtra el canario como dice el manifiesto', async () => {
    sitio = await iniciarSandbox({ puerto: 0 });
    const canario = CANARIO_POR_DEFECTO;
    const consola = await pedir(sitio, '/fugas/consola');
    expect(consola.cuerpo).toContain(canario.slice(0, 10));
    expect(consola.cuerpo).toContain(JWT_DE_PRUEBA);
    expect((await pedir(sitio, '/fugas/encabezado')).encabezados['x-depuracion']).toBe(canario);
    expect((await pedir(sitio, '/fugas/html')).cuerpo).toContain(canario);
    expect(JSON.parse((await pedir(sitio, '/fugas/datos.json')).cuerpo)).toMatchObject({
      token: canario,
      jwt: JWT_DE_PRUEBA,
    });
    expect((await pedir(sitio, '/fugas')).cuerpo).toContain(
      `/fugas/url?clave=${encodeURIComponent(canario)}`,
    );
    // TS-13: el backend imprime el canario y un JWT en su log, y la página lo pide.
    await pedir(sitio, '/fugas/registro');
    expect(sitio.registroBackend.join('\n')).toContain(canario);
    expect(sitio.registroBackend.join('\n')).toContain(JWT_DE_PRUEBA);
    expect(JSON.parse((await pedir(sitio, '/fugas/registro.json')).cuerpo)).toHaveLength(2);

    const paginas = manifiesto.fugasDeSecretos.casos.map((c) => c.pagina);
    expect(paginas).toEqual(expect.arrayContaining(['/fugas/consola', '/fugas/registro']));
  });

  it('con un canario, es la contraseña del admin y el token de un enlace, y aparece la depuración', async () => {
    const canario = 'CANARIO-prueba-sandbox-9d2a';
    sitio = await iniciarSandbox({ puerto: 0, canario });
    const entrar = (clave: string) =>
      pedir(sitio as SandboxActivo, '/app/login', {
        metodo: 'POST',
        cuerpo: new URLSearchParams({ usuario: USUARIOS_APP.admin.usuario, clave }).toString(),
      });
    expect((await entrar(USUARIOS_APP.admin.clave)).estado).toBe(401);
    const respuesta = await entrar(canario);
    expect(respuesta.estado).toBe(302);
    const cookie = String((respuesta.encabezados['set-cookie'] as string[])[0]).split(';')[0] ?? '';
    const depuracion = await pedir(sitio, '/app/depuracion', { cookie });
    expect(depuracion.cuerpo).toContain(canario);
    expect((await pedir(sitio, '/fugas/html')).cuerpo).toContain(canario);
    expect(sitio.autenticacion.emitirEnlace('admin', { token: canario })).toContain(
      `token=${canario}`,
    );
  });

  it('sin canario, no hay página de depuración con sesión', async () => {
    sitio = await iniciarSandbox({ puerto: 0 });
    expect((await pedir(sitio, '/app/depuracion')).estado).not.toBe(200);
  });
});
