import path from 'node:path';

/**
 * Ubicación de la bóveda (especificación 3.10).
 *
 * En Windows se usa %LOCALAPPDATA% y no %APPDATA% (Roaming), que en redes
 * corporativas puede sincronizarse con un servidor.
 */
export function resolveDataDirectory(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  defaultUserData: string,
): string {
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.win32.join(env.LOCALAPPDATA, 'QAtlas');
  }
  return defaultUserData;
}

/** Carpetas típicas de servicios de sincronización en la nube. */
const SYNCED_FOLDER_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])OneDrive( - [^\\/]+)?([\\/]|$)/i,
  /(^|[\\/])Dropbox([\\/]|$)/i,
  /(^|[\\/])Google Drive([\\/]|$)/i,
  /(^|[\\/])My Drive([\\/]|$)/i,
  /(^|[\\/])Mi unidad([\\/]|$)/i,
  /(^|[\\/])iCloud Drive([\\/]|$)/i,
  /(^|[\\/])Mobile Documents([\\/]|$)/i,
  /(^|[\\/])Box Sync([\\/]|$)/i,
  /(^|[\\/])pCloud Drive([\\/]|$)/i,
];

/**
 * Indica si una ruta parece estar dentro de una carpeta sincronizada con la
 * nube. Es una heurística: se usa para AVISAR, nunca para decidir en silencio.
 */
export function isLikelySyncedPath(candidate: string): boolean {
  return SYNCED_FOLDER_PATTERNS.some((pattern) => pattern.test(candidate));
}
