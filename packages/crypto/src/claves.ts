import { hkdfSync, randomBytes } from 'node:crypto';
import { abrir, PROPOSITO, sellar } from './aead';
import { ErrorCripto } from './errores';
import { LONGITUD_CLAVE } from './kdf';
import { borrar } from './memoria';

type UsoSubclave = 'sqlcipher' | 'envoltura-proyectos' | 'archivos' | 'campos';

const SIN_SALT = Buffer.alloc(0);

/** HKDF-SHA-256 (RFC 5869). `info` separa los usos: nunca la misma clave para dos. */
export function hkdf(clave: Buffer, salt: Buffer, info: string): Buffer {
  if (clave.length !== LONGITUD_CLAVE) throw new ErrorCripto('PARAMETROS');
  return Buffer.from(hkdfSync('sha256', clave, salt, info, LONGITUD_CLAVE));
}

// Sin salt: la clave de entrada ya es uniforme y aleatoria (RFC 5869, sección 3.1).
function subclave(raiz: Buffer, uso: UsoSubclave): Buffer {
  return hkdf(raiz, SIN_SALT, `qatlas/v1/${uso}`);
}

/** Clave de SQLCipher (semana 3). Quien la recibe debe borrarla. */
export function derivarClaveSqlcipher(maestra: Buffer): Buffer {
  return subclave(maestra, 'sqlcipher');
}

export function derivarSubclaveArchivos(claveProyecto: Buffer): Buffer {
  return subclave(claveProyecto, 'archivos');
}

export function derivarSubclaveCampos(claveProyecto: Buffer): Buffer {
  return subclave(claveProyecto, 'campos');
}

export interface ClaveProyectoNueva {
  /** En claro: quien la recibe debe borrarla. */
  clave: Buffer;
  /** Lo único que se guarda. Destruirla es el borrado criptográfico del proyecto. */
  envuelta: Buffer;
}

/** Clave aleatoria del proyecto, envuelta con una subclave de la maestra y atada a su ID. */
export function crearClaveProyecto(maestra: Buffer, idProyecto: string): ClaveProyectoNueva {
  const clave = randomBytes(LONGITUD_CLAVE);
  const envoltura = subclave(maestra, 'envoltura-proyectos');
  try {
    return { clave, envuelta: sellar(envoltura, PROPOSITO.PROYECTO, idProyecto, clave) };
  } finally {
    borrar(envoltura);
  }
}

export function abrirClaveProyecto(maestra: Buffer, idProyecto: string, envuelta: Buffer): Buffer {
  const envoltura = subclave(maestra, 'envoltura-proyectos');
  try {
    return abrir(envoltura, PROPOSITO.PROYECTO, idProyecto, envuelta);
  } finally {
    borrar(envoltura);
  }
}
