/**
 * Un solo navegador de pruebas: el Chromium completo, verificado por su hash (ADR 020,
 * `scripts/verificar-navegador.mjs`). Sin `channel: 'chromium'`, Playwright abre su «headless shell»,
 * otro binario que no se instala (`--no-shell`) ni se verifica: en el CI falla por no existir, y si
 * existiera, correría un navegador que nadie revisó.
 *
 * Revisa el código de la app, los paquetes, los E2E, los tests de seguridad y los scripts: cada
 * `launch`, `launchPersistentContext` y `launchServer` de Playwright pide `channel: 'chromium'`, y nadie
 * pasa `executablePath` ni otro canal, ni usa Firefox o WebKit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(import.meta.dirname, '..');
const CARPETAS = ['apps', 'packages', 'e2e', 'security-tests', 'scripts'];
const IGNORADAS = new Set([
  'node_modules',
  'out',
  'dist',
  'e2e-report',
  'test-results',
  'coverage',
]);
const EXTENSIONES = /\.(c|m)?(t|j)sx?$/;

function fuentes(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    if (IGNORADAS.has(nombre)) continue;
    const ruta = path.join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) fuentes(ruta, salida);
    else if (EXTENSIONES.test(nombre) && !nombre.endsWith('.d.ts')) salida.push(ruta);
  }
  return salida;
}

/** El texto entre el paréntesis que abre en `inicio` y el que lo cierra. */
function argumentos(texto: string, inicio: number): string {
  let profundidad = 0;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === '(') profundidad++;
    else if (texto[i] === ')' && --profundidad === 0) return texto.slice(inicio + 1, i);
  }
  return texto.slice(inicio + 1);
}

const LANZAMIENTO = /\b(\w+)\.(launch|launchPersistentContext|launchServer)\s*\(/g;
/** Electron no es un navegador de pruebas: `_electron.launch` abre la app (`e2e/lanzar.ts`). */
const NO_NAVEGADOR = new Set(['electron', '_electron']);

interface Lanzamiento {
  lugar: string;
  args: string;
}

/** Cada lanzamiento de un navegador de Playwright, con sus argumentos. */
export function lanzamientos(texto: string, archivo: string): Lanzamiento[] {
  // Sin comentarios de línea: un ejemplo en un comentario no es un lanzamiento.
  const codigo = texto.replace(/^\s*(\/\/|\*).*$/gm, '');
  const salida: Lanzamiento[] = [];
  for (const m of codigo.matchAll(LANZAMIENTO)) {
    if (NO_NAVEGADOR.has(m[1] ?? '')) continue;
    const linea = codigo.slice(0, m.index).split('\n').length;
    salida.push({
      lugar: `${archivo}:${String(linea)}`,
      args: argumentos(codigo, m.index + m[0].length - 1),
    });
  }
  return salida;
}

const verificado = (args: string) => /\bchannel:\s*'chromium'/.test(args);

describe('el navegador de pruebas es siempre el Chromium verificado', () => {
  // Este archivo tiene ejemplos de lanzamientos sin canal, para el control.
  const archivos = CARPETAS.flatMap((c) => fuentes(path.join(RAIZ, c))).filter(
    (ruta) => ruta !== import.meta.filename,
  );
  const todos = archivos.flatMap((ruta) =>
    lanzamientos(readFileSync(ruta, 'utf8'), path.relative(RAIZ, ruta).replaceAll('\\', '/')),
  );

  it('control: encuentra los lanzamientos y reconoce uno sin canal', () => {
    // El del runner y los de los E2E: si el test dejara de verlos, no probaría nada.
    expect(todos.map((l) => l.lugar)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^packages\/runner\/src\/motor\/motor\.ts:/),
        expect.stringMatching(/^e2e\/ocr\.e2e\.ts:/),
      ]),
    );
    const malos = lanzamientos(
      'const a = await chromium.launch();\nconst b = await chromium.launchPersistentContext(p, { headless: true });\nawait electron.launch({ args: [] });',
      'ejemplo.ts',
    );
    expect(malos.map((l) => verificado(l.args))).toEqual([false, false]);
  });

  it("cada launch pide channel: 'chromium'", () => {
    expect(todos.filter((l) => !verificado(l.args)).map((l) => l.lugar)).toEqual([]);
  });

  it('nadie elige otro ejecutable, otro canal ni otro navegador', () => {
    const problemas: string[] = [];
    for (const ruta of archivos) {
      const relativa = path.relative(RAIZ, ruta).replaceAll('\\', '/');
      const texto = readFileSync(ruta, 'utf8');
      if (/\bexecutablePath:/.test(texto)) problemas.push(`${relativa}: executablePath`);
      for (const m of texto.matchAll(/\bchannel:\s*'([^']+)'/g)) {
        if (m[1] !== 'chromium') problemas.push(`${relativa}: channel ${m[1] ?? ''}`);
      }
      if (/\b(firefox|webkit)\b\s*[,}]|\b(firefox|webkit)\.launch/.test(texto)) {
        problemas.push(`${relativa}: firefox o webkit`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("los fixtures de Playwright Test también usan channel: 'chromium'", () => {
    const configuracion = readFileSync(path.join(RAIZ, 'playwright.config.ts'), 'utf8');
    expect(/use:\s*\{[^}]*\bchannel:\s*'chromium'/.test(configuracion)).toBe(true);
  });
});
