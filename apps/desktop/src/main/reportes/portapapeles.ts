/**
 * Copiar al portapapeles (3.9, ADR 048). La interfaz no tiene permiso de portapapeles: copia por el proceso
 * principal, que antes pasa el texto por la redacción. Así un secreto nunca se copia en claro.
 *
 * Lo sensible (lo que pide la interfaz como tal, o un texto donde el detector encontró algo) se limpia a los
 * 30 segundos, **solo si el portapapeles todavía tiene ese texto**: si la persona copió otra cosa, no se toca.
 * Si no se puede leer el portapapeles, se limpia igual (falla cerrado). Sin `electron`: el portapapeles y el
 * reloj se inyectan, para probarlo con Vitest.
 */

export const LIMPIEZA_MS = 30_000;

export interface Portapapeles {
  escribir(texto: string): Promise<void>;
  /** En Electron 45, `clipboard.readText` es asíncrona. */
  leer(): Promise<string>;
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
  async copiar(texto: string, sensible: boolean): Promise<{ limpiaEnMs: number | null }> {
    await this.portapapeles.escribir(texto);
    if (this.pendiente !== null) this.reloj.cancelar(this.pendiente);
    this.pendiente = null;
    this.sensible = null;
    if (!sensible) return { limpiaEnMs: null };
    this.sensible = texto;
    this.pendiente = this.reloj.programar(() => {
      this.pendiente = null;
      this.sensible = null;
      void this.limpiarSiSigue(texto);
    }, LIMPIEZA_MS);
    return { limpiaEnMs: LIMPIEZA_MS };
  }

  /** Al bloquear o salir: lo sensible que quede se limpia ya, si sigue en el portapapeles. */
  async limpiarPendiente(): Promise<void> {
    if (this.pendiente === null) return;
    this.reloj.cancelar(this.pendiente);
    this.pendiente = null;
    const texto = this.sensible;
    this.sensible = null;
    if (texto !== null) await this.limpiarSiSigue(texto);
  }

  private async limpiarSiSigue(texto: string): Promise<void> {
    let actual: string | null;
    try {
      actual = await this.portapapeles.leer();
    } catch {
      actual = null;
    }
    if (actual === null || actual === texto) this.portapapeles.limpiar();
  }
}
