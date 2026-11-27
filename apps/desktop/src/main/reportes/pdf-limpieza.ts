/**
 * Los metadatos de un PDF de Chromium (`printToPDF`), borrados en el lugar (EXP-03 y TS-14, ADR 048).
 *
 * Chromium escribe un diccionario `/Info` con `/Producer (Skia/PDF mNNN)`, `/Creator (Chromium)`, el título
 * del documento y las fechas. Cada valor se reemplaza por espacios del mismo largo: el archivo no cambia de
 * tamaño y la tabla `xref` sigue apuntando bien. Sin dependencias.
 *
 * **Falla cerrado:** si el PDF no tiene la forma esperada (una sola tabla `xref` clásica, sin flujos de
 * objetos, sin XMP, sin cifrado, con un `/Info` de valores simples), tira `PdfNoLimpiable` y no se exporta.
 * Después de limpiar, `problemasDeMetadatos` tiene que dar vacío; si no, también falla.
 */

export class PdfNoLimpiable extends Error {
  constructor(motivo: string) {
    super(`El PDF no se puede limpiar: ${motivo}`);
    this.name = 'PdfNoLimpiable';
  }
}

/** Las claves del diccionario `/Info` que se vacían. */
const CLAVES_INFO = [
  'Producer',
  'Creator',
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'CreationDate',
  'ModDate',
] as const;

/** Lo que nunca puede quedar en el archivo: software de origen, XMP y lo que no sabemos limpiar. */
const PROHIBIDO = [
  /Skia/,
  /Chromium/,
  /<x:xmpmeta/,
  /\/Metadata\b/,
  /\/ObjStm\b/,
  /\/Type\s*\/XRef\b/,
  /\/Encrypt\b/,
];

export function limpiarMetadatosPdf(pdf: Uint8Array): Buffer {
  // latin1: un byte por carácter, así los índices son los del archivo.
  const texto = Buffer.from(pdf).toString('latin1');
  if (!texto.startsWith('%PDF-')) throw new PdfNoLimpiable('no es un PDF');
  for (const patron of [
    /\/ObjStm\b/,
    /\/Type\s*\/XRef\b/,
    /\/Encrypt\b/,
    /<x:xmpmeta/,
    /\/Metadata\b/,
  ]) {
    if (patron.test(texto)) throw new PdfNoLimpiable(`estructura no esperada (${patron.source})`);
  }
  const trailers = texto.match(/\btrailer\b/g) ?? [];
  if (trailers.length !== 1) throw new PdfNoLimpiable('se esperaba un solo trailer');
  const info = /\btrailer\s*<<[^]*?\/Info\s+(\d+)\s+0\s+R/.exec(texto);
  if (!info) throw new PdfNoLimpiable('el trailer no tiene /Info');
  const inicioObjeto = texto.search(new RegExp(`(^|[\\r\\n])${info[1] ?? ''} 0 obj\\b`));
  if (inicioObjeto < 0) throw new PdfNoLimpiable('no se encontró el objeto /Info');
  const finObjeto = texto.indexOf('endobj', inicioObjeto);
  if (finObjeto < 0) throw new PdfNoLimpiable('el objeto /Info no termina');

  const salida = Buffer.from(pdf);
  const objeto = texto.slice(inicioObjeto, finObjeto);
  for (const clave of CLAVES_INFO) {
    const m = new RegExp(`/${clave}\\s*\\(`).exec(objeto);
    if (!m) continue;
    const abre = inicioObjeto + m.index + m[0].length;
    const cierra = texto.indexOf(')', abre);
    if (cierra < 0 || cierra > finObjeto) throw new PdfNoLimpiable(`/${clave} sin cerrar`);
    const valor = texto.slice(abre, cierra);
    // Un valor con escapes o paréntesis anidados no se sabe recortar con seguridad.
    if (/[\\(]/.test(valor)) throw new PdfNoLimpiable(`/${clave} con un valor complejo`);
    salida.fill(0x20, abre, cierra);
  }
  const problemas = problemasDeMetadatos(salida);
  if (problemas.length > 0) throw new PdfNoLimpiable(problemas.join('; '));
  return salida;
}

/**
 * Lo que queda de metadatos en un PDF: cada clave de `/Info` con un valor que no sea vacío, y lo
 * prohibido. TS-14 lo usa sobre el archivo exportado.
 */
export function problemasDeMetadatos(pdf: Uint8Array): string[] {
  const texto = Buffer.from(pdf).toString('latin1');
  const problemas: string[] = [];
  for (const clave of CLAVES_INFO) {
    const m = new RegExp(`/${clave}\\s*\\(([^)]*)\\)`).exec(texto);
    if (m && (m[1] ?? '').trim() !== '') problemas.push(`/${clave} con valor`);
  }
  for (const patron of PROHIBIDO)
    if (patron.test(texto)) problemas.push(`contiene ${patron.source}`);
  return problemas;
}
