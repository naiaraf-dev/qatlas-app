/**
 * El portapapeles (3.9, ADR 048): lo sensible se limpia a los 30 segundos, solo si sigue ahí.
 */
import { describe, expect, it } from 'vitest';
import { CopiaSegura, LIMPIEZA_MS, type Portapapeles, type Reloj } from './portapapeles';

function entorno() {
  let contenido = '';
  let fallaLectura = false;
  const tareas: { accion: () => void; ms: number; cancelada: boolean }[] = [];
  const portapapeles: Portapapeles = {
    escribir: (texto) => {
      contenido = texto;
      return Promise.resolve();
    },
    leer: () =>
      fallaLectura ? Promise.reject(new Error('sin acceso')) : Promise.resolve(contenido),
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
  /** Corre lo programado y espera a que terminen sus lecturas del portapapeles. */
  const pasar = async () => {
    for (const tarea of tareas.splice(0)) if (!tarea.cancelada) tarea.accion();
    await new Promise((listo) => setImmediate(listo));
  };
  return {
    copia: new CopiaSegura(portapapeles, reloj),
    leer: () => contenido,
    escribir: (texto: string) => {
      contenido = texto;
    },
    tareas,
    pasar,
    fallarLectura: () => {
      fallaLectura = true;
    },
  };
}

describe('Portapapeles', () => {
  it('si no se puede leer el portapapeles, lo sensible se limpia igual (falla cerrado)', async () => {
    const e = entorno();
    await e.copia.copiar('contraseña-de-un-solo-uso', true);
    e.fallarLectura();
    await e.pasar();
    expect(e.leer()).toBe('');
  });

  it('lo sensible se limpia a los 30 segundos', async () => {
    const e = entorno();
    expect(await e.copia.copiar('contraseña-de-un-solo-uso', true)).toEqual({
      limpiaEnMs: LIMPIEZA_MS,
    });
    expect(e.tareas[0]?.ms).toBe(30_000);
    expect(e.leer()).toBe('contraseña-de-un-solo-uso');
    await e.pasar();
    expect(e.leer()).toBe('');
  });

  it('control: lo que no es sensible se queda', async () => {
    const e = entorno();
    expect(await e.copia.copiar('# Un reporte', false)).toEqual({ limpiaEnMs: null });
    await e.pasar();
    expect(e.leer()).toBe('# Un reporte');
  });

  it('si la persona copió otra cosa después, no se la borra', async () => {
    const e = entorno();
    await e.copia.copiar('contraseña-de-un-solo-uso', true);
    e.escribir('algo que copió la persona');
    await e.pasar();
    expect(e.leer()).toBe('algo que copió la persona');
  });

  it('al bloquear, lo sensible pendiente se limpia ya', async () => {
    const e = entorno();
    await e.copia.copiar('contraseña-de-un-solo-uso', true);
    await e.copia.limpiarPendiente();
    expect(e.leer()).toBe('');
    expect(e.tareas.every((t) => t.cancelada)).toBe(true);
  });
});
