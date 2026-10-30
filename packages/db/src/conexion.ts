import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { ErrorBoveda } from './errores';

export type BaseCifrada = Database.Database;

const LONGITUD_CLAVE = 32;
const HEX = Buffer.from('0123456789abcdef', 'ascii');
const CABECERA_SQLITE = Buffer.from('SQLite format 3\0', 'latin1');

/**
 * Clave cruda con el formato x'…', como bytes. No pasa por un string de JavaScript, que no se
 * podría borrar: quien la recibe debe sobrescribirla.
 */
function claveCruda(clave: Buffer): Buffer {
  const salida = Buffer.alloc(clave.length * 2 + 3);
  salida.write("x'", 0, 'latin1');
  clave.forEach((byte, i) => {
    salida[2 + i * 2] = HEX[byte >> 4] as number;
    salida[3 + i * 2] = HEX[byte & 0x0f] as number;
  });
  salida.write("'", salida.length - 1, 'latin1');
  return salida;
}

/** Un archivo que empieza con la cabecera de SQLite está en texto plano. */
export function pareceSqlitePlano(cabecera: Buffer): boolean {
  return cabecera.subarray(0, CABECERA_SQLITE.length).equals(CABECERA_SQLITE);
}

/**
 * Abre o crea una base cifrada con SQLCipher y verifica que la clave sea la correcta y que
 * el cifrador sea el esperado. Falla cerrado: ante cualquier duda, cierra y lanza.
 */
export function abrirBaseCifrada(ruta: string, clave: Buffer): BaseCifrada {
  if (clave.length !== LONGITUD_CLAVE) throw new ErrorBoveda('BASE_INVALIDA');
  const cruda = claveCruda(clave);
  let base: BaseCifrada | undefined;
  try {
    base = new Database(ruta);
    // El cifrador se elige antes de la clave. legacy=4 es el formato de SQLCipher 4.
    base.pragma("cipher='sqlcipher'");
    base.pragma('legacy=4');
    base.key(cruda);
    // Primera lectura: con una clave incorrecta, acá falla.
    base.prepare('SELECT count(*) FROM sqlite_master').get();
    // Temporales solo en memoria y sin restos de lo borrado en las páginas libres.
    base.pragma('temp_store=MEMORY');
    base.pragma('secure_delete=ON');
    base.pragma('foreign_keys=ON');
    if (base.pragma('cipher', { simple: true }) !== 'sqlcipher') {
      throw new ErrorBoveda('BASE_INVALIDA');
    }
    return base;
  } catch {
    base?.close();
    throw new ErrorBoveda('BASE_INVALIDA');
  } finally {
    cruda.fill(0);
  }
}

/** Falla cerrado si, por un error de configuración, la base hubiera quedado en texto plano. */
export function verificarArchivoCifrado(ruta: string): void {
  if (pareceSqlitePlano(readFileSync(ruta).subarray(0, CABECERA_SQLITE.length))) {
    throw new ErrorBoveda('BASE_INVALIDA');
  }
}
