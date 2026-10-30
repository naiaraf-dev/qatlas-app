/**
 * Detecta la inactividad (especificación 3.4). No usa temporizadores ni Electron: quien lo usa le
 * informa la actividad y le pregunta periódicamente, así se prueba con una hora simulada.
 */
export class DetectorInactividad {
  private ultimaActividadMs: number;

  constructor(
    private limiteMs: number,
    ahoraMs: number,
  ) {
    this.ultimaActividadMs = ahoraMs;
  }

  registrarActividad(ahoraMs: number): void {
    this.ultimaActividadMs = ahoraMs;
  }

  cambiarLimite(limiteMs: number): void {
    this.limiteMs = limiteMs;
  }

  venció(ahoraMs: number): boolean {
    return ahoraMs - this.ultimaActividadMs >= this.limiteMs;
  }
}
