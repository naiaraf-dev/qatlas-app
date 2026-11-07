/**
 * Registro de los módulos nativos precompilados (ADR 007).
 *
 * `scripts/nativos-hashes.json` guarda el SHA-256 de cada `.node` que traen los paquetes nativos, por
 * versión y por plataforma, revisado a mano. Lo usan tres lugares, con estas mismas funciones:
 *
 * - `scripts/verificar-nativos.mjs` (CI y `npm run check`): todo lo instalado, de todas las
 *   plataformas, tiene que coincidir con el registro.
 * - El build (`electron.vite.config.ts`): falla si no coincide, y lo que deja en la app es el valor
 *   registrado, no el que calculó del disco.
 * - Los tests de seguridad, con un binario con un byte cambiado.
 *
 * Los mensajes de error nunca llevan rutas absolutas: el log del CI es público.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Los paquetes con binarios nativos que carga el proceso principal. */
export const PAQUETES_NATIVOS = ['argon2', 'better-sqlite3-multiple-ciphers'];

/** Desde dónde se resuelven: cada lugar del monorepo que los usa (una copia anidada también cuenta). */
const DESDE = ['apps/desktop', 'packages/crypto', 'packages/db', '.'];

export const leerRegistro = (raiz) =>
  JSON.parse(readFileSync(path.join(raiz, 'scripts/nativos-hashes.json'), 'utf8'));

export const sha256 = (datos) => createHash('sha256').update(datos).digest('hex');

/** Las carpetas instaladas de un paquete, sin repetir. Vacío si no está. */
export function carpetasDe(raiz, paquete) {
  const carpetas = new Set();
  for (const desde of DESDE) {
    try {
      const requerir = createRequire(path.join(raiz, desde, 'package.json'));
      carpetas.add(path.dirname(requerir.resolve(`${paquete}/package.json`)));
    } catch {
      // No lo usa ese lugar.
    }
  }
  return [...carpetas];
}

/** Todos los `.node` de `prebuilds/`, relativos a la carpeta del paquete, con barras normales. */
export function binariosDe(carpeta) {
  const base = path.join(carpeta, 'prebuilds');
  const encontrados = [];
  const recorrer = (actual) => {
    for (const nombre of readdirSync(actual)) {
      const ruta = path.join(actual, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (nombre.endsWith('.node')) {
        encontrados.push(path.relative(carpeta, ruta).split(path.sep).join('/'));
      }
    }
  };
  if (existsSync(base)) recorrer(base);
  return encontrados.sort();
}

/**
 * Compara lo instalado con el registro. Devuelve los problemas (vacío si todo coincide): una versión
 * sin registrar, un binario que no está en el registro, uno registrado que falta, o un hash distinto.
 */
export function verificarInstalados(raiz, registro = leerRegistro(raiz)) {
  const problemas = [];
  for (const paquete of PAQUETES_NATIVOS) {
    const carpetas = carpetasDe(raiz, paquete);
    if (carpetas.length === 0) problemas.push(`${paquete}: no está instalado`);
    for (const carpeta of carpetas) {
      const { version } = JSON.parse(readFileSync(path.join(carpeta, 'package.json'), 'utf8'));
      const registrados = registro[paquete]?.[version];
      if (!registrados) {
        problemas.push(
          `${paquete} ${version}: versión no registrada en scripts/nativos-hashes.json`,
        );
        continue;
      }
      const instalados = binariosDe(carpeta);
      for (const archivo of instalados) {
        const esperado = registrados[archivo];
        if (!esperado) {
          problemas.push(`${paquete} ${version}: ${archivo} no está en el registro`);
        } else if (sha256(readFileSync(path.join(carpeta, archivo))) !== esperado) {
          problemas.push(`${paquete} ${version}: ${archivo} no coincide con el hash registrado`);
        }
      }
      for (const archivo of Object.keys(registrados)) {
        if (!instalados.includes(archivo)) {
          problemas.push(`${paquete} ${version}: falta ${archivo}, que está registrado`);
        }
      }
    }
  }
  return problemas;
}

/**
 * Lo que el build deja en la app: los valores registrados de esta plataforma. Antes verifica todo lo
 * instalado, y falla si algo no coincide o si esta plataforma no tiene binarios registrados.
 */
export function manifiestoRegistrado(raiz, plataforma, registro = leerRegistro(raiz)) {
  const problemas = verificarInstalados(raiz, registro);
  if (problemas.length > 0) {
    throw new Error(
      `Módulos nativos que no coinciden con el registro (ADR 007):\n- ${problemas.join('\n- ')}`,
    );
  }
  return PAQUETES_NATIVOS.flatMap((paquete) => {
    // La copia que carga el proceso principal es la que resuelve apps/desktop.
    const [carpeta] = carpetasDe(raiz, paquete);
    const { version } = JSON.parse(readFileSync(path.join(carpeta, 'package.json'), 'utf8'));
    const deLaPlataforma = Object.entries(registro[paquete][version]).filter(
      ([archivo]) =>
        archivo === `prebuilds/${plataforma}.node` ||
        archivo.startsWith(`prebuilds/${plataforma}/`),
    );
    if (deLaPlataforma.length === 0) {
      throw new Error(`${paquete} ${version}: no hay binarios registrados para ${plataforma}`);
    }
    return deLaPlataforma.map(([archivo, hash]) => ({ paquete, archivo, sha256: hash }));
  });
}

/** Para registrar una versión nueva, después de revisarla: los hashes de lo instalado. */
export function calcularRegistro(raiz) {
  const registro = {};
  for (const paquete of PAQUETES_NATIVOS) {
    const [carpeta] = carpetasDe(raiz, paquete);
    if (!carpeta) continue;
    const { version } = JSON.parse(readFileSync(path.join(carpeta, 'package.json'), 'utf8'));
    registro[paquete] = {
      [version]: Object.fromEntries(
        binariosDe(carpeta).map((archivo) => [
          archivo,
          sha256(readFileSync(path.join(carpeta, archivo))),
        ]),
      ),
    };
  }
  return registro;
}
