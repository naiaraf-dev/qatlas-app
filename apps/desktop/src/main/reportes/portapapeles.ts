/**
 * Copiar al portapapeles (3.9, ADR 048). La interfaz no tiene permiso de portapapeles: copia por el proceso
 * principal, que antes pasa el texto por la redacción. Así un secreto nunca se copia en claro.
 *
 * Lo sensible (lo que pide la interfaz como tal, o un texto donde el detector encontró algo) se limpia a los
 * 30 segundos, **solo si el portapapeles todavía tiene ese texto**: si la persona copió otra cosa, no se toca.
 * Sin `electron`: el portapapeles y el reloj se inyectan, para probarlo con Vitest.
 */

export const LIMPIEZA_MS = 30_000;

export interface Portapapeles {
  escribir(texto: string): void;
  leer(): string;
  limpiar(): void;
}

export interface Reloj {
  programar(accion: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
}

const RELOJ_REAL: Reloj = {
  programar: (accion, ms) => setTimeout(accion, ms),
  cancelar: (id) => {
    clearTimeout(id as ReturnType<typeof setTimeout>);
  },
};

export class CopiaSegura {
  private pendiente: unknown = null;
  private sensible: string | null = null;

  constructor(
    private readonly portapapeles: Portapapeles,
    private readonly reloj: Reloj = RELOJ_REAL,
  ) {}

  /** Copia el texto ya redactado. Si es sensible, programa su limpieza. */
  copiar(texto: string, sensible: boolean): { limpiaEnMs: number | null } {
    this.portapapeles.escribir(texto);
    if (this.pendiente !== null) this.reloj.cancelar(this.pendiente);
    this.pendiente = null;
    this.sensible = null;
    if (!sensible) return { limpiaEnMs: null };
    this.sensible = texto;
    this.pendiente = this.reloj.programar(() => {
      this.pendiente = null;
      this.sensible = null;
      if (this.portapapeles.leer() === texto) this.portapapeles.limpiar();
    }, LIMPIEZA_MS);
    return { limpiaEnMs: LIMPIEZA_MS };
  }

  /** Al bloquear o salir: lo sensible que quede se limpia ya, si sigue en el portapapeles. */
  limpiarPendiente(): void {
    if (this.pendiente === null) return;
    this.reloj.cancelar(this.pendiente);
    this.pendiente = null;
    if (this.sensible !== null && this.portapapeles.leer() === this.sensible)
      this.portapapeles.limpiar();
    this.sensible = null;
  }
}
