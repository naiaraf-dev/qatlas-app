/**
 * TS-07 — Configuración de Electron (especificación 3.6 y 3.15).
 *
 * Verifica la configuración declarada y, con análisis estático del código, que
 * nadie la saltee: ventanas creadas sin las preferencias seguras, Node
 * habilitado, ipcRenderer expuesto entero, etc.
 * Complemento: Electronegativity corre en CI sobre el mismo código.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_PREFERENCE_VALUES,
  SECURE_WEB_PREFERENCES,
} from '../apps/desktop/src/main/security/web-preferences';
import { buildCsp } from '../apps/desktop/src/main/security/csp';

const DESKTOP_SRC = path.resolve(import.meta.dirname, '../apps/desktop/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|html)$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
}

const files = sourceFiles(DESKTOP_SRC).map((file) => ({
  file: path.relative(DESKTOP_SRC, file),
  code: readFileSync(file, 'utf8'),
}));

describe('TS-07 · Preferencias de las ventanas', () => {
  it.each(Object.entries(REQUIRED_PREFERENCE_VALUES))('%s = %s', (key, value) => {
    expect((SECURE_WEB_PREFERENCES as Record<string, unknown>)[key]).toBe(value);
  });

  it('el corrector ortográfico está desactivado (descargaría diccionarios de internet)', () => {
    expect(SECURE_WEB_PREFERENCES.spellcheck).toBe(false);
  });

  it('toda ventana se crea con SECURE_WEB_PREFERENCES', () => {
    const creators = files.filter((f) => f.code.includes('new BrowserWindow('));
    expect(creators.length).toBeGreaterThan(0);
    for (const { file, code } of creators) {
      expect(code, file).toContain('SECURE_WEB_PREFERENCES');
    }
  });

  it('ningún archivo habilita Node, desactiva el aislamiento o el sandbox', () => {
    const forbidden = [
      /nodeIntegration\s*:\s*true/,
      /nodeIntegrationInWorker\s*:\s*true/,
      /contextIsolation\s*:\s*false/,
      /sandbox\s*:\s*false/,
      /webSecurity\s*:\s*false/,
      /allowRunningInsecureContent\s*:\s*true/,
      /webviewTag\s*:\s*true/,
      /enableRemoteModule/,
    ];
    for (const { file, code } of files) {
      for (const pattern of forbidden) expect(code, `${file}: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('el sandbox se fuerza globalmente con app.enableSandbox()', () => {
    const main = files.find((f) => f.file === path.join('main', 'index.ts'));
    expect(main?.code).toContain('app.enableSandbox()');
  });
});

describe('TS-07 · Preload', () => {
  const preload = files.find((f) => f.file === path.join('preload', 'index.ts'));

  it('no expone ipcRenderer completo', () => {
    expect(preload?.code).toBeDefined();
    expect(preload?.code).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/);
    expect(preload?.code).not.toMatch(/ipcRenderer\.(on|send|sendSync)\(/);
  });

  it('solo importa tipos de @qatlas/shared (sin código en tiempo de ejecución)', () => {
    expect(preload?.code).toMatch(/import type \{[^}]*\} from '@qatlas\/shared'/);
    expect(preload?.code).not.toMatch(/import \{[^}]*\} from '@qatlas\/shared'/);
  });
});

describe('TS-07 · Content Security Policy de producción', () => {
  const csp = buildCsp({ dev: false });
  const directives = new Map(
    csp.split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

  it('deniega todo por defecto', () => {
    expect(directives.get('default-src')).toEqual(["'none'"]);
  });

  it('la interfaz no puede abrir conexiones', () => {
    expect(directives.get('connect-src')).toEqual(["'none'"]);
  });

  it('no permite scripts inline ni eval', () => {
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directives.get('script-src')).toEqual(["'self'"]);
  });

  it('no carga nada de http(s) externo', () => {
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it.each(['object-src', 'frame-src', 'base-uri', 'form-action', 'frame-ancestors'])(
    '%s está en none',
    (name) => {
      expect(directives.get(name)).toEqual(["'none'"]);
    },
  );
});

describe('TS-07 · Interfaz sin recursos remotos', () => {
  it('ningún archivo de la interfaz referencia URLs http(s) para cargar recursos', () => {
    const renderer = files.filter((f) => f.file.startsWith('renderer'));
    for (const { file, code } of renderer) {
      // Se permiten URLs dentro de la prueba de contención (que deben fallar).
      const withoutContainmentTest = code.replace(/example\.com/g, '');
      expect(withoutContainmentTest, file).not.toMatch(/(src|href)=["']https?:\/\//);
      expect(withoutContainmentTest, file).not.toMatch(/@import\s+url\(["']?https?:/);
    }
  });

  it('no se usa shell.openExternal sin el canal con confirmación (pendiente)', () => {
    for (const { file, code } of files) expect(code, file).not.toContain('openExternal');
  });
});
