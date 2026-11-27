/**
 * La huella y la normalización v2 (ADR 046). Mensajes inventados. Los pares que NO tienen que unirse
 * importan tanto como los que sí: errores distintos con una forma parecida.
 */
import { describe, expect, it } from 'vitest';
import { normalizarMensaje } from '@qatlas/redaction';
import {
  ALCANCE_POR_TIPO,
  alcanceDe,
  claveEstable,
  formaDeUrl,
  huellaDe,
  normalizarMensajeV2,
} from './huella';

const mismo = (a: string, b: string) => normalizarMensajeV2(a) === normalizarMensajeV2(b);

describe('Normalización v2: el mismo problema, aunque cambien detalles', () => {
  it.each([
    [
      'números de línea',
      'TypeError: x is undefined at app.js:10:5',
      'TypeError: x is undefined at app.js:12:9',
    ],
    [
      'hash del bundle',
      'TypeError: x is undefined at main.3f9ac2be.js:1:2345',
      'TypeError: x is undefined at main.b7e01dfa.js:1:2345',
    ],
    [
      'UUID',
      'Pedido 2b1f0c9e-4a7d-4c1e-9f3a-0d8e6b5a4c21 no encontrado',
      'Pedido 9c8d7e6f-1a2b-4c3d-8e9f-0a1b2c3d4e5f no encontrado',
    ],
    [
      'fecha ISO',
      'Sesión vencida el 2026-11-27T14:05:00Z',
      'Sesión vencida el 2026-11-28T09:30:12Z',
    ],
    ['ID hexadecimal corto', 'Error en el pedido a7f3e9', 'Error en el pedido c4b2d1'],
    ['ID numérico', 'No se encontró el pedido 123', 'No se encontró el pedido 98765'],
    [
      'otra línea de la pila',
      'ReferenceError: f is not defined\n    at a (x.js:1)',
      'ReferenceError: f is not defined\n    at b (y.js:2)',
    ],
    [
      'el mismo estado HTTP, en otra línea',
      'Request failed with status code 404 (app.js:10)',
      'Request failed with status code 404 (app.js:99)',
    ],
  ])('%s', (_caso, a, b) => {
    expect(mismo(a, b)).toBe(true);
  });

  it('control: la v1 separaba el hash del bundle y el ID hexadecimal (por eso la v2)', () => {
    expect(normalizarMensaje('x at main.3f9ac2be.js')).not.toBe(
      normalizarMensaje('x at main.b7e01dfa.js'),
    );
    expect(normalizarMensaje('pedido a7f3e9')).not.toBe(normalizarMensaje('pedido c4b2d1'));
  });
});

describe('Normalización v2: problemas distintos con una forma parecida NO se unen', () => {
  it.each([
    ['otra variable', 'TypeError: x is undefined', 'TypeError: y is undefined'],
    [
      'otra propiedad',
      "Cannot read properties of undefined (reading 'nombre')",
      "Cannot read properties of undefined (reading 'email')",
    ],
    [
      'otro estado HTTP',
      'Request failed with status code 404',
      'Request failed with status code 500',
    ],
    ['otro estado HTTP, en español', 'Respuesta con código 401', 'Respuesta con código 403'],
    ['HTTP y el estado', 'HTTP 502 en la API', 'HTTP 503 en la API'],
    ['otro token', "Unexpected token '<'", "Unexpected token '{'"],
    ['otro verbo', 'Failed to fetch', 'Failed to execute'],
    ['otro tipo de error', 'ReferenceError: f is not defined', 'TypeError: f is not a function'],
    ['promesa o no', 'Uncaught (in promise) Error: Timeout', 'Uncaught Error: Timeout'],
    ['otro archivo', 'No se pudo cargar el módulo carrito', 'No se pudo cargar el módulo checkout'],
    ['otra palabra hexadecimal sin dígitos', 'Fallo en decade', 'Fallo en facade'],
  ])('%s', (_caso, a, b) => {
    expect(mismo(a, b)).toBe(false);
  });
});

describe('Alcance según el tipo', () => {
  it('forma: el mismo error en dos productos es uno; en otra ruta, otro', () => {
    expect(formaDeUrl('https://tienda.example.test/producto/12')).toBe(
      'https://tienda.example.test/producto/#',
    );
    expect(alcanceDe('console-error', 'https://tienda.example.test/producto/12')).toBe(
      alcanceDe('console-error', 'https://tienda.example.test/producto/98'),
    );
    expect(alcanceDe('console-error', 'https://tienda.example.test/producto/12')).not.toBe(
      alcanceDe('console-error', 'https://tienda.example.test/carrito'),
    );
  });

  it('sitio: una cookie es del origen, en cualquier página', () => {
    expect(alcanceDe('cookie-insegura', 'https://tienda.example.test/login')).toBe(
      'https://tienda.example.test',
    );
    expect(alcanceDe('cookie-insegura', 'https://otra.example.test/login')).toBe(
      'https://otra.example.test',
    );
  });

  it('destino: un link roto es la URL rota exacta', () => {
    expect(alcanceDe('link-roto', 'https://tienda.example.test/ayuda/12')).toBe(
      'https://tienda.example.test/ayuda/12',
    );
  });

  it('todo tipo tiene su alcance', () => {
    expect(Object.keys(ALCANCE_POR_TIPO).length).toBe(13);
  });

  it('la ruta de un recurso con error va por su forma; lo demás, igual', () => {
    expect(claveEstable('recurso-con-error', '404 /img/123.png')).toBe('404 /img/#');
    expect(claveEstable('recurso-con-error', 'fallida net::ERR_FAILED')).toBe(
      'fallida net::ERR_FAILED',
    );
    expect(claveEstable('accesibilidad', 'color-contrast')).toBe('color-contrast');
  });
});

describe('Huella', () => {
  const SUBCLAVE = Buffer.alloc(32, 7);
  const OTRA = Buffer.alloc(32, 8);
  const base = {
    tipo: 'accesibilidad' as const,
    url: 'https://tienda.example.test/producto/12',
    clave: 'color-contrast',
  };

  it('determinística, y la misma para el mismo problema en otra página de la misma forma', () => {
    expect(huellaDe(SUBCLAVE, base)).toBe(huellaDe(SUBCLAVE, base));
    expect(huellaDe(SUBCLAVE, base)).toBe(
      huellaDe(SUBCLAVE, { ...base, url: 'https://tienda.example.test/producto/98' }),
    );
    expect(huellaDe(SUBCLAVE, base)).toMatch(/^h1:[0-9a-f]{64}$/);
  });

  it('otro tipo, otra clave u otra forma: otra huella', () => {
    const huella = huellaDe(SUBCLAVE, base);
    expect(huellaDe(SUBCLAVE, { ...base, clave: 'image-alt' })).not.toBe(huella);
    expect(huellaDe(SUBCLAVE, { ...base, tipo: 'console-error' })).not.toBe(huella);
    expect(huellaDe(SUBCLAVE, { ...base, url: 'https://tienda.example.test/carrito' })).not.toBe(
      huella,
    );
  });

  it('con otra subclave (otro proyecto), otra huella: no se puede probar candidatos sin la clave', () => {
    expect(huellaDe(OTRA, base)).not.toBe(huellaDe(SUBCLAVE, base));
  });

  it('el separador evita que dos combinaciones distintas den el mismo texto', () => {
    const a = huellaDe(SUBCLAVE, {
      tipo: 'accesibilidad',
      url: 'https://a.example.test/x',
      clave: 'yz',
    });
    const b = huellaDe(SUBCLAVE, {
      tipo: 'accesibilidad',
      url: 'https://a.example.test/xy',
      clave: 'z',
    });
    expect(a).not.toBe(b);
  });
});
