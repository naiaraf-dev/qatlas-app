/**
 * AES-256-GCM: vectores oficiales (McGrew y Viega, "The Galois/Counter Mode of
 * Operation", casos 13 a 16), HKDF (RFC 5869) y formato sellado.
 */
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { abrir, aesGcmCifrar, aesGcmDescifrar, PROPOSITO, sellar } from './aead';
import { hkdf } from './claves';
import { ErrorCripto } from './errores';

const hex = (valor: string) => Buffer.from(valor, 'hex');

const CLAVE_GCM = 'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308';
const VECTORES = [
  {
    caso: 13,
    clave: '00'.repeat(32),
    nonce: '00'.repeat(12),
    aad: '',
    texto: '',
    cifrado: '',
    tag: '530f8afbc74536b9a963b4f1c4cb738b',
  },
  {
    caso: 14,
    clave: '00'.repeat(32),
    nonce: '00'.repeat(12),
    aad: '',
    texto: '00'.repeat(16),
    cifrado: 'cea7403d4d606b6e074ec5d3baf39d18',
    tag: 'd0d1c8a799996bf0265b98b5d48ab919',
  },
  {
    caso: 15,
    clave: CLAVE_GCM,
    nonce: 'cafebabefacedbaddecaf888',
    aad: '',
    texto:
      'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
      '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255',
    cifrado:
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
      '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad',
    tag: 'b094dac5d93471bdec1a502270e3cc6c',
  },
  {
    caso: 16,
    clave: CLAVE_GCM,
    nonce: 'cafebabefacedbaddecaf888',
    aad: 'feedfacedeadbeeffeedfacedeadbeefabaddad2',
    texto:
      'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a72' +
      '1c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
    cifrado:
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa' +
      '8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662',
    tag: '76fc6ece0f4e1768cddf8853bb2d551b',
  },
];

describe('AES-256-GCM · vectores oficiales', () => {
  it.each(VECTORES)('caso $caso: cifra', ({ clave, nonce, aad, texto, cifrado, tag }) => {
    const resultado = aesGcmCifrar(hex(clave), hex(nonce), hex(aad), hex(texto));
    expect(resultado.cifrado.toString('hex')).toBe(cifrado);
    expect(resultado.tag.toString('hex')).toBe(tag);
  });

  it.each(VECTORES)('caso $caso: descifra', ({ clave, nonce, aad, texto, cifrado, tag }) => {
    const resultado = aesGcmDescifrar(hex(clave), hex(nonce), hex(aad), hex(cifrado), hex(tag));
    expect(resultado.toString('hex')).toBe(texto);
  });
});

describe('HKDF-SHA-256 · vector oficial RFC 5869', () => {
  it('caso 1 con la primitiva que usa el paquete', () => {
    const okm = hkdfSync(
      'sha256',
      Buffer.alloc(22, 0x0b),
      hex('000102030405060708090a0b0c'),
      hex('f0f1f2f3f4f5f6f7f8f9'),
      42,
    );
    expect(Buffer.from(okm).toString('hex')).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('rechaza claves de longitud incorrecta', () => {
    expect(() => hkdf(Buffer.alloc(31), Buffer.alloc(0), 'x')).toThrow(ErrorCripto);
  });
});

describe('Formato sellado', () => {
  const CLAVE = Buffer.alloc(32, 7);
  const TEXTO = Buffer.from('dato de prueba');
  const CONTEXTO = 'contexto';
  const sellado = () => sellar(CLAVE, PROPOSITO.CAMPO, CONTEXTO, TEXTO);

  const codigoDe = (accion: () => unknown) => {
    try {
      accion();
    } catch (error) {
      return (error as ErrorCripto).codigo;
    }
    return 'SIN_ERROR';
  };
  const abrirCon = (valor: Buffer) => abrir(CLAVE, PROPOSITO.CAMPO, CONTEXTO, valor);

  it('ida y vuelta, incluso con texto vacío', () => {
    expect(abrirCon(sellado())).toEqual(TEXTO);
    const vacio = sellar(CLAVE, PROPOSITO.CAMPO, CONTEXTO, Buffer.alloc(0));
    expect(abrirCon(vacio).length).toBe(0);
  });

  it('el resultado no comparte memoria con el pool de Node', () => {
    expect(abrirCon(sellado()).buffer.byteLength).toBe(TEXTO.length);
  });

  it.each([
    ['versión (cabecera)', 0, 'VERSION'],
    ['propósito (cabecera)', 1, 'AUTENTICACION'],
    ['nonce', 2, 'AUTENTICACION'],
    ['texto cifrado', 14, 'AUTENTICACION'],
    ['tag', -1, 'AUTENTICACION'],
  ])('un bit alterado en %s falla', (_nombre, posicion, codigo) => {
    const valor = sellado();
    const indice = posicion < 0 ? valor.length + posicion : posicion;
    valor[indice] = (valor[indice] as number) ^ 1;
    expect(codigoDe(() => abrirCon(valor))).toBe(codigo);
  });

  it('todos los bits de todas las posiciones están protegidos', () => {
    const original = sellado();
    for (let bit = 0; bit < original.length * 8; bit++) {
      const valor = Buffer.from(original);
      const indice = bit >> 3;
      valor[indice] = (valor[indice] as number) ^ (1 << (bit & 7));
      expect(() => abrirCon(valor)).toThrow(ErrorCripto);
    }
  });

  it('rechaza un AAD distinto: otro contexto u otro propósito', () => {
    expect(codigoDe(() => abrir(CLAVE, PROPOSITO.CAMPO, 'otro', sellado()))).toBe('AUTENTICACION');
    expect(codigoDe(() => abrir(CLAVE, PROPOSITO.PROYECTO, CONTEXTO, sellado()))).toBe(
      'AUTENTICACION',
    );
  });

  it('rechaza otra clave', () => {
    expect(codigoDe(() => abrir(Buffer.alloc(32, 8), PROPOSITO.CAMPO, CONTEXTO, sellado()))).toBe(
      'AUTENTICACION',
    );
  });

  it('rechaza datos demasiado cortos', () => {
    expect(codigoDe(() => abrirCon(Buffer.alloc(29)))).toBe('FORMATO');
  });

  it('rechaza claves de longitud incorrecta y contexto vacío', () => {
    expect(codigoDe(() => sellar(Buffer.alloc(16), PROPOSITO.CAMPO, CONTEXTO, TEXTO))).toBe(
      'PARAMETROS',
    );
    expect(codigoDe(() => abrir(Buffer.alloc(16), PROPOSITO.CAMPO, CONTEXTO, sellado()))).toBe(
      'PARAMETROS',
    );
    expect(codigoDe(() => sellar(CLAVE, PROPOSITO.CAMPO, '', TEXTO))).toBe('PARAMETROS');
  });

  it('los nonces no se repiten en 200 000 operaciones', () => {
    const vistos = new Set<string>();
    const operaciones = 200_000;
    for (let i = 0; i < operaciones; i++) {
      vistos.add(sellar(CLAVE, PROPOSITO.CAMPO, CONTEXTO, TEXTO).toString('latin1', 2, 14));
    }
    expect(vistos.size).toBe(operaciones);
  }, 60_000);
});
