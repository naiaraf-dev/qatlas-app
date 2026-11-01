/**
 * Detecta la inactividad (especificación 3.4). No usa temporizadores ni Electron: quien lo usa le
 * informa la actividad y le pregunta periódicamente, así se prueba con una hora simulada.
 */
/** Lo que necesita de una ventana: se prueba con un emisor falso. */
export interface EmisorDeEntrada {
  on(evento: 'input-event', oyente: () => void): unknown;
}

/** La actividad la escucha el proceso principal, no la interfaz: un XSS no puede evitar el bloqueo. */
export function conectarActividad(
  emisor: EmisorDeEntrada,
  detector: DetectorInactividad,
  ahoraMs: () => number,
): void {
  emisor.on('input-event', () => {
    detector.registrarActividad(ahoraMs());
  });
}

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
