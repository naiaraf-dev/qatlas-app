/**
 * El borrado de temporales (CLAUDE.md, reglas de procesos): `scripts/borrar-temporal.mjs` solo borra
 * dentro del repo, en una carpeta temporal permitida e ignorada por git, sin nada versionado. Todo lo
 * demás falla sin borrar. Las pruebas usan un repo de juguete en una carpeta temporal del sistema, que
 * crea y borra el propio test (no la terminal).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validarRutaTemporal } from '../scripts/borrar-temporal.mjs';

let base: string;
let repo: string;
let afuera: string;
const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const validar = (ruta: string) => validarRutaTemporal(ruta, { raiz: repo, git });

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'qatlas-borrar-'));
  repo = path.join(base, 'repo');
  afuera = path.join(base, 'afuera');
  mkdirSync(path.join(repo, '.artefactos', 'lamina'), { recursive: true });
  mkdirSync(path.join(repo, '.artefactos', 'versionada'), { recursive: true });
  mkdirSync(path.join(repo, 'docs'), { recursive: true });
  mkdirSync(afuera);
  writeFileSync(path.join(repo, '.gitignore'), '.artefactos/\nout/\n');
  writeFileSync(path.join(repo, '.artefactos', 'lamina', 'a.png'), 'x');
  writeFileSync(path.join(repo, '.artefactos', 'versionada', 'b.txt'), 'x');
  writeFileSync(path.join(repo, 'docs', 'c.md'), 'x');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '.gitignore', 'docs'], { cwd: repo });
  // Un archivo versionado a la fuerza dentro de la carpeta ignorada.
  execFileSync('git', ['add', '-f', '.artefactos/versionada/b.txt'], { cwd: repo });
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true, maxRetries: 3 });
});

describe('borrar-temporal', () => {
  it('control: acepta una carpeta temporal ignorada y sin nada versionado', () => {
    expect(validar('.artefactos/lamina')).toBe(
      path.join(path.resolve(repo), '.artefactos', 'lamina'),
    );
  });

  it.each([
    ['vacía', ''],
    ['solo espacios', '   '],
    ['la raíz', '.'],
    ['la raíz con barra', './'],
    ['la carpeta temporal misma', '.artefactos'],
    ['una que no existe', '.artefactos/no-existe'],
    ['fuera de las temporales', 'docs'],
    ['un archivo versionado', 'docs/c.md'],
    ['subiendo fuera del repo', '../afuera'],
    ['con archivos versionados adentro', '.artefactos/versionada'],
  ])('rechaza %s', (_caso, ruta) => {
    expect(() => validar(ruta)).toThrow('borrar-temporal');
  });

  it('rechaza una ruta absoluta fuera del repo', () => {
    expect(() => validar(afuera)).toThrow('borrar-temporal');
  });

  it('rechaza un enlace dentro de la temporal que apunta afuera', () => {
    const enlace = path.join(repo, '.artefactos', 'enlace');
    try {
      symlinkSync(afuera, enlace, 'junction');
    } catch {
      return; // Sin permiso para crear enlaces en este sistema: no hay caso que probar.
    }
    expect(() => validar('.artefactos/enlace')).toThrow('borrar-temporal');
  });

  it('rechaza lo que git no ignora, aunque esté en una carpeta permitida', () => {
    writeFileSync(path.join(repo, '.gitignore'), 'out/\n');
    try {
      expect(() => validar('.artefactos/lamina')).toThrow('git no la ignora');
    } finally {
      writeFileSync(path.join(repo, '.gitignore'), '.artefactos/\nout/\n');
    }
  });
});
