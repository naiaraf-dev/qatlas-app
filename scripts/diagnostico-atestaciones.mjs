/**
 * Diagnóstico de la caché de npm: qué respuestas de atestaciones guardó (ADR 044). Solo lee: nunca falla,
 * nunca borra.
 *
 * Para qué: `npm audit signatures` busca, por cada paquete con atestaciones, el `keyid` de su atestación
 * de publicación entre las claves del registro. El registro sirve las atestaciones con
 * `Cache-Control: max-age` de un año, npm las guarda en su caché, y `actions/setup-node` (`cache: npm`)
 * restaura esa caché en cada corrida con el mismo lockfile. Una respuesta incompleta guardada una vez se
 * reusaría en todas. Esto la muestra: paquete, tipos de atestación, `keyid` y cuándo se guardó.
 *
 *   node scripts/diagnostico-atestaciones.mjs --cache <carpeta de la caché de npm>
 *   node scripts/diagnostico-atestaciones.mjs --cache <carpeta> --todos   también las completas
 *
 * Sin rutas en la salida: el log del CI es público.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLICACION = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';
const PREFIJO = 'make-fetch-happen:request-cache:';

/**
 * Lo que importa de una respuesta de `/-/npm/v1/attestations/<paquete>@<versión>`: los tipos y los
 * `keyid`. Está completa si trae la atestación de publicación con su `keyid`, que es lo que npm busca
 * entre las claves del registro.
 */
export function analizarAtestaciones(texto) {
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { tipos: [], keyids: [], completa: false, motivo: 'no es JSON' };
  }
  const lista = Array.isArray(datos?.attestations) ? datos.attestations : [];
  const tipos = lista.map((a) => String(a?.predicateType ?? ''));
  const keyids = lista
    .map((a) => a?.bundle?.dsseEnvelope?.signatures?.[0]?.keyid)
    .filter((k) => typeof k === 'string' && k.length > 0);
  const publicacion = lista.find((a) => a?.predicateType === PUBLICACION);
  const conKeyid = Boolean(publicacion?.bundle?.dsseEnvelope?.signatures?.[0]?.keyid);
  const motivo = !publicacion
    ? 'sin la atestación de publicación'
    : !conKeyid
      ? 'la atestación de publicación no tiene keyid'
      : null;
  return { tipos, keyids, completa: motivo === null, motivo };
}

/** La ruta del contenido en cacache a partir de su integridad (`sha512-<base64>`). */
export function rutaDelContenido(cache, integridad) {
  const [algoritmo, base64] = String(integridad).split(/-(.*)/s);
  const hex = Buffer.from(base64 ?? '', 'base64').toString('hex');
  return path.join(
    cache,
    '_cacache',
    'content-v2',
    algoritmo ?? '',
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4),
  );
}

/** Las respuestas de atestaciones de la caché: la última entrada del índice por URL. */
export function atestacionesEnCache(cache) {
  const indice = path.join(cache, '_cacache', 'index-v5');
  if (!existsSync(indice)) return [];
  const porUrl = new Map();
  for (const relativo of readdirSync(indice, { recursive: true })) {
    const archivo = path.join(indice, relativo);
    if (!statSync(archivo).isFile()) continue;
    for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
      const json = linea.slice(linea.indexOf('\t') + 1);
      let entrada;
      try {
        entrada = JSON.parse(json);
      } catch {
        continue;
      }
      if (typeof entrada?.key !== 'string' || !entrada.key.startsWith(PREFIJO)) continue;
      const url = entrada.key.slice(PREFIJO.length);
      const m = /\/-\/npm\/v1\/attestations\/(.+)$/.exec(url);
      if (!m) continue;
      const previa = porUrl.get(url);
      if (!previa || (entrada.time ?? 0) >= (previa.time ?? 0))
        porUrl.set(url, { ...entrada, paquete: decodeURIComponent(m[1] ?? '') });
    }
  }
  return [...porUrl.values()].map((entrada) => {
    const ruta = rutaDelContenido(cache, entrada.integrity);
    const analisis = existsSync(ruta)
      ? analizarAtestaciones(readFileSync(ruta, 'utf8'))
      : { tipos: [], keyids: [], completa: false, motivo: 'falta el contenido en la caché' };
    return {
      paquete: entrada.paquete,
      guardada: new Date(entrada.time ?? 0).toISOString(),
      ...analisis,
    };
  });
}

function principal() {
  const argumentos = process.argv.slice(2);
  const i = argumentos.indexOf('--cache');
  const cache = i >= 0 ? argumentos[i + 1] : undefined;
  if (!cache) {
    console.log('[atestaciones] Falta --cache: no hay nada que mirar.');
    return;
  }
  const todas = atestacionesEnCache(path.resolve(cache));
  const incompletas = todas.filter((a) => !a.completa);
  console.log(
    `[atestaciones] ${String(todas.length)} respuestas de atestaciones en la caché de npm; ${String(incompletas.length)} incompletas.`,
  );
  for (const a of argumentos.includes('--todos') ? todas : incompletas) {
    console.log(
      `[atestaciones] ${a.paquete} · guardada ${a.guardada} · ${a.motivo ?? 'completa'} · tipos: ${a.tipos.map((t) => t.replace(/^https:\/\//, '')).join(', ') || 'ninguno'} · keyid: ${a.keyids.join(', ') || 'ninguno'}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  principal();
