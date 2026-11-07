/** Tipos de `metadatos-imagenes.mjs`, para los tests y los scripts. */
export function esPng(datos: Uint8Array): boolean;
export function limpiarPng(datos: Buffer): Buffer;
export function limpiarSvg(texto: string): string;
export function metadatosDe(datos: Buffer, extension: string): string[];
export const EXTENSIONES_DE_IMAGEN: RegExp;
