/**
 * KDF: vector oficial de Argon2id (RFC 9106, sección 5.3) contra la implementación
 * real, y validación de parámetros.
 */
import { describe, expect, it, vi } from 'vitest';
import { ErrorCripto } from './errores';
import { derivarKek, PARAMETROS_POR_DEFECTO, validarParametros, type ParametrosKdf } from './kdf';
import { argon2idReferencia } from './kdf-argon2';

const SALT = Buffer.alloc(16, 2);

describe('Argon2id · vector oficial RFC 9106', () => {
  it('coincide con la sección 5.3', async () => {
    const tag = await argon2idReferencia({
      contrasena: Buffer.alloc(32, 0x01),
      salt: Buffer.alloc(16, 0x02),
      secreto: Buffer.alloc(8, 0x03),
      datosAsociados: Buffer.alloc(12, 0x04),
      memoriaKiB: 32,
      iteraciones: 3,
      paralelismo: 4,
      longitud: 32,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('un error de la librería no filtra detalles', async () => {
    await expect(
      argon2idReferencia({
        contrasena: Buffer.from('x'),
        salt: Buffer.alloc(1),
        memoriaKiB: 1,
        iteraciones: 0,
        paralelismo: 1,
        longitud: 32,
      }),
    ).rejects.toMatchObject({ name: 'ErrorCripto', codigo: 'PARAMETROS' });
  });
});

describe('Parámetros de la KDF', () => {
  it('por defecto son los de la especificación 3.4', () => {
    expect(PARAMETROS_POR_DEFECTO).toMatchObject({ memoriaKiB: 65536, iteraciones: 3 });
    expect(() => {
      validarParametros(PARAMETROS_POR_DEFECTO);
    }).not.toThrow();
  });

  it('se pueden subir', () => {
    expect(() => {
      validarParametros({ ...PARAMETROS_POR_DEFECTO, memoriaKiB: 256 * 1024, iteraciones: 4 });
    }).not.toThrow();
  });

  it.each<[string, Partial<Record<keyof ParametrosKdf, unknown>>]>([
    ['memoria por debajo del piso', { memoriaKiB: 65535 }],
    ['memoria por encima del techo', { memoriaKiB: 2 ** 31 }],
    ['iteraciones por debajo del piso', { iteraciones: 2 }],
    ['iteraciones por encima del techo', { iteraciones: 65 }],
    ['sin paralelismo', { paralelismo: 0 }],
    ['paralelismo excesivo', { paralelismo: 17 }],
    ['valor no entero', { memoriaKiB: 65536.5 }],
    ['valor no numérico', { iteraciones: '3' }],
    ['algoritmo desconocido', { algoritmo: 'argon2i' }],
    ['versión desconocida', { version: 16 }],
  ])('rechaza %s', (_nombre, cambio) => {
    const parametros = { ...PARAMETROS_POR_DEFECTO, ...cambio } as ParametrosKdf;
    expect(() => {
      validarParametros(parametros);
    }).toThrow(ErrorCripto);
  });

  it('no llama a la implementación si los parámetros son inválidos', async () => {
    const implementacion = vi.fn(() => Promise.resolve(Buffer.alloc(32)));
    await expect(
      derivarKek(
        Buffer.from('x'),
        SALT,
        { ...PARAMETROS_POR_DEFECTO, iteraciones: 1 },
        implementacion,
      ),
    ).rejects.toThrow(ErrorCripto);
    expect(implementacion).not.toHaveBeenCalled();
  });

  it.each([
    ['contraseña vacía', Buffer.alloc(0), SALT],
    ['salt corto', Buffer.from('x'), Buffer.alloc(15)],
    ['salt largo', Buffer.from('x'), Buffer.alloc(17)],
  ])('rechaza %s', async (_nombre, contrasena, salt) => {
    const implementacion = vi.fn(() => Promise.resolve(Buffer.alloc(32)));
    await expect(
      derivarKek(contrasena, salt, PARAMETROS_POR_DEFECTO, implementacion),
    ).rejects.toThrow(ErrorCripto);
    expect(implementacion).not.toHaveBeenCalled();
  });
});
