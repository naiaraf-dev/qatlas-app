export const LENTOS: string;
export const PARTES: {
  nombre: string;
  archivos?: string[];
  grep?: string;
  grepInvert?: string;
  shard?: string;
}[];
export function argumentosDeParte(numero: number): string[];
export function playwright(args: string[]): number;
