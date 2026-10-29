/**
 * Protocolo app:// (especificación 3.5): la interfaz empaquetada solo puede
 * leer archivos de su propia carpeta. Complementa TS-07.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppRequest } from '../apps/desktop/src/main/security/app-protocol';

const ROOT = path.resolve('/opt/qatlas/resources/app/out/renderer');

describe('Protocolo app:// · archivos permitidos', () => {
  it('sirve index.html por defecto', () => {
    const res = resolveAppRequest('app://qatlas/', ROOT);
    expect(res).toMatchObject({ ok: true, filePath: path.join(ROOT, 'index.html') });
  });

  it('sirve recursos de la interfaz con su tipo', () => {
    const res = resolveAppRequest('app://qatlas/assets/index-abc.js', ROOT);
    expect(res).toMatchObject({ ok: true, mimeType: 'text/javascript; charset=utf-8' });
  });
});

describe('Protocolo app:// · intentos de salir de la carpeta (path traversal)', () => {
  it.each([
    'app://qatlas/../../main/index.js',
    'app://qatlas/%2e%2e/%2e%2e/main/index.js',
    'app://qatlas/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.json',
    'app://qatlas/..%5c..%5cmain%5cindex.js',
    'app://qatlas/assets/archivo.js%00.png',
  ])('nunca resuelve fuera de la carpeta: %s', (url) => {
    // El parser de URL normaliza "../" literales (la ruta queda dentro de la
    // carpeta); las variantes codificadas las rechaza la función. En ambos
    // casos, la propiedad que importa es que nunca se lee fuera de ROOT.
    const res = resolveAppRequest(url, ROOT);
    if (res.ok) {
      const relative = path.relative(ROOT, res.filePath);
      expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false);
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });

  it('las variantes codificadas se rechazan explícitamente', () => {
    expect(
      resolveAppRequest('app://qatlas/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2fs.json', ROOT),
    ).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveAppRequest('app://qatlas/..%5c..%5cmain%5cindex.js', ROOT).ok).toBe(false);
  });
});

describe('Protocolo app:// · otros rechazos', () => {
  it.each([
    ['host desconocido', 'app://otro/index.html'],
    ['esquema distinto', 'file:///opt/qatlas/resources/app/out/renderer/index.html'],
    ['tipo de archivo no esperado', 'app://qatlas/config.exe'],
    ['sin extensión', 'app://qatlas/assets/archivo'],
    ['codificación inválida', 'app://qatlas/%E0%A4%A'],
  ])('%s', (_label, url) => {
    expect(resolveAppRequest(url, ROOT).ok).toBe(false);
  });
});
