import { describe, expect, it } from 'vitest';
import { formaDeRuta, Frontera, LIMITES_DE_TRAMPA, normalizarUrl, sinQuery } from './urls';

describe('normalizarUrl (RN-ESC-04)', () => {
  it.each([
    ['https://App.Lexora.test/panel#seccion', 'https://app.lexora.test/panel'],
    ['https://app.lexora.test/panel/', 'https://app.lexora.test/panel'],
    ['https://app.lexora.test/', 'https://app.lexora.test/'],
    ['https://app.lexora.test', 'https://app.lexora.test/'],
    ['https://app.lexora.test:443/x', 'https://app.lexora.test/x'],
    ['http://app.lexora.test:80/x', 'http://app.lexora.test/x'],
    ['https://app.lexora.test/x?b=2&a=1', 'https://app.lexora.test/x?a=1&b=2'],
    ['https://app.lexora.test/x?a=2&a=1', 'https://app.lexora.test/x?a=1&a=2'],
    ['https://usuario:clave@example.com/x', 'https://example.com/x'],
    ['https://app.lexora.test/x//', 'https://app.lexora.test/x'],
  ])('%s → %s', (entrada, salida) => {
    expect(normalizarUrl(entrada)).toBe(salida);
  });

  it('resuelve una ruta relativa contra la página', () => {
    expect(normalizarUrl('../otra', 'https://app.lexora.test/a/b')).toBe(
      'https://app.lexora.test/otra',
    );
  });

  it.each([
    'javascript:alert(1)',
    'mailto:ana@example.com',
    'ftp://x.test/',
    'no es una url',
    'data:text/html,x',
  ])('descarta %s', (entrada) => {
    expect(normalizarUrl(entrada)).toBeNull();
  });

  it('descarta una URL de más de 2048 caracteres', () => {
    expect(normalizarUrl(`https://app.lexora.test/?q=${'x'.repeat(2100)}`)).toBeNull();
  });

  it('sinQuery deja origen y ruta', () => {
    expect(sinQuery('https://app.lexora.test/x?token=abc')).toBe('https://app.lexora.test/x');
  });

  it('la forma reemplaza los segmentos con números', () => {
    expect(formaDeRuta('https://x.test/calendario/2026/11')).toBe('https://x.test/calendario/#/#');
    expect(formaDeRuta('https://x.test/item-42/ver')).toBe('https://x.test/#/ver');
  });
});

describe('Frontera', () => {
  it('es una cola en anchura y no repite', () => {
    const frontera = new Frontera();
    expect(frontera.agregar('https://x.test/a', 1, 'https://x.test/')).toBe('agregada');
    expect(frontera.agregar('https://x.test/b', 1, 'https://x.test/')).toBe('agregada');
    expect(frontera.agregar('https://x.test/a', 2, 'https://x.test/b')).toBe('repetida');
    expect(frontera.siguiente()?.url).toBe('https://x.test/a');
    expect(frontera.siguiente()).toMatchObject({ url: 'https://x.test/b', profundidad: 1 });
    expect(frontera.siguiente()).toBeUndefined();
  });

  it('una URL marcada como vista, por una redirección, no se vuelve a encolar', () => {
    const frontera = new Frontera();
    frontera.marcarVista('https://x.test/login');
    expect(frontera.agregar('https://x.test/login', 1, null)).toBe('repetida');
  });

  it('corta un parámetro que cambia siempre', () => {
    const frontera = new Frontera();
    const resultados = Array.from({ length: 30 }, (_, i) =>
      frontera.agregar(`https://x.test/buscar?t=${i}`, 1, null),
    );
    expect(resultados.filter((r) => r === 'agregada')).toHaveLength(
      LIMITES_DE_TRAMPA.variantesPorRuta,
    );
    expect(frontera.descartadasPorTrampa).toBe(30 - LIMITES_DE_TRAMPA.variantesPorRuta);
  });

  it('corta un calendario: rutas con la misma forma', () => {
    const frontera = new Frontera();
    for (let mes = 1; mes <= 30; mes++)
      frontera.agregar(`https://x.test/calendario/2026/${mes}`, 1, null);
    expect(frontera.quedan).toBe(LIMITES_DE_TRAMPA.rutasPorForma);
  });

  it('otras rutas de la misma forma ya vistas siguen sumando variantes', () => {
    const frontera = new Frontera();
    for (let i = 0; i < 10; i++) frontera.agregar(`https://x.test/item/${i}`, 1, null);
    expect(frontera.agregar('https://x.test/item/3?vista=lista', 1, null)).toBe('agregada');
    expect(frontera.agregar('https://x.test/item/11', 1, null)).toBe('trampa');
  });
});
