/**
 * Logs técnicos de QAtlas (3.13, ADR 034). Se escriben también con la bóveda bloqueada, así que no se
 * pueden cifrar con sus claves: llevan **solo** eventos, códigos, IDs y tiempos. Nada de URLs, hosts,
 * nombres de proyectos, credenciales ni contenido de páginas; lo que tiene datos va a la base cifrada.
 *
 * `registrar` es el único camino: un test prohíbe `console.*` en el proceso principal fuera de acá. Un
 * valor que no sea un número, un booleano, un ID o un código de la lista cerrada se rechaza, aunque
 * esté redactado: una URL o un host redactados siguen diciendo a dónde se fue.
 *
 * Sin `electron`, para probarlo con Vitest.
 */
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { EstadoEjecucion, IpcErrorCode, ipcContract, MotivoFinEjecucion } from '@qatlas/shared';

export type ValorDeRegistro = number | boolean | null | string;

/** Los textos que pueden ir en un log: códigos que define QAtlas, nunca datos. */
export const CODIGOS_PERMITIDOS: ReadonlySet<string> = new Set([
  ...MotivoFinEjecucion.options,
  ...EstadoEjecucion.options,
  ...IpcErrorCode.options,
  ...Object.keys(ipcContract),
  // Causas de un navegador que no arrancó (diagnostico.ts del runner).
  'ruta',
  'perfil-ruta-larga',
  'sandbox',
  'dependencias',
  'pantalla',
  'otra',
  // Procesos.
  'proxy',
  'runner',
  'navegador',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTO = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){1,3}$/;
const NOMBRE_DE_CAMPO = /^[a-z][a-zA-Z0-9]{0,30}$/;

/** Si un valor puede ir en un log. Un texto, solo si es un ID o un código de la lista. */
export function valorPermitido(valor: unknown): boolean {
  if (valor === null || typeof valor === 'boolean') return true;
  if (typeof valor === 'number') return Number.isFinite(valor);
  if (typeof valor === 'string') return UUID.test(valor) || CODIGOS_PERMITIDOS.has(valor);
  return false;
}

export interface OpcionesRegistro {
  /** Dentro de la carpeta de datos: `<datos>/logs`. */
  carpeta: string;
  /** Tamaño máximo de un archivo antes de rotar. */
  maxBytes?: number;
  /** Cuántos archivos se conservan: con los valores por defecto, 50 MB como mucho (3.13). */
  maxArchivos?: number;
  /** Lo más viejo que esto se borra al iniciar (3.13: 7 días). */
  maxDias?: number;
  ahora?: () => number;
  /** También a la consola (la del proceso principal), para el CI y el desarrollo. */
  consola?: boolean;
}

const ARCHIVO = 'qatlas.log';
const rotado = (n: number) => `qatlas.${n}.log`;

export class Registro {
  private readonly maxBytes: number;
  private readonly maxArchivos: number;
  private readonly ahora: () => number;
  private readonly consola: boolean;

  constructor(private readonly opciones: OpcionesRegistro) {
    this.maxBytes = opciones.maxBytes ?? 5 * 1024 * 1024;
    this.maxArchivos = opciones.maxArchivos ?? 10;
    this.ahora = opciones.ahora ?? Date.now;
    this.consola = opciones.consola ?? false;
    mkdirSync(opciones.carpeta, { recursive: true, mode: 0o700 });
    this.borrarViejos(opciones.maxDias ?? 7);
  }

  /** Devuelve false si algo se rechazó: el evento entero, o un campo (que no se escribe). */
  registrar(evento: string, campos: Record<string, ValorDeRegistro> = {}): boolean {
    if (!EVENTO.test(evento) || evento.length > 64) {
      this.escribir('registro.evento-rechazado', {});
      return false;
    }
    const aceptados: Record<string, ValorDeRegistro> = {};
    let rechazados = 0;
    for (const [nombre, valor] of Object.entries(campos)) {
      if (NOMBRE_DE_CAMPO.test(nombre) && valorPermitido(valor)) aceptados[nombre] = valor;
      else rechazados++;
    }
    this.escribir(evento, aceptados);
    if (rechazados > 0) this.escribir('registro.campo-rechazado', { cantidad: rechazados });
    return rechazados === 0;
  }

  private escribir(evento: string, campos: Record<string, ValorDeRegistro>): void {
    const linea = `${JSON.stringify({ t: new Date(this.ahora()).toISOString(), evento, ...campos })}\n`;
    this.rotarSiHaceFalta(Buffer.byteLength(linea));
    appendFileSync(path.join(this.opciones.carpeta, ARCHIVO), linea, { mode: 0o600 });
    if (!this.consola) return;
    console.warn(
      `[qatlas] ${evento}${Object.entries(campos)
        .map(([nombre, valor]) => ` ${nombre}=${String(valor)}`)
        .join('')}`,
    );
  }

  private rotarSiHaceFalta(agregar: number): void {
    const actual = path.join(this.opciones.carpeta, ARCHIVO);
    let tamano: number;
    try {
      tamano = statSync(actual).size;
    } catch {
      return;
    }
    if (tamano + agregar <= this.maxBytes) return;
    rmSync(path.join(this.opciones.carpeta, rotado(this.maxArchivos - 1)), { force: true });
    for (let n = this.maxArchivos - 2; n >= 1; n--) {
      try {
        renameSync(
          path.join(this.opciones.carpeta, rotado(n)),
          path.join(this.opciones.carpeta, rotado(n + 1)),
        );
      } catch {
        // No existía.
      }
    }
    renameSync(actual, path.join(this.opciones.carpeta, rotado(1)));
  }

  private borrarViejos(maxDias: number): void {
    const limite = this.ahora() - maxDias * 24 * 60 * 60 * 1000;
    for (const nombre of readdirSync(this.opciones.carpeta)) {
      if (!/^qatlas(?:\.\d+)?\.log$/.test(nombre)) continue;
      const ruta = path.join(this.opciones.carpeta, nombre);
      if (statSync(ruta).mtimeMs < limite) rmSync(ruta, { force: true });
    }
  }
}

let actual: Registro | null = null;

/** Al arrancar, con la carpeta de datos. Antes, solo a la consola. */
export function iniciarRegistro(opciones: OpcionesRegistro): Registro {
  actual = new Registro(opciones);
  return actual;
}

/** El único log del proceso principal. Ver arriba qué puede llevar. */
export function registrar(evento: string, campos: Record<string, ValorDeRegistro> = {}): boolean {
  if (actual) return actual.registrar(evento, campos);
  const valido = EVENTO.test(evento) && Object.values(campos).every(valorPermitido);
  if (valido) console.warn(`[qatlas] ${evento}`, JSON.stringify(campos));
  return valido;
}
