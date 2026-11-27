/**
 * Un ZIP escrito por QAtlas, sin dependencias (zlib de Node), **sin cifrar** (EXP-06, ADR 048). Para un
 * archivo cifrado está el paquete `.qatlas-paquete` (semana 9b).
 *
 * - Los nombres de adentro los arma quien llama, con IDs: nunca un dato del sitio (EXP-06). `escribirZip`
 *   rechaza un nombre que no sea una ruta relativa simple.
 * - Sin metadatos: fecha fija (1980-01-01), sin comentario, sin campos extra, sin atributos del sistema.
 * - Deflate si achica; si no, guardado tal cual.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface EntradaZip {
  nombre: string;
  datos: Uint8Array;
}

const NOMBRE_VALIDO = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z0-9]+$/;
/** 1980-01-01 00:00 en formato DOS: la fecha no dice cuándo ni dónde se armó. */
const HORA_DOS = 0;
const FECHA_DOS = (0 << 9) | (1 << 5) | 1;

export function escribirZip(entradas: readonly EntradaZip[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  const vistos = new Set<string>();
  let desplazamiento = 0;
  for (const { nombre, datos } of entradas) {
    if (!NOMBRE_VALIDO.test(nombre) || vistos.has(nombre)) {
      throw new Error('Nombre de entrada del ZIP no válido o repetido');
    }
    vistos.add(nombre);
    const crudo = Buffer.from(datos);
    const comprimido = deflateRawSync(crudo);
    const usaDeflate = comprimido.length < crudo.length;
    const cuerpo = usaDeflate ? comprimido : crudo;
    const nombreBytes = Buffer.from(nombre, 'utf8');
    const crc = crc32(crudo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(usaDeflate ? 8 : 0, 8);
    local.writeUInt16LE(HORA_DOS, 10);
    local.writeUInt16LE(FECHA_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(crudo.length, 22);
    local.writeUInt16LE(nombreBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBytes, cuerpo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(usaDeflate ? 8 : 0, 10);
    central.writeUInt16LE(HORA_DOS, 12);
    central.writeUInt16LE(FECHA_DOS, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(cuerpo.length, 20);
    central.writeUInt32LE(crudo.length, 24);
    central.writeUInt16LE(nombreBytes.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombreBytes);
    desplazamiento += local.length + nombreBytes.length + cuerpo.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}

/** Lee un ZIP de `escribirZip`: para los tests (nombres, contenido y que no haya nada más). */
export function leerZip(zip: Uint8Array): EntradaZip[] {
  const b = Buffer.from(zip);
  const fin = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('Sin fin de directorio');
  const cantidad = b.readUInt16LE(fin + 10);
  let i = b.readUInt32LE(fin + 16);
  const salida: EntradaZip[] = [];
  for (let n = 0; n < cantidad; n++) {
    if (b.readUInt32LE(i) !== 0x02014b50) throw new Error('Directorio central inválido');
    const metodo = b.readUInt16LE(i + 10);
    const comprimido = b.readUInt32LE(i + 20);
    const largoNombre = b.readUInt16LE(i + 28);
    const largoExtra = b.readUInt16LE(i + 30);
    const largoComentario = b.readUInt16LE(i + 32);
    const local = b.readUInt32LE(i + 42);
    const nombre = b.toString('utf8', i + 46, i + 46 + largoNombre);
    const inicio = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const cuerpo = b.subarray(inicio, inicio + comprimido);
    salida.push({ nombre, datos: metodo === 8 ? inflateRawSync(cuerpo) : Buffer.from(cuerpo) });
    i += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}
