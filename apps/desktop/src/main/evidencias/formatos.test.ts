/**
 * Los formatos de las evidencias: el contenedor del video, el almacén cifrado, la traza y el HAR. Los
 * «secretos» son inventados y se arman por partes.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearSemillaEvidencia } from '@qatlas/crypto';
import { ComparadorDeSecretos } from '@qatlas/redaction';
import { REDACTOR } from '../ejecuciones/redaccion';
import { crearEscritor, leerDescifrado, limpiarHuerfanos, nombreAleatorio } from './almacen';
import { entradaHar, FIN_HAR, INICIO_HAR, redactarEvento, redactarRed } from './traza';
import {
  CABECERA_VIDEO,
  esJpeg,
  esPng,
  indexarVideo,
  medidasPng,
  registroFotograma,
  registroHueco,
} from './video';

const JPEG = (relleno: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, relleno, relleno, 0xff, 0xd9]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 5, 0, 0, 0, 2, 0xd0]),
  Buffer.alloc(5),
]);

describe('Contenedor del video', () => {
  it('ida y vuelta: fotogramas con su momento y los huecos donde se perdieron', () => {
    const video = Buffer.concat([
      CABECERA_VIDEO,
      registroFotograma(0, JPEG(1)),
      registroHueco(80, 3),
      registroFotograma(120, JPEG(2)),
    ]);
    const indice = indexarVideo(video);
    expect(indice.fotogramas.map((f) => f.t)).toEqual([0, 120]);
    expect(indice.huecos).toEqual([{ t: 80, cantidad: 3 }]);
    const segundo = indice.fotogramas[1];
    expect(segundo && video.subarray(segundo.inicio, segundo.fin)).toEqual(JPEG(2));
  });

  it.each([
    ['sin cabecera', Buffer.from('nada')],
    ['otra versión', Buffer.concat([Buffer.from('QVID'), Buffer.from([9])])],
    [
      'un registro cortado',
      Buffer.concat([CABECERA_VIDEO, registroFotograma(0, JPEG(1)).subarray(0, 12)]),
    ],
    [
      'un tipo desconocido',
      Buffer.concat([CABECERA_VIDEO, Buffer.from([7, 0, 0, 0, 0, 0, 0, 0, 0])]),
    ],
  ])('rechaza %s', (_nombre, video) => {
    expect(() => indexarVideo(video)).toThrow();
  });

  it('las firmas: solo JPEG y PNG, nada de SVG', () => {
    expect(esJpeg(JPEG(1))).toBe(true);
    expect(esPng(PNG)).toBe(true);
    expect(medidasPng(PNG)).toEqual({ ancho: 1280, alto: 720 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(esJpeg(svg) || esPng(svg)).toBe(false);
    expect(esPng(JPEG(1))).toBe(false);
  });
});

describe('Almacén cifrado', () => {
  let carpeta: string;
  const clave = Buffer.alloc(32, 4);
  const conClave = <T>(uso: (c: Buffer) => T): T => uso(clave);
  const MARCA = Buffer.from(['contenido', 'de', 'la', 'pagina', '7731'].join('-'));

  beforeEach(() => {
    carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-almacen-'));
  });
  afterEach(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  it('ida y vuelta, con un nombre aleatorio y sin un byte en claro en el disco', async () => {
    const semilla = crearSemillaEvidencia();
    const escritor = crearEscritor(carpeta, conClave, 'ev-1', semilla);
    await escritor.escribir(MARCA);
    await escritor.escribir(Buffer.alloc(200_000, 7));
    await escritor.terminar();
    expect(escritor.archivo).toMatch(/^[0-9a-f]{32}\.qev$/);
    const enDisco = readFileSync(path.join(carpeta, escritor.archivo));
    expect(enDisco.includes(MARCA)).toBe(false);
    const leido = await leerDescifrado(carpeta, conClave, 'ev-1', semilla, escritor.archivo, 1e6);
    expect(leido.subarray(0, MARCA.length)).toEqual(MARCA);
    expect(leido.length).toBe(MARCA.length + 200_000);
  });

  it('mientras se escribe, lo que hay en el disco ya está cifrado', async () => {
    const escritor = crearEscritor(carpeta, conClave, 'ev-2', crearSemillaEvidencia());
    for (let i = 0; i < 30; i++)
      await escritor.escribir(Buffer.concat([MARCA, Buffer.alloc(8192)]));
    // Sin terminar: el archivo existe y crece, pero nunca en claro.
    const parcial = readFileSync(path.join(carpeta, escritor.archivo));
    expect(parcial.length).toBeGreaterThan(0);
    expect(parcial.includes(MARCA)).toBe(false);
    await escritor.terminar();
  });

  it('con otra semilla no se lee, y pasar del máximo falla', async () => {
    const semilla = crearSemillaEvidencia();
    const escritor = crearEscritor(carpeta, conClave, 'ev-3', semilla);
    await escritor.escribir(MARCA);
    await escritor.terminar();
    await expect(
      leerDescifrado(carpeta, conClave, 'ev-3', crearSemillaEvidencia(), escritor.archivo, 1e6),
    ).rejects.toThrow();
    await expect(
      leerDescifrado(carpeta, conClave, 'ev-3', semilla, escritor.archivo, 4),
    ).rejects.toThrow();
  });

  it('descartar borra el archivo', async () => {
    const escritor = crearEscritor(carpeta, conClave, 'ev-4', crearSemillaEvidencia());
    await escritor.escribir(MARCA);
    escritor.descartar();
    await expect.poll(() => readdirSync(carpeta)).toEqual([]);
  });

  it('limpia lo que no tiene fila, y nunca lo que se le pide conservar', () => {
    const conservar = nombreAleatorio();
    const huerfano = nombreAleatorio();
    writeFileSync(path.join(carpeta, conservar), 'x');
    writeFileSync(path.join(carpeta, huerfano), 'x');
    expect(limpiarHuerfanos(carpeta, new Set([conservar]))).toBe(1);
    expect(readdirSync(carpeta)).toEqual([conservar]);
  });

  it('no lee un nombre que no es de una evidencia', async () => {
    await expect(
      leerDescifrado(carpeta, conClave, 'ev', crearSemillaEvidencia(), '../boveda.db', 10),
    ).rejects.toThrow('nombre-invalido');
  });
});

describe('Traza y HAR: redactados campo por campo (EVI-03 y EVI-04)', () => {
  const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJhbmEifQ', 'firma-de-prueba-123'].join('.');
  const CLAVE = ['clave', 'del', 'proyecto', '8842'].join('-');
  const comparador = ComparadorDeSecretos.crear([Buffer.from(CLAVE)]);
  const opciones = { comparador };
  const red = {
    clase: 'red' as const,
    t: 10,
    tramo: 1,
    metodo: 'POST',
    url: `http://app.example.test/api?token=${JWT}&q=1`,
    tipoRecurso: 'fetch',
    estado: 200,
    encabezadosSolicitud: [
      { nombre: 'Authorization', valor: `Bearer ${JWT}` },
      { nombre: 'Cookie', valor: 'sesion=abc123' },
      { nombre: 'Accept', valor: 'application/json' },
    ],
    encabezadosRespuesta: [
      { nombre: 'Set-Cookie', valor: 'sesion=xyz; HttpOnly' },
      { nombre: 'Content-Type', valor: 'application/json' },
    ],
    cuerpoSolicitud: JSON.stringify({ usuario: 'ana', password: CLAVE, nota: `uso ${CLAVE}` }),
    tipoContenidoSolicitud: 'application/json',
    error: null,
    duracionMs: 42,
  };

  it('encabezados, URL y cuerpo: nada del secreto queda', () => {
    const { red: redactada, redacciones } = redactarRed(red, REDACTOR, opciones);
    const texto = JSON.stringify(redactada);
    for (const secreto of [JWT, CLAVE, 'abc123', 'xyz']) expect(texto).not.toContain(secreto);
    expect(texto).toContain('application/json');
    expect(redacciones.length).toBeGreaterThan(0);
  });

  it('el HAR no tiene cuerpos de respuesta y es JSON válido', () => {
    const { red: redactada } = redactarRed(red, REDACTOR, opciones);
    const har = `${INICIO_HAR}${JSON.stringify(entradaHar(redactada, Date.parse('2026-11-08T00:00:00Z')))}${FIN_HAR}`;
    const leido = JSON.parse(har) as { log: { entries: { response: { content: object } }[] } };
    expect(leido.log.entries).toHaveLength(1);
    expect(leido.log.entries[0]?.response.content).not.toHaveProperty('text');
    expect(har).not.toContain(CLAVE);
  });

  it('consola, excepción, acción y navegación pasan por la redacción', () => {
    for (const evento of [
      { clase: 'consola' as const, t: 1, tramo: 1, nivel: 'log', texto: `token ${JWT}` },
      { clase: 'excepcion' as const, t: 1, tramo: 1, texto: `falló con ${CLAVE}` },
      { clase: 'accion' as const, t: 1, tramo: 1, accion: 'click' as const, objetivo: CLAVE },
      { clase: 'navegacion' as const, t: 1, tramo: 1, url: `http://app.example.test/?k=${CLAVE}` },
    ]) {
      const { linea, secretos } = redactarEvento(evento, REDACTOR, opciones);
      expect(JSON.stringify(linea)).not.toContain(CLAVE);
      expect(JSON.stringify(linea)).not.toContain(JWT);
      expect(secretos).toBeGreaterThan(0);
    }
  });

  it('un nombre de encabezado o un método raros no pasan como texto libre', () => {
    const { red: redactada } = redactarRed(
      { ...red, metodo: 'GET <x>', encabezadosSolicitud: [{ nombre: 'X a b', valor: '1' }] },
      REDACTOR,
      opciones,
    );
    expect(redactada.metodo).toBe('[no-token]');
    expect(redactada.encabezadosSolicitud[0]?.nombre).toBe('[no-token]');
  });
});
