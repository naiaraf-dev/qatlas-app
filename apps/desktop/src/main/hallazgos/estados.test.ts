/**
 * Las transiciones de estado de un hallazgo (5.1 y 5.2, ADR 047).
 */
import { describe, expect, it } from 'vitest';
import type { EstadoHallazgo } from '@qatlas/shared';
import { alAparecer, alNoAparecerCubierto, decidir, estadoAlFusionar } from './estados';

const en = (estado: EstadoHallazgo, estadoPrevio: EstadoHallazgo | null = null) => ({
  estado,
  estadoPrevio,
});

describe('Cuando aparece', () => {
  it('la primera vez: nuevo, aparición nueva', () => {
    expect(alAparecer(null)).toEqual({
      estado: 'nuevo',
      estadoPrevio: null,
      aparicion: 'nueva',
      alerta: false,
    });
  });

  it('un resuelto que vuelve: regresión, con alerta', () => {
    expect(alAparecer(en('resuelto'))).toMatchObject({
      estado: 'regresion',
      aparicion: 'regresion',
      alerta: true,
    });
  });

  it('control: ningún otro estado da regresión', () => {
    const otros: EstadoHallazgo[] = [
      'nuevo',
      'confirmado',
      'descartado',
      'reportado',
      'posiblemente_resuelto',
      'regresion',
    ];
    for (const estado of otros) {
      const resultado = alAparecer(en(estado, 'confirmado'));
      expect(resultado.aparicion, estado).toBe('recurrente');
      expect(resultado.alerta, estado).toBe(false);
    }
  });

  it('un posiblemente resuelto que vuelve: recupera su estado anterior', () => {
    expect(alAparecer(en('posiblemente_resuelto', 'confirmado'))).toMatchObject({
      estado: 'confirmado',
      estadoPrevio: null,
      aparicion: 'recurrente',
    });
    expect(alAparecer(en('posiblemente_resuelto', null)).estado).toBe('nuevo');
  });

  it('un descartado que vuelve: sigue descartado, sin alerta', () => {
    expect(alAparecer(en('descartado'))).toMatchObject({
      estado: 'descartado',
      aparicion: 'recurrente',
      alerta: false,
    });
  });

  it('un confirmado o reportado que vuelve no pierde la decisión', () => {
    expect(alAparecer(en('confirmado')).estado).toBe('confirmado');
    expect(alAparecer(en('reportado')).estado).toBe('reportado');
  });
});

describe('Cuando una ejecución lo cubrió y no apareció', () => {
  it('los abiertos pasan a posiblemente resuelto, recordando el estado', () => {
    for (const estado of ['nuevo', 'confirmado', 'reportado', 'regresion'] as const) {
      expect(alNoAparecerCubierto(en(estado))).toEqual({
        estado: 'posiblemente_resuelto',
        estadoPrevio: estado,
      });
    }
  });

  it('descartado, resuelto y posiblemente resuelto no cambian', () => {
    for (const estado of ['descartado', 'resuelto'] as const) {
      expect(alNoAparecerCubierto(en(estado))).toEqual(en(estado));
    }
    expect(alNoAparecerCubierto(en('posiblemente_resuelto', 'nuevo'))).toEqual(
      en('posiblemente_resuelto', 'nuevo'),
    );
  });
});

describe('Decisiones de la persona', () => {
  it('resolver: desde abierto o posiblemente resuelto; nunca un descartado', () => {
    expect(decidir(en('posiblemente_resuelto', 'nuevo'), { accion: 'resolver' })).toEqual(
      en('resuelto'),
    );
    expect(decidir(en('nuevo'), { accion: 'resolver' })).toEqual(en('resuelto'));
    expect(decidir(en('descartado'), { accion: 'resolver' })).toBeNull();
    expect(decidir(en('resuelto'), { accion: 'resolver' })).toBeNull();
  });

  it('descartar y reabrir: solo un descartado se reabre, y vuelve a nuevo', () => {
    expect(decidir(en('confirmado'), { accion: 'descartar' })).toEqual(en('descartado'));
    expect(decidir(en('descartado'), { accion: 'descartar' })).toBeNull();
    expect(decidir(en('descartado'), { accion: 'reabrir' })).toEqual(en('nuevo'));
    expect(decidir(en('nuevo'), { accion: 'reabrir' })).toBeNull();
  });

  it('confirmar: desde nuevo, regresión o posiblemente resuelto', () => {
    for (const estado of ['nuevo', 'regresion', 'posiblemente_resuelto'] as const) {
      expect(decidir(en(estado), { accion: 'confirmar' })).toEqual(en('confirmado'));
    }
    expect(decidir(en('resuelto'), { accion: 'confirmar' })).toBeNull();
  });
});

describe('Fusión de duplicados (lo guardado antes de la semana 8)', () => {
  const fila = (estado: EstadoHallazgo, decisionEn: string | null, ultimaVezEn: string) => ({
    estado,
    estadoPrevio: null,
    decisionEn,
    ultimaVezEn,
  });

  it('gana la última decisión de una persona, aunque otro haya aparecido después', () => {
    expect(
      estadoAlFusionar([
        fila('confirmado', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
        fila('descartado', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z'),
        fila('nuevo', null, '2026-11-05T10:00:00Z'),
      ]),
    ).toMatchObject({ estado: 'descartado', decisionEn: '2026-11-02T10:00:00Z' });
  });

  it('sin decisiones: el del que apareció por última vez', () => {
    expect(
      estadoAlFusionar([
        fila('regresion', null, '2026-11-05T10:00:00Z'),
        fila('nuevo', null, '2026-11-01T10:00:00Z'),
      ]).estado,
    ).toBe('regresion');
  });
});
