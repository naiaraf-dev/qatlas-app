import { randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { aesGcmCifrar, aesGcmDescifrar, LONGITUD_TAG } from './aead';
import { derivarSubclaveArchivos, hkdf } from './claves';
import { ErrorCripto } from './errores';
import { borrar } from './memoria';

/*
 * Formato v2: construcción STREAM (Hoang, Reyhanitabar, Rogaway y Vizár, 2015), con la
 * misma disposición que AES-GCM-HKDF streaming de Tink. Detalle en el README.
 *
 *   cabecera: "QATF" (4) | versión (1) | salt (32) | prefijo de nonce (7)
 *   bloques:  texto cifrado (hasta 64 KiB) | tag (16)
 *   nonce:    prefijo (7) | contador big-endian (4) | ¿es el último? (1)
 *   AAD:      cabecera completa
 *   clave:    HKDF(HKDF(subclave de archivos, semilla, "qatlas/v2/evidencia/<id>"),
 *                  salt, "qatlas/v2/archivo/<id>")
 *
 * La semilla (32 bytes aleatorios por evidencia) no va en el archivo: se guarda en la base. Borrarla
 * es el borrado criptográfico de esa evidencia (EVI-06), aunque la clave del proyecto siga viva; y
 * borrar la clave del proyecto lo es de todas (TS-10). Hacen falta las dos para descifrar (ADR 035).
 * La v1 (sin semilla) nunca guardó evidencias y se rechaza.
 */
const MAGIC = Buffer.from('QATF', 'ascii');
const VERSION_ARCHIVO = 2;
export const LONGITUD_SEMILLA = 32;
const LONGITUD_SALT_ARCHIVO = 32;
const LONGITUD_PREFIJO = 7;
const POS_SALT = MAGIC.length + 1;
const POS_PREFIJO = POS_SALT + LONGITUD_SALT_ARCHIVO;
const LONGITUD_CABECERA = POS_PREFIJO + LONGITUD_PREFIJO;

export const TAMANO_BLOQUE = 64 * 1024;
const MAX_BLOQUES = 2 ** 32;

/** La clave depende de la semilla, del salt y del ID: cada archivo tiene la suya. */
function derivarClaveArchivo(
  subclaveArchivos: Buffer,
  semilla: Buffer,
  salt: Buffer,
  idArchivo: string,
): Buffer {
  const deLaEvidencia = hkdf(subclaveArchivos, semilla, `qatlas/v2/evidencia/${idArchivo}`);
  try {
    return hkdf(deLaEvidencia, salt, `qatlas/v2/archivo/${idArchivo}`);
  } finally {
    borrar(deLaEvidencia);
  }
}

/** Una semilla nueva para una evidencia. Se guarda en la base, nunca junto al archivo. */
export function crearSemillaEvidencia(): Buffer {
  return randomBytes(LONGITUD_SEMILLA);
}

/** Exportada para probar el límite del contador, que no se alcanza en un test real. */
export function construirNonce(prefijo: Buffer, contador: number, ultimo: boolean): Buffer {
  if (contador >= MAX_BLOQUES) throw new ErrorCripto('PARAMETROS');
  const nonce = Buffer.alloc(LONGITUD_PREFIJO + 5);
  prefijo.copy(nonce);
  nonce.writeUInt32BE(contador, LONGITUD_PREFIJO);
  nonce[LONGITUD_PREFIJO + 4] = ultimo ? 1 : 0;
  return nonce;
}

/** Junta la entrada en bloques fijos y procesa uno recién cuando sabe si es el último. */
abstract class TransformadorPorBloques extends Transform {
  protected subclave: Buffer;
  protected semilla: Buffer;
  protected clave: Buffer | null = null;
  protected cabecera: Buffer | null = null;
  protected contador = 0;
  private readonly pendiente: Buffer;
  private usado = 0;

  protected constructor(
    claveProyecto: Buffer,
    idArchivo: string,
    semilla: Buffer,
    tamanoBloque: number,
  ) {
    super();
    if (idArchivo.length === 0) throw new ErrorCripto('PARAMETROS');
    if (semilla.length !== LONGITUD_SEMILLA) throw new ErrorCripto('PARAMETROS');
    this.subclave = derivarSubclaveArchivos(claveProyecto);
    // Copia propia: quien llama puede borrar la suya enseguida.
    this.semilla = Buffer.from(semilla);
    this.pendiente = Buffer.alloc(tamanoBloque);
  }

  protected abstract procesarBloque(bloque: Buffer, ultimo: boolean): Buffer;

  /** Consume lo que necesite antes de los bloques (la cabecera) y devuelve el resto. */
  protected prepararEntrada(entrada: Buffer): Buffer {
    return entrada;
  }

  /** Control previo al bloque final. */
  protected prepararFin(): void {
    // Sin controles por defecto.
  }

  private emitirBloque(ultimo: boolean): void {
    const salida = this.procesarBloque(this.pendiente.subarray(0, this.usado), ultimo);
    this.contador += 1;
    this.usado = 0;
    this.push(salida);
  }

  override _transform(trozo: Buffer, _codificacion: string, listo: TransformCallback): void {
    try {
      const entrada = this.prepararEntrada(trozo);
      let posicion = 0;
      while (posicion < entrada.length) {
        if (this.usado === this.pendiente.length) this.emitirBloque(false);
        const copiados = entrada.copy(this.pendiente, this.usado, posicion);
        this.usado += copiados;
        posicion += copiados;
      }
      listo();
    } catch (error) {
      listo(error as Error);
    }
  }

  override _flush(listo: TransformCallback): void {
    try {
      this.prepararFin();
      this.emitirBloque(true);
      listo();
    } catch (error) {
      listo(error as Error);
    }
  }

  override _destroy(error: Error | null, listo: (error?: Error | null) => void): void {
    borrar(this.subclave, this.semilla, this.clave, this.pendiente);
    listo(error);
  }
}

class CifradorArchivo extends TransformadorPorBloques {
  private cabeceraEmitida = false;

  constructor(claveProyecto: Buffer, idArchivo: string, semilla: Buffer) {
    super(claveProyecto, idArchivo, semilla, TAMANO_BLOQUE);
    const salt = randomBytes(LONGITUD_SALT_ARCHIVO);
    this.clave = derivarClaveArchivo(this.subclave, this.semilla, salt, idArchivo);
    this.cabecera = Buffer.concat([
      MAGIC,
      Buffer.from([VERSION_ARCHIVO]),
      salt,
      randomBytes(LONGITUD_PREFIJO),
    ]);
  }

  protected override procesarBloque(bloque: Buffer, ultimo: boolean): Buffer {
    const cabecera = this.cabecera as Buffer;
    const nonce = construirNonce(cabecera.subarray(POS_PREFIJO), this.contador, ultimo);
    const { cifrado, tag } = aesGcmCifrar(this.clave as Buffer, nonce, cabecera, bloque);
    const partes = this.cabeceraEmitida ? [cifrado, tag] : [cabecera, cifrado, tag];
    this.cabeceraEmitida = true;
    return Buffer.concat(partes);
  }
}

class DescifradorArchivo extends TransformadorPorBloques {
  private readonly leida = Buffer.alloc(LONGITUD_CABECERA);
  private usadoCabecera = 0;

  constructor(
    claveProyecto: Buffer,
    private readonly idArchivo: string,
    semilla: Buffer,
  ) {
    super(claveProyecto, idArchivo, semilla, TAMANO_BLOQUE + LONGITUD_TAG);
  }

  // La versión se valida apenas se puede leer, antes de usar ningún otro campo.
  protected override prepararEntrada(entrada: Buffer): Buffer {
    if (this.cabecera) return entrada;
    const copiados = entrada.copy(this.leida, this.usadoCabecera);
    this.usadoCabecera += copiados;
    if (this.usadoCabecera < LONGITUD_CABECERA) return Buffer.alloc(0);
    if (!this.leida.subarray(0, MAGIC.length).equals(MAGIC)) throw new ErrorCripto('FORMATO');
    if (this.leida[MAGIC.length] !== VERSION_ARCHIVO) throw new ErrorCripto('VERSION');
    this.cabecera = this.leida;
    const salt = this.leida.subarray(POS_SALT, POS_PREFIJO);
    this.clave = derivarClaveArchivo(this.subclave, this.semilla, salt, this.idArchivo);
    return entrada.subarray(copiados);
  }

  protected override prepararFin(): void {
    if (!this.cabecera) throw new ErrorCripto('FORMATO');
  }

  protected override procesarBloque(bloque: Buffer, ultimo: boolean): Buffer {
    if (bloque.length < LONGITUD_TAG) throw new ErrorCripto('AUTENTICACION');
    const cabecera = this.cabecera as Buffer;
    const nonce = construirNonce(cabecera.subarray(POS_PREFIJO), this.contador, ultimo);
    const finCifrado = bloque.length - LONGITUD_TAG;
    return aesGcmDescifrar(
      this.clave as Buffer,
      nonce,
      cabecera,
      bloque.subarray(0, finCifrado),
      bloque.subarray(finCifrado),
    );
  }
}

/**
 * Stream que recibe texto plano y entrega el archivo cifrado. `idArchivo` es el ID de
 * la evidencia y `semilla`, la suya (`crearSemillaEvidencia`). Deriva lo que necesita al
 * crearse: `claveProyecto` y `semilla` se pueden borrar después.
 */
export function crearCifradorArchivo(
  claveProyecto: Buffer,
  idArchivo: string,
  semilla: Buffer,
): Transform {
  return new CifradorArchivo(claveProyecto, idArchivo, semilla);
}

/**
 * Stream que recibe el archivo cifrado y entrega solo bloques ya autenticados.
 *
 * Una alteración o un truncamiento pueden detectarse recién al final: **hasta que el
 * stream termine sin error, lo recibido no es válido** y hay que descartarlo.
 */
export function crearDescifradorArchivo(
  claveProyecto: Buffer,
  idArchivo: string,
  semilla: Buffer,
): Transform {
  return new DescifradorArchivo(claveProyecto, idArchivo, semilla);
}
