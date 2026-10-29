import path from 'node:path';

/**
 * Protocolo propio `app://qatlas/` para servir la interfaz empaquetada
 * (especificación 3.5). Evita `file://`, que tiene privilegios amplios sobre el
 * disco, y permite aplicar la CSP como header en cada respuesta.
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'qatlas';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export type ResolveResult =
  { ok: true; filePath: string; mimeType: string } | { ok: false; status: 403 | 404 };

/**
 * Traduce una URL `app://qatlas/...` a un archivo dentro de `rootDir`.
 * Rechaza cualquier intento de salir de la carpeta (path traversal), hosts
 * desconocidos y tipos de archivo no esperados.
 */
export function resolveAppRequest(rawUrl: string, rootDir: string): ResolveResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 404 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return { ok: false, status: 404 };

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, status: 404 };
  }
  if (pathname.includes('\0')) return { ok: false, status: 403 };
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, status: 403 };

  const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mimeType) return { ok: false, status: 404 };

  return { ok: true, filePath, mimeType };
}
