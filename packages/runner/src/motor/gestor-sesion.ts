import type { Browser, BrowserContext } from 'playwright-core';
import { decidirNombre, type PoliticaDeRed } from '../red/reglas';
import type { HallazgoDetectado } from './chequeos';
import {
  esperar,
  indicadorCumplido,
  urlSinQuery,
  type AlRegistrar,
  type NavegadorVisible,
  type Vigilancia,
} from './motor';
import {
  contextoConSesion,
  hallazgosDeSecretos,
  iniciarSesion,
  MARGEN_RENOVACION_MS,
  motivoDeSospecha,
  VIDA_MAXIMA_ESTADO_MS,
  type DatosAutenticacion,
  type EstadoSesion,
  type ProxyDeContexto,
  type ResultadoLogin,
  type SenalesDePagina,
} from './sesion';

/** Por qué se pide un login: el proceso principal lleva la cuenta (ADR 027). */
export type MotivoLogin = 'inicial' | 'planificada' | 'vencida';

export interface DatosDeLogin {
  proxy: ProxyDeContexto;
  politica: PoliticaDeRed;
  secreto: Uint8Array | null;
}

/** Lo que el crawler le pregunta a la sesión. Sin sesión, el crawler hace lo de siempre. */
export interface SesionDelRastreo {
  actual(): { contexto: BrowserContext; vigilancia: Vigilancia; generacion: number };
  /** Antes de cada página: renueva si toca. False: hay que detener el escaneo. */
  antesDePagina(): Promise<boolean>;
  /** Una sospecha, que todavía no es una sesión vencida. */
  sospechar(senales: SenalesDePagina): boolean;
  /** Confirma; si venció, vuelve a entrar. */
  confirmarYRenovar(): Promise<'activa' | 'renovada' | 'detener'>;
  /** El escaneo autenticado nunca visita la URL de login. */
  esUrlDeLogin(url: string): boolean;
  /** Lo que se estuvo fuera del escaneo, por login o pausa: no cuenta para el tiempo máximo. */
  tiempoFuera(): number;
  /** El selector del campo de contraseña del login, para la señal del formulario. */
  readonly selectorContrasena: string;
}

export interface OpcionesGestor {
  datos: DatosAutenticacion;
  politicaDelEscaneo: PoliticaDeRed;
  soloLectura: boolean;
  alRegistrar: AlRegistrar;
  timeoutMs: number;
  urlBase: string;
  abrirVisible: (proxy: ProxyDeContexto) => Promise<NavegadorVisible>;
  /**
   * Pide los datos del login al proceso principal y espera. `reintento`: el anterior falló y el proceso
   * principal decide si hay otro (después de una pausa) o no. Null: no hay login.
   */
  pedirLogin: (motivo: MotivoLogin, reintento: boolean) => Promise<DatosDeLogin | null>;
  /** El resultado de cada login, para que el proceso principal guarde el estado o pause. */
  informarSesion: (resultado: ResultadoLogin) => void;
  alHallazgo: (hallazgo: HallazgoDetectado) => void;
  ahora?: () => number;
  /** El login; los tests lo reemplazan para no depender de un navegador. */
  entrar?: typeof iniciarSesion;
}

export interface SesionPrevia {
  estado: EstadoSesion;
  urlComprobacion: string;
  /** Hace cuánto se hizo ese login. */
  edadMs: number;
}

export class GestorDeSesion implements SesionDelRastreo {
  readonly selectorContrasena: string;
  private contexto: { contexto: BrowserContext; vigilancia: Vigilancia } | null = null;
  private generacion = 0;
  private inicioSesion = 0;
  private urlComprobacion: string;
  private renovacionesSuspendidas = false;
  private fuera = 0;
  /** Los de los contextos que ya se cerraron, por un login nuevo. */
  private descartadosAnteriores = 0;
  private claveBasica = '';
  private readonly secretosReportados = new Set<string>();
  private readonly ahora: () => number;

  constructor(
    private readonly navegador: Browser,
    private readonly opciones: OpcionesGestor,
  ) {
    this.ahora = opciones.ahora ?? Date.now;
    this.urlComprobacion = opciones.urlBase;
    const paso = opciones.datos.pasos.find(
      (p) => p.accion === 'rellenar' && p.origen === 'secreto',
    );
    this.selectorContrasena = paso?.selector ?? 'input[type=password]';
  }

  /** Con una sesión guardada, se comprueba antes de usarla; si no sirve, se entra. */
  async iniciar(previa: SesionPrevia | null): Promise<boolean> {
    const vigente =
      previa !== null &&
      previa.edadMs < VIDA_MAXIMA_ESTADO_MS &&
      (this.opciones.datos.sesionMaxMs === null ||
        previa.edadMs < this.opciones.datos.sesionMaxMs - MARGEN_RENOVACION_MS);
    if (previa && vigente && this.opciones.datos.estrategia !== 'basica') {
      await this.reemplazarContexto(previa.estado);
      this.inicioSesion = this.ahora() - previa.edadMs;
      this.urlComprobacion = previa.urlComprobacion;
      if (await this.confirmar()) return true;
    }
    return (await this.renovar('inicial')) !== 'detener';
  }

  actual() {
    if (!this.contexto) throw new Error('Sin contexto');
    return { ...this.contexto, generacion: this.generacion };
  }

  websocketDescartados(): number {
    return this.descartadosAnteriores + (this.contexto?.vigilancia.websocketDescartados() ?? 0);
  }

  tiempoFuera(): number {
    return this.fuera;
  }

  esUrlDeLogin(url: string): boolean {
    // En la básica no hay pantalla de login: la URL es solo una página protegida para comprobar.
    if (this.opciones.datos.estrategia === 'basica') return false;
    try {
      return urlSinQuery(url) === urlSinQuery(this.opciones.datos.urlLogin);
    } catch {
      return false;
    }
  }

  async antesDePagina(): Promise<boolean> {
    const { sesionMaxMs } = this.opciones.datos;
    if (sesionMaxMs === null || this.renovacionesSuspendidas) return true;
    if (this.ahora() - this.inicioSesion < sesionMaxMs - MARGEN_RENOVACION_MS) return true;
    return (await this.renovar('planificada')) !== 'detener';
  }

  sospechar(senales: SenalesDePagina): boolean {
    // Con la básica, el navegador manda las credenciales en cada pedido: no hay sesión que vencer.
    if (this.opciones.datos.estrategia === 'basica') return false;
    return motivoDeSospecha(senales, this.opciones.datos) !== null;
  }

  async confirmarYRenovar(): Promise<'activa' | 'renovada' | 'detener'> {
    if (await this.confirmar()) return 'activa';
    const resultado = await this.renovar('vencida');
    return resultado === 'detener' ? 'detener' : 'renovada';
  }

  async cerrar(): Promise<void> {
    await this.contexto?.contexto.close().catch(() => undefined);
    this.contexto = null;
    this.claveBasica = '';
  }

  /**
   * Vuelve a la página donde se confirmó el login y mira el indicador. Sin indicador, no hay forma de
   * saberlo, y la sesión se da por vencida.
   */
  private async confirmar(): Promise<boolean> {
    const { indicador } = this.opciones.datos;
    if (!indicador || !this.contexto) return false;
    const pagina = await this.contexto.contexto.newPage();
    try {
      const respuesta = await pagina.goto(this.urlComprobacion, {
        timeout: this.opciones.timeoutMs,
        waitUntil: 'load',
      });
      if (!respuesta || respuesta.status() >= 400) return false;
      const final = pagina.url();
      if (this.esUrlDeLogin(final)) return false;
      if (!decidirNombre(new URL(final).hostname, this.opciones.politicaDelEscaneo).permitida) {
        return false;
      }
      // El indicador puede tardar en aparecer en una SPA.
      for (let i = 0; i < 10; i++) {
        if (await indicadorCumplido(pagina, indicador).catch(() => false)) return true;
        await esperar(100);
      }
      return false;
    } catch {
      return false;
    } finally {
      await pagina.close().catch(() => undefined);
    }
  }

  /** 'sigue': la renovación planificada no se pudo hacer, y se sigue con la sesión actual. */
  private async renovar(motivo: MotivoLogin): Promise<'ok' | 'sigue' | 'detener'> {
    const desde = this.ahora();
    try {
      for (let reintento = false; ; reintento = true) {
        const datosLogin = await this.opciones.pedirLogin(motivo, reintento);
        if (!datosLogin) {
          if (motivo === 'planificada' && this.contexto) {
            this.renovacionesSuspendidas = true;
            return 'sigue';
          }
          return 'detener';
        }
        if (this.opciones.datos.estrategia === 'basica' && datosLogin.secreto) {
          // La básica va en cada pedido: la contraseña queda en la memoria de este proceso todo el
          // escaneo, y se va con él (ADR 025).
          this.claveBasica = new TextDecoder().decode(datosLogin.secreto);
        }
        const resultado = await (this.opciones.entrar ?? iniciarSesion)(this.navegador, {
          datos: this.opciones.datos,
          proxy: datosLogin.proxy,
          politica: datosLogin.politica,
          secreto: datosLogin.secreto,
          timeoutMs: this.opciones.timeoutMs,
          alRegistrar: this.opciones.alRegistrar,
          abrirVisible: this.opciones.abrirVisible,
          politicaDelEscaneo: this.opciones.politicaDelEscaneo,
          origenBase: new URL(this.opciones.urlBase).origin,
          ahora: this.ahora,
        });
        this.opciones.informarSesion(resultado);
        if (resultado.resultado !== 'ok') continue;
        for (const hallazgo of hallazgosDeSecretos(
          resultado.secretosEnAlmacenamiento,
          urlSinQuery(this.opciones.datos.urlLogin),
        )) {
          if (this.secretosReportados.has(hallazgo.clave)) continue;
          this.secretosReportados.add(hallazgo.clave);
          this.opciones.alHallazgo(hallazgo);
        }
        await this.reemplazarContexto(resultado.estado);
        this.inicioSesion = this.ahora();
        this.urlComprobacion = resultado.urlComprobacion;
        this.renovacionesSuspendidas = false;
        return 'ok';
      }
    } finally {
      this.fuera += this.ahora() - desde;
    }
  }

  private async reemplazarContexto(estado: EstadoSesion): Promise<void> {
    const anterior = this.contexto;
    this.descartadosAnteriores += anterior?.vigilancia.websocketDescartados() ?? 0;
    const basica =
      this.opciones.datos.estrategia === 'basica'
        ? {
            usuario: this.opciones.datos.usuario,
            clave: this.claveBasica,
            origen: new URL(this.opciones.urlBase).origin,
            permitirHttp: this.opciones.datos.permitirLoginHttp,
          }
        : undefined;
    this.contexto = await contextoConSesion(
      this.navegador,
      estado,
      this.opciones.politicaDelEscaneo,
      {
        soloLectura: this.opciones.soloLectura,
        alRegistrar: this.opciones.alRegistrar,
        basica,
      },
    );
    this.generacion += 1;
    await anterior?.contexto.close().catch(() => undefined);
  }
}
