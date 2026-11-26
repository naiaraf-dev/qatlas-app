/**
 * Las etiquetas de los E2E y las partes del CI (ADR 044).
 *
 * - Todo test tiene al menos una etiqueta, y solo de las conocidas: @seguridad, @lento, @ocr,
 *   @interfaz, @smoke.
 * - Cada test cae en exactamente una parte de `scripts/e2e-partes.mjs`: ninguno queda afuera del CI y
 *   ninguno corre dos veces.
 * - Las partes del CI y del job nocturno son las mismas, con los mismos nombres (son los checks
 *   obligatorios).
 *
 * La lista sale de Playwright (`--list`), no de leer los archivos: es la misma que usa al correr.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PARTES } from '../scripts/e2e-partes.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ETIQUETAS = ['@seguridad', '@lento', '@ocr', '@interfaz', '@smoke'];

interface Prueba {
  archivo: string;
  titulo: string;
  etiquetas: string[];
}

interface Suite {
  file?: string;
  specs?: { title: string; file: string; tags?: string[] }[];
  suites?: Suite[];
}

function listar(): Prueba[] {
  const paquete = createRequire(path.join(RAIZ, 'package.json')).resolve('playwright/package.json');
  const resultado = spawnSync(
    process.execPath,
    [path.join(path.dirname(paquete), 'cli.js'), 'test', '--list', '--reporter=json'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '' } },
  );
  if (resultado.status !== 0) throw new Error(`playwright --list falló: ${resultado.stderr}`);
  const raiz = JSON.parse(resultado.stdout) as { suites: Suite[] };
  const salida: Prueba[] = [];
  const recorrer = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      salida.push({
        archivo: path.basename(spec.file).replace(/\.e2e\.ts$/, ''),
        titulo: spec.title,
        // Playwright las devuelve sin la arroba.
        etiquetas: (spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)),
      });
    }
    for (const hija of suite.suites ?? []) recorrer(hija);
  };
  for (const suite of raiz.suites) recorrer(suite);
  return salida;
}

/** Las partes que correrían este test, con la misma lógica que los argumentos de Playwright. */
export function partesDe(prueba: Prueba): number[] {
  const texto = prueba.etiquetas.join(' ');
  return PARTES.flatMap((parte, i) => {
    if (parte.archivos && !parte.archivos.includes(prueba.archivo)) return [];
    if (parte.grep && !new RegExp(parte.grep).test(texto)) return [];
    if (parte.grepInvert && new RegExp(parte.grepInvert).test(texto)) return [];
    return [i + 1];
  });
}

/** Las partes declaradas en un workflow: «- { numero: N, nombre: '...' }». */
function partesDelWorkflow(archivo: string): { numero: number; nombre: string }[] {
  const texto = readFileSync(path.join(RAIZ, '.github/workflows', archivo), 'utf8');
  return [...texto.matchAll(/- \{ numero: (\d+), nombre: '([^']+)' \}/g)].map((m) => ({
    numero: Number(m[1]),
    nombre: m[2] ?? '',
  }));
}

describe('E2E: etiquetas y partes', () => {
  let pruebas: Prueba[];
  beforeAll(() => {
    pruebas = listar();
  }, 120_000);

  it('control: Playwright lista la suite, con etiquetas', () => {
    expect(pruebas.length).toBeGreaterThan(150);
    expect(pruebas.some((p) => p.etiquetas.includes('@smoke'))).toBe(true);
  });

  it('todo test tiene al menos una etiqueta, y solo de las conocidas', () => {
    expect(pruebas.filter((p) => p.etiquetas.length === 0).map((p) => p.titulo)).toEqual([]);
    const desconocidas = pruebas.flatMap((p) => p.etiquetas.filter((e) => !ETIQUETAS.includes(e)));
    expect([...new Set(desconocidas)]).toEqual([]);
  });

  it('cada test cae en exactamente una parte del CI', () => {
    const mal = pruebas
      .map((p) => ({ prueba: `${p.archivo} › ${p.titulo}`, partes: partesDe(p) }))
      .filter((x) => x.partes.length !== 1);
    expect(mal).toEqual([]);
    // Control: un @lento de un archivo sin parte no cae en ninguna; uno sin @lento, en «rápidos».
    expect(partesDe({ archivo: 'nuevo', titulo: 'x', etiquetas: ['@lento'] })).toEqual([]);
    expect(partesDe({ archivo: 'nuevo', titulo: 'x', etiquetas: ['@interfaz'] })).toEqual([1]);
  });

  it('el smoke está en la primera parte', () => {
    const smoke = pruebas.filter((p) => p.etiquetas.includes('@smoke'));
    expect(smoke.every((p) => partesDe(p).join() === '1')).toBe(true);
  });

  it('el CI y el job nocturno tienen las mismas partes que scripts/e2e-partes.mjs', () => {
    const esperadas = PARTES.map((parte, i) => ({ numero: i + 1, nombre: parte.nombre }));
    expect(partesDelWorkflow('ci.yml')).toEqual(esperadas);
    expect(partesDelWorkflow('nocturno.yml')).toEqual(esperadas);
    const ci = readFileSync(path.join(RAIZ, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain(
      `name: E2E \${{ matrix.numero }}/${String(PARTES.length)} · \${{ matrix.nombre }}`,
    );
  });

  it('el nocturno repite la suite tres veces', () => {
    const nocturno = readFileSync(path.join(RAIZ, '.github/workflows/nocturno.yml'), 'utf8');
    expect(nocturno).toContain('--repeat-each=3');
    expect(nocturno).toMatch(/schedule:/);
  });
});
