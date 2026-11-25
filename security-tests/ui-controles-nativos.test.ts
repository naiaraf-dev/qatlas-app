/**
 * La interfaz usa los controles propios de `ui/` (ADR 042), no los nativos del navegador. Este test
 * revisa el código de la interfaz fuera de `ui/` y falla si aparece un control nativo nuevo: un
 * `<select>`, una casilla, un número, un deslizador, un `<details>`, un `<dialog>`, un tooltip con el
 * atributo `title`, un `confirm()`/`alert()`/`prompt()`, o un campo de contraseña fuera de
 * `EntradaSensible`.
 *
 * Quedan permitidos los campos de texto y los `<textarea>`: se estilan con los tokens, y no tienen un
 * reemplazo mejor. Los diálogos de archivos del sistema los abre el proceso principal: no están acá.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = path.resolve(import.meta.dirname, '../apps/desktop/src/renderer/src');
const UI = path.join(RENDERER, 'ui');

/** Un `<input type="password">` en JSX. Un selector CSS en un texto (`input[type=password]`) no cuenta. */
const CONTRASENA = /<input\b[^>]*\stype=["'{]+password\b/;

const PROHIBIDOS: readonly [string, RegExp][] = [
  ['<select>', /<select\b/],
  ['<option>', /<option\b/],
  ['<datalist>', /<datalist\b/],
  ['<details>', /<details\b/],
  ['<summary>', /<summary\b/],
  ['<dialog>', /<dialog\b/],
  ['<progress>', /<progress\b/],
  ['<meter>', /<meter\b/],
  [
    'input nativo (casilla, radio, número, deslizador, fecha, color o archivo)',
    /<input\b[^>]*\btype=["'{]*(checkbox|radio|number|range|date|datetime-local|month|week|time|color|file)\b/,
  ],
  ['contraseña fuera de EntradaSensible', CONTRASENA],
  // El atributo `title` en un elemento HTML (minúscula). La prop `title` de Card o PageHeader, no.
  ['tooltip nativo (atributo title)', /<[a-z][\w-]*\b[^<>]*\stitle=/],
  ['confirm/alert/prompt del navegador', /\b(window\.)?(confirm|alert|prompt)\s*\(/],
];

function archivos(carpeta: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = path.join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

/** Sin comentarios: un ejemplo en un comentario no es código. */
const sinComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

export function controlesNativos(texto: string): string[] {
  const codigo = sinComentarios(texto);
  return PROHIBIDOS.filter(([, patron]) => patron.test(codigo)).map(([nombre]) => nombre);
}

describe('controles nativos fuera de ui/', () => {
  it('control: el detector ve cada uno, y no confunde la prop title de un componente', () => {
    const ejemplos = [
      '<select value={x}>',
      '<option value="a">',
      '<details open>',
      '<input type="checkbox" />',
      '<input className="x" type="number" min={1} />',
      '<input type="range" />',
      '<input type="password" />',
      '<button title="Cerrar">',
      'if (window.confirm("¿Seguro?")) {}',
      '<dialog open>',
    ];
    for (const ejemplo of ejemplos) expect(controlesNativos(ejemplo), ejemplo).not.toEqual([]);
    for (const permitido of [
      '<Card title="Bóveda">',
      '<PageHeader title={x} />',
      '<input className={CLASE_ENTRADA} value={x} />',
      '<input type="email" />',
      '<textarea value={x} />',
      "const paso = { selector: 'input[type=password]' };",
      '// <select> en un comentario',
    ]) {
      expect(controlesNativos(permitido), permitido).toEqual([]);
    }
  });

  it('ninguna pantalla usa un control nativo: van los de ui/', () => {
    const fuera = archivos(RENDERER).filter((ruta) => !ruta.startsWith(UI + path.sep));
    // Control: revisa las pantallas de verdad.
    expect(fuera.some((r) => r.endsWith('Credenciales.tsx'))).toBe(true);
    const hallados = fuera.flatMap((ruta) =>
      controlesNativos(readFileSync(ruta, 'utf8')).map(
        (nombre) => `${path.relative(RENDERER, ruta)}: ${nombre}`,
      ),
    );
    expect(hallados).toEqual([]);
  });

  it('dentro de ui/, la contraseña solo está en EntradaSensible', () => {
    const conContrasena = archivos(UI).filter((ruta) =>
      /\btype=["'{]*password\b/.test(sinComentarios(readFileSync(ruta, 'utf8'))),
    );
    expect(conContrasena.map((r) => path.basename(r))).toEqual(['EntradaSensible.tsx']);
  });
});
