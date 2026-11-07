/** Tipos de `nativos.mjs`, para el build y los tests (ADR 007). */
export interface ModuloRegistrado {
  paquete: string;
  /** Relativo a la carpeta del paquete, con barras normales. */
  archivo: string;
  sha256: string;
}

/** Paquete → versión → archivo → SHA-256. */
export type RegistroNativos = Record<string, Record<string, Record<string, string>>>;

export const PAQUETES_NATIVOS: readonly string[];
export function leerRegistro(raiz: string): RegistroNativos;
export function sha256(datos: Uint8Array): string;
export function carpetasDe(raiz: string, paquete: string): string[];
export function binariosDe(carpeta: string): string[];
export function verificarInstalados(raiz: string, registro?: RegistroNativos): string[];
export function manifiestoRegistrado(
  raiz: string,
  plataforma: string,
  registro?: RegistroNativos,
): ModuloRegistrado[];
export function calcularRegistro(raiz: string): RegistroNativos;
