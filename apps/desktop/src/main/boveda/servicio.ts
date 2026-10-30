import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  abrirBoveda,
  borrar,
  contrasenaABuffer,
  crearBoveda,
  derivarClaveSqlcipher,
  ErrorCripto,
} from '@qatlas/crypto';
import {
  abrirBaseCifrada,
  analizarSellada,
  crearCopia,
  ErrorBoveda,
  escribirAtomico,
  estadoArchivos,
  guardarConfiguracion,
  inicializarDatos,
  instalarPar,
  leerConfiguracion,
  leerCopia,
  leerLapidas,
  leerSellada,
  migrar,
  purgarConLapida,
  recuperarInstalacion,
  registrarLapidas,
  rutasBoveda,
  serializarSellada,
  verificarArchivoCifrado,
  verificarIntegridad,
  type BaseCifrada,
  type Configuracion,
  type Lapida,
  type RutasBoveda,
} from '@qatlas/db';
import { evaluarContrasena, type MotivoRechazo } from '@qatlas/shared/contrasena';
import {
  analizarFreno,
  FRENO_INICIAL,
  registrarFallo,
  segundosRestantes,
  type EstadoFreno,
} from './freno-intentos';

export type EstadoBoveda = 'sin-boveda' | 'bloqueada' | 'desbloqueada' | 'danada';

export type ResultadoCreacion =
  { resultado: 'creada' } | { resultado: 'rechazada'; motivo: MotivoRechazo | 'ya-existe' };

export type ResultadoDesbloqueo =
  { resultado: 'desbloqueada' } | { resultado: 'rechazada'; esperaSegundos: number };

export type ResultadoRestauracion = { resultado: 'restaurada' } | { resultado: 'rechazada' };

export interface OpcionesServicio {
  carpeta: string;
  /** Se ejecuta después de cada bloqueo, con las claves ya borradas. */
  alBloquear?: () => void;
  /** Se ejecuta después de abrir la base, con su configuración. */
  alDesbloquear?: (configuracion: Configuracion) => void;
  ahora?: () => number;
  /** Solo para tests: tablas de proyecto a purgar. */
  tablasDeProyecto?: readonly string[];
}

const NOMBRE_FRENO = 'intentos.json';

/** Lanzado por las operaciones que necesitan la bóveda abierta. */
export class BovedaBloqueada extends Error {
  constructor() {
    super('La bóveda está bloqueada.');
    this.name = 'BovedaBloqueada';
  }
}

/**
 * Ciclo de vida de la bóveda. Sin Electron: se prueba con Vitest (TS-02, TS-09).
 *
 * - La clave maestra y la conexión viven solo acá, en el proceso principal.
 * - La contraseña entra como string porque llega por IPC: se convierte enseguida y se borra.
 * - Las operaciones largas se ejecutan de a una. Si se bloquea durante una de ellas, al terminar no
 *   queda nada abierto: `generacion` lo detecta.
 */
export class ServicioBoveda {
  private readonly rutas: RutasBoveda;
  private readonly rutaFreno: string;
  private readonly ahora: () => number;
  private base: BaseCifrada | null = null;
  private maestra: Buffer | null = null;
  private generacion = 0;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private readonly opciones: OpcionesServicio) {
    this.rutas = rutasBoveda(opciones.carpeta);
    this.rutaFreno = path.join(opciones.carpeta, NOMBRE_FRENO);
    this.ahora = opciones.ahora ?? Date.now;
    mkdirSync(opciones.carpeta, { recursive: true, mode: 0o700 });
    recuperarInstalacion(opciones.carpeta);
  }

  estado(): EstadoBoveda {
    if (this.base) return 'desbloqueada';
    const archivos = estadoArchivos(this.rutas);
    if (archivos !== 'existe') return archivos;
    try {
      leerSellada(this.rutas.sellada);
      return 'bloqueada';
    } catch {
      return 'danada';
    }
  }

  esperaSegundos(): number {
    return segundosRestantes(this.leerFreno(), this.ahora());
  }

  private enCola<T>(operacion: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(operacion, operacion);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  private leerFreno(): EstadoFreno {
    if (!existsSync(this.rutaFreno)) return FRENO_INICIAL;
    return analizarFreno(readFileSync(this.rutaFreno, 'utf8'), this.ahora());
  }

  private guardarFreno(estado: EstadoFreno): void {
    escribirAtomico(this.rutaFreno, Buffer.from(JSON.stringify(estado), 'utf8'));
  }

  /** Abre la base y deja las claves en memoria. La clave de SQLCipher no se conserva. */
  private activar(maestra: Buffer): void {
    const clave = derivarClaveSqlcipher(maestra);
    let base: BaseCifrada;
    try {
      base = abrirBaseCifrada(this.rutas.base, clave);
    } finally {
      borrar(clave);
    }
    try {
      migrar(base);
      verificarIntegridad(base);
      this.opciones.alDesbloquear?.(leerConfiguracion(base));
    } catch (error) {
      base.close();
      throw error;
    }
    this.base = base;
    this.maestra = maestra;
  }

  crear(contrasena: string, actualizacionesActivas: boolean): Promise<ResultadoCreacion> {
    return this.enCola(async () => {
      if (estadoArchivos(this.rutas) !== 'sin-boveda') {
        return { resultado: 'rechazada', motivo: 'ya-existe' };
      }
      const evaluacion = evaluarContrasena(contrasena);
      if (!evaluacion.aceptable) {
        return { resultado: 'rechazada', motivo: evaluacion.motivo ?? 'debil' };
      }

      const bytes = contrasenaABuffer(contrasena);
      const generacion = this.generacion;
      let nueva;
      try {
        nueva = await crearBoveda(bytes);
      } finally {
        borrar(bytes);
      }

      const clave = derivarClaveSqlcipher(nueva.maestra);
      try {
        const base = abrirBaseCifrada(this.rutas.baseNueva, clave);
        try {
          migrar(base);
          inicializarDatos(base, actualizacionesActivas);
        } finally {
          base.close();
        }
        verificarArchivoCifrado(this.rutas.baseNueva);
        instalarPar(this.rutas, serializarSellada(nueva.sellada));
      } catch (error) {
        borrar(nueva.maestra);
        rmSync(this.rutas.baseNueva, { force: true });
        throw error;
      } finally {
        borrar(clave);
      }

      // Si se pidió bloquear mientras tanto, la bóveda queda creada y bloqueada.
      if (generacion !== this.generacion) {
        borrar(nueva.maestra);
        return { resultado: 'creada' };
      }
      this.activarOBorrar(nueva.maestra);
      return { resultado: 'creada' };
    });
  }

  private activarOBorrar(maestra: Buffer): void {
    try {
      this.activar(maestra);
    } catch (error) {
      borrar(maestra);
      throw error;
    }
  }

  desbloquear(contrasena: string): Promise<ResultadoDesbloqueo> {
    return this.enCola(async () => {
      if (this.base) return { resultado: 'desbloqueada' };

      const espera = this.esperaSegundos();
      if (espera > 0) return { resultado: 'rechazada', esperaSegundos: espera };

      const bytes = contrasenaABuffer(contrasena);
      const generacion = this.generacion;
      let maestra: Buffer | null = null;
      try {
        maestra = await abrirBoveda(bytes, leerSellada(this.rutas.sellada));
        if (generacion !== this.generacion) {
          // Se bloqueó mientras tanto: este desbloqueo ya no vale.
          borrar(maestra);
          return { resultado: 'rechazada', esperaSegundos: 0 };
        }
        this.activar(maestra);
      } catch {
        // Mismo resultado para contraseña incorrecta y archivo alterado: sin detalles internos.
        borrar(maestra);
        const freno = registrarFallo(this.leerFreno(), this.ahora());
        this.guardarFreno(freno);
        return { resultado: 'rechazada', esperaSegundos: segundosRestantes(freno, this.ahora()) };
      } finally {
        borrar(bytes);
      }
      rmSync(this.rutaFreno, { force: true });
      return { resultado: 'desbloqueada' };
    });
  }

  /** Síncrono a propósito: al suspender o cerrar la app puede no haber otra vuelta del bucle. */
  bloquear(): void {
    this.generacion += 1;
    const estabaAbierta = this.base !== null;
    try {
      this.base?.close();
    } finally {
      this.base = null;
      borrar(this.maestra);
      this.maestra = null;
    }
    if (estabaAbierta) this.opciones.alBloquear?.();
  }

  private baseAbierta(): BaseCifrada {
    if (!this.base) throw new BovedaBloqueada();
    return this.base;
  }

  configuracion(): Configuracion {
    return leerConfiguracion(this.baseAbierta());
  }

  cambiarConfiguracion(cambios: Partial<Configuracion>): Configuracion {
    const base = this.baseAbierta();
    guardarConfiguracion(base, cambios);
    return leerConfiguracion(base);
  }

  /** Con la base abierta: no hace falta bloquear la bóveda (ADR 010). */
  crearCopia(destino: string): void {
    crearCopia(
      this.baseAbierta(),
      readFileSync(this.rutas.sellada),
      this.opciones.carpeta,
      destino,
    );
  }

  registrarLapidas(lapidas: readonly Lapida[]): void {
    registrarLapidas(this.baseAbierta(), lapidas);
  }

  lapidas(): Lapida[] {
    return leerLapidas(this.baseAbierta());
  }

  /**
   * Restaura una copia. Con la contraseña de la copia, no la actual.
   *
   * Sobre una bóveda existente hay que tenerla desbloqueada: sus lápidas están cifradas y primero se
   * combinan con las de la copia, y recién después se purga (ADR 009). Si la bóveda está dañada no
   * hay lápidas que leer, y quien llama debe advertirlo. Con la bóveda bloqueada se rechaza.
   * Cualquier fallo antes de instalar deja la bóveda actual como estaba.
   */
  restaurar(origen: string, contrasena: string): Promise<ResultadoRestauracion> {
    return this.enCola(async () => {
      const estado = this.estado();
      if (estado === 'bloqueada') throw new BovedaBloqueada();

      const bytes = contrasenaABuffer(contrasena);
      let maestra: Buffer | null = null;
      try {
        const contenido = leerCopia(origen);
        const sellada = analizarSellada(contenido.sellada);
        maestra = await abrirBoveda(bytes, sellada);
        const lapidasActuales = this.base ? leerLapidas(this.base) : [];

        escribirAtomico(this.rutas.baseNueva, contenido.base);
        this.prepararBaseRestaurada(maestra, lapidasActuales);

        this.bloquearSinAviso();
        instalarPar(this.rutas, contenido.sellada);
        this.activar(maestra);
        rmSync(this.rutaFreno, { force: true });
        return { resultado: 'restaurada' };
      } catch (error) {
        borrar(maestra);
        rmSync(this.rutas.baseNueva, { force: true });
        if (!(error instanceof ErrorBoveda) && !(error instanceof ErrorCripto)) throw error;
        return { resultado: 'rechazada' };
      } finally {
        borrar(bytes);
      }
    });
  }

  private prepararBaseRestaurada(maestra: Buffer, lapidasActuales: readonly Lapida[]): void {
    const clave = derivarClaveSqlcipher(maestra);
    try {
      const base = abrirBaseCifrada(this.rutas.baseNueva, clave);
      try {
        verificarIntegridad(base);
        migrar(base);
        // Orden importante: primero combinar, después purgar.
        registrarLapidas(base, lapidasActuales);
        purgarConLapida(base, this.opciones.tablasDeProyecto);
      } finally {
        base.close();
      }
      verificarArchivoCifrado(this.rutas.baseNueva);
    } finally {
      borrar(clave);
    }
  }

  private bloquearSinAviso(): void {
    this.generacion += 1;
    this.base?.close();
    this.base = null;
    if (this.maestra) borrar(this.maestra);
    this.maestra = null;
  }
}
