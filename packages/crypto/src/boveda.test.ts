/**
 * Jerarquía de claves: bóveda, cambio de contraseña, claves de proyecto, subclaves,
 * campos e higiene de memoria.
 */
import { describe, expect, it } from 'vitest';
import { abrirBoveda, cambiarContrasena, crearBoveda, type BovedaSellada } from './boveda';
import { cifrarCampo, descifrarCampo } from './campos';
import {
  abrirClaveProyecto,
  crearClaveProyecto,
  derivarClaveSqlcipher,
  derivarSubclaveArchivos,
  derivarSubclaveCampos,
} from './claves';
import { ErrorCripto } from './errores';
import { PARAMETROS_POR_DEFECTO, type ImplementacionArgon2id } from './kdf';
import { argon2idReferencia } from './kdf-argon2';
import { borrar, contrasenaABuffer, igualesEnTiempoConstante } from './memoria';

const CONTRASENA = () => contrasenaABuffer('una contraseña larga de prueba');
const OTRA = () => contrasenaABuffer('otra contraseña larga de prueba');
const ceros = (buffer: Buffer) => buffer.every((byte) => byte === 0);

describe('Bóveda', () => {
  it('ida y vuelta con la clave maestra de 256 bits', async () => {
    const { sellada, maestra } = await crearBoveda(CONTRASENA());
    expect(maestra.length).toBe(32);
    expect(await abrirBoveda(CONTRASENA(), sellada)).toEqual(maestra);
  });

  it('guarda los parámetros y un salt de 16 bytes junto al resultado', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    expect(sellada.kdf).toEqual(PARAMETROS_POR_DEFECTO);
    expect(sellada.salt.length).toBe(16);
  });

  it('dos bóvedas con la misma contraseña no comparten salt ni clave', async () => {
    const a = await crearBoveda(CONTRASENA());
    const b = await crearBoveda(CONTRASENA());
    expect(a.sellada.salt).not.toEqual(b.sellada.salt);
    expect(a.maestra).not.toEqual(b.maestra);
  });

  it('rechaza una contraseña incorrecta sin detalles', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    await expect(abrirBoveda(OTRA(), sellada)).rejects.toMatchObject({
      codigo: 'AUTENTICACION',
      message: 'No se pudieron autenticar los datos.',
    });
  });

  it('rechaza una versión desconocida', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    await expect(abrirBoveda(CONTRASENA(), { ...sellada, version: 2 })).rejects.toMatchObject({
      codigo: 'VERSION',
    });
  });

  it('rechaza una rebaja de parámetros antes de derivar', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    const rebajada: BovedaSellada = { ...sellada, kdf: { ...sellada.kdf, iteraciones: 1 } };
    await expect(abrirBoveda(CONTRASENA(), rebajada)).rejects.toMatchObject({
      codigo: 'PARAMETROS',
    });
  });

  it('los parámetros y el salt están autenticados', async () => {
    const implementacionFija: ImplementacionArgon2id = () => Promise.resolve(Buffer.alloc(32, 5));
    const opciones = { implementacion: implementacionFija };
    const { sellada } = await crearBoveda(CONTRASENA(), opciones);
    const subida: BovedaSellada = { ...sellada, kdf: { ...sellada.kdf, iteraciones: 4 } };
    const otroSalt: BovedaSellada = { ...sellada, salt: Buffer.alloc(16, 9) };
    // La KEK es la misma a propósito: solo el AAD puede detectar el cambio.
    await expect(abrirBoveda(CONTRASENA(), subida, implementacionFija)).rejects.toMatchObject({
      codigo: 'AUTENTICACION',
    });
    await expect(abrirBoveda(CONTRASENA(), otroSalt, implementacionFija)).rejects.toMatchObject({
      codigo: 'AUTENTICACION',
    });
  });

  it('acepta otra implementación detrás de la interfaz, con el mismo resultado', async () => {
    const llamadas: number[] = [];
    const envuelta: ImplementacionArgon2id = (entrada) => {
      llamadas.push(entrada.memoriaKiB);
      return argon2idReferencia(entrada);
    };
    const { sellada, maestra } = await crearBoveda(CONTRASENA(), { implementacion: envuelta });
    expect(llamadas).toEqual([65536]);
    expect(await abrirBoveda(CONTRASENA(), sellada)).toEqual(maestra);
  });
});

describe('Cambio de contraseña', () => {
  it('conserva la clave maestra y deja de aceptar la contraseña vieja', async () => {
    const { sellada, maestra } = await crearBoveda(CONTRASENA());
    const nueva = await cambiarContrasena(CONTRASENA(), OTRA(), sellada);
    expect(await abrirBoveda(OTRA(), nueva)).toEqual(maestra);
    await expect(abrirBoveda(CONTRASENA(), nueva)).rejects.toThrow(ErrorCripto);
    expect(nueva.salt).not.toEqual(sellada.salt);
  });

  it('los datos de un proyecto siguen abriéndose sin recifrarlos', async () => {
    const { sellada, maestra } = await crearBoveda(CONTRASENA());
    const { clave, envuelta } = crearClaveProyecto(maestra, 'proyecto-1');
    const nueva = await cambiarContrasena(CONTRASENA(), OTRA(), sellada);
    const reabierta = await abrirBoveda(OTRA(), nueva);
    expect(abrirClaveProyecto(reabierta, 'proyecto-1', envuelta)).toEqual(clave);
  });

  it('exige la contraseña actual', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    await expect(cambiarContrasena(OTRA(), OTRA(), sellada)).rejects.toMatchObject({
      codigo: 'AUTENTICACION',
    });
  });

  it('permite subir los parámetros', async () => {
    const { sellada, maestra } = await crearBoveda(CONTRASENA());
    const parametros = { ...PARAMETROS_POR_DEFECTO, iteraciones: 4 };
    const nueva = await cambiarContrasena(CONTRASENA(), CONTRASENA(), sellada, { parametros });
    expect(nueva.kdf.iteraciones).toBe(4);
    expect(await abrirBoveda(CONTRASENA(), nueva)).toEqual(maestra);
  });

  it('LIMITACIÓN documentada: una copia vieja sigue abriéndose con la contraseña vieja', async () => {
    const { sellada, maestra } = await crearBoveda(CONTRASENA());
    await cambiarContrasena(CONTRASENA(), OTRA(), sellada);
    expect(await abrirBoveda(CONTRASENA(), sellada)).toEqual(maestra);
  });
});

describe('Claves de proyecto', () => {
  const MAESTRA = Buffer.alloc(32, 1);

  it('ida y vuelta; cada proyecto tiene su clave', () => {
    const a = crearClaveProyecto(MAESTRA, 'a');
    const b = crearClaveProyecto(MAESTRA, 'b');
    expect(abrirClaveProyecto(MAESTRA, 'a', a.envuelta)).toEqual(a.clave);
    expect(a.clave).not.toEqual(b.clave);
  });

  it('la envoltura de un proyecto no sirve para otro', () => {
    const { envuelta } = crearClaveProyecto(MAESTRA, 'a');
    expect(() => abrirClaveProyecto(MAESTRA, 'b', envuelta)).toThrow(ErrorCripto);
  });

  it('otra clave maestra no la abre', () => {
    const { envuelta } = crearClaveProyecto(MAESTRA, 'a');
    expect(() => abrirClaveProyecto(Buffer.alloc(32, 2), 'a', envuelta)).toThrow(ErrorCripto);
  });
});

describe('Subclaves', () => {
  it('nunca la misma clave para dos usos', () => {
    const raiz = Buffer.alloc(32, 3);
    const claves = [
      raiz,
      derivarClaveSqlcipher(raiz),
      derivarSubclaveArchivos(raiz),
      derivarSubclaveCampos(raiz),
    ].map((clave) => clave.toString('hex'));
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('son deterministas: la base de datos se reabre tras reiniciar', () => {
    const raiz = Buffer.alloc(32, 3);
    expect(derivarClaveSqlcipher(raiz)).toEqual(derivarClaveSqlcipher(raiz));
  });
});

describe('Cifrado de campo', () => {
  const PROYECTO = Buffer.alloc(32, 4);
  const SECRETO = Buffer.from('s3creto');

  it('ida y vuelta', () => {
    const sellado = cifrarCampo(PROYECTO, 'credencial:1:secreto', SECRETO);
    expect(descifrarCampo(PROYECTO, 'credencial:1:secreto', sellado)).toEqual(SECRETO);
  });

  it('un valor copiado a otro campo o a otro proyecto no se abre', () => {
    const sellado = cifrarCampo(PROYECTO, 'credencial:1:secreto', SECRETO);
    expect(() => descifrarCampo(PROYECTO, 'credencial:2:secreto', sellado)).toThrow(ErrorCripto);
    expect(() => descifrarCampo(Buffer.alloc(32, 5), 'credencial:1:secreto', sellado)).toThrow(
      ErrorCripto,
    );
  });

  it('la clave de proyecto sola no abre un campo: usa su subclave', () => {
    const sellado = cifrarCampo(PROYECTO, 'c', SECRETO);
    expect(() => descifrarCampo(derivarSubclaveCampos(PROYECTO), 'c', sellado)).toThrow(
      ErrorCripto,
    );
  });
});

describe('Higiene de memoria', () => {
  it('la KEK se sobrescribe con ceros al crear, abrir y cambiar', async () => {
    const entregadas: Buffer[] = [];
    const implementacion: ImplementacionArgon2id = () => {
      const kek = Buffer.alloc(32, 9);
      entregadas.push(kek);
      return Promise.resolve(kek);
    };
    const { sellada } = await crearBoveda(CONTRASENA(), { implementacion });
    await abrirBoveda(CONTRASENA(), sellada, implementacion);
    await cambiarContrasena(CONTRASENA(), OTRA(), sellada, { implementacion });
    expect(entregadas.length).toBe(4);
    expect(entregadas.every(ceros)).toBe(true);
  });

  it('la KEK se borra también si la contraseña es incorrecta', async () => {
    const { sellada } = await crearBoveda(CONTRASENA());
    let kek = Buffer.alloc(0);
    const implementacion: ImplementacionArgon2id = () => {
      kek = Buffer.alloc(32, 9);
      return Promise.resolve(kek);
    };
    await expect(abrirBoveda(CONTRASENA(), sellada, implementacion)).rejects.toThrow(ErrorCripto);
    expect(ceros(kek)).toBe(true);
  });

  it('si falla la derivación no se devuelve clave maestra', async () => {
    const implementacion: ImplementacionArgon2id = () => Promise.reject(new Error('interno'));
    await expect(crearBoveda(CONTRASENA(), { implementacion })).rejects.toThrow('interno');
  });

  it('borrar sobrescribe y tolera valores ausentes', () => {
    const clave = Buffer.alloc(32, 1);
    borrar(clave, null, undefined);
    expect(ceros(clave)).toBe(true);
  });

  it('contrasenaABuffer normaliza a NFC y no usa el pool de Node', () => {
    const compuesta = contrasenaABuffer('café');
    const descompuesta = contrasenaABuffer('café');
    expect(compuesta).toEqual(descompuesta);
    expect(compuesta.buffer.byteLength).toBe(compuesta.length);
  });
});

describe('Comparación en tiempo constante', () => {
  it('compara contenido y longitud', () => {
    expect(igualesEnTiempoConstante(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(igualesEnTiempoConstante(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(igualesEnTiempoConstante(Buffer.from('abc'), Buffer.from('ab'))).toBe(false);
  });
});
