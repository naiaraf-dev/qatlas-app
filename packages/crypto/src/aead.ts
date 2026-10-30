import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ErrorCripto } from './errores';
import { LONGITUD_CLAVE } from './kdf';

export const LONGITUD_NONCE = 12;
export const LONGITUD_TAG = 16;

/** AES-256-GCM sin formato. La usan `sellar`, los archivos por bloques y los vectores. */
export function aesGcmCifrar(clave: Buffer, nonce: Buffer, aad: Buffer, texto: Buffer) {
  const cifrador = createCipheriv('aes-256-gcm', clave, nonce, { authTagLength: LONGITUD_TAG });
  cifrador.setAAD(aad);
  const cifrado = Buffer.concat([cifrador.update(texto), cifrador.final()]);
  return { cifrado, tag: cifrador.getAuthTag() };
}

/**
 * Devuelve el texto solo si el tag es válido. GCM entrega bytes antes de verificar:
 * se retienen acá y se borran siempre, así nunca salen sin autenticar. El resultado
 * usa Buffer.alloc para que una clave descifrada no quede en el pool interno de Node.
 */
export function aesGcmDescifrar(
  clave: Buffer,
  nonce: Buffer,
  aad: Buffer,
  cifrado: Buffer,
  tag: Buffer,
): Buffer {
  let parcial: Buffer | undefined;
  try {
    const descifrador = createDecipheriv('aes-256-gcm', clave, nonce, {
      authTagLength: LONGITUD_TAG,
    });
    descifrador.setAAD(aad);
    descifrador.setAuthTag(tag);
    parcial = descifrador.update(cifrado);
    descifrador.final();
    const texto = Buffer.alloc(parcial.length);
    parcial.copy(texto);
    return texto;
  } catch {
    throw new ErrorCripto('AUTENTICACION');
  } finally {
    parcial?.fill(0);
  }
}

/** Para qué se usa un valor sellado. Va en el AAD: un valor no sirve para otro propósito. */
export const PROPOSITO = { MAESTRA: 1, PROYECTO: 2, CAMPO: 3 } as const;
export type Proposito = (typeof PROPOSITO)[keyof typeof PROPOSITO];

const VERSION_SELLADO = 1;
const LONGITUD_CABECERA = 2 + LONGITUD_NONCE; // versión, propósito, nonce
const DOMINIO_AAD = Buffer.from('qatlas.sellado', 'ascii');

function construirAad(proposito: Proposito, contexto: string): Buffer {
  if (contexto.length === 0) throw new ErrorCripto('PARAMETROS');
  return Buffer.concat([
    DOMINIO_AAD,
    Buffer.from([VERSION_SELLADO, proposito]),
    Buffer.from(contexto, 'utf8'),
  ]);
}

function validarClave(clave: Buffer): void {
  if (clave.length !== LONGITUD_CLAVE) throw new ErrorCripto('PARAMETROS');
}

/**
 * Formato: versión (1) | propósito (1) | nonce (12) | texto cifrado | tag (16).
 * El nonce es aleatorio. El contexto (por ejemplo, el ID del dueño) no se guarda:
 * quien abre debe conocerlo, y un valor movido a otro lugar no se autentica.
 */
export function sellar(
  clave: Buffer,
  proposito: Proposito,
  contexto: string,
  texto: Buffer,
): Buffer {
  validarClave(clave);
  const aad = construirAad(proposito, contexto);
  const nonce = randomBytes(LONGITUD_NONCE);
  const { cifrado, tag } = aesGcmCifrar(clave, nonce, aad, texto);
  return Buffer.concat([Buffer.from([VERSION_SELLADO, proposito]), nonce, cifrado, tag]);
}

export function abrir(
  clave: Buffer,
  proposito: Proposito,
  contexto: string,
  sellado: Buffer,
): Buffer {
  validarClave(clave);
  const aad = construirAad(proposito, contexto);
  if (sellado.length < LONGITUD_CABECERA + LONGITUD_TAG) throw new ErrorCripto('FORMATO');
  if (sellado[0] !== VERSION_SELLADO) throw new ErrorCripto('VERSION');
  if (sellado[1] !== proposito) throw new ErrorCripto('AUTENTICACION');
  const nonce = sellado.subarray(2, LONGITUD_CABECERA);
  const cifrado = sellado.subarray(LONGITUD_CABECERA, sellado.length - LONGITUD_TAG);
  const tag = sellado.subarray(sellado.length - LONGITUD_TAG);
  return aesGcmDescifrar(clave, nonce, aad, cifrado, tag);
}
