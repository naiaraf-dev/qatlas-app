/**
 * Los archivos que arma QAtlas para exportar, sin dependencias (ADR 048): la limpieza de metadatos del PDF,
 * el PNG de la captura anotada (tapar destruye, sin metadatos) y el ZIP sin cifrar con nombres por ID.
 * Todo con datos inventados.
 */
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { limpiarMetadatosPdf, PdfNoLimpiable, problemasDeMetadatos } from './pdf-limpieza';
import {
  chunksDePng,
  codificarPng,
  decodificarPng,
  PngInvalido,
  tapar,
  type ImagenRgba,
} from './png';
import { escribirZip, leerZip } from './zip';

/** Un PDF con la forma del de Chromium: xref clásica, un trailer y /Info con Producer y Creator. */
function pdfComoChromium(
  info = "/Title (Un reporte inventado) /Creator (Chromium) /Producer (Skia/PDF m156) /CreationDate (D:20261127120000+00'00') /ModDate (D:20261127120000+00'00')",
): Buffer {
  const objetos = [
    `1 0 obj\n<<${info}>>\nendobj\n`,
    '2 0 obj\n<</Type /Catalog /Pages 3 0 R>>\nendobj\n',
    '3 0 obj\n<</Type /Pages /Kids [] /Count 0>>\nendobj\n',
  ];
  let cuerpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objetos) {
    offsets.push(cuerpo.length);
    cuerpo += o;
  }
  const xref = cuerpo.length;
  cuerpo += `xref\n0 4\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  cuerpo += `trailer\n<</Size 4 /Root 2 0 R /Info 1 0 R>>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(cuerpo, 'latin1');
}

describe('PDF: metadatos borrados en el lugar (EXP-03, TS-14)', () => {
  it('control: el PDF de Chromium trae software de origen, título y fechas', () => {
    expect(problemasDeMetadatos(pdfComoChromium())).toEqual(
      expect.arrayContaining(['/Producer con valor', '/Creator con valor', '/Title con valor']),
    );
  });

  it('limpio: sin valores, del mismo tamaño y con la xref intacta', () => {
    const original = pdfComoChromium();
    const limpio = limpiarMetadatosPdf(original);
    expect(problemasDeMetadatos(limpio)).toEqual([]);
    expect(limpio.length).toBe(original.length);
    // Cada offset de la xref sigue apuntando a su objeto.
    const texto = limpio.toString('latin1');
    for (const [n, offset] of [...texto.matchAll(/^(\d{10}) 00000 n $/gm)].map((m, i) => [
      i + 1,
      Number(m[1]),
    ])) {
      expect(texto.startsWith(`${String(n)} 0 obj\n`, offset)).toBe(true);
    }
  });

  it('falla cerrado con lo que no sabe limpiar', () => {
    const casos: [string, Buffer][] = [
      ['no es un PDF', Buffer.from('hola')],
      ['XMP', Buffer.concat([pdfComoChromium(), Buffer.from('<x:xmpmeta>')])],
      ['flujo de objetos', Buffer.concat([pdfComoChromium(), Buffer.from('/Type /ObjStm')])],
      ['dos trailers', Buffer.concat([pdfComoChromium(), Buffer.from('trailer\n<</Info 1 0 R>>')])],
      ['valor con escapes', pdfComoChromium('/Producer (Skia\\(raro\\))')],
      ['Chromium fuera de /Info', Buffer.concat([pdfComoChromium(), Buffer.from('% Chromium')])],
    ];
    for (const [caso, pdf] of casos) {
      expect(() => limpiarMetadatosPdf(pdf), caso).toThrow(PdfNoLimpiable);
    }
  });
});

const imagen = (
  ancho: number,
  alto: number,
  pintar: (x: number, y: number) => [number, number, number],
): ImagenRgba => {
  const datos = new Uint8Array(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const [r, g, b] = pintar(x, y);
      datos.set([r, g, b, 255], (y * ancho + x) * 4);
    }
  }
  return { ancho, alto, datos };
};

/** Un PNG RGB con un filtro distinto por fila (0 a 4) y un chunk tEXt: lo que puede traer la entrada. */
function pngConFiltrosYTexto(): Buffer {
  const ancho = 3;
  const alto = 5;
  const filas: number[] = [];
  const pixeles = (y: number) =>
    Array.from({ length: ancho * 3 }, (_, i) => (y * 40 + i * 7) & 0xff);
  let anterior = new Array<number>(ancho * 3).fill(0);
  for (let y = 0; y < alto; y++) {
    const actual = pixeles(y);
    const filtro = y; // 0..4
    filas.push(filtro);
    for (let x = 0; x < actual.length; x++) {
      const a = x >= 3 ? (actual[x - 3] ?? 0) : 0;
      const b = anterior[x] ?? 0;
      const c = x >= 3 ? (anterior[x - 3] ?? 0) : 0;
      const p = a + b - c;
      const paeth =
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][filtro] ?? 0;
      filas.push(((actual[x] ?? 0) - predictor) & 0xff);
    }
    anterior = actual;
  }
  const chunk = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const tipoYDatos = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tipoYDatos));
    return Buffer.concat([largo, tipoYDatos, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Author\0ana', 'latin1')),
    chunk('IDAT', deflateSync(Buffer.from(filas))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('PNG de la captura anotada', () => {
  it('decodifica los cinco filtros de PNG y vuelve a codificar sin metadatos', () => {
    const entrada = pngConFiltrosYTexto();
    expect(chunksDePng(entrada)).toContain('tEXt'); // control: la entrada sí trae metadatos
    const decodificada = decodificarPng(entrada);
    expect(decodificada).toMatchObject({ ancho: 3, alto: 5 });
    // El primer píxel de la fila 4 (Paeth): (4*40 + 0) & 0xff.
    expect(decodificada.datos[4 * 3 * 4]).toBe(160);
    const salida = codificarPng(decodificada);
    expect(chunksDePng(salida)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(decodificarPng(salida).datos).toEqual(decodificada.datos);
  });

  it('tapar reemplaza los píxeles: lo tapado no queda en la imagen que sale', () => {
    const original = imagen(20, 10, (x) => (x < 10 ? [200, 30, 30] : [30, 200, 30]));
    const tapada = decodificarPng(
      codificarPng(tapar(original, [{ x: 2, y: 2, ancho: 6, alto: 6 }])),
    );
    const pixel = (img: ImagenRgba, x: number, y: number) => [
      ...img.datos.subarray((y * img.ancho + x) * 4, (y * img.ancho + x) * 4 + 4),
    ];
    expect(pixel(tapada, 4, 4)).toEqual([0, 0, 0, 255]);
    // Control: fuera del recuadro, la imagen sigue igual.
    expect(pixel(tapada, 15, 4)).toEqual([30, 200, 30, 255]);
    expect(pixel(original, 4, 4)).toEqual([200, 30, 30, 255]);
    // Ningún píxel tapado conserva el rojo original.
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) expect(pixel(tapada, x, y)[0]).toBe(0);
  });

  it('falla cerrado: sin firma, CRC roto, entrelazado o paleta', () => {
    const bueno = codificarPng(imagen(2, 2, () => [1, 2, 3]));
    const crcRoto = Buffer.from(bueno);
    crcRoto[29] = (crcRoto[29] ?? 0) ^ 0xff; // el CRC de IHDR
    const conPaleta = Buffer.from(bueno);
    conPaleta[25] = 3;
    for (const [caso, png] of [
      ['sin firma', Buffer.from('no es png')],
      ['CRC roto', crcRoto],
      ['paleta (sin recalcular el CRC)', conPaleta],
    ] as const) {
      expect(() => decodificarPng(png), caso).toThrow(PngInvalido);
    }
  });
});

describe('ZIP sin cifrar, con nombres por ID (EXP-06)', () => {
  it('se lee igual que se escribió, comprimido si achica', () => {
    const texto = Buffer.from('reporte inventado\n'.repeat(50));
    const binario = Buffer.from([1, 2, 3]);
    const zip = escribirZip([
      { nombre: 'reporte.md', datos: texto },
      { nombre: 'evidencias/0123abcd-aaaa.png', datos: binario },
    ]);
    expect(leerZip(zip)).toEqual([
      { nombre: 'reporte.md', datos: texto },
      { nombre: 'evidencias/0123abcd-aaaa.png', datos: binario },
    ]);
    expect(zip.length).toBeLessThan(texto.length);
  });

  it('sin fecha real, sin comentario ni campos extra', () => {
    const zip = escribirZip([{ nombre: 'reporte.md', datos: Buffer.from('x') }]);
    expect(zip.readUInt16LE(10)).toBe(0); // hora
    expect(zip.readUInt16LE(12)).toBe(33); // 1980-01-01
    expect(zip.readUInt16LE(28)).toBe(0); // extra del encabezado local
    expect(zip.readUInt16LE(zip.length - 2)).toBe(0); // comentario del ZIP
  });

  it('rechaza un nombre que no sea una ruta simple por ID: nada del sitio adentro', () => {
    for (const nombre of [
      '../salir.md',
      'C:/x.md',
      'Pedido de ana.png',
      'evidencias//x.png',
      'a.md',
      'a.md',
    ]) {
      expect(
        () =>
          escribirZip([
            { nombre: 'a.md', datos: Buffer.from('') },
            { nombre, datos: Buffer.from('') },
          ]),
        nombre,
      ).toThrow();
    }
  });
});
