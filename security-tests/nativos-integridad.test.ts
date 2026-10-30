/**
 * Integridad de los módulos nativos (ADR 007, A-21). Fuera del asar no los cubre la validación de
 * Electron: se verifica su SHA-256 antes de cargarlos, y si algo no coincide no se ejecuta nada.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rutaFueraDelAsar, verificarNativos } from '../apps/desktop/src/main/security/nativos';

const BUENO = Buffer.from('binario original');
const hash = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');
const MANIFIESTO = [
  { paquete: 'modulo-a', archivo: 'prebuilds/x.node', sha256: hash(BUENO) },
  { paquete: 'modulo-b', archivo: 'prebuilds/y.node', sha256: hash(BUENO) },
];
const carpetaDelPaquete = (paquete: string) => `/app/${paquete}`;

describe('Integridad de los módulos nativos', () => {
  it('acepta si todos coinciden', () => {
    expect(verificarNativos(MANIFIESTO, { carpetaDelPaquete, leer: () => BUENO })).toBe(true);
  });

  it('rechaza si un binario fue modificado', () => {
    const leer = (ruta: string) =>
      ruta.includes('modulo-b') ? Buffer.from('binario manipulado') : BUENO;
    expect(verificarNativos(MANIFIESTO, { carpetaDelPaquete, leer })).toBe(false);
  });

  it('rechaza si un binario falta', () => {
    const leer = (): Buffer => {
      throw new Error('no existe');
    };
    expect(verificarNativos(MANIFIESTO, { carpetaDelPaquete, leer })).toBe(false);
  });

  it('rechaza si un paquete no se encuentra', () => {
    const noEncuentra = (): string => {
      throw new Error('no existe');
    };
    expect(
      verificarNativos(MANIFIESTO, { carpetaDelPaquete: noEncuentra, leer: () => BUENO }),
    ).toBe(false);
  });

  it('un manifiesto vacío falla cerrado', () => {
    expect(verificarNativos([], { carpetaDelPaquete, leer: () => BUENO })).toBe(false);
  });

  it('lee desde fuera del asar en la app empaquetada', () => {
    const ficticia = ['C:', 'Program Files', 'QAtlas', 'resources', 'app.asar', 'modulo.node'];
    expect(rutaFueraDelAsar(ficticia.join('\\'))).toBe(
      ['C:', 'Program Files', 'QAtlas', 'resources', 'app.asar.unpacked', 'modulo.node'].join('\\'),
    );
    expect(rutaFueraDelAsar('/opt/qatlas/resources/app.asar/modulo.node')).toBe(
      '/opt/qatlas/resources/app.asar.unpacked/modulo.node',
    );
    expect(rutaFueraDelAsar('/sin/asar/modulo.node')).toBe('/sin/asar/modulo.node');
  });

  it('el proceso principal verifica antes de cargar lo que importa los módulos nativos', () => {
    const fuente = readFileSync(
      new URL('../apps/desktop/src/main/index.ts', import.meta.url),
      'utf8',
    );
    // Solo un import de tipos: uno de valor cargaría los módulos antes de la verificación.
    expect(fuente).toMatch(/import type \{ ServicioBoveda \} from '\.\/boveda\/servicio'/);
    expect(fuente).not.toMatch(/^import \{[^}]*\} from '@qatlas\/(crypto|db)'/m);
    expect(fuente.indexOf('verificarNativos(__QATLAS_NATIVOS__')).toBeLessThan(
      fuente.indexOf("import('./boveda/servicio')"),
    );
    expect(fuente.indexOf('verificarNativos(__QATLAS_NATIVOS__')).toBeGreaterThan(0);
  });
});
