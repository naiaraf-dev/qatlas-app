/**
 * Lista permitida de scripts de instalación (especificación 3.11).
 *
 * .npmrc tiene `ignore-scripts=true`, así que ningún paquete ejecuta código al
 * instalarse. Los que realmente lo necesitan se listan acá, con el motivo, y se
 * ejecutan de forma explícita con `npm run setup:native`.
 *
 * Para agregar un paquete: justificarlo en el PR y revisar qué hace su script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const ALLOWED = [
  {
    pkg: 'electron',
    script: 'install.js',
    reason: 'Descarga el binario de Electron verificando su checksum SHA-256.',
  },
  // Fase 1, semana 3: better-sqlite3-multiple-ciphers (compilación para Electron).
];

for (const { pkg, script, reason } of ALLOWED) {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve(`${pkg}/package.json`, { paths: ['apps/desktop', '.'] }));
  } catch {
    console.warn(`[setup] ${pkg} no está instalado; se omite.`);
    continue;
  }
  const file = path.join(pkgDir, script);
  if (!existsSync(file)) {
    console.error(`[setup] No se encontró ${file}`);
    process.exit(1);
  }
  console.log(`[setup] ${pkg}: ${reason}`);
  execFileSync(process.execPath, [file], { cwd: pkgDir, stdio: 'inherit' });
}
