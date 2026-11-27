/**
 * TS-14 · Metadatos de lo exportado (EXP-03, EXP-06, ADR 048). Lo que sale de QAtlas no dice quién, dónde ni
 * con qué se hizo: ni usuario, ni equipo, ni rutas, ni software de origen.
 *
 * Cada caso tiene su control positivo: la entrada **sí** trae el metadato, así que el test no puede pasar
 * porque no había nada que sacar. El PDF real de `printToPDF` se prueba en `e2e/reportes.e2e.ts`.
 */
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  limpiarMetadatosPdf,
  PdfNoLimpiable,
  problemasDeMetadatos,
} from '../apps/desktop/src/main/reportes/pdf-limpieza';
import { fuentesDelPdf } from '../apps/desktop/src/main/reportes/plantillas';
import { chunksDePng, codificarPng, decodificarPng } from '../apps/desktop/src/main/reportes/png';
import { escribirZip } from '../apps/desktop/src/main/reportes/zip';

// Inventados: un usuario, un equipo y una ruta que no existen.
const USUARIO = 'ana';
const EQUIPO = ['EQUIPO', 'DE', 'PRUEBA', '77'].join('-');
const RUTA = ['C:', 'Users', USUARIO, 'Documents', 'reporte.pdf'].join(String.fromCharCode(92));

function pdfConMetadatos(): Buffer {
  const info = `/Title (${RUTA}) /Author (${USUARIO}) /Subject (${EQUIPO}) /Creator (Chromium) /Producer (Skia/PDF m156) /CreationDate (D:20261127120000+00'00')`;
  // Sin escapes en los valores: el limpiador rechaza un valor con barra invertida.
  const objetos = [
    `1 0 obj\n<<${info.replaceAll(String.fromCharCode(92), '/')}>>\nendobj\n`,
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

describe('TS-14 · PDF', () => {
  it('control: el PDF trae usuario, equipo, ruta y software de origen', () => {
    const texto = pdfConMetadatos().toString('latin1');
    for (const marca of [USUARIO, EQUIPO, 'Users/ana', 'Skia', 'Chromium'])
      expect(texto).toContain(marca);
    expect(problemasDeMetadatos(pdfConMetadatos()).length).toBeGreaterThan(0);
  });

  it('limpio, no queda nada de eso', () => {
    const limpio = limpiarMetadatosPdf(pdfConMetadatos()).toString('latin1');
    for (const marca of [EQUIPO, 'Users/ana', 'Skia', 'Chromium', 'D:2026']) {
      expect(limpio, marca).not.toContain(marca);
    }
    expect(limpio).not.toMatch(/\(\s*ana\s*\)/);
  });

  it('lo que no sabe limpiar no sale (falla cerrado)', () => {
    const conXmp = Buffer.concat([pdfConMetadatos(), Buffer.from('<x:xmpmeta>')]);
    expect(() => limpiarMetadatosPdf(conXmp)).toThrow(PdfNoLimpiable);
  });

  it('una fuente del sistema se reconoce; control: la empaquetada también', () => {
    const conFuente = (nombre: string) =>
      Buffer.from(`1 0 obj\n<</Type /Font /Subtype /Type0 /BaseFont /AAAAAA+${nombre}>>\nendobj\n`);
    expect(fuentesDelPdf(conFuente('ArialMT'))).toEqual(['ArialMT']);
    expect(fuentesDelPdf(conFuente('Inter-Regular'))).toEqual(['Inter-Regular']);
  });
});

/** Un PNG RGBA de 2×2 con los chunks de metadatos que suelen traer las herramientas. */
function pngConMetadatos(): Buffer {
  const chunk = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const filas = Buffer.concat([0, 0].map(() => Buffer.from([0, 9, 9, 9, 255, 9, 9, 9, 255])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`Author\0${USUARIO}`, 'latin1')),
    chunk('tEXt', Buffer.from(`Source\0${RUTA}`, 'latin1')),
    chunk('tIME', Buffer.from([7, 234, 11, 27, 12, 0, 0])),
    chunk('IDAT', deflateSync(filas)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('TS-14 · Imágenes', () => {
  it('control: la imagen de entrada trae autor, ruta y fecha', () => {
    expect(chunksDePng(pngConMetadatos())).toEqual([
      'IHDR',
      'tEXt',
      'tEXt',
      'tIME',
      'IDAT',
      'IEND',
    ]);
    const texto = pngConMetadatos().toString('latin1');
    expect(texto).toContain('Author');
    expect(texto).toContain('Users');
  });

  it('la que sale tiene solo la imagen: IHDR, IDAT e IEND', () => {
    const salida = codificarPng(decodificarPng(pngConMetadatos()));
    expect(chunksDePng(salida)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(salida.toString('latin1')).not.toContain('Users');
  });
});

describe('TS-14 · ZIP', () => {
  it('fecha fija, sin comentarios ni campos extra, y nombres sin datos', () => {
    const zip = escribirZip([{ nombre: 'evidencias/0f3c.png', datos: Buffer.from('x') }]);
    // Cabecera local: fecha y hora DOS fijas (1980-01-01 00:00), sin campo extra.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(10)).toBe(0);
    expect(zip.readUInt16LE(12)).toBe(0x21);
    expect(zip.readUInt16LE(28)).toBe(0);
    // Fin del directorio central: sin comentario.
    expect(zip.readUInt16LE(zip.length - 2)).toBe(0);
    // Control: un nombre con una ruta o un dato no se acepta.
    for (const nombre of [RUTA, `${USUARIO} reporte.png`, '../reporte.png']) {
      expect(() => escribirZip([{ nombre, datos: Buffer.from('x') }]), nombre).toThrow();
    }
  });
});
