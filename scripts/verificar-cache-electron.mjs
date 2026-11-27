/**
 * Verifica la caché de descargas de Electron (`@electron/get`) antes de instalar el binario (ADR 044).
 * Cada archivo de la caché que figura en `checksums.json` del paquete `electron` instalado (que llega por
 * el lockfile, con su integridad) tiene que coincidir con su SHA-256. Si uno no coincide, sale con 1: no se
 * instala nada. Los que no figuran (de otras versiones) no se usan: `install.js` busca el nombre exacto.
 *
 * `@electron/get` también compara el checksum con la caché, pero si no coincide vuelve a descargar sin
 * avisar. Acá se falla cerrado: una caché alterada es un incidente, no un detalle.
 *
 *   node scripts/verificar-cache-electron.mjs --cache <carpeta>   (por defecto, $electron_config_cache)
 *   node scripts/verificar-cache-electron.mjs --raiz <carpeta>    otra raíz del monorepo (los tests)
 *
 * Una caché vacía o inexistente está bien: Electron se descarga y se verifica como siempre. Los mensajes no
 * llevan rutas: el log del CI es público.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Los archivos de la caché que figuran en `checksums` y no coinciden. Sin rutas. */
export function problemasDeLaCache(carpeta, checksums) {
  if (!existsSync(carpeta)) return [];
  const problemas = [];
  for (const relativo of readdirSync(carpeta, { recursive: true })) {
    const ruta = path.join(carpeta, relativo);
    if (!statSync(ruta).isFile()) continue;
    const nombre = path.basename(ruta);
    const esperado = checksums[nombre];
    if (!esperado) continue;
    const actual = createHash('sha256').update(readFileSync(ruta)).digest('hex');
    if (actual !== esperado) problemas.push(`${nombre}: el SHA-256 no coincide`);
  }
  return problemas;
}

function principal() {
  const argumentos = process.argv.slice(2);
  const valor = (nombre) => {
    const i = argumentos.indexOf(nombre);
    return i >= 0 ? argumentos[i + 1] : undefined;
  };
  const raiz = path.resolve(
    valor('--raiz') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const carpeta = valor('--cache') ?? process.env.electron_config_cache;
  if (!carpeta) {
    console.error(
      '[cache-electron] Falta la carpeta de la caché (--cache o electron_config_cache).',
    );
    process.exit(1);
  }
  const requerir = createRequire(path.join(raiz, 'apps/desktop/package.json'));
  const checksums = JSON.parse(readFileSync(requerir.resolve('electron/checksums.json'), 'utf8'));
  const problemas = problemasDeLaCache(path.resolve(carpeta), checksums);
  if (problemas.length > 0) {
    console.error(
      '[cache-electron] La caché de Electron no coincide con checksums.json (ADR 044):',
    );
    for (const problema of problemas) console.error(`[cache-electron] - ${problema}`);
    console.error('[cache-electron] No se instala nada. Borrar esa entrada de la caché y avisar.');
    process.exit(1);
  }
  console.log('[cache-electron] La caché de Electron coincide con checksums.json.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  principal();
