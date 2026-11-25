/**
 * Scripts de instalación (especificación 3.11, ADR 006 y 007): ningún paquete ejecuta código al
 * instalarse, salvo los de `scripts/allowed-install-scripts.mjs`, que se corren a mano.
 *
 * - `ignore-scripts=true` en `.npmrc`, y es la configuración efectiva de npm.
 * - Cada paquete del lockfile que podría ejecutar algo al instalarse está registrado acá, con el motivo.
 *   Cuenta como tal: `hasInstallScript` en el lockfile, un `preinstall`, `install` o `postinstall`, o un
 *   `binding.gyp` (npm lo toma como `node-gyp rebuild` implícito, salvo con `"gypfile": false`, y
 *   distintas versiones de npm lo registran distinto). Un paquete nuevo con script hace fallar el test
 *   hasta que se consulte y se registre.
 * - La lista permitida es exactamente la consultada: agregarle un paquete hace fallar el test.
 * - Ningún paquete con `binding.gyp` se compiló: no hay carpeta `build/` (la salida de node-gyp).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = path.resolve(import.meta.dirname, '..');

/**
 * Los paquetes con script de instalación, revisados. Ninguno se ejecuta: `ignore-scripts` los bloquea.
 * Para sumar uno: consultarlo, justificarlo en el PR y anotarlo acá.
 */
const REVISADOS: Record<string, string> = {
  argon2:
    '`install: node-gyp-build`. No hace falta: se usa el binario de `prebuilds/`, verificado por hash (ADR 005 y 007).',
  'better-sqlite3-multiple-ciphers':
    'Sin script declarado; trae `binding.gyp` con `"gypfile": false`. Se usa el binario de `prebuilds/`, verificado por hash (ADR 006 y 007).',
  fsevents: 'Opcional, solo macOS. No se instala en Windows ni en el CI de Linux.',
  'tesseract.js': '`postinstall` de opencollective, solo desarrollo. No hace falta (ADR 039).',
};

/** La lista permitida consultada: lo único que se ejecuta, a mano, con `npm run setup:native`. */
const PERMITIDOS = ['electron'];

interface EntradaLock {
  hasInstallScript?: boolean;
  link?: boolean;
}

const lock = JSON.parse(readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, EntradaLock>;
};

/** El nombre del paquete a partir de su clave en el lockfile (`node_modules/@a/b` → `@a/b`). */
const nombreDe = (clave: string) => clave.slice(clave.lastIndexOf('node_modules/') + 13);

function leerPaquete(carpeta: string): Record<string, unknown> | undefined {
  const ruta = path.join(RAIZ, carpeta, 'package.json');
  if (!existsSync(ruta)) return undefined;
  return JSON.parse(readFileSync(ruta, 'utf8')) as Record<string, unknown>;
}

/** Los paquetes del lockfile que podrían ejecutar algo al instalarse, con su carpeta. */
function conScript(): Map<string, string[]> {
  const encontrados = new Map<string, string[]>();
  for (const [clave, entrada] of Object.entries(lock.packages)) {
    if (!clave.includes('node_modules/') || entrada.link) continue;
    const paquete = leerPaquete(clave);
    const scripts = (paquete?.scripts ?? {}) as Record<string, unknown>;
    const declarado = ['preinstall', 'install', 'postinstall'].some((s) => s in scripts);
    const gyp = existsSync(path.join(RAIZ, clave, 'binding.gyp'));
    if (entrada.hasInstallScript === true || declarado || gyp) {
      const nombre = nombreDe(clave);
      encontrados.set(nombre, [...(encontrados.get(nombre) ?? []), clave]);
    }
  }
  return encontrados;
}

describe('scripts de instalación', () => {
  it('.npmrc tiene ignore-scripts=true', () => {
    const lineas = readFileSync(path.join(RAIZ, '.npmrc'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(lineas).toContain('ignore-scripts=true');
    expect(lineas.filter((l) => l.startsWith('ignore-scripts'))).toEqual(['ignore-scripts=true']);
  });

  it('y es la configuración efectiva de npm (ninguna variable ni config global la pisa)', () => {
    const valor = execSync('npm config get ignore-scripts', { cwd: RAIZ, encoding: 'utf8' }).trim();
    expect(valor).toBe('true');
  });

  it('cada paquete con script de instalación está revisado, y no sobra ninguno', () => {
    const encontrados = [...conScript().keys()].sort();
    // Control: el test ve los scripts (argon2 declara `install`).
    expect(encontrados).toContain('argon2');
    expect(encontrados).toEqual(Object.keys(REVISADOS).sort());
  });

  it('la lista permitida es exactamente la consultada', () => {
    const fuente = readFileSync(path.join(RAIZ, 'scripts/allowed-install-scripts.mjs'), 'utf8');
    const bloque = /const ALLOWED = \[([\s\S]*?)\n\];/.exec(fuente)?.[1];
    expect(bloque, 'no se encontró ALLOWED').toBeDefined();
    const paquetes = [...(bloque ?? '').matchAll(/^\s*pkg:\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(paquetes).toEqual(PERMITIDOS);
    // Ningún revisado entra a la lista permitida sin consulta.
    for (const nombre of Object.keys(REVISADOS)) expect(paquetes).not.toContain(nombre);
  });

  it('ningún paquete con binding.gyp se compiló al instalar: no hay salida de node-gyp', () => {
    const conGyp = [...conScript().values()]
      .flat()
      .filter((carpeta) => existsSync(path.join(RAIZ, carpeta, 'binding.gyp')));
    // Control: los dos nativos tienen binding.gyp y están instalados.
    expect(conGyp.map(nombreDe)).toEqual(
      expect.arrayContaining(['argon2', 'better-sqlite3-multiple-ciphers']),
    );
    for (const carpeta of conGyp) {
      expect(existsSync(path.join(RAIZ, carpeta, 'build')), carpeta).toBe(false);
    }
  });
});

describe('versión de npm (ADR 040)', () => {
  const paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')) as {
    packageManager?: string;
    engines?: Record<string, string>;
  };

  it('packageManager y engines.npm fijan la misma versión, y engine-strict la hace cumplir', () => {
    expect(paquete.packageManager).toBe('npm@10.9.3');
    expect(paquete.engines?.npm).toBe('>=10.9.3 <11');
    const npmrc = readFileSync(path.join(RAIZ, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^engine-strict=true$/m);
  });

  it('el npm que corre los tests cumple el rango', () => {
    const version = execSync('npm --version', { cwd: RAIZ, encoding: 'utf8' }).trim();
    const [mayor = 0, menor = 0, parche = 0] = version.split('.').map(Number);
    expect(mayor, version).toBe(10);
    expect(menor > 9 || (menor === 9 && parche >= 3), version).toBe(true);
  });
});
