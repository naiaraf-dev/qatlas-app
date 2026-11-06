import type { test as testBase } from '@playwright/test';

/** Solo los nombres: un valor del entorno no debe terminar en el log de un repo público. */
export function diferenciasDeEntorno(
  antes: Readonly<Record<string, string | undefined>>,
  despues: Readonly<Record<string, string | undefined>>,
): string[] {
  return [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((nombre) => !DEL_RUNNER_DE_PLAYWRIGHT.has(nombre))
    .filter((nombre) => antes[nombre] !== despues[nombre])
    .sort();
}

/**
 * Las que pone Playwright, no el test. `BROWSERSLIST_IGNORE_OLD_DATA`: la define cada vez que transpila un
 * archivo que no está en su caché, y un `import()` dentro de un test (TS-06 carga así los servicios) lo
 * hace después de la foto del entorno. Pasaba solo cuando el archivo había cambiado desde la corrida
 * anterior.
 */
const DEL_RUNNER_DE_PLAYWRIGHT = new Set(['BROWSERSLIST_IGNORE_OLD_DATA']);

/**
 * Falla si un test deja `process.env` distinto de como lo encontró. El punto de referencia es uno solo,
 * tomado al cargar el archivo, para ver también lo que cambie un `beforeAll`. Todos los tests de un
 * worker comparten el entorno: así un test rompió `os.tmpdir()` a otro archivo.
 */
export function vigilarEntorno(test: typeof testBase): void {
  const inicial = { ...process.env };
  test.afterEach(() => {
    const cambios = diferenciasDeEntorno(inicial, process.env);
    if (cambios.length > 0) {
      throw new Error(`Este test dejó cambiado el entorno: ${cambios.join(', ')}`);
    }
  });
}

/** Asignar `undefined` a `process.env` guarda el texto "undefined": hay que borrar la variable. */
export function restaurarEntorno(valores: Record<string, string | undefined>): void {
  for (const [nombre, valor] of Object.entries(valores)) {
    if (valor === undefined) Reflect.deleteProperty(process.env, nombre);
    else process.env[nombre] = valor;
  }
}
