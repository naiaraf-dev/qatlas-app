import { describe, expect, it } from 'vitest';
import { causaDeFalla, detalleDeFalla, perfilDemasiadoLargo } from './diagnostico';

describe('Por qué no arrancó el navegador', () => {
  it.each([
    ["browserType.launch: Executable doesn't exist at /x/chrome", 'ruta'],
    ['spawn /x/chrome ENOENT', 'ruta'],
    ['FATAL: No usable sandbox!', 'sandbox'],
    ['Failed to move to new namespace', 'sandbox'],
    ['error while loading shared libraries: libnss3.so', 'dependencias'],
    ['Host system is missing dependencies', 'dependencias'],
    ['Target closed', 'otra'],
  ])('%s → %s', (mensaje, causa) => {
    expect(causaDeFalla(mensaje)).toBe(causa);
  });

  it('el detalle lleva las líneas de error, sin rutas', () => {
    const detalle = detalleDeFalla(
      [
        '<launching> /home/ana/.cache/chrome --proxy-server=http://127.0.0.1:1',
        '[pid=1][err] [1:1:ERROR:process_singleton.cc(1)] Socket path too long: /tmp/ana/perfil/x',
        'C:\\Users\\ana\\AppData\\chrome.exe ERROR: algo',
        'cualquier otra línea',
      ].join('\n'),
    );
    expect(detalle).toContain('Socket path too long');
    expect(detalle).not.toMatch(/ana|launching|proxy-server|otra línea/);
  });

  it('el detalle tiene un largo máximo', () => {
    expect(detalleDeFalla(`ERROR: ${'x'.repeat(1000)}`).length).toBeLessThanOrEqual(300);
  });
});

describe('Largo del perfil, por el socket de Chromium', () => {
  it('la ruta corta de los E2E entra, y la de un UUID no entraba', () => {
    const corta = '/tmp/qatlas-e2e-ejecuciones-AbCdEf/QAtlas/perfiles/12345678';
    const conUuid =
      '/tmp/qatlas-e2e-ejecuciones-AbCdEf/QAtlas/perfiles/12345678-1234-4234-8234-123456789012';
    expect(perfilDemasiadoLargo(corta, 'linux')).toBe(false);
    expect(perfilDemasiadoLargo(conUuid, 'linux')).toBe(true);
  });

  it('una carpeta de datos típica entra', () => {
    expect(perfilDemasiadoLargo('/home/ana/.config/QAtlas/perfiles/12345678', 'linux')).toBe(false);
  });

  it('en Windows no hay socket Unix', () => {
    expect(perfilDemasiadoLargo(`C:\\${'x'.repeat(200)}`, 'win32')).toBe(false);
  });
});
