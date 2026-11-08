/**
 * Logs técnicos (ADR 034): solo eventos, códigos, IDs y tiempos. Una URL o un host se rechazan aunque
 * estén redactados, y su valor nunca llega al archivo.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Registro, valorPermitido } from './registro';

let carpeta: string;
const contenido = () =>
  readdirSync(carpeta)
    .map((nombre) => readFileSync(path.join(carpeta, nombre), 'utf8'))
    .join('');

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-registro-'));
});

afterEach(() => {
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Logs técnicos (ADR 034)', () => {
  it('escribe una línea JSON por evento, con eventos, códigos, IDs, números y booleanos', () => {
    const registro = new Registro({ carpeta, ahora: () => Date.parse('2026-11-07T12:00:00Z') });
    expect(
      registro.registrar('ejecucion.navegador-no-disponible', {
        ejecucion: '3f2a1b9c-1234-4234-8234-123456789012',
        causa: 'pantalla',
        ms: 1200,
        reintento: false,
        canal: 'proyectos:crear',
      }),
    ).toBe(true);
    expect(JSON.parse(contenido())).toEqual({
      t: '2026-11-07T12:00:00.000Z',
      evento: 'ejecucion.navegador-no-disponible',
      ejecucion: '3f2a1b9c-1234-4234-8234-123456789012',
      causa: 'pantalla',
      ms: 1200,
      reintento: false,
      canal: 'proyectos:crear',
    });
  });

  it.each([
    ['una URL', 'https://app.example.test/panel?token=abc'],
    ['una URL redactada', 'https://app.example.test/panel?token=[REDACTADO:parametro]'],
    ['un host', 'app.example.test'],
    ['un host sin punto', 'intranet'],
    ['localhost', 'localhost'],
    ['un host con puerto', '127.0.0.1:8080'],
    ['un host redactado', '[REDACTADO:credencial].example.test'],
    ['una marca de redacción sola', '[REDACTADO:credencial]'],
    ['el nombre de un proyecto', 'Lexora'],
    ['un email', 'ana@example.com'],
    ['un mensaje', 'TypeError: algo falló'],
    ['un canal que no existe', 'proyectos:inventado'],
  ])('rechaza %s, y su valor no llega al archivo', (_, valor) => {
    const registro = new Registro({ carpeta });
    expect(registro.registrar('ipc.rechazado', { canal: valor })).toBe(false);
    const escrito = contenido();
    expect(escrito).not.toContain(valor);
    expect(escrito).toContain('"evento":"registro.campo-rechazado","cantidad":1');
    expect(valorPermitido(valor)).toBe(false);
  });

  it('rechaza un evento con un nombre fuera del formato, y no lo escribe', () => {
    const registro = new Registro({ carpeta });
    expect(registro.registrar('evento con https://app.example.test')).toBe(false);
    expect(contenido()).not.toContain('example');
    expect(contenido()).toContain('registro.evento-rechazado');
  });

  it('rechaza objetos, números infinitos y nombres de campo raros', () => {
    expect(valorPermitido({ url: 'x' })).toBe(false);
    expect(valorPermitido(Number.POSITIVE_INFINITY)).toBe(false);
    const registro = new Registro({ carpeta });
    expect(registro.registrar('prueba.campos', { 'url.completa': 1 })).toBe(false);
  });

  it('rota al pasar el tamaño máximo y conserva la cantidad de archivos', () => {
    const registro = new Registro({ carpeta, maxBytes: 200, maxArchivos: 3 });
    for (let i = 0; i < 30; i++) registro.registrar('prueba.rotacion', { i });
    expect(readdirSync(carpeta).sort()).toEqual(['qatlas.1.log', 'qatlas.2.log', 'qatlas.log']);
    for (const nombre of readdirSync(carpeta)) {
      expect(readFileSync(path.join(carpeta, nombre)).length).toBeLessThanOrEqual(200);
    }
  });

  it('al iniciar borra los archivos de más de 7 días, y solo los suyos', () => {
    const viejo = path.join(carpeta, 'qatlas.3.log');
    const ajeno = path.join(carpeta, 'otro.txt');
    writeFileSync(viejo, 'x');
    writeFileSync(ajeno, 'x');
    const hace8Dias = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(viejo, hace8Dias, hace8Dias);
    utimesSync(ajeno, hace8Dias, hace8Dias);
    new Registro({ carpeta });
    expect(readdirSync(carpeta)).toEqual(['otro.txt']);
  });
});
