/**
 * El portapapeles (3.9, ADR 048): lo sensible se limpia a los 30 segundos, solo si sigue ahí.
 */
import { describe, expect, it } from 'vitest';
import { CopiaSegura, LIMPIEZA_MS, type Portapapeles, type Reloj } from './portapapeles';

function entorno() {
  let contenido = '';
  const tareas: { accion: () => void; ms: number; cancelada: boolean }[] = [];
  const portapapeles: Portapapeles = {
    escribir: (texto) => {
      contenido = texto;
    },
    leer: () => contenido,
    limpiar: () => {
      contenido = '';
    },
  };
  const reloj: Reloj = {
    programar: (accion, ms) => {
      const tarea = { accion, ms, cancelada: false };
      tareas.push(tarea);
      return tarea;
    },
    cancelar: (id) => {
      (id as { cancelada: boolean }).cancelada = true;
    },
  };
  const pasar = () => {
    for (const tarea of tareas.splice(0)) if (!tarea.cancelada) tarea.accion();
  };
  return {
    copia: new CopiaSegura(portapapeles, reloj),
    leer: () => contenido,
    escribir: (texto: string) => {
      portapapeles.escribir(texto);
    },
    tareas,
    pasar,
  };
}

describe('Portapapeles', () => {
  it('lo sensible se limpia a los 30 segundos', () => {
    const e = entorno();
    expect(e.copia.copiar('contraseña-de-un-solo-uso', true)).toEqual({ limpiaEnMs: LIMPIEZA_MS });
    expect(e.tareas[0]?.ms).toBe(30_000);
    expect(e.leer()).toBe('contraseña-de-un-solo-uso');
    e.pasar();
    expect(e.leer()).toBe('');
  });

  it('control: lo que no es sensible se queda', () => {
    const e = entorno();
    expect(e.copia.copiar('# Un reporte', false)).toEqual({ limpiaEnMs: null });
    e.pasar();
    expect(e.leer()).toBe('# Un reporte');
  });

  it('si la persona copió otra cosa después, no se la borra', () => {
    const e = entorno();
    e.copia.copiar('contraseña-de-un-solo-uso', true);
    e.escribir('algo que copió la persona');
    e.pasar();
    expect(e.leer()).toBe('algo que copió la persona');
  });

  it('al bloquear, lo sensible pendiente se limpia ya', () => {
    const e = entorno();
    e.copia.copiar('contraseña-de-un-solo-uso', true);
    e.copia.limpiarPendiente();
    expect(e.leer()).toBe('');
    expect(e.tareas.every((t) => t.cancelada)).toBe(true);
  });
});
