/**
 * La cobertura (5.1, ADR 047): «posiblemente resuelto» solo si la ejecución recorrió esa página, con el
 * mismo contexto.
 */
import { describe, expect, it } from 'vitest';
import type { CandidatoCobertura } from '@qatlas/db';
import { cubre, decidirCobertura } from './cobertura';

const SIN_LOGIN = { credencialId: null, rol: null };
const ADMIN = { credencialId: 'cred-1', rol: 'admin' };
const lugar = (
  url: string,
  contexto: { credencialId: string | null; rol: string | null } = SIN_LOGIN,
) => ({ url, ...contexto });

describe('Cubre', () => {
  it('la misma página, o una de la misma forma, con el mismo contexto', () => {
    expect(
      cubre(
        SIN_LOGIN,
        ['https://a.example.test/producto/12'],
        [lugar('https://a.example.test/producto/12')],
      ),
    ).toBe(true);
    expect(
      cubre(
        SIN_LOGIN,
        ['https://a.example.test/producto/98'],
        [lugar('https://a.example.test/producto/12')],
      ),
    ).toBe(true);
  });

  it('control: otra página no lo cubre', () => {
    expect(
      cubre(
        SIN_LOGIN,
        ['https://a.example.test/carrito'],
        [lugar('https://a.example.test/producto/12')],
      ),
    ).toBe(false);
    expect(cubre(SIN_LOGIN, [], [lugar('https://a.example.test/producto/12')])).toBe(false);
  });

  it('otro contexto no lo cubre: sin login no cubre lo visto como admin, ni otro rol', () => {
    const visto = [lugar('https://a.example.test/panel', ADMIN)];
    expect(cubre(SIN_LOGIN, ['https://a.example.test/panel'], visto)).toBe(false);
    expect(
      cubre({ credencialId: 'cred-1', rol: 'lector' }, ['https://a.example.test/panel'], visto),
    ).toBe(false);
    expect(cubre(ADMIN, ['https://a.example.test/panel'], visto)).toBe(true);
  });
});

describe('Decidir al terminar', () => {
  const candidato = (
    id: string,
    estado: CandidatoCobertura['estado'],
    url: string,
  ): CandidatoCobertura => ({
    id,
    estado,
    estadoPrevio: null,
    tipo: 'console-error',
    lugares: [lugar(url)],
  });

  it('un abierto cubierto pasa a posiblemente resuelto; uno no cubierto no cambia', () => {
    const { cambios, cubiertos } = decidirCobertura(
      [
        candidato('a', 'nuevo', 'https://a.example.test/x'),
        candidato('b', 'confirmado', 'https://a.example.test/no-recorrida'),
      ],
      SIN_LOGIN,
      ['https://a.example.test/x'],
    );
    expect(cambios).toEqual([{ id: 'a', estado: 'posiblemente_resuelto', estadoPrevio: 'nuevo' }]);
    expect(cubiertos).toEqual(['a']);
  });

  it('un resuelto o descartado cubierto solo anota la cobertura', () => {
    const { cambios, cubiertos } = decidirCobertura(
      [
        candidato('r', 'resuelto', 'https://a.example.test/x'),
        candidato('d', 'descartado', 'https://a.example.test/x'),
      ],
      SIN_LOGIN,
      ['https://a.example.test/x'],
    );
    expect(cambios).toEqual([]);
    expect(cubiertos).toEqual(['r', 'd']);
  });
});
