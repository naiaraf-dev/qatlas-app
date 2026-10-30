/**
 * Cifrado de archivos por bloques: ida y vuelta, manipulación del formato y streaming
 * real. El archivo grande usa 1 GiB en local y 64 MiB en CI.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  construirNonce,
  crearCifradorArchivo,
  crearDescifradorArchivo,
  TAMANO_BLOQUE,
} from './archivos';
import { ErrorCripto } from './errores';

const CLAVE = Buffer.alloc(32, 6);
const ID = 'evidencia-1';
const CABECERA = 44;
const TAG = 16;
const BLOQUE_CIFRADO = TAMANO_BLOQUE + TAG;
const MIB = 1024 * 1024;

function trocear(datos: Buffer, tamano: number): Buffer[] {
  const trozos: Buffer[] = [];
  for (let i = 0; i < datos.length; i += tamano) trozos.push(datos.subarray(i, i + tamano));
  return trozos;
}

async function pasar(
  transformador: NodeJS.ReadWriteStream,
  datos: Buffer,
  tamanoTrozo = 8191,
): Promise<{ salida: Buffer; recibido: Buffer[] }> {
  const recibido: Buffer[] = [];
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      recibido.push(trozo);
      listo();
    },
  });
  await pipeline(Readable.from(trocear(datos, tamanoTrozo)), transformador, destino);
  return { salida: Buffer.concat(recibido), recibido };
}

const cifrar = async (datos: Buffer, id = ID, clave = CLAVE) =>
  (await pasar(crearCifradorArchivo(clave, id), datos)).salida;
const descifrar = async (datos: Buffer, id = ID, clave = CLAVE) =>
  (await pasar(crearDescifradorArchivo(clave, id), datos)).salida;

/** Separa un archivo cifrado en cabecera y bloques. */
function partes(archivo: Buffer) {
  return {
    cabecera: archivo.subarray(0, CABECERA),
    bloques: trocear(archivo.subarray(CABECERA), BLOQUE_CIFRADO),
  };
}

const TRES_BLOQUES = randomBytes(TAMANO_BLOQUE * 2 + 1000);

async function esperaError(archivo: Buffer, codigo = 'AUTENTICACION', id = ID, clave = CLAVE) {
  await expect(descifrar(archivo, id, clave)).rejects.toMatchObject({
    name: 'ErrorCripto',
    codigo,
  });
}

describe('Archivos · ida y vuelta', () => {
  it.each([
    ['vacío', 0],
    ['un byte', 1],
    ['justo un bloque', TAMANO_BLOQUE],
    ['un bloque y un byte', TAMANO_BLOQUE + 1],
    ['justo dos bloques', TAMANO_BLOQUE * 2],
    ['varios bloques', TAMANO_BLOQUE * 3 + 77],
  ])('%s', async (_nombre, tamano) => {
    const datos = randomBytes(tamano);
    expect((await descifrar(await cifrar(datos))).equals(datos)).toBe(true);
  });

  it('no depende de cómo llegan los trozos', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    for (const tamano of [1024, TAMANO_BLOQUE, BLOQUE_CIFRADO + 1, archivo.length]) {
      const { salida } = await pasar(crearDescifradorArchivo(CLAVE, ID), archivo, tamano);
      expect(salida.equals(TRES_BLOQUES)).toBe(true);
    }
  });

  it('el mismo contenido cifrado dos veces no se parece', async () => {
    const a = await cifrar(TRES_BLOQUES);
    const b = await cifrar(TRES_BLOQUES);
    expect(a.subarray(5, 44).equals(b.subarray(5, 44))).toBe(false);
    expect(a.subarray(44, 1000).equals(b.subarray(44, 1000))).toBe(false);
  });

  it('tiene el tamaño esperado del formato', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    expect(archivo.length).toBe(CABECERA + TRES_BLOQUES.length + 3 * TAG);
    expect(archivo.subarray(0, 5).toString('latin1')).toBe('QATF\u0001');
  });

  it('la clave de proyecto se puede borrar después de crear el stream', async () => {
    const clave = Buffer.alloc(32, 8);
    const archivo = await cifrar(TRES_BLOQUES, ID, clave);
    const descifrador = crearDescifradorArchivo(clave, ID);
    clave.fill(0);
    const { salida } = await pasar(descifrador, archivo);
    expect(salida.equals(TRES_BLOQUES)).toBe(true);
  });
});

describe('Archivos · manipulación', () => {
  it.each([
    ['la versión', 4, 'VERSION'],
    ['el magic', 0, 'FORMATO'],
    ['el salt de la cabecera', 5, 'AUTENTICACION'],
    ['el prefijo de nonce', 37, 'AUTENTICACION'],
    ['el texto cifrado', CABECERA, 'AUTENTICACION'],
    ['el tag del primer bloque', CABECERA + BLOQUE_CIFRADO - 1, 'AUTENTICACION'],
  ])('un bit alterado en %s falla', async (_nombre, posicion, codigo) => {
    const archivo = await cifrar(TRES_BLOQUES);
    archivo[posicion] = (archivo[posicion] as number) ^ 1;
    await esperaError(archivo, codigo);
  });

  it('un bit alterado en el último tag falla', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    const ultimo = archivo.length - 1;
    archivo[ultimo] = (archivo[ultimo] as number) ^ 1;
    await esperaError(archivo);
  });

  it('bloques reordenados', async () => {
    const { cabecera, bloques } = partes(await cifrar(TRES_BLOQUES));
    const [a, b, c] = bloques as [Buffer, Buffer, Buffer];
    await esperaError(Buffer.concat([cabecera, b, a, c]));
  });

  it('bloque duplicado', async () => {
    const { cabecera, bloques } = partes(await cifrar(TRES_BLOQUES));
    const [a, b, c] = bloques as [Buffer, Buffer, Buffer];
    await esperaError(Buffer.concat([cabecera, a, a, b, c]));
  });

  it('truncado justo en un límite de bloque', async () => {
    const { cabecera, bloques } = partes(await cifrar(TRES_BLOQUES));
    const [a, b] = bloques as [Buffer, Buffer, Buffer];
    await esperaError(Buffer.concat([cabecera, a, b]));
    await esperaError(Buffer.concat([cabecera, a]));
  });

  it('truncado en medio de un bloque', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    await esperaError(archivo.subarray(0, archivo.length - 1));
    await esperaError(archivo.subarray(0, CABECERA + 100));
    await esperaError(archivo.subarray(0, CABECERA + 3));
  });

  it('sin bloques o sin cabecera completa', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    await esperaError(archivo.subarray(0, CABECERA));
    await esperaError(archivo.subarray(0, CABECERA - 1), 'FORMATO');
    await esperaError(Buffer.alloc(0), 'FORMATO');
  });

  it('un último bloque vacío no puede quitarse de un archivo vacío', async () => {
    const vacio = await cifrar(Buffer.alloc(0));
    expect(vacio.length).toBe(CABECERA + TAG);
    await esperaError(vacio.subarray(0, CABECERA));
  });

  it('datos agregados al final', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    await esperaError(Buffer.concat([archivo, Buffer.from([0])]));
  });

  it('bloques de otro archivo con la misma clave', async () => {
    const uno = partes(await cifrar(TRES_BLOQUES));
    const otro = partes(await cifrar(TRES_BLOQUES));
    const [a, , c] = uno.bloques as [Buffer, Buffer, Buffer];
    const [, b] = otro.bloques as [Buffer, Buffer, Buffer];
    await esperaError(Buffer.concat([uno.cabecera, a, b, c]));
  });

  it('otro ID de archivo u otra clave', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    await esperaError(archivo, 'AUTENTICACION', 'evidencia-2');
    await esperaError(archivo, 'AUTENTICACION', ID, Buffer.alloc(32, 7));
  });

  it('nunca entrega bytes del bloque alterado ni de los siguientes', async () => {
    const archivo = await cifrar(TRES_BLOQUES);
    archivo[CABECERA + BLOQUE_CIFRADO + 5] = (archivo[CABECERA + BLOQUE_CIFRADO + 5] as number) ^ 1;
    const recibido: Buffer[] = [];
    const destino = new Writable({
      write(trozo: Buffer, _codificacion, listo) {
        recibido.push(trozo);
        listo();
      },
    });
    await expect(
      pipeline(Readable.from([archivo]), crearDescifradorArchivo(CLAVE, ID), destino),
    ).rejects.toThrow(ErrorCripto);
    const entregado = Buffer.concat(recibido);
    expect(entregado.length).toBeLessThanOrEqual(TAMANO_BLOQUE);
    expect(entregado.equals(TRES_BLOQUES.subarray(0, entregado.length))).toBe(true);
  });

  it('rechaza un ID vacío y claves inválidas', () => {
    expect(() => crearCifradorArchivo(CLAVE, '')).toThrow(ErrorCripto);
    expect(() => crearDescifradorArchivo(CLAVE, '')).toThrow(ErrorCripto);
    expect(() => crearCifradorArchivo(Buffer.alloc(16), ID)).toThrow(ErrorCripto);
  });

  it('falla cerrado si el contador llega al límite del formato', () => {
    const prefijo = Buffer.alloc(7);
    expect(() => construirNonce(prefijo, 2 ** 32, false)).toThrow(ErrorCripto);
    expect(construirNonce(prefijo, 2 ** 32 - 1, true).toString('hex')).toBe(
      '00000000000000ffffffff01',
    );
  });
});

describe('Archivos · nonces', () => {
  it('no se repiten entre archivos ni entre bloques: claves y prefijos son únicos', async () => {
    const vistos = new Set<string>();
    const archivos = 2000;
    for (let i = 0; i < archivos; i++) {
      vistos.add((await cifrar(Buffer.alloc(1))).toString('hex', 5, CABECERA));
    }
    expect(vistos.size).toBe(archivos);
  });

  it('el último bloque nunca usa el nonce de uno intermedio', () => {
    const prefijo = Buffer.alloc(7, 1);
    expect(construirNonce(prefijo, 5, true).equals(construirNonce(prefijo, 5, false))).toBe(false);
    expect(construirNonce(prefijo, 5, false).equals(construirNonce(prefijo, 6, false))).toBe(false);
  });
});

describe('Archivos · streaming', () => {
  // 1 GiB en local; 64 MiB en CI para no hacerla lenta.
  const TAMANO = process.env.CI ? 64 * MIB : 1024 * MIB;
  const MAX_EN_VUELO = 16 * MIB;

  it(`${TAMANO / MIB} MiB pasan sin cargarse enteros en memoria`, async () => {
    const hashEntrada = createHash('sha256');
    const hashSalida = createHash('sha256');
    const patron = randomBytes(MIB);
    let generados = 0;
    let recibidos = 0;
    let enVueloMaximo = 0;
    let rssMaximo = 0;
    const rssInicial = process.memoryUsage.rss();

    const origen = Readable.from(
      (function* () {
        while (generados < TAMANO) {
          // Cambia el primer byte para que los trozos no sean idénticos.
          patron[0] = generados % 251;
          const trozo = Buffer.from(patron);
          hashEntrada.update(trozo);
          generados += trozo.length;
          yield trozo;
        }
      })(),
      { objectMode: false, highWaterMark: MIB },
    );
    const destino = new Writable({
      write(trozo: Buffer, _codificacion, listo) {
        hashSalida.update(trozo);
        recibidos += trozo.length;
        enVueloMaximo = Math.max(enVueloMaximo, generados - recibidos);
        rssMaximo = Math.max(rssMaximo, process.memoryUsage.rss());
        listo();
      },
    });

    await pipeline(
      origen,
      crearCifradorArchivo(CLAVE, ID),
      crearDescifradorArchivo(CLAVE, ID),
      destino,
    );

    expect(recibidos).toBe(TAMANO);
    expect(hashSalida.digest('hex')).toBe(hashEntrada.digest('hex'));
    // Determinista y válido para cualquier tamaño: lo generado y todavía no recibido.
    expect(enVueloMaximo).toBeLessThan(MAX_EN_VUELO);
    // Con 1 GiB, la memoria del proceso tampoco crece en proporción al archivo.
    if (TAMANO > 512 * MIB) expect(rssMaximo - rssInicial).toBeLessThan(512 * MIB);
  }, 600_000);
});
