/**
 * Las acciones del CI (ADR 044):
 * - Toda acción de terceros está fijada por SHA completo, con la versión en un comentario. Un tag se puede
 *   mover; un SHA, no.
 * - La caché de Electron y del navegador: clave exacta (sin `restore-keys`, que restauraría otra versión),
 *   se verifica antes de usarse, y se guarda después de verificar, nunca al final del job.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(import.meta.dirname, '..');

function archivosDeAcciones(): string[] {
  const workflows = readdirSync(path.join(RAIZ, '.github/workflows'))
    .filter((n) => /\.ya?ml$/.test(n))
    .map((n) => path.join('.github/workflows', n));
  const acciones = readdirSync(path.join(RAIZ, '.github/actions')).map((n) =>
    path.join('.github/actions', n, 'action.yml'),
  );
  return [...workflows, ...acciones];
}

/** Cada `uses:` que no es una acción local, con su línea. */
export function usosDeTerceros(texto: string): { linea: number; uso: string }[] {
  return texto
    .split('\n')
    .map((l, i) => ({ linea: i + 1, m: /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(l) }))
    .filter((x) => x.m && !x.m[1]?.startsWith('./'))
    .map((x) => ({ linea: x.linea, uso: `${x.m?.[1] ?? ''}${x.m?.[2] ?? ''}` }));
}

const FIJADA = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+){0,2}$/;

describe('Acciones del CI', () => {
  it('toda acción de terceros, fijada por SHA con su versión', () => {
    const malas: string[] = [];
    let total = 0;
    for (const archivo of archivosDeAcciones()) {
      for (const { linea, uso } of usosDeTerceros(readFileSync(path.join(RAIZ, archivo), 'utf8'))) {
        total += 1;
        if (!FIJADA.test(uso.trim())) malas.push(`${archivo}:${String(linea)}`);
      }
    }
    expect(total).toBeGreaterThan(5);
    expect(malas).toEqual([]);
  });

  it('control: reconoce una acción por tag y deja pasar una fijada', () => {
    const texto = [
      '      - uses: actions/cache@v6',
      '      - uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
      '      - uses: ./.github/actions/preparar-e2e',
    ].join('\n');
    const usos = usosDeTerceros(texto);
    expect(usos).toHaveLength(2);
    expect(usos.map((u) => FIJADA.test(u.uso.trim()))).toEqual([false, true]);
  });

  describe('la caché de los E2E', () => {
    const accion = readFileSync(path.join(RAIZ, '.github/actions/preparar-e2e/action.yml'), 'utf8');
    const posicion = (texto: string) => {
      const i = accion.indexOf(texto);
      expect(i, texto).toBeGreaterThanOrEqual(0);
      return i;
    };

    it('clave exacta: nunca restore-keys', () => {
      expect(accion).not.toMatch(/restore-keys/);
      expect(accion).toContain('steps.versiones.outputs.electron');
      expect(accion).toContain('steps.versiones.outputs.chromium');
    });

    it('Electron: restaura, verifica, instala y recién ahí guarda', () => {
      const restaura = posicion('name: Caché de Electron');
      const verifica = posicion('run: node scripts/verificar-cache-electron.mjs');
      const instala = posicion('run: npm run setup:native');
      const guarda = posicion('name: Guardar la caché de Electron');
      expect(restaura < verifica && verifica < instala && instala < guarda).toBe(true);
    });

    it('Chromium: restaura, instala, verifica el hash y recién ahí guarda; los tests vienen después', () => {
      const restaura = posicion('name: Caché del navegador de pruebas');
      const instala = posicion('npx playwright install');
      const verifica = posicion('run: npm run navegador:verificar');
      const guarda = posicion('name: Guardar la caché del navegador de pruebas');
      expect(restaura < instala && instala < verifica && verifica < guarda).toBe(true);
      // Nada de la acción corre tests: lo que se guarda no lo tocó ningún E2E.
      expect(accion).not.toMatch(/test:e2e|playwright test/);
    });
  });
});
