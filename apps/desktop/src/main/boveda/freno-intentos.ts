/**
 * Freno ante intentos fallidos de desbloqueo (RN-BOV-02). Función pura: recibe el estado y la hora,
 * y devuelve el estado nuevo.
 *
 * Frena a quien use la interfaz. No detiene un ataque sin conexión sobre una copia del archivo: de
 * eso se encarga Argon2id. Por eso alcanza con persistirlo en un archivo sin cifrar: no contiene
 * ningún dato y, si alguien lo borra, solo evita la espera, no la contraseña.
 */
export interface EstadoFreno {
  fallos: number;
  bloqueadoHastaMs: number;
}

export const FRENO_INICIAL: Readonly<EstadoFreno> = { fallos: 0, bloqueadoHastaMs: 0 };

const INTENTOS_SIN_ESPERA = 4;
const ESPERAS_SEGUNDOS = [30, 60, 300, 900, 1800] as const;
const ESPERA_MAXIMA_MS = 1800 * 1000;

/** Del 5.º fallo en adelante: 30 s, 1 min, 5 min, 15 min y 30 min. */
export function esperaPorFallos(fallos: number): number {
  if (fallos <= INTENTOS_SIN_ESPERA) return 0;
  const indice = Math.min(fallos - INTENTOS_SIN_ESPERA - 1, ESPERAS_SEGUNDOS.length - 1);
  return ESPERAS_SEGUNDOS[indice] ?? 0;
}

export function registrarFallo(estado: EstadoFreno, ahoraMs: number): EstadoFreno {
  const fallos = estado.fallos + 1;
  return { fallos, bloqueadoHastaMs: ahoraMs + esperaPorFallos(fallos) * 1000 };
}

/** Segundos restantes. Si el reloj se atrasó, el máximo evita una espera sin fin. */
export function segundosRestantes(estado: EstadoFreno, ahoraMs: number): number {
  const restante = Math.min(estado.bloqueadoHastaMs - ahoraMs, ESPERA_MAXIMA_MS);
  return restante > 0 ? Math.ceil(restante / 1000) : 0;
}

/** Un archivo ilegible o alterado cuenta como si ya hubiera 5 fallos: falla cerrado. */
export function analizarFreno(contenido: string, ahoraMs: number): EstadoFreno {
  try {
    const { fallos, bloqueadoHastaMs } = JSON.parse(contenido) as Partial<EstadoFreno>;
    if (
      Number.isSafeInteger(fallos) &&
      (fallos as number) >= 0 &&
      Number.isSafeInteger(bloqueadoHastaMs) &&
      (bloqueadoHastaMs as number) >= 0
    ) {
      return { fallos: fallos as number, bloqueadoHastaMs: bloqueadoHastaMs as number };
    }
  } catch {
    // Sigue abajo.
  }
  return { fallos: INTENTOS_SIN_ESPERA + 1, bloqueadoHastaMs: ahoraMs + 30_000 };
}
