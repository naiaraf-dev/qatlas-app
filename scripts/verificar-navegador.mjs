/**
 * Verifica que el Chromium instalado sea el mismo de la primera descarga (ADR 020): Playwright solo
 * compara el tamaño de lo que baja, sin un hash. Sirve para desarrollo y CI; los instaladores llevan el
 * navegador adentro, firmado (semana 10).
 *
 * Es una confianza en el primer uso: protege de un cambio posterior, no de que esa primera descarga
 * ya estuviera alterada.
 *
 *   node scripts/verificar-navegador.mjs            verifica
 *   node scripts/verificar-navegador.mjs --calcular imprime el hash de esta plataforma, para registrarlo
 */
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(raiz, 'packages/runner/package.json'));
const { chromium } = require('playwright-core');

const REGISTRO = path.join(raiz, 'scripts/navegador-hashes.json');
// Los escribe Playwright al instalar: cambian en cada equipo.
const SIN_CONTENIDO_PROPIO = new Set(['INSTALLATION_COMPLETE', 'DEPENDENCIES_VALIDATED']);

/** La carpeta `chromium-<revisión>` del ejecutable. */
function carpetaDelNavegador(ejecutable) {
  const partes = ejecutable.split(path.sep);
  const indice = partes.findIndex((parte) => /^chromium-\d+$/.test(parte));
  if (indice === -1) throw new Error('No se reconoce la carpeta del navegador.');
  return { carpeta: partes.slice(0, indice + 1).join(path.sep), revision: partes[indice] };
}

function hashDeArchivo(ruta) {
  return new Promise((resolver, rechazar) => {
    const hash = createHash('sha256');
    createReadStream(ruta)
      .on('data', (trozo) => hash.update(trozo))
      .on('end', () => {
        resolver(hash.digest('hex'));
      })
      .on('error', rechazar);
  });
}

/** Hash de nombres relativos y contenidos, en un orden fijo: no depende de rutas ni de fechas. */
async function hashDeCarpeta(carpeta) {
  const archivos = readdirSync(carpeta, { recursive: true })
    .map((nombre) => nombre.replaceAll('\\', '/'))
    .filter((nombre) => {
      const ruta = path.join(carpeta, nombre);
      return lstatSync(ruta).isFile() && !SIN_CONTENIDO_PROPIO.has(path.basename(nombre));
    })
    .sort();
  const total = createHash('sha256');
  for (const nombre of archivos) {
    total.update(`${nombre}\0${await hashDeArchivo(path.join(carpeta, nombre))}\n`);
  }
  return total.digest('hex');
}

const plataforma = `${process.platform}-${process.arch}`;
const ejecutable = chromium.executablePath();
let ubicacion;
try {
  ubicacion = carpetaDelNavegador(ejecutable);
  lstatSync(ejecutable);
} catch {
  console.error('Falta el navegador de pruebas. Instalalo con: npm run navegador:instalar');
  process.exit(1);
}

const { carpeta, revision } = ubicacion;
const actual = await hashDeCarpeta(carpeta);

if (process.argv.includes('--calcular')) {
  console.log(`${revision} ${plataforma} ${actual}`);
  process.exit(0);
}

const registro = JSON.parse(readFileSync(REGISTRO, 'utf8'));
const esperado = registro[revision]?.[plataforma];
if (!esperado) {
  console.error(`No hay un hash registrado para ${revision} en ${plataforma}: ${actual}`);
  process.exit(1);
}
if (esperado !== actual) {
  console.error(`El navegador ${revision} no coincide con la primera descarga.`);
  process.exit(1);
}
console.log(`Navegador verificado: ${revision} (${plataforma}).`);
