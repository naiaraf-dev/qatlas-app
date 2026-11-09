/**
 * El contenedor del video de un tramo (ADR 036): fotogramas JPEG del screencast con su momento, y los
 * huecos donde se descartaron fotogramas. Es lo que se cifra; nunca hay un `.webm` ni un fotograma en
 * claro en disco. La interfaz lo reproduce fotograma a fotograma en un canvas.
 *
 *   cabecera: "QVID" (4) | versión (1)
 *   registro: tipo (1) | t en ms desde el comienzo del tramo (4) | largo (4) | datos
 *   tipos:    1 = fotograma (JPEG) · 2 = hueco (datos: cantidad de fotogramas perdidos, 4 bytes)
 *
 * Sin Electron, para probarlo con Vitest.
 */

const MAGIC = Buffer.from('QVID', 'ascii');
const VERSION = 1;
export const CABECERA_VIDEO = Buffer.concat([MAGIC, Buffer.from([VERSION])]);
const TIPO_FOTOGRAMA = 1;
const TIPO_HUECO = 2;
const LARGO_REGISTRO = 9;

export interface Hueco {
  t: number;
  cantidad: number;
}

const enteroDe = (valor: number): number => Math.max(0, Math.min(0xffffffff, Math.round(valor)));

function registro(tipo: number, t: number, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(LARGO_REGISTRO);
  cabecera[0] = tipo;
  cabecera.writeUInt32BE(enteroDe(t), 1);
  cabecera.writeUInt32BE(datos.length, 5);
  return Buffer.concat([cabecera, datos]);
}

export const registroFotograma = (t: number, jpeg: Buffer): Buffer =>
  registro(TIPO_FOTOGRAMA, t, jpeg);

export function registroHueco(t: number, cantidad: number): Buffer {
  const datos = Buffer.alloc(4);
  datos.writeUInt32BE(enteroDe(cantidad));
  return registro(TIPO_HUECO, t, datos);
}

export interface IndiceVideo {
  fotogramas: { t: number; inicio: number; fin: number }[];
  huecos: Hueco[];
}

/** Lee el contenedor ya descifrado. Un archivo mal formado se rechaza entero. */
export function indexarVideo(video: Buffer): IndiceVideo {
  if (video.length < CABECERA_VIDEO.length || !video.subarray(0, 4).equals(MAGIC)) {
    throw new Error('video-invalido');
  }
  if (video[4] !== VERSION) throw new Error('video-version');
  const indice: IndiceVideo = { fotogramas: [], huecos: [] };
  let posicion = CABECERA_VIDEO.length;
  while (posicion < video.length) {
    if (posicion + LARGO_REGISTRO > video.length) throw new Error('video-invalido');
    const tipo = video[posicion];
    const t = video.readUInt32BE(posicion + 1);
    const largo = video.readUInt32BE(posicion + 5);
    const inicio = posicion + LARGO_REGISTRO;
    const fin = inicio + largo;
    if (fin > video.length) throw new Error('video-invalido');
    if (tipo === TIPO_FOTOGRAMA) indice.fotogramas.push({ t, inicio, fin });
    else if (tipo === TIPO_HUECO && largo === 4) {
      indice.huecos.push({ t, cantidad: video.readUInt32BE(inicio) });
    } else throw new Error('video-invalido');
    posicion = fin;
  }
  return indice;
}

/** Firmas de los formatos que se aceptan. Nada de SVG ni de otro formato que pueda traer código. */
export const esJpeg = (datos: Uint8Array): boolean =>
  datos.length > 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff;

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const esPng = (datos: Uint8Array): boolean =>
  datos.length > FIRMA_PNG.length && FIRMA_PNG.every((byte, i) => datos[i] === byte);

/** Ancho y alto de un PNG, de su cabecera IHDR. */
export function medidasPng(datos: Uint8Array): { ancho: number; alto: number } | null {
  if (!esPng(datos) || datos.length < 24) return null;
  const vista = Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  return { ancho: vista.readUInt32BE(16), alto: vista.readUInt32BE(20) };
}
