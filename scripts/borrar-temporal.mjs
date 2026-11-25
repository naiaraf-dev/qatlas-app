/**
 * Borra una carpeta o un archivo temporal del trabajo, con controles (CLAUDE.md, reglas de procesos).
 * Nunca se usa `rm -rf` con rutas armadas desde variables: una variable vacía apuntaría a la raíz.
 *
 *   node scripts/borrar-temporal.mjs .artefactos/comparacion-iconos
 *
 * Solo borra si la ruta:
 * - no está vacía y existe;
 * - resuelta (también los enlaces), queda DENTRO del repo, y no es la raíz;
 * - está dentro de una de las carpetas temporales permitidas, y no es esa carpeta;
 * - git la ignora, y no tiene ningún archivo versionado.
 * Si algo no se cumple, falla sin borrar nada.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Las carpetas de la raíz donde va el trabajo temporal. Todas ignoradas por git. */
export const CARPETAS_TEMPORALES = ['.artefactos', 'out'];

const RAIZ_DEL_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Valida la ruta y devuelve la ruta absoluta real que se puede borrar. Tira un error si no cumple.
 * `git` se inyecta para poder probarla.
 */
export function validarRutaTemporal(
  entrada,
  {
    raiz = RAIZ_DEL_REPO,
    git = (args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }),
  } = {},
) {
  if (typeof entrada !== 'string' || entrada.trim() === '') {
    throw new Error('borrar-temporal: falta la ruta');
  }
  const raizReal = realpathSync(raiz);
  const absoluta = path.resolve(raizReal, entrada);
  if (!existsSync(absoluta)) throw new Error('borrar-temporal: la ruta no existe');
  // Los enlaces se resuelven: uno adentro que apunte afuera no cuenta como adentro.
  const real = realpathSync(absoluta);
  const relativa = path.relative(raizReal, real);
  if (relativa === '' || relativa.startsWith('..') || path.isAbsolute(relativa)) {
    throw new Error('borrar-temporal: la ruta no está dentro del repo, o es la raíz');
  }
  const partes = relativa.split(path.sep);
  if (!CARPETAS_TEMPORALES.includes(partes[0] ?? '') || partes.length < 2) {
    throw new Error(
      `borrar-temporal: solo dentro de ${CARPETAS_TEMPORALES.join(', ')}, y nunca la carpeta misma`,
    );
  }
  const paraGit = relativa.split(path.sep).join('/');
  try {
    git(['check-ignore', '-q', '--no-index', paraGit]);
  } catch {
    throw new Error('borrar-temporal: git no la ignora');
  }
  if (git(['ls-files', '--', paraGit]).trim() !== '') {
    throw new Error('borrar-temporal: tiene archivos versionados');
  }
  return real;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const ruta = validarRutaTemporal(process.argv[2]);
    rmSync(ruta, { recursive: true, force: false, maxRetries: 3 });
    console.log(`[borrar-temporal] Borrado: ${path.relative(RAIZ_DEL_REPO, ruta)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
