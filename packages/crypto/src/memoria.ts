import { timingSafeEqual } from 'node:crypto';

/**
 * Sobrescribe con ceros los buffers recibidos. Limitaciones de JavaScript en el
 * README del paquete: esto reduce la ventana de exposición, no la elimina.
 */
export function borrar(...buffers: readonly (Uint8Array | null | undefined)[]): void {
  for (const buffer of buffers) buffer?.fill(0);
}

/**
 * Compara en tiempo constante respecto del contenido. La longitud no se considera
 * secreta: con longitudes distintas devuelve false sin comparar.
 */
export function igualesEnTiempoConstante(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Convierte la contraseña a bytes normalizando a NFC, para que la misma contraseña
 * dé la misma KEK en cualquier sistema operativo. Usa Buffer.alloc porque
 * Buffer.from(string) puede compartir el pool interno de Node.
 *
 * El string de entrada no se puede borrar: hay que convertirlo lo antes posible.
 */
export function contrasenaABuffer(contrasena: string): Buffer {
  const normalizada = contrasena.normalize('NFC');
  const bytes = Buffer.alloc(Buffer.byteLength(normalizada, 'utf8'));
  bytes.write(normalizada, 'utf8');
  return bytes;
}
