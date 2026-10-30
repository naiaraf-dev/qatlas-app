import { describe, expect, it } from 'vitest';
import { evaluarContrasena, LARGO_MINIMO } from './contrasena';

describe('Contraseña maestra (RN-BOV-01)', () => {
  it('el mínimo es de 12 caracteres', () => {
    expect(LARGO_MINIMO).toBe(12);
  });

  it.each(['abc', 'x9$Lq2!vZ7k'])('rechaza por corta: %s', (contrasena) => {
    expect(evaluarContrasena(contrasena)).toMatchObject({ aceptable: false, motivo: 'corta' });
  });

  it('cuenta caracteres y no unidades UTF-16', () => {
    // 11 emojis ocupan 22 unidades UTF-16, pero siguen siendo 11 caracteres.
    expect(evaluarContrasena('🦊🐙🦉🐝🦋🐢🦀🐬🦔🐧🦕')).toMatchObject({ motivo: 'corta' });
  });

  it.each(['123456789012', 'qwertyuiopas', 'passwordpassword', 'contraseña123456'])(
    'rechaza contraseñas comunes o previsibles: %s',
    (contrasena) => {
      expect(evaluarContrasena(contrasena).aceptable).toBe(false);
    },
  );

  it('rechaza una contraseña de la lista común con el motivo "comun"', () => {
    for (const comun of ['1qaz2wsx3edc', 'administrator', '123456789012']) {
      expect(evaluarContrasena(comun)).toEqual({ puntaje: 0, aceptable: false, motivo: 'comun' });
    }
  });

  it('rechaza por débil lo largo pero previsible', () => {
    expect(evaluarContrasena('aaaaaaaaaaaaaaaa')).toMatchObject({ aceptable: false });
  });

  it.each(['tigre-morado-bajo-la-lluvia-73', 'V8#mQz!p2R@wK5xL'])(
    'acepta una contraseña fuerte: %s',
    (contrasena) => {
      const evaluacion = evaluarContrasena(contrasena);
      expect(evaluacion.aceptable).toBe(true);
      expect(evaluacion.motivo).toBeUndefined();
      expect(evaluacion.puntaje).toBeGreaterThanOrEqual(3);
    },
  );
});
