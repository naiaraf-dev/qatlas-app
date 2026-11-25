/**
 * Cada E2E termina con `vigilarProcesos(test, import.meta.filename)` (e2e/procesos.ts): falla si el
 * archivo deja procesos abiertos, y registra la memoria. Tiene que ser lo último del archivo, porque los
 * `afterAll` corren en el orden en que se registran.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { descendientes, procesos } from '../e2e/arbol-procesos';

const E2E = path.resolve(import.meta.dirname, '../e2e');
const LLAMADA = 'vigilarProcesos(test, import.meta.filename);';

/** La última sentencia del archivo, sin comentarios ni líneas vacías. */
export function ultimaSentencia(texto: string): string {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('//'));
  return lineas.at(-1) ?? '';
}

describe('E2E: el árbol de procesos, por PID', () => {
  it('encuentra los nietos aunque el padre no sea el raíz, y no se confunde con ciclos', () => {
    const arbol = [
      { pid: 10, ppid: 1, nombre: 'worker' },
      { pid: 11, ppid: 10, nombre: 'electron' },
      { pid: 12, ppid: 11, nombre: 'electron' },
      { pid: 13, ppid: 12, nombre: 'chrome' },
      { pid: 20, ppid: 1, nombre: 'otro' },
      { pid: 30, ppid: 31, nombre: 'ciclo' },
      { pid: 31, ppid: 30, nombre: 'ciclo' },
    ];
    expect(
      descendientes(arbol, 10)
        .map((p) => p.pid)
        .sort(),
    ).toEqual([11, 12, 13]);
    expect(descendientes(arbol, 30).map((p) => p.pid)).toEqual([31]);
  });

  it('control positivo: un proceso que lanza este test aparece, y deja de aparecer al cerrarlo por su PID', async () => {
    const hijo = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      const pid = hijo.pid ?? -1;
      expect(descendientes(procesos(), process.pid).map((p) => p.pid)).toContain(pid);
      hijo.kill();
      await new Promise((listo) => hijo.once('exit', listo));
      expect(procesos().map((p) => p.pid)).not.toContain(pid);
    } finally {
      if (hijo.exitCode === null) hijo.kill();
    }
  }, 30_000);
});

describe('E2E: vigilancia de procesos', () => {
  const archivos = readdirSync(E2E).filter((n) => n.endsWith('.e2e.ts'));

  it('control: hay E2E, y el detector distingue la llamada al final de una en el medio', () => {
    expect(archivos.length).toBeGreaterThan(10);
    expect(ultimaSentencia(`test('a', () => {});\n\n// fin\n${LLAMADA}\n`)).toBe(LLAMADA);
    expect(ultimaSentencia(`${LLAMADA}\ntest.afterAll(() => {});\n`)).not.toBe(LLAMADA);
  });

  it('cada archivo .e2e.ts termina con vigilarProcesos', () => {
    const sin = archivos.filter(
      (nombre) => ultimaSentencia(readFileSync(path.join(E2E, nombre), 'utf8')) !== LLAMADA,
    );
    expect(sin).toEqual([]);
  });
});
