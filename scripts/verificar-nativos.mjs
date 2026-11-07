/**
 * Verifica que cada módulo nativo instalado esté en `scripts/nativos-hashes.json` (ADR 007): la versión
 * registrada y el SHA-256 de cada `.node`, de todas las plataformas que trae el paquete. Corre en el CI
 * después de `npm ci` y dentro de `npm run check`. Si algo no coincide, sale con 1.
 *
 *   node scripts/verificar-nativos.mjs              verifica
 *   node scripts/verificar-nativos.mjs --calcular   imprime los hashes de lo instalado, para registrar
 *                                                   una versión nueva DESPUÉS de revisarla
 *   node scripts/verificar-nativos.mjs --raiz <c>   otra raíz del monorepo (lo usan los tests)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calcularRegistro, verificarInstalados } from './nativos.mjs';

const argumentos = process.argv.slice(2);
const indiceRaiz = argumentos.indexOf('--raiz');
const raiz =
  indiceRaiz >= 0
    ? path.resolve(argumentos[indiceRaiz + 1] ?? '.')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (argumentos.includes('--calcular')) {
  console.log(JSON.stringify(calcularRegistro(raiz), null, 2));
  process.exit(0);
}

const problemas = verificarInstalados(raiz);
if (problemas.length > 0) {
  console.error('[nativos] No coinciden con el registro (ADR 007):');
  for (const problema of problemas) console.error(`[nativos] - ${problema}`);
  console.error('[nativos] Una versión nueva se registra solo después de revisarla: ver ADR 007.');
  process.exit(1);
}
console.log('[nativos] Todos los módulos nativos coinciden con el registro.');
