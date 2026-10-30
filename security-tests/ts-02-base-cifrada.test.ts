/**
 * TS-02 — Base cifrada (especificación 3.4 y 3.15).
 *
 * La base y la copia de seguridad no contienen texto legible de los datos cargados, y no abren sin
 * la clave. Se usa una carpeta temporal y una contraseña inventada: nunca la bóveda real del equipo.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { derivarClaveSqlcipher, abrirBoveda, contrasenaABuffer } from '@qatlas/crypto';
import { abrirBaseCifrada, leerCopia, leerSellada, rutasBoveda } from '@qatlas/db';
import { ServicioBoveda } from '../apps/desktop/src/main/boveda/servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const CANARIO = 'CANARIO-ts02-8f3a51c7e2';

let carpeta: string;
let boveda: ServicioBoveda;

/** Agrega el canario a la configuración y al esquema, con el acceso interno que tiene el servicio. */
function cargarCanario(): void {
  const base = (boveda as unknown as { base: Database.Database }).base;
  base.exec('CREATE TABLE datos_de_prueba (valor TEXT)');
  base.prepare('INSERT INTO datos_de_prueba VALUES (?)').run(CANARIO);
  boveda.cambiarConfiguracion({ idioma: CANARIO });
}

function archivosDeLaCarpeta(): string[] {
  return readdirSync(carpeta)
    .map((nombre) => path.join(carpeta, nombre))
    .filter((ruta) => statSync(ruta).isFile());
}

function contieneTexto(bytes: Buffer, texto: string): boolean {
  return (
    bytes.includes(Buffer.from(texto, 'utf8')) || bytes.includes(Buffer.from(texto, 'utf16le'))
  );
}

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts02-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  cargarCanario();
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('TS-02 · La base en disco', () => {
  it('ningún archivo de la carpeta contiene los datos, la contraseña ni la cabecera de SQLite', () => {
    boveda.bloquear();
    const archivos = archivosDeLaCarpeta();
    expect(archivos.length).toBeGreaterThanOrEqual(2);
    for (const archivo of archivos) {
      const bytes = readFileSync(archivo);
      expect(contieneTexto(bytes, CANARIO)).toBe(false);
      expect(contieneTexto(bytes, CONTRASENA)).toBe(false);
      expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
      expect(bytes.includes(Buffer.from('CREATE TABLE'))).toBe(false);
    }
  });

  it('sigue sin texto plano con la base abierta, sin archivos temporales visibles', () => {
    for (const archivo of archivosDeLaCarpeta()) {
      expect(contieneTexto(readFileSync(archivo), CANARIO)).toBe(false);
    }
  });

  it('no abre sin clave con SQLite', () => {
    boveda.bloquear();
    const base = new Database(rutasBoveda(carpeta).base);
    expect(() => base.prepare('SELECT * FROM sqlite_master').all()).toThrow();
    base.close();
  });

  it('no abre con una clave incorrecta', () => {
    boveda.bloquear();
    expect(() => abrirBaseCifrada(rutasBoveda(carpeta).base, randomBytes(32))).toThrow();
  });

  it('la clave se usa cruda: abre también con la forma estándar de SQLCipher', async () => {
    boveda.bloquear();
    const rutas = rutasBoveda(carpeta);
    const maestra = await abrirBoveda(contrasenaABuffer(CONTRASENA), leerSellada(rutas.sellada));
    const hex = derivarClaveSqlcipher(maestra).toString('hex');
    const base = new Database(rutas.base);
    base.pragma("cipher='sqlcipher'");
    base.pragma('legacy=4');
    base.pragma(`key="x'${hex}'"`);
    expect(base.prepare('SELECT valor FROM datos_de_prueba').get()).toEqual({ valor: CANARIO });
    base.close();
  });

  it('el archivo sellado no contiene la clave maestra en claro', async () => {
    boveda.bloquear();
    const rutas = rutasBoveda(carpeta);
    const maestra = await abrirBoveda(contrasenaABuffer(CONTRASENA), leerSellada(rutas.sellada));
    const sellado = readFileSync(rutas.sellada);
    expect(sellado.includes(maestra)).toBe(false);
    expect(contieneTexto(sellado, maestra.toString('base64'))).toBe(false);
    expect(contieneTexto(sellado, maestra.toString('hex'))).toBe(false);
  });
});

describe('TS-02 · La copia de seguridad', () => {
  const destino = () => path.join(carpeta, 'copia.qatlas');

  it('no contiene texto plano', () => {
    boveda.crearCopia(destino());
    const bytes = readFileSync(destino());
    expect(contieneTexto(bytes, CANARIO)).toBe(false);
    expect(contieneTexto(bytes, CONTRASENA)).toBe(false);
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(bytes.includes(Buffer.from('CREATE TABLE'))).toBe(false);
  });

  it('no deja temporales sin cifrar en la carpeta', () => {
    boveda.crearCopia(destino());
    for (const archivo of archivosDeLaCarpeta()) {
      expect(contieneTexto(readFileSync(archivo), CANARIO)).toBe(false);
    }
    expect(readdirSync(carpeta).some((n) => n.includes('.tmp-'))).toBe(false);
  });

  it('su base no abre sin clave ni con otra clave', () => {
    boveda.crearCopia(destino());
    const extraida = path.join(carpeta, 'extraida.db');
    writeFileSync(extraida, leerCopia(destino()).base);

    const base = new Database(extraida);
    expect(() => base.prepare('SELECT * FROM sqlite_master').all()).toThrow();
    base.close();
    expect(() => abrirBaseCifrada(extraida, randomBytes(32))).toThrow();
  });

  it('solo se recupera con la contraseña correcta', async () => {
    boveda.crearCopia(destino());
    const incorrecta = 'cometa-verde-sobre-el-rio-58';
    expect(await boveda.restaurar(destino(), incorrecta)).toEqual({ resultado: 'rechazada' });
    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'restaurada' });
    const base = (boveda as unknown as { base: Database.Database }).base;
    expect(base.prepare('SELECT valor FROM datos_de_prueba').get()).toEqual({ valor: CANARIO });
  });
});
