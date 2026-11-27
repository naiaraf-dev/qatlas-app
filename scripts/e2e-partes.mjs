/**
 * Las partes del E2E en el CI (ADR 044): cada una corre en su propio job, en paralelo.
 *
 * No se usa solo `--shard`: Playwright reparte por cantidad de tests, con cada archivo entero y en orden
 * alfabético, y con unos pocos archivos largos quedaba muy desparejo. Acá cada parte dice qué archivos y
 * qué etiquetas corre. Una parte que crezca puede llevar además `shard` (se agrega `--shard`).
 *
 * - Lo que no es `@lento` ni `@ocr` va solo en «rápidos»: un archivo nuevo entra ahí sin tocar nada.
 * - Un test `@lento` o `@ocr` tiene que estar en una parte por su archivo:
 *   `security-tests/e2e-etiquetas.test.ts` verifica que cada test caiga en exactamente una parte, y que
 *   las partes coincidan con las del CI.
 *
 *   node scripts/e2e-partes.mjs <número> [argumentos de Playwright]   corre esa parte
 *   node scripts/e2e-partes.mjs --listar                              las partes, en JSON (para el CI)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LENTOS = '@lento|@ocr';

/** @type {{ nombre: string; archivos?: string[]; grep?: string; grepInvert?: string; shard?: string }[]} */
export const PARTES = [
  { nombre: 'rápidos', grepInvert: LENTOS },
  { nombre: 'Bóveda: inactividad', archivos: ['boveda-inactividad'], grep: '@lento' },
  { nombre: 'contención: solo lectura', archivos: ['contencion'], grep: '@lento' },
  {
    nombre: 'ejecuciones y escaneos',
    archivos: [
      'ejecuciones',
      'escaneo',
      'escaneo-oraculo',
      'escaneo-autenticado',
      'escaneo-autenticado-app',
    ],
    grep: LENTOS,
  },
  {
    nombre: 'OCR y evidencias',
    archivos: [
      'evidencias',
      'evidencias-app',
      'ocr',
      'reportes',
      'ts-01-canario',
      'ts-06-login-asistido',
    ],
    grep: LENTOS,
  },
];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Los argumentos de Playwright de una parte (número desde 1). */
export function argumentosDeParte(numero) {
  const parte = PARTES[numero - 1];
  if (!parte) throw new Error(`No hay parte ${String(numero)}: son ${String(PARTES.length)}.`);
  return [
    ...(parte.archivos ?? []).map((archivo) => `e2e/${archivo}.e2e.ts$`),
    ...(parte.grep ? ['--grep', parte.grep] : []),
    ...(parte.grepInvert ? ['--grep-invert', parte.grepInvert] : []),
    ...(parte.shard ? ['--shard', parte.shard] : []),
  ];
}

/** Corre Playwright con `node`, sin shell: la `|` de los patrones no pasa por cmd ni por sh. */
export function playwright(args) {
  // cli.js no está en los exports del paquete: se ubica por su package.json.
  const paquete = createRequire(path.join(RAIZ, 'package.json')).resolve('playwright/package.json');
  const cli = path.join(path.dirname(paquete), 'cli.js');
  const resultado = spawnSync(process.execPath, [cli, 'test', ...args], {
    cwd: RAIZ,
    stdio: 'inherit',
  });
  return resultado.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [primero, ...resto] = process.argv.slice(2);
  if (primero === '--listar') {
    console.log(
      JSON.stringify(PARTES.map((parte, i) => ({ numero: i + 1, nombre: parte.nombre }))),
    );
  } else {
    process.exit(playwright([...argumentosDeParte(Number(primero)), ...resto]));
  }
}
