/**
 * Registro de los módulos nativos (ADR 007): el control positivo. Sobre una copia de los paquetes
 * instalados, en una carpeta temporal, se cambia un byte de un `.node` y fallan el script del CI, el
 * build (la función que llama `electron.vite.config.ts`) y la verificación de la app contra el valor
 * registrado. Al restaurarlo, los tres vuelven a pasar. El `node_modules` real no se toca.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verificarNativos } from '../apps/desktop/src/main/security/nativos';
import {
  binariosDe,
  carpetasDe,
  leerRegistro,
  manifiestoRegistrado,
  PAQUETES_NATIVOS,
  verificarInstalados,
} from '../scripts/nativos.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PLATAFORMA = `${process.platform}-${process.arch}`;
const SCRIPT = path.join(RAIZ, 'scripts/verificar-nativos.mjs');

let copia: string;
const carpetaEnCopia = (paquete: string) => path.join(copia, 'node_modules', paquete);

/** Cambia un byte del archivo y devuelve cómo restaurarlo. */
function cambiarUnByte(ruta: string): () => void {
  const original = readFileSync(ruta);
  const cambiado = Buffer.from(original);
  const medio = Math.floor(cambiado.length / 2);
  cambiado[medio] = (cambiado[medio] ?? 0) ^ 0xff;
  writeFileSync(ruta, cambiado);
  return () => {
    writeFileSync(ruta, original);
  };
}

/** El script del CI sobre la copia: el código de salida y lo que escribió. */
function correrScript(): { codigo: number; salida: string } {
  try {
    const salida = execFileSync(process.execPath, [SCRIPT, '--raiz', copia], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { codigo: 0, salida };
  } catch (error) {
    const fallo = error as { status: number; stderr: string };
    return { codigo: fallo.status, salida: fallo.stderr };
  }
}

/** La app, con el manifiesto registrado de esta plataforma, leyendo los binarios de la copia. */
const appAcepta = () =>
  verificarNativos(manifiestoRegistrado(RAIZ, PLATAFORMA), { carpetaDelPaquete: carpetaEnCopia });

beforeAll(() => {
  copia = mkdtempSync(path.join(os.tmpdir(), 'qatlas-nativos-'));
  mkdirSync(path.join(copia, 'scripts'));
  cpSync(
    path.join(RAIZ, 'scripts/nativos-hashes.json'),
    path.join(copia, 'scripts/nativos-hashes.json'),
  );
  writeFileSync(path.join(copia, 'package.json'), '{"name":"copia","private":true}');
  for (const paquete of PAQUETES_NATIVOS) {
    const [instalado] = carpetasDe(RAIZ, paquete);
    if (!instalado) throw new Error(`${paquete} no está instalado`);
    cpSync(
      path.join(instalado, 'package.json'),
      path.join(carpetaEnCopia(paquete), 'package.json'),
    );
    cpSync(path.join(instalado, 'prebuilds'), path.join(carpetaEnCopia(paquete), 'prebuilds'), {
      recursive: true,
    });
  }
});

afterAll(() => {
  rmSync(copia, { recursive: true, force: true, maxRetries: 3 });
});

describe('Registro de módulos nativos (ADR 007)', () => {
  it('lo instalado en el repo coincide con el registro, en todas las plataformas', () => {
    expect(verificarInstalados(RAIZ)).toEqual([]);
    const registro = leerRegistro(RAIZ);
    for (const paquete of PAQUETES_NATIVOS) {
      expect(Object.keys(registro[paquete] ?? {})).toHaveLength(1);
    }
  });

  it('control: la copia intacta pasa en el script, el build y la app', () => {
    expect(correrScript().codigo).toBe(0);
    expect(verificarInstalados(copia)).toEqual([]);
    expect(() => manifiestoRegistrado(copia, PLATAFORMA)).not.toThrow();
    expect(appAcepta()).toBe(true);
  });

  it.each(PAQUETES_NATIVOS)(
    '%s: un byte cambiado en el binario de esta plataforma hace fallar el script, el build y la app',
    (paquete) => {
      const [archivo] = binariosDe(carpetaEnCopia(paquete)).filter(
        (a) => a === `prebuilds/${PLATAFORMA}.node` || a.startsWith(`prebuilds/${PLATAFORMA}/`),
      );
      if (!archivo) throw new Error(`Sin binario de ${PLATAFORMA}`);
      const restaurar = cambiarUnByte(path.join(carpetaEnCopia(paquete), archivo));
      try {
        const { codigo, salida } = correrScript();
        expect(codigo).toBe(1);
        expect(salida).toContain(`${archivo} no coincide con el hash registrado`);
        // El log del CI es público: sin rutas.
        expect(salida).not.toContain(copia);
        expect(() => manifiestoRegistrado(copia, PLATAFORMA)).toThrow(/no coincide/);
        expect(appAcepta()).toBe(false);
      } finally {
        restaurar();
      }
      expect(correrScript().codigo).toBe(0);
      expect(appAcepta()).toBe(true);
    },
  );

  it('un binario de otra plataforma también se verifica: el CI de Linux ve el de Windows', () => {
    const otra = PLATAFORMA === 'win32-x64' ? 'linux-x64' : 'win32-x64';
    const archivo = `prebuilds/${otra}/argon2.glibc.node`;
    const restaurar = cambiarUnByte(path.join(carpetaEnCopia('argon2'), archivo));
    const { version } = JSON.parse(
      readFileSync(path.join(carpetaEnCopia('argon2'), 'package.json'), 'utf8'),
    ) as { version: string };
    try {
      expect(verificarInstalados(copia)).toEqual([
        `argon2 ${version}: ${archivo} no coincide con el hash registrado`,
      ]);
      expect(correrScript().codigo).toBe(1);
    } finally {
      restaurar();
    }
  });

  it('una versión sin registrar falla, aunque los binarios sean los mismos', () => {
    const ruta = path.join(carpetaEnCopia('argon2'), 'package.json');
    const original = readFileSync(ruta, 'utf8');
    writeFileSync(ruta, JSON.stringify({ ...JSON.parse(original), version: '9.9.9' }));
    try {
      expect(verificarInstalados(copia)).toContain(
        'argon2 9.9.9: versión no registrada en scripts/nativos-hashes.json',
      );
      expect(() => manifiestoRegistrado(copia, PLATAFORMA)).toThrow(/versión no registrada/);
    } finally {
      writeFileSync(ruta, original);
    }
  });

  it('un binario de más, o uno registrado que falta, también fallan', () => {
    const extra = path.join(
      carpetaEnCopia('better-sqlite3-multiple-ciphers'),
      'prebuilds/otro.node',
    );
    writeFileSync(extra, 'x');
    try {
      expect(verificarInstalados(copia).join('\n')).toContain(
        'prebuilds/otro.node no está en el registro',
      );
    } finally {
      rmSync(extra);
    }
    const falta = path.join(
      carpetaEnCopia('better-sqlite3-multiple-ciphers'),
      'prebuilds/darwin-x64.node',
    );
    const contenido = readFileSync(falta);
    rmSync(falta);
    try {
      expect(verificarInstalados(copia).join('\n')).toContain(
        'falta prebuilds/darwin-x64.node, que está registrado',
      );
    } finally {
      writeFileSync(falta, contenido);
    }
    expect(verificarInstalados(copia)).toEqual([]);
  });

  it('una plataforma sin binarios registrados no se puede compilar', () => {
    expect(() => manifiestoRegistrado(copia, 'plan9-mips')).toThrow(/no hay binarios registrados/);
  });

  it('el build usa el registro, y no calcula el hash del disco', () => {
    const config = readFileSync(path.join(RAIZ, 'apps/desktop/electron.vite.config.ts'), 'utf8');
    expect(config).toContain("import { manifiestoRegistrado } from '../../scripts/nativos.mjs';");
    expect(config).toContain('__QATLAS_NATIVOS__: JSON.stringify(manifiestoNativos())');
    expect(config).not.toMatch(/createHash|readFileSync/);
  });

  it('el CI y npm run check lo corren, y el CI verifica las firmas de npm', () => {
    const ci = readFileSync(path.join(RAIZ, '.github/workflows/ci.yml'), 'utf8');
    const calidad = ci.slice(ci.indexOf('calidad:'), ci.indexOf('electron:'));
    expect(calidad.indexOf('run: npm run nativos:verificar')).toBeGreaterThan(
      calidad.indexOf('run: npm ci'),
    );
    expect(calidad).toContain('run: npm audit signatures');
    const paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(paquete.scripts.check).toContain('npm run nativos:verificar');
    expect(paquete.scripts['nativos:verificar']).toBe('node scripts/verificar-nativos.mjs');
  });
});
