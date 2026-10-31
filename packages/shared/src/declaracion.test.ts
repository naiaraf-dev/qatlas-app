import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PLANTILLA_DECLARACION,
  renderizarDeclaracion,
  verificarAutorizacion,
  VERSION_DECLARACION,
} from './declaracion';

const ALCANCE = {
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.lexora.test', '*.lexora.test'],
  sistemaInterno: false,
};
const ACEPTADA = { ...ALCANCE, version: VERSION_DECLARACION, invalidada: false };

describe('Declaración de autorización', () => {
  it('el texto de la versión 1 está congelado: un cambio de fondo es una versión nueva', () => {
    const hash = createHash('sha256').update(PLANTILLA_DECLARACION).digest('hex');
    expect({ version: VERSION_DECLARACION, hash }).toEqual({
      version: 1,
      hash: '1cb2bb366e29b2f9ee7f69fb3b8d41278ac8e4e9376f1c98030811bdf4711455',
    });
  });

  it('incluye el alcance real', () => {
    const texto = renderizarDeclaracion(ALCANCE);
    expect(texto).toContain('https://app.lexora.test/ · app.lexora.test, *.lexora.test');
    expect(texto).not.toContain('{url_base}');
    expect(texto).not.toContain('{dominios}');
  });

  it('un $ en la URL no se interpreta como patrón de reemplazo', () => {
    const texto = renderizarDeclaracion({ urlBase: "https://x.test/$'$&", dominios: ['x.test'] });
    expect(texto).toContain("https://x.test/$'$&");
  });
});

describe('verificarAutorizacion (RN-PRY-01 y RN-PRY-03)', () => {
  it('vigente con la misma versión y el mismo alcance', () => {
    expect(verificarAutorizacion(ALCANCE, ACEPTADA)).toEqual({ vigente: true });
  });

  it('el orden de los dominios no cambia el alcance', () => {
    const invertidos = { ...ALCANCE, dominios: [...ALCANCE.dominios].reverse() };
    expect(verificarAutorizacion(invertidos, ACEPTADA)).toEqual({ vigente: true });
  });

  it.each([[null], [undefined]])('falla cerrado sin aceptación: %s', (aceptada) => {
    expect(verificarAutorizacion(ALCANCE, aceptada)).toEqual({
      vigente: false,
      motivo: 'sin-aceptar',
    });
  });

  it.each([
    ['otra URL base', { ...ALCANCE, urlBase: 'https://otra.lexora.test/' }],
    ['un dominio más', { ...ALCANCE, dominios: [...ALCANCE.dominios, 'otra.test'] }],
    ['un dominio menos', { ...ALCANCE, dominios: ['*.lexora.test'] }],
    ['la opción Sistema interno', { ...ALCANCE, sistemaInterno: true }],
  ])('cambiar %s invalida la autorización', (_nombre, alcance) => {
    expect(verificarAutorizacion(alcance, ACEPTADA)).toEqual({
      vigente: false,
      motivo: 'alcance-cambiado',
    });
  });

  it('una aceptación invalidada no revive al volver al mismo alcance', () => {
    expect(verificarAutorizacion(ALCANCE, { ...ACEPTADA, invalidada: true })).toEqual({
      vigente: false,
      motivo: 'alcance-cambiado',
    });
  });

  it('una versión nueva de la declaración obliga a aceptar de nuevo', () => {
    expect(verificarAutorizacion(ALCANCE, ACEPTADA, VERSION_DECLARACION + 1)).toEqual({
      vigente: false,
      motivo: 'version-anterior',
    });
  });
});
