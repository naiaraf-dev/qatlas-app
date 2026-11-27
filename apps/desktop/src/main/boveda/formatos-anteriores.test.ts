/**
 * Las bóvedas de formatos anteriores tienen que abrir (ADR 006). Regla: toda actualización de
 * better-sqlite3-multiple-ciphers (SQLCipher) tiene que pasar este test, con cada fixture de
 * `fixtures/`. Los fixtures quedan para siempre: nunca se regeneran ni se borran.
 *
 * Cada fixture se creó con la versión de su nombre, con datos y contraseñas inventados:
 *
 * - `base-clave-cruda/boveda.db`: una base SQLCipher abierta como la abre la app (`cipher='sqlcipher'`,
 *   `legacy=4`, clave cruda `x'…'`), migrada y con una configuración conocida. La clave sale del SHA-256
 *   de una frase inventada: no hay una clave escrita en el repo.
 * - `boveda-completa/`: una bóveda creada por `ServicioBoveda` con una contraseña inventada (Argon2id y
 *   la clave maestra envuelta), con una configuración conocida.
 *
 * Los tests abren una copia en una carpeta temporal: el fixture no se toca. Corren en Node y dentro de
 * Electron (`npm run test:crypto:electron`).
 *
 * Para crear el fixture de una versión nueva (solo antes de actualizar, con la versión vieja instalada):
 *   QATLAS_GENERAR_FIXTURE_SQLCIPHER=1 npx vitest run apps/desktop/src/main/boveda/formatos-anteriores
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { redactarTexto } from '@qatlas/redaction';
import {
  abrirBaseCifrada,
  guardarConfiguracion,
  inicializarDatos,
  leerConfiguracion,
  migrar,
} from '@qatlas/db';
import { afterEach, describe, expect, it } from 'vitest';
import { ServicioBoveda } from './servicio';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
/** Inventada. La misma de los E2E. */
const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const CLAVE_CRUDA = createHash('sha256')
  .update('qatlas: clave inventada del fixture de SQLCipher')
  .digest();
/** Lo que cada fixture guardó en su configuración, para comprobar que se lee. */
const CONFIGURACION_BASE = { tema: 'dark', bloqueoMinutos: 42 } as const;
const CONFIGURACION_BOVEDA = { tema: 'light', retencionDias: 33 } as const;

const versionInstalada = (): string =>
  (
    createRequire(import.meta.url)('better-sqlite3-multiple-ciphers/package.json') as {
      version: string;
    }
  ).version;

let temporales: string[] = [];
afterEach(() => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true });
  temporales = [];
});

/** Una copia del fixture en una carpeta temporal: abrir migra y escribe, el original no se toca. */
function copia(origen: string): string {
  const destino = mkdtempSync(path.join(os.tmpdir(), 'qatlas-formato-'));
  temporales.push(destino);
  cpSync(origen, destino, { recursive: true });
  return destino;
}

const versiones = existsSync(FIXTURES)
  ? readdirSync(FIXTURES).filter((n) => n.startsWith('sqlcipher-'))
  : [];

describe('Bóvedas de formatos anteriores (ADR 006)', () => {
  it('hay al menos un fixture: si no, este test no prueba nada', () => {
    expect(versiones.length).toBeGreaterThan(0);
  });

  describe.each(versiones)('%s', (version) => {
    const carpeta = path.join(FIXTURES, version);

    it('la base con clave cruda abre, se lee, se escribe y vuelve a abrir', () => {
      const ruta = path.join(copia(path.join(carpeta, 'base-clave-cruda')), 'boveda.db');
      const base = abrirBaseCifrada(ruta, CLAVE_CRUDA);
      try {
        migrar(base);
        expect(leerConfiguracion(base)).toMatchObject(CONFIGURACION_BASE);
        guardarConfiguracion(base, { bloqueoMinutos: 7 });
      } finally {
        base.close();
      }
      const otra = abrirBaseCifrada(ruta, CLAVE_CRUDA);
      try {
        expect(leerConfiguracion(otra).bloqueoMinutos).toBe(7);
      } finally {
        otra.close();
      }
    });

    it('con otra clave no abre: sigue cifrada', () => {
      const ruta = path.join(copia(path.join(carpeta, 'base-clave-cruda')), 'boveda.db');
      const otraClave = createHash('sha256').update('otra clave').digest();
      expect(() => abrirBaseCifrada(ruta, otraClave)).toThrow();
      // Y no tiene la cabecera de SQLite en claro.
      expect(readFileSync(ruta).subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\0');
    });

    it('la bóveda completa se desbloquea con su contraseña, y no con otra', async () => {
      const servicio = new ServicioBoveda({
        carpeta: copia(path.join(carpeta, 'boveda-completa')),
      });
      try {
        expect(servicio.estado()).toBe('bloqueada');
        expect((await servicio.desbloquear('otra-contrasena-cualquiera-12')).resultado).not.toBe(
          'desbloqueada',
        );
        expect((await servicio.desbloquear(CONTRASENA)).resultado).toBe('desbloqueada');
        expect(servicio.configuracion()).toMatchObject(CONFIGURACION_BOVEDA);
        servicio.cambiarConfiguracion({ bloqueoMinutos: 9 });
        expect(servicio.configuracion().bloqueoMinutos).toBe(9);
      } finally {
        servicio.bloquear();
      }
    }, 60_000);

    it('el fixture es chico, y el detector de secretos no encuentra nada en lo que es texto', () => {
      let total = 0;
      for (const nombre of readdirSync(carpeta, { recursive: true }) as string[]) {
        const ruta = path.join(carpeta, nombre);
        if (!statSync(ruta).isFile()) continue;
        total += statSync(ruta).size;
        const datos = readFileSync(ruta);
        if (datos.includes(0)) continue;
        const { registros } = redactarTexto(datos.toString('utf8'));
        expect(registros, nombre).toEqual([]);
      }
      expect(total).toBeLessThan(512 * 1024);
    });
  });
});

describe.runIf(process.env.QATLAS_GENERAR_FIXTURE_SQLCIPHER === '1')(
  'Generar el fixture de la versión instalada',
  () => {
    it('crea fixtures/sqlcipher-<versión>, si todavía no existe', async () => {
      const destino = path.join(FIXTURES, `sqlcipher-${versionInstalada()}`);
      // Nunca se pisa: un fixture existente es la prueba de un formato anterior.
      expect(existsSync(destino), `${destino} ya existe`).toBe(false);

      const conBase = path.join(destino, 'base-clave-cruda');
      mkdirSync(conBase, { recursive: true });
      const base = abrirBaseCifrada(path.join(conBase, 'boveda.db'), CLAVE_CRUDA);
      try {
        migrar(base);
        inicializarDatos(base, false);
        guardarConfiguracion(base, CONFIGURACION_BASE);
        base.exec('VACUUM');
      } finally {
        base.close();
      }

      const trabajo = mkdtempSync(path.join(os.tmpdir(), 'qatlas-fixture-'));
      temporales.push(trabajo);
      const servicio = new ServicioBoveda({ carpeta: trabajo });
      try {
        expect((await servicio.crear(CONTRASENA, false)).resultado).toBe('creada');
        servicio.cambiarConfiguracion(CONFIGURACION_BOVEDA);
      } finally {
        servicio.bloquear();
      }
      const completa = path.join(destino, 'boveda-completa');
      mkdirSync(completa, { recursive: true });
      // Solo lo que es la bóveda: la base y la sellada.
      for (const nombre of ['boveda.db', 'boveda.sellada']) {
        cpSync(path.join(trabajo, nombre), path.join(completa, nombre));
      }
    }, 120_000);
  },
);
