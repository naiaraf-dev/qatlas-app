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
 * - Versiones exactas: `save-exact=true`, y ningún `package.json` tiene un rango con `^` o `~`.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    // Lanzar npm tarda: con la máquina cargada, más que los 5 s por defecto.
  }, 30_000);

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
  }, 30_000);
});

describe('react-aria-components (ADR 042)', () => {
  /** El árbol completo de dependencias de un paquete, según el lockfile. */
  function arbol(nombre: string): Map<string, string> {
    const vistos = new Map<string, string>();
    const pendientes = [nombre];
    while (pendientes.length > 0) {
      const actual = pendientes.pop() ?? '';
      if (vistos.has(actual)) continue;
      const clave = `node_modules/${actual}`;
      const entrada = lock.packages[clave] as
        (EntradaLock & { version?: string; dependencies?: Record<string, string> }) | undefined;
      if (!entrada) continue;
      vistos.set(actual, clave);
      pendientes.push(...Object.keys(entrada.dependencies ?? {}));
    }
    // React es de la app desde antes: no lo suma esta librería.
    vistos.delete('react');
    vistos.delete('react-dom');
    return vistos;
  }

  it('versión exacta en la app', () => {
    const app = JSON.parse(readFileSync(path.join(RAIZ, 'apps/desktop/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(app.dependencies['react-aria-components']).toBe('1.22.1');
    expect(
      (lock.packages['node_modules/react-aria-components'] as { version?: string }).version,
    ).toBe('1.22.1');
  });

  it('sus 13 paquetes no tienen script de instalación ni binding.gyp', () => {
    const paquetes = arbol('react-aria-components');
    // Control: el árbol es el que se revisó al agregarla (ADR 042). Si crece, se vuelve a revisar.
    expect(paquetes.size).toBe(13);
    for (const [nombre, clave] of paquetes) {
      const entrada = lock.packages[clave] ?? {};
      const scripts = (leerPaquete(clave)?.scripts ?? {}) as Record<string, unknown>;
      expect(entrada.hasInstallScript, nombre).not.toBe(true);
      expect(
        ['preinstall', 'install', 'postinstall'].filter((s) => s in scripts),
        nombre,
      ).toEqual([]);
      expect(existsSync(path.join(RAIZ, clave, 'binding.gyp')), nombre).toBe(false);
    }
  });
});

describe('@react-aria/optimize-locales-plugin (ADR 042, solo desarrollo)', () => {
  const PAQUETES = [
    '@react-aria/optimize-locales-plugin',
    'unplugin',
    'picomatch',
    'webpack-virtual-modules',
  ];

  it('versión exacta, solo de desarrollo', () => {
    const app = JSON.parse(readFileSync(path.join(RAIZ, 'apps/desktop/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(app.devDependencies['@react-aria/optimize-locales-plugin']).toBe('2.1.0');
    expect(app.dependencies['@react-aria/optimize-locales-plugin']).toBeUndefined();
  });

  it('sus paquetes no tienen script de instalación, y las licencias son las revisadas', () => {
    for (const nombre of PAQUETES) {
      const clave = `node_modules/${nombre}`;
      const entrada = (lock.packages[clave] ?? {}) as EntradaLock & { license?: string };
      const paquete = leerPaquete(clave);
      expect(paquete, nombre).toBeDefined();
      const scripts = (paquete?.scripts ?? {}) as Record<string, unknown>;
      expect(entrada.hasInstallScript, nombre).not.toBe(true);
      expect(
        ['preinstall', 'install', 'postinstall'].filter((s) => s in scripts),
        nombre,
      ).toEqual([]);
      expect(existsSync(path.join(RAIZ, clave, 'binding.gyp')), nombre).toBe(false);
      // El plugin no declara la licencia en su package.json: su archivo LICENSE es Apache 2.0.
      const licencia =
        entrada.license ??
        (readFileSync(path.join(RAIZ, clave, 'LICENSE'), 'utf8').includes('Apache License')
          ? 'Apache-2.0'
          : 'desconocida');
      expect(['MIT', 'Apache-2.0'], `${nombre}: ${licencia}`).toContain(licencia);
    }
  });
});

/** Las dependencias declaradas en un package.json que no son una versión exacta. */
export function rangosDe(paquete: Record<string, unknown>): string[] {
  const salida: string[] = [];
  for (const campo of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'overrides',
  ]) {
    const deps = (paquete[campo] ?? {}) as Record<string, unknown>;
    for (const [nombre, valor] of Object.entries(deps)) {
      if (typeof valor === 'string' && /[\^~]/.test(valor))
        salida.push(`${campo}.${nombre}: ${valor}`);
    }
  }
  return salida;
}

describe('versiones exactas', () => {
  const carpetas = [
    '.',
    ...(['apps', 'packages'] as const).flatMap((grupo) =>
      readdirSync(path.join(RAIZ, grupo))
        .map((c) => path.join(grupo, c))
        .filter((c) => existsSync(path.join(RAIZ, c, 'package.json'))),
    ),
  ];

  it('.npmrc guarda versiones exactas (save-exact=true)', () => {
    const lineas = readFileSync(path.join(RAIZ, '.npmrc'), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim());
    expect(lineas).toContain('save-exact=true');
    expect(lineas).not.toContain('save-exact=false');
  });

  it('ningún package.json tiene un rango con ^ o ~', () => {
    expect(carpetas.length).toBeGreaterThan(5);
    const rangos = carpetas.flatMap((carpeta) =>
      rangosDe(
        JSON.parse(readFileSync(path.join(RAIZ, carpeta, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >,
      ).map((r) => `${carpeta}: ${r}`),
    );
    expect(rangos).toEqual([]);
  });

  it('control: reconoce ^ y ~, y deja pasar una versión exacta y un workspace', () => {
    expect(
      rangosDe({
        dependencies: { a: '^1.0.0', b: '1.2.3', '@qatlas/shared': '*' },
        devDependencies: { c: '~2.0.0' },
      }),
    ).toEqual(['dependencies.a: ^1.0.0', 'devDependencies.c: ~2.0.0']);
  });
});
