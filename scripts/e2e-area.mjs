/**
 * Los E2E de un área más el smoke, para trabajar localmente (CLAUDE.md): la suite completa la confirma
 * el CI.
 *
 *   npm run test:e2e:area -- <patrón> [argumentos de Playwright]
 *
 * El patrón elige archivos por su nombre (como el filtro de Playwright): `boveda`, `escaneo` (todos los
 * de escaneo), `componentes|barra-lateral`.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from './e2e-partes.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [patron, ...resto] = process.argv.slice(2);
if (!patron) {
  console.error('Uso: npm run test:e2e:area -- <patrón> [argumentos de Playwright]');
  process.exit(1);
}
const expresion = new RegExp(patron);
const archivos = readdirSync(path.join(RAIZ, 'e2e'))
  .filter((nombre) => nombre.endsWith('.e2e.ts') && expresion.test(nombre.replace('.e2e.ts', '')))
  .map((nombre) => `e2e/${nombre}$`);
if (archivos.length === 0) {
  console.error(`Ningún E2E coincide con «${patron}».`);
  process.exit(1);
}
console.log(`[e2e:area] ${String(archivos.length)} archivos, más el smoke.`);
process.exit(playwright([...new Set([...archivos, 'e2e/smoke.e2e.ts$']), ...resto]));
