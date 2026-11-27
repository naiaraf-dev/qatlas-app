/**
 * La caché del CI no saltea las verificaciones (ADR 044). Lo que se restaura de la caché pasa por lo mismo
 * que una descarga, y si fue alterado, falla:
 *
 * - Electron: `scripts/verificar-cache-electron.mjs` compara cada archivo de la caché de `@electron/get` con
 *   `checksums.json` del paquete instalado. Corre antes del script de instalación de Electron.
 * - Chromium: `scripts/verificar-navegador.mjs` compara la carpeta de los navegadores de Playwright con el
 *   hash registrado (ADR 020), venga de donde venga.
 *
 * Cada caso tiene su control: sin alterar, pasa. Todo en carpetas temporales, con archivos inventados.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { problemasDeLaCache } from '../scripts/verificar-cache-electron.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

let temporales: string[] = [];
const temporal = () => {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-cache-'));
  temporales.push(carpeta);
  return carpeta;
};
afterEach(() => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true });
  temporales = [];
});

const correr = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [path.join(RAIZ, 'scripts', script), ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('Caché de Electron', () => {
  it('coincide: sin problemas; con un byte de más: falla; otra versión no cuenta', () => {
    const carpeta = temporal();
    // Como la arma @electron/get: una carpeta por URL (un hash) y el zip adentro.
    const sub = path.join(carpeta, 'a'.repeat(64));
    mkdirSync(sub);
    const zip = path.join(sub, 'electron-v1.0.0-linux-x64.zip');
    writeFileSync(zip, 'contenido inventado');
    const checksums = { 'electron-v1.0.0-linux-x64.zip': sha256('contenido inventado') };

    // Control: sin alterar, pasa.
    expect(problemasDeLaCache(carpeta, checksums)).toEqual([]);
    // Un byte de más.
    appendFileSync(zip, 'x');
    expect(problemasDeLaCache(carpeta, checksums)).toEqual([
      'electron-v1.0.0-linux-x64.zip: el SHA-256 no coincide',
    ]);
    // Un archivo de otra versión no se usa, y no cambia nada; el que se usa sigue verificado.
    writeFileSync(path.join(sub, 'electron-v0.9.0-linux-x64.zip'), 'x');
    expect(problemasDeLaCache(carpeta, checksums)).toEqual([
      'electron-v1.0.0-linux-x64.zip: el SHA-256 no coincide',
    ]);
    writeFileSync(zip, 'contenido inventado');
    expect(problemasDeLaCache(carpeta, checksums)).toEqual([]);
  });

  it('sin caché no hay nada que verificar: Electron se descarga y se verifica como siempre', () => {
    expect(problemasDeLaCache(path.join(temporal(), 'no-existe'), {})).toEqual([]);
  });

  it(
    'el script, con el checksums.json real: una caché alterada sale con 1, sin rutas',
    { timeout: 30_000 },
    () => {
      const version = (
        createRequire(path.join(RAIZ, 'apps/desktop/package.json'))('electron/package.json') as {
          version: string;
        }
      ).version;
      const carpeta = temporal();
      // Control: vacía, pasa.
      expect(correr('verificar-cache-electron.mjs', ['--cache', carpeta]).status).toBe(0);

      const sub = path.join(carpeta, 'b'.repeat(64));
      mkdirSync(sub);
      writeFileSync(
        path.join(sub, `electron-v${version}-linux-x64.zip`),
        'no es el zip de Electron',
      );
      const resultado = correr('verificar-cache-electron.mjs', ['--cache', carpeta]);
      expect(resultado.status).toBe(1);
      expect(resultado.stderr).toContain('el SHA-256 no coincide');
      expect(resultado.stderr).not.toContain(carpeta);
    },
  );
});

describe('Caché de los navegadores de Playwright', () => {
  // La revisión del Chromium de Playwright, y dónde queda el ejecutable dentro de su carpeta en cada
  // plataforma soportada (Chrome for Testing). Sin `executablePath`: nadie más que la app lo usa.
  const navegadoresJson = JSON.parse(
    readFileSync(path.join(RAIZ, 'node_modules/playwright-core/browsers.json'), 'utf8'),
  ) as { browsers: { name: string; revision: string }[] };
  const revision = `chromium-${navegadoresJson.browsers.find((b) => b.name === 'chromium')?.revision ?? ''}`;
  const EJECUTABLE: Partial<Record<NodeJS.Platform, string[]>> = {
    win32: ['chrome-win64', 'chrome.exe'],
    linux: ['chrome-linux64', 'chrome'],
  };
  const dentro = EJECUTABLE[process.platform] ?? [];

  it(
    'restaurada igual: pasa; con un byte cambiado o un archivo de más: falla',
    { timeout: 60_000 },
    () => {
      expect(dentro.length).toBeGreaterThan(0);
      const navegadores = temporal();
      const carpeta = path.join(navegadores, revision);
      const ejecutable = path.join(carpeta, ...dentro);
      mkdirSync(path.dirname(ejecutable), { recursive: true });
      writeFileSync(ejecutable, 'ejecutable inventado');
      writeFileSync(path.join(path.dirname(ejecutable), 'recursos.pak'), 'recursos inventados');
      const env = { PLAYWRIGHT_BROWSERS_PATH: navegadores };

      // El hash de esta carpeta, registrado en un registro temporal: la «primera descarga».
      const calculado = correr('verificar-navegador.mjs', ['--calcular'], env);
      expect(calculado.status).toBe(0);
      const [rev, plataforma, hash] = calculado.stdout.trim().split(' ');
      expect(rev).toBe(revision);
      const registro = path.join(temporal(), 'registro.json');
      writeFileSync(registro, JSON.stringify({ [revision]: { [plataforma ?? '']: hash } }));

      // Control: lo mismo que se registró, pasa.
      expect(correr('verificar-navegador.mjs', ['--registro', registro], env).status).toBe(0);

      // Un byte cambiado en un archivo restaurado.
      writeFileSync(path.join(path.dirname(ejecutable), 'recursos.pak'), 'recursos inventadoz');
      const alterado = correr('verificar-navegador.mjs', ['--registro', registro], env);
      expect(alterado.status).toBe(1);
      expect(alterado.stderr).toContain('no coincide');

      // Un archivo de más.
      writeFileSync(path.join(path.dirname(ejecutable), 'recursos.pak'), 'recursos inventados');
      expect(correr('verificar-navegador.mjs', ['--registro', registro], env).status).toBe(0);
      writeFileSync(path.join(carpeta, 'agregado.dll'), 'x');
      expect(correr('verificar-navegador.mjs', ['--registro', registro], env).status).toBe(1);
    },
  );
});
