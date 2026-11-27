/**
 * El diagnóstico de la caché de npm (`scripts/diagnostico-atestaciones.mjs`, ADR 044): distingue una
 * respuesta de atestaciones completa de una que no trae la atestación de publicación o su `keyid`, que es
 * lo que hace fallar `npm audit signatures` con EMISSINGSIGNATUREKEY. Todo inventado, en una carpeta
 * temporal con la forma de cacache.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analizarAtestaciones,
  atestacionesEnCache,
  rutaDelContenido,
} from '../scripts/diagnostico-atestaciones.mjs';

const PUBLICACION = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1';
const PROCEDENCIA = 'https://slsa.dev/provenance/v1';
const atestacion = (predicateType: string, keyid: string) => ({
  predicateType,
  bundle: { dsseEnvelope: { payload: '', signatures: [{ keyid, sig: 'firma-inventada' }] } },
});
const COMPLETA = JSON.stringify({
  attestations: [atestacion(PUBLICACION, 'SHA256:clave-inventada'), atestacion(PROCEDENCIA, '')],
});
const SIN_PUBLICACION = JSON.stringify({ attestations: [atestacion(PROCEDENCIA, '')] });

describe('Respuestas de atestaciones', () => {
  it('completa: la de publicación con su keyid', () => {
    expect(analizarAtestaciones(COMPLETA)).toMatchObject({
      completa: true,
      keyids: ['SHA256:clave-inventada'],
      motivo: null,
    });
  });

  it('incompleta: sin la de publicación, sin keyid, o que no es JSON', () => {
    expect(analizarAtestaciones(SIN_PUBLICACION)).toMatchObject({
      completa: false,
      motivo: 'sin la atestación de publicación',
    });
    expect(
      analizarAtestaciones(JSON.stringify({ attestations: [atestacion(PUBLICACION, '')] })),
    ).toMatchObject({ completa: false, motivo: 'la atestación de publicación no tiene keyid' });
    expect(analizarAtestaciones('<html>504</html>')).toMatchObject({
      completa: false,
      motivo: 'no es JSON',
    });
  });
});

describe('La caché de npm (cacache)', () => {
  let carpeta: string;
  afterEach(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  /** Guarda una respuesta como lo hace npm: el contenido por su integridad y una línea en el índice. */
  function guardar(cache: string, url: string, cuerpo: string, time: number) {
    const integridad = `sha512-${createHash('sha512').update(cuerpo).digest('base64')}`;
    const ruta = rutaDelContenido(cache, integridad);
    mkdirSync(path.dirname(ruta), { recursive: true });
    writeFileSync(ruta, cuerpo);
    const indice = path.join(cache, '_cacache', 'index-v5', 'aa', 'bb');
    mkdirSync(indice, { recursive: true });
    const linea = JSON.stringify({
      key: `make-fetch-happen:request-cache:${url}`,
      integrity: integridad,
      time,
    });
    writeFileSync(path.join(indice, createHash('sha1').update(url).digest('hex')), `x\t${linea}\n`);
  }

  it('encuentra la incompleta entre las completas; sin caché, no hay nada', () => {
    carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-npm-cache-'));
    const base = 'https://registry.npmjs.org/-/npm/v1/attestations/';
    guardar(carpeta, `${base}paquete-a@1.0.0`, COMPLETA, 1000);
    guardar(carpeta, `${base}@ambito%2fpaquete-b@2.0.0`, SIN_PUBLICACION, 2000);
    const resultado = atestacionesEnCache(carpeta);
    expect(resultado).toHaveLength(2);
    expect(resultado.filter((a) => !a.completa).map((a) => a.paquete)).toEqual([
      '@ambito/paquete-b@2.0.0',
    ]);
    expect(atestacionesEnCache(path.join(carpeta, 'no-existe'))).toEqual([]);
  });
});
