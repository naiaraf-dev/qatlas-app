/**
 * Las etiquetas de los E2E y las partes del CI (ADR 044).
 *
 * - Todo test tiene al menos una etiqueta, y solo de las conocidas: @seguridad, @lento, @ocr,
 *   @interfaz, @smoke.
 * - Cada test cae en exactamente una parte de `scripts/e2e-partes.mjs`: ninguno queda afuera del CI y
 *   ninguno corre dos veces.
 * - Las partes del CI y del job nocturno son las mismas, con los mismos nombres (son los checks
 *   obligatorios).
 * - Un archivo en modo serial cae entero en una parte, salvo los `describe` declarados en
 *   `GRUPOS_INDEPENDIENTES`, que caen enteros en una (sus tests comparten estado).
 *
 * La lista sale de Playwright (`--list`), no de leer los archivos: es la misma que usa al correr.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GRUPOS_INDEPENDIENTES, PARTES } from '../scripts/e2e-partes.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ETIQUETAS = ['@seguridad', '@lento', '@ocr', '@interfaz', '@smoke'];

interface Prueba {
  archivo: string;
  titulo: string;
  etiquetas: string[];
  /** El `describe` de primer nivel, o `''` si el test está suelto en el archivo. */
  describe?: string;
}

interface Suite {
  title?: string;
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
  const recorrer = (suite: Suite, describe: string) => {
    for (const spec of suite.specs ?? []) {
      salida.push({
        describe,
        archivo: path.basename(spec.file).replace(/\.e2e\.ts$/, ''),
        titulo: spec.title,
        // Playwright las devuelve sin la arroba.
        etiquetas: (spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`)),
      });
    }
    for (const hija of suite.suites ?? []) recorrer(hija, describe || (hija.title ?? ''));
  };
  // El primer nivel es el archivo; el segundo, sus describe.
  for (const suite of raiz.suites) recorrer(suite, '');
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

/** Los archivos en modo serial: comparten estado entre sus tests. */
function archivosSeriales(): Set<string> {
  const carpeta = path.join(RAIZ, 'e2e');
  return new Set(
    readdirSync(carpeta)
      .filter((nombre) => nombre.endsWith('.e2e.ts'))
      .filter((nombre) => /mode:\s*'serial'/.test(readFileSync(path.join(carpeta, nombre), 'utf8')))
      .map((nombre) => nombre.replace(/\.e2e\.ts$/, '')),
  );
}

/**
 * Los grupos que comparten estado y caen en más de una parte. Un grupo es el archivo serial, o un
 * `describe` declarado independiente.
 */
export function gruposRepartidos(
  pruebas: readonly Prueba[],
  seriales: ReadonlySet<string>,
  independientes: readonly { archivo: string; describe: string }[] = GRUPOS_INDEPENDIENTES,
): string[] {
  const partes = new Map<string, Set<number>>();
  for (const p of pruebas) {
    if (!seriales.has(p.archivo)) continue;
    const propio = independientes.some((g) => g.archivo === p.archivo && g.describe === p.describe);
    const grupo = propio ? `${p.archivo} › ${p.describe ?? ''}` : p.archivo;
    const conjunto = partes.get(grupo) ?? new Set<number>();
    for (const n of partesDe(p)) conjunto.add(n);
    partes.set(grupo, conjunto);
  }
  return [...partes]
    .filter(([, conjunto]) => conjunto.size > 1)
    .map(([grupo, conjunto]) => `${grupo}: partes ${[...conjunto].join(', ')}`);
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

  it('un archivo serial cae entero en una parte; un describe independiente declarado, también', () => {
    const seriales = archivosSeriales();
    expect(seriales.size, 'control: hay archivos seriales').toBeGreaterThan(5);
    expect(gruposRepartidos(pruebas, seriales)).toEqual([]);
    // Cada grupo declarado existe: un describe renombrado no deja la excepción colgada.
    for (const g of GRUPOS_INDEPENDIENTES) {
      expect(
        pruebas.some((p) => p.archivo === g.archivo && p.describe === g.describe),
        `${g.archivo} › ${g.describe}`,
      ).toBe(true);
    }
  });

  it('control: el caso de los reportes (un @interfaz suelto en otra parte) se detecta', () => {
    const reportes = [
      { archivo: 'reportes', titulo: 'crea', etiquetas: ['@interfaz', '@lento'], describe: '' },
      { archivo: 'reportes', titulo: 'axe', etiquetas: ['@interfaz'], describe: '' },
    ];
    expect(gruposRepartidos(reportes, new Set(['reportes']))).toEqual(['reportes: partes 5, 1']);
    // Sin modo serial no hay estado compartido declarado: no se exige.
    expect(gruposRepartidos(reportes, new Set())).toEqual([]);
    // Un describe independiente puede ir a otra parte que el resto del archivo, entero.
    const contencion = [
      { archivo: 'contencion', titulo: 'a', etiquetas: ['@seguridad'], describe: 'Otro' },
      { archivo: 'contencion', titulo: 'b', etiquetas: ['@lento'], describe: 'Propio' },
    ];
    const propio = [{ archivo: 'contencion', describe: 'Propio' }];
    expect(gruposRepartidos(contencion, new Set(['contencion']), propio)).toEqual([]);
    expect(gruposRepartidos(contencion, new Set(['contencion']), [])).toEqual([
      'contencion: partes 1, 3',
    ]);
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
