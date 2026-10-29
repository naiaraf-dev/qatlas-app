import { describe, expect, it } from 'vitest';
import { isLikelySyncedPath, resolveDataDirectory } from './data-dir';

describe('resolveDataDirectory', () => {
  it('en Windows usa LOCALAPPDATA (no se sincroniza en perfiles móviles)', () => {
    const dir = resolveDataDirectory(
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' },
      'C:\\Users\\ana\\AppData\\Roaming\\QAtlas',
    );
    expect(dir).toBe('C:\\Users\\ana\\AppData\\Local\\QAtlas');
  });

  it('en macOS y Linux usa la carpeta por defecto de Electron', () => {
    expect(resolveDataDirectory('linux', {}, '/home/ana/.config/QAtlas')).toBe(
      '/home/ana/.config/QAtlas',
    );
  });
});

describe('isLikelySyncedPath', () => {
  it.each([
    'C:\\Users\\ana\\OneDrive\\Desktop\\qatlas',
    'C:\\Users\\ana\\OneDrive - Empresa SA\\Documentos',
    '/Users/ana/Dropbox/trabajo',
    'G:\\Mi unidad\\proyectos',
    '/Users/ana/Library/Mobile Documents/com~apple~CloudDocs',
  ])('detecta carpeta sincronizada: %s', (p) => {
    expect(isLikelySyncedPath(p)).toBe(true);
  });

  it.each([
    'C:\\Users\\ana\\AppData\\Local\\QAtlas',
    '/home/ana/.config/QAtlas',
    'C:\\proyectos\\OneDriveBackup',
  ])('no marca carpetas locales: %s', (p) => {
    expect(isLikelySyncedPath(p)).toBe(false);
  });
});
