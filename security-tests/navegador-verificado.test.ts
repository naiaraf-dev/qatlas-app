/**
 * Un solo navegador de pruebas, lanzado de una sola forma (ADR 020 y 041): `opcionesChromium`
 * (`packages/runner/src/motor/opciones-chromium.ts`), la misma de la app.
 *
 * - Sin `channel: 'chromium'`, Playwright abre su «headless shell», otro binario que no se instala
 *   (`--no-shell`) ni se verifica.
 * - Con otros argumentos, un test prueba un navegador distinto del de la app: un segundo
 *   `--disable-features` volvía a encender servicios de Google que Playwright apaga, y solo se vio en el CI.
 *
 * Revisa el código de la app, los paquetes, los E2E, los tests de seguridad y los scripts: cada
 * `launch`, `launchPersistentContext` y `launchServer` de Playwright usa `opcionesChromium(...)` y no
 * pisa lo que arma (canal, argumentos, sandbox, ventana, proxy). Los controles de los tests sacan un freno
 * con `control`, que el código de la app nunca usa. Nadie pasa `executablePath` ni otro canal, ni usa
 * Firefox o WebKit.
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

/** Sin comentarios de línea: un ejemplo en un comentario no es código. */
const sinComentarios = (texto: string) => texto.replace(/^\s*(\/\/|\*).*$/gm, '');

/** Cada lanzamiento de un navegador de Playwright, con sus argumentos. */
export function lanzamientos(texto: string, archivo: string): Lanzamiento[] {
  const codigo = sinComentarios(texto);
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

const LLAMADA = /\bopcionesChromium\s*\(/g;
/** Lo que `opcionesChromium` arma y nadie puede pisar al lado. */
const PISADAS =
  /\b(channel|args|chromiumSandbox|headless|proxy|ignoreDefaultArgs|executablePath)\s*:/;

/** Los argumentos de cada `opcionesChromium(...)` del texto, y el texto sin esas llamadas. */
function llamadas(texto: string): { dentro: string[]; fuera: string } {
  const dentro: string[] = [];
  let fuera = '';
  let desde = 0;
  for (const m of texto.matchAll(LLAMADA)) {
    if (m.index < desde) continue;
    const abre = m.index + m[0].length - 1;
    const contenido = argumentos(texto, abre);
    dentro.push(contenido);
    fuera += texto.slice(desde, m.index);
    desde = abre + contenido.length + 2;
  }
  return { dentro, fuera: fuera + texto.slice(desde) };
}

/** Usa la función de la app una vez, y no pisa nada de lo que arma. */
const verificado = (args: string) => {
  const { dentro, fuera } = llamadas(args);
  return dentro.length === 1 && !PISADAS.test(fuera);
};

describe('el navegador de pruebas es siempre el de la app', () => {
  // Este archivo tiene ejemplos de lanzamientos mal hechos, para el control.
  const archivos = CARPETAS.flatMap((c) => fuentes(path.join(RAIZ, c))).filter(
    (ruta) => ruta !== import.meta.filename,
  );
  const relativa = (ruta: string) => path.relative(RAIZ, ruta).replaceAll('\\', '/');
  const todos = archivos.flatMap((ruta) =>
    lanzamientos(readFileSync(ruta, 'utf8'), relativa(ruta)),
  );

  it('control: encuentra los lanzamientos y reconoce los que no usan la función de la app', () => {
    // El del runner y los de los E2E: si el test dejara de verlos, no probaría nada.
    expect(todos.map((l) => l.lugar)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^packages\/runner\/src\/motor\/motor\.ts:/),
        expect.stringMatching(/^e2e\/ocr\.e2e\.ts:/),
        expect.stringMatching(/^e2e\/contencion\.e2e\.ts:/),
      ]),
    );
    const ejemplos = lanzamientos(
      [
        'await chromium.launch();',
        "await chromium.launch({ channel: 'chromium', args: ['--disable-features=X'] });",
        "await chromium.launch({ ...opcionesChromium(), args: ['--disable-features=X'] });",
        'await chromium.launchPersistentContext(p, { ...opcionesChromium(), headless: true });',
        'await chromium.launch(opcionesChromium({ proxy, headless: false }));',
        'await chromium.launchPersistentContext(p, { ...opcionesChromium({ proxy }), serviceWorkers });',
        'await chromium.launch({ ...opcionesChromium(), tracesDir: carpeta });',
        'await electron.launch({ args: [] });',
      ].join('\n'),
      'ejemplo.ts',
    );
    expect(ejemplos.map((l) => verificado(l.args))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('cada launch usa opcionesChromium, sin pisar lo que arma', () => {
    expect(todos.filter((l) => !verificado(l.args)).map((l) => l.lugar)).toEqual([]);
  });

  it('el código de la app nunca usa los controles de los tests', () => {
    const deLaApp = archivos.filter((ruta) => {
      const r = relativa(ruta);
      return (
        /^(apps|packages)\//.test(r) &&
        !r.endsWith('.test.ts') &&
        !r.endsWith('motor/opciones-chromium.ts')
      );
    });
    // Control: entre los archivos está motor.ts, que llama a la función, y la búsqueda ve un control.
    expect(deLaApp.some((r) => relativa(r).endsWith('motor/motor.ts'))).toBe(true);
    expect(llamadas('opcionesChromium({ control: { sinSandbox: true } })').dentro).toEqual([
      '{ control: { sinSandbox: true } }',
    ]);
    const conControl = deLaApp.filter((ruta) =>
      llamadas(sinComentarios(readFileSync(ruta, 'utf8'))).dentro.some((a) =>
        /\bcontrol\s*:/.test(a),
      ),
    );
    expect(conControl.map(relativa)).toEqual([]);
  });

  it('nadie elige otro ejecutable, otro canal ni otro navegador', () => {
    const problemas: string[] = [];
    for (const ruta of archivos) {
      const texto = readFileSync(ruta, 'utf8');
      if (/\bexecutablePath:/.test(texto)) problemas.push(`${relativa(ruta)}: executablePath`);
      for (const m of texto.matchAll(/\bchannel:\s*'([^']+)'/g)) {
        if (m[1] !== 'chromium') problemas.push(`${relativa(ruta)}: channel ${m[1] ?? ''}`);
      }
      if (/\b(firefox|webkit)\b\s*[,}]|\b(firefox|webkit)\.launch/.test(texto)) {
        problemas.push(`${relativa(ruta)}: firefox o webkit`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("los fixtures de Playwright Test también usan channel: 'chromium'", () => {
    const configuracion = readFileSync(path.join(RAIZ, 'playwright.config.ts'), 'utf8');
    expect(/use:\s*\{[^}]*\bchannel:\s*'chromium'/.test(configuracion)).toBe(true);
  });
});
