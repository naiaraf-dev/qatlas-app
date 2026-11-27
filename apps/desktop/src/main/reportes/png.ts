/**
 * PNG en el proceso principal, sin dependencias (zlib de Node): decodificar, tapar y volver a codificar
 * (captura anotada, ADR 048).
 *
 * - **Tapar destruye:** los píxeles del recuadro se reemplazan por un color sólido en la imagen que sale. No
 *   hay capas: el archivo es una sola imagen, y la original no viaja.
 * - **Sin metadatos:** se vuelve a codificar solo con `IHDR`, `IDAT` e `IEND`. Nada de `tEXt`, `iTXt`, `eXIf`
 *   ni `tIME`, aunque los traiga la entrada.
 * - **Falla cerrado:** solo PNG de 8 bits, RGB o RGBA, sin entrelazado (lo que dan Chromium y el canvas), con
 *   el CRC de cada chunk verificado y un tope de tamaño.
 */
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export class PngInvalido extends Error {
  constructor(motivo: string) {
    super(`PNG inválido: ${motivo}`);
    this.name = 'PngInvalido';
  }
}

export interface ImagenRgba {
  ancho: number;
  alto: number;
  /** RGBA, 4 bytes por píxel, fila por fila. */
  datos: Uint8Array;
}

export interface Recuadro {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 8000 × 8000: más que cualquier captura de una página. */
export const MAXIMO_PIXELES = 64_000_000;

export function decodificarPng(entrada: Uint8Array): ImagenRgba {
  const png = Buffer.from(entrada);
  if (png.length < 8 || !png.subarray(0, 8).equals(FIRMA)) throw new PngInvalido('sin la firma');
  let i = 8;
  let ancho = 0;
  let alto = 0;
  let canales = 0;
  const idat: Buffer[] = [];
  let fin = false;
  while (i + 12 <= png.length && !fin) {
    const largo = png.readUInt32BE(i);
    const tipo = png.toString('latin1', i + 4, i + 8);
    if (i + 12 + largo > png.length) throw new PngInvalido('chunk cortado');
    const datos = png.subarray(i + 8, i + 8 + largo);
    if (crc32(png.subarray(i + 4, i + 8 + largo)) !== png.readUInt32BE(i + 8 + largo)) {
      throw new PngInvalido(`CRC de ${tipo}`);
    }
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0);
      alto = datos.readUInt32BE(4);
      const [bits, color, compresion, filtro, entrelazado] = [
        datos[8],
        datos[9],
        datos[10],
        datos[11],
        datos[12],
      ];
      if (bits !== 8 || compresion !== 0 || filtro !== 0 || entrelazado !== 0) {
        throw new PngInvalido('solo 8 bits, sin entrelazado');
      }
      if (color === 2) canales = 3;
      else if (color === 6) canales = 4;
      else throw new PngInvalido('solo RGB o RGBA');
      if (ancho === 0 || alto === 0 || ancho * alto > MAXIMO_PIXELES)
        throw new PngInvalido('tamaño');
    } else if (tipo === 'IDAT') {
      idat.push(datos);
    } else if (tipo === 'IEND') {
      fin = true;
    }
    i += 12 + largo;
  }
  if (!fin || canales === 0) throw new PngInvalido('incompleto');
  const fila = ancho * canales;
  const crudo = inflateSync(Buffer.concat(idat), { maxOutputLength: (fila + 1) * alto });
  if (crudo.length !== (fila + 1) * alto) throw new PngInvalido('datos de un tamaño inesperado');

  const salida = new Uint8Array(ancho * alto * 4);
  const anterior = new Uint8Array(fila);
  const actual = new Uint8Array(fila);
  for (let y = 0; y < alto; y++) {
    const base = y * (fila + 1);
    const filtroFila = crudo[base];
    for (let x = 0; x < fila; x++) {
      const valor = crudo[base + 1 + x] ?? 0;
      const a = x >= canales ? (actual[x - canales] ?? 0) : 0;
      const b = anterior[x] ?? 0;
      const c = x >= canales ? (anterior[x - canales] ?? 0) : 0;
      let predictor = 0;
      switch (filtroFila) {
        case 0:
          break;
        case 1:
          predictor = a;
          break;
        case 2:
          predictor = b;
          break;
        case 3:
          predictor = (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new PngInvalido('filtro desconocido');
      }
      actual[x] = (valor + predictor) & 0xff;
    }
    for (let x = 0; x < ancho; x++) {
      const destino = (y * ancho + x) * 4;
      const origen = x * canales;
      salida[destino] = actual[origen] ?? 0;
      salida[destino + 1] = actual[origen + 1] ?? 0;
      salida[destino + 2] = actual[origen + 2] ?? 0;
      salida[destino + 3] = canales === 4 ? (actual[origen + 3] ?? 255) : 255;
    }
    anterior.set(actual);
  }
  return { ancho, alto, datos: salida };
}

function chunk(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabecera.subarray(4), datos])), 0);
  return Buffer.concat([cabecera, datos, crc]);
}

/** RGBA de 8 bits, filtro 0, solo IHDR, IDAT e IEND. */
export function codificarPng(imagen: ImagenRgba): Buffer {
  const { ancho, alto, datos } = imagen;
  if (datos.length !== ancho * alto * 4) throw new PngInvalido('datos de un tamaño inesperado');
  const fila = ancho * 4;
  const crudo = Buffer.alloc((fila + 1) * alto);
  for (let y = 0; y < alto; y++) {
    crudo[y * (fila + 1)] = 0;
    crudo.set(datos.subarray(y * fila, (y + 1) * fila), y * (fila + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    FIRMA,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(crudo)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Reemplaza los píxeles de cada recuadro (recortado a la imagen) por un color sólido opaco. */
export function tapar(
  imagen: ImagenRgba,
  recuadros: readonly Recuadro[],
  color: readonly [number, number, number] = [0, 0, 0],
): ImagenRgba {
  const datos = new Uint8Array(imagen.datos);
  for (const r of recuadros) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(imagen.ancho, Math.ceil(r.x + r.ancho));
    const y1 = Math.min(imagen.alto, Math.ceil(r.y + r.alto));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * imagen.ancho + x) * 4;
        datos[i] = color[0];
        datos[i + 1] = color[1];
        datos[i + 2] = color[2];
        datos[i + 3] = 255;
      }
    }
  }
  return { ...imagen, datos };
}

/** Los tipos de chunk de un PNG, en orden: para verificar que no salga ninguno de metadatos. */
export function chunksDePng(entrada: Uint8Array): string[] {
  const png = Buffer.from(entrada);
  const tipos: string[] = [];
  let i = 8;
  while (i + 12 <= png.length) {
    const largo = png.readUInt32BE(i);
    tipos.push(png.toString('latin1', i + 4, i + 8));
    i += 12 + largo;
  }
  return tipos;
}
