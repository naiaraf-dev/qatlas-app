/**
 * TS-01 (adelanto, especificación 3.15): un secreto canario y el texto plano nunca
 * aparecen en lo que el paquete crypto escribiría a disco, en ninguna codificación.
 * El TS-01 completo, sobre toda la bóveda, llega en la semana 7.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  cifrarCampo,
  contrasenaABuffer,
  crearBoveda,
  crearCifradorArchivo,
  crearClaveProyecto,
  descifrarCampo,
  ErrorCripto,
} from '@qatlas/crypto';

const CANARIO = 'CANARIO-8f3a91d27c4e4b0fa6';
const CONTRASENA = 'contraseña-canaria-de-la-bóveda';

/** El valor en claro, en las codificaciones en que podría filtrarse. */
function formas(valor: string): Buffer[] {
  const bytes = Buffer.from(valor, 'utf8');
  return [
    bytes,
    Buffer.from(valor, 'utf16le'),
    Buffer.from(bytes.toString('hex'), 'latin1'),
    Buffer.from(bytes.toString('base64'), 'latin1'),
  ];
}

function expectSinRastros(salida: Buffer, ...valores: string[]) {
  for (const valor of valores) {
    for (const forma of formas(valor)) expect(salida.includes(forma)).toBe(false);
  }
}

async function cifrarArchivo(clave: Buffer, id: string, datos: Buffer): Promise<Buffer> {
  const salida: Buffer[] = [];
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      salida.push(trozo);
      listo();
    },
  });
  await pipeline(Readable.from([datos]), crearCifradorArchivo(clave, id), destino);
  return Buffer.concat(salida);
}

describe('TS-01 · Secreto canario en la salida cifrada', () => {
  it('la búsqueda detecta el canario cuando está en claro (control del propio test)', () => {
    const conCanario = Buffer.concat([Buffer.alloc(10), Buffer.from(CANARIO), Buffer.alloc(10)]);
    expect(() => {
      expectSinRastros(conCanario, CANARIO);
    }).toThrow();
  });

  it('el campo cifrado no contiene el canario, y se recupera con la clave', () => {
    const { clave } = crearClaveProyecto(Buffer.alloc(32, 1), 'proyecto');
    const sellado = cifrarCampo(clave, 'credencial:1:secreto', Buffer.from(CANARIO));
    expectSinRastros(sellado, CANARIO);
    expect(descifrarCampo(clave, 'credencial:1:secreto', sellado).toString()).toBe(CANARIO);
  });

  it('la bóveda sellada no contiene la contraseña ni la clave maestra', async () => {
    const { sellada, maestra } = await crearBoveda(contrasenaABuffer(CONTRASENA));
    const serializada = Buffer.concat([
      Buffer.from(JSON.stringify(sellada.kdf)),
      sellada.salt,
      sellada.maestraEnvuelta,
    ]);
    expectSinRastros(serializada, CONTRASENA);
    expect(serializada.includes(maestra)).toBe(false);
  });

  it('la envoltura del proyecto no contiene su clave', () => {
    const { clave, envuelta } = crearClaveProyecto(Buffer.alloc(32, 1), 'proyecto');
    expect(envuelta.includes(clave)).toBe(false);
  });

  it('el archivo cifrado en disco no contiene el canario ni el texto plano', async () => {
    const { clave } = crearClaveProyecto(Buffer.alloc(32, 1), 'proyecto');
    const texto = `inicio ${CANARIO} y un texto plano reconocible `.repeat(5000);
    const cifrado = await cifrarArchivo(clave, 'evidencia', Buffer.from(texto));

    const carpeta = await mkdtemp(path.join(tmpdir(), 'qatlas-ts01-'));
    try {
      const archivo = path.join(carpeta, 'evidencia.qatf');
      await writeFile(archivo, cifrado);
      expectSinRastros(await readFile(archivo), CANARIO, 'texto plano reconocible');
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  });

  it('los errores no contienen el canario ni detalles internos', () => {
    const { clave } = crearClaveProyecto(Buffer.alloc(32, 1), 'proyecto');
    const sellado = cifrarCampo(clave, 'c', Buffer.from(CANARIO));
    let capturado: unknown;
    try {
      descifrarCampo(clave, 'otro-contexto', sellado);
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(ErrorCripto);
    const texto = `${String(capturado)} ${JSON.stringify(capturado)}`;
    expect(texto).not.toContain(CANARIO);
    expect(texto).not.toContain('otro-contexto');
    expect((capturado as Error).cause).toBeUndefined();
  });
});
