/**
 * Que ningún E2E deje procesos abiertos, y cuánta memoria usa cada archivo.
 *
 * `vigilarProcesos(test, import.meta.filename)` va como ÚLTIMA línea de cada archivo `.e2e.ts`
 * (`security-tests/e2e-procesos.test.ts` lo exige): los `afterAll` corren en el orden en que se
 * registran, así que el suyo corre después de los del archivo, que cierran la app o el navegador.
 *
 * - Los procesos se siguen por su PID, nunca por su nombre: los descendientes del worker de Playwright
 *   que no estaban al empezar el archivo. Se anotan después de cada test y cada 5 segundos: si un padre
 *   muere antes que sus hijos (un Chromium huérfano), los hijos ya estaban anotados.
 * - Al terminar el archivo espera hasta 15 segundos a que se cierren. Si queda alguno vivo, el archivo
 *   falla y dice cuál (PID y tipo), sin rutas ni líneas de comando.
 * - La memoria libre del sistema al empezar y al terminar va a la consola y a
 *   `test-results/procesos-y-memoria.txt`, para ver si se acumula entre archivos.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type test as pruebaBase } from '@playwright/test';
import { descendientes, procesos } from './arbol-procesos';

const RESUMEN = path.resolve(import.meta.dirname, '..', 'test-results', 'procesos-y-memoria.txt');
const INTERVALO_MS = 5000;
const ESPERA_MAXIMA_MS = 15_000;

/** Un nombre corto para el informe: nunca la ruta ni la línea de comando. */
const tipo = (nombre: string) => path.basename(nombre).replace(/\.exe$/i, '');
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

export function vigilarProcesos(test: typeof pruebaBase, archivo: string): void {
  // Solo en el worker: el proceso principal de Playwright también carga los archivos para listarlos.
  if (process.env.TEST_WORKER_INDEX === undefined) return;
  const nombre = path.basename(archivo);
  const previos = new Set(descendientes(procesos(), process.pid).map((p) => p.pid));
  const libreAlEmpezar = os.freemem();
  const vistos = new Map<number, string>();
  const anotar = () => {
    for (const p of descendientes(procesos(), process.pid)) {
      if (!previos.has(p.pid)) vistos.set(p.pid, tipo(p.nombre));
    }
  };
  const temporizador = setInterval(() => {
    try {
      anotar();
    } catch {
      // Una lectura que falla no corta los tests: la del final es la que cuenta.
    }
  }, INTERVALO_MS);
  temporizador.unref();

  // Después de cada test la app sigue abierta (se cierra en afterAll): ahí se ve el árbol entero.
  test.afterEach(() => {
    anotar();
  });

  test.afterAll(async () => {
    clearInterval(temporizador);
    anotar();
    let vivos: { pid: number; tipo: string }[];
    const limite = Date.now() + ESPERA_MAXIMA_MS;
    do {
      const activos = new Set(procesos().map((p) => p.pid));
      vivos = [...vistos].filter(([pid]) => activos.has(pid)).map(([pid, t]) => ({ pid, tipo: t }));
      if (vivos.length === 0) break;
      await new Promise((listo) => setTimeout(listo, 500));
    } while (Date.now() < limite);

    const linea =
      `[procesos y memoria] ${nombre}: memoria libre ${gb(libreAlEmpezar)} -> ${gb(os.freemem())} ` +
      `de ${gb(os.totalmem())} · lanzó ${String(vistos.size)} procesos · quedan vivos ${String(vivos.length)}` +
      (vivos.length > 0 ? ` (${vivos.map((v) => `${v.tipo}:${String(v.pid)}`).join(', ')})` : '');
    console.log(linea);
    mkdirSync(path.dirname(RESUMEN), { recursive: true });
    appendFileSync(RESUMEN, `${linea}\n`);
    expect(vivos, `procesos que ${nombre} dejó abiertos`).toEqual([]);
  });
}
