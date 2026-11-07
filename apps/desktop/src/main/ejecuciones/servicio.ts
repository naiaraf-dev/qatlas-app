import { randomBytes, randomUUID } from 'node:crypto';
import { sinQuery } from '@qatlas/runner';
import {
  actualizarEjecucion,
  agregarConexiones,
  agregarHallazgo,
  agregarPaginaVisitada,
  leerHallazgosDeEjecucion,
  leerPaginasVisitadas,
  insertarEjecucion,
  leerConexionesDeEjecucion,
  leerEjecucion,
  leerEjecuciones,
  leerEjecucionesActivas,
  leerIntentosLogin,
  registrarIntentoLogin,
  leerUltimasConexiones,
  type BaseCifrada,
  type FilaEjecucion,
} from '@qatlas/db';
import {
  credencialUsable,
  estrategiaDisponible,
  LIMITE_PRUEBAS_LOGIN,
  LIMITES_SESION,
  type ConnectionEntry,
  type CredencialResumen,
  type EjecucionResumen,
  type HallazgoVista,
  type IpcResponse,
  type MotivoFinEjecucion,
  type ProgresoEjecucion,
  type ResumenEjecucion,
} from '@qatlas/shared';
import {
  EstadoSesion,
  type Autenticacion,
  type Configuracion,
  type MensajeAlRunner,
  type MensajeDelRunner,
} from '@qatlas/runner';
import { z } from 'zod';
import type { ServicioBoveda } from '../boveda/servicio';
import {
  AutorizacionNoVigente,
  type DatosDeEjecucion,
  type ServicioProyectos,
} from '../proyectos/servicio';

/** Lo que el servicio necesita de un proceso del sistema. Se reemplaza en los tests. */
export interface ProcesoProxy {
  puerto: number;
  alCaer: (oyente: () => void) => void;
  detener: () => void;
}

export interface ProcesoRunner {
  enviar: (mensaje: MensajeAlRunner) => void;
  alMensaje: (oyente: (mensaje: MensajeDelRunner) => void) => void;
  alSalir: (oyente: () => void) => void;
  detener: () => void;
}

export interface LanzadorDeProcesos {
  iniciarProxy: (
    datos: { politica: Configuracion['politica']; credencial: { usuario: string; clave: string } },
    alRegistrar: (registro: { destino: string; permitida: boolean; regla: string }) => void,
  ) => Promise<ProcesoProxy>;
  iniciarRunner: (ejecucionId: string) => ProcesoRunner;
  /** Borra el perfil efímero de la ejecución. Se llama recién cuando el runner salió. */
  limpiarPerfil: (ejecucionId: string) => Promise<void> | void;
}

const NAVEGADOR = 'chromium';
const MAX_CONEXIONES_GUARDADAS = 2000;
/**
 * Cuánto se espera a que el runner salga solo: cierra su navegador (y la ventana del asistido) y
 * espera a que terminen. Pasado esto, se lo corta.
 */
const TIEMPO_DE_SALIDA_MS = 10_000;

const RESUMEN_VACIO: ResumenEjecucion = {
  paginasVisitadas: 0,
  linksExcluidos: 0,
  conexionesPermitidas: 0,
  conexionesBloqueadas: 0,
  motivo: null,
  hallazgos: 0,
  detenido: null,
  noRecorridosSoloLectura: 0,
  noRecorridosExclusiones: 0,
  urlsDescartadas: 0,
  websocketDescartados: 0,
  logins: 0,
  loginsInesperados: 0,
  renovaciones: 0,
};

/** Una sesión guardada nunca dura más que esto en memoria, diga lo que diga el sitio (ADR 026). */
const VIDA_MAXIMA_SESION_MS = 12 * 60 * 60_000;
const PAUSA_MAXIMA_MS = LIMITES_SESION.pausaMinutos * 60_000;

type Politica = Configuracion['politica'];
type MotivoLogin = Extract<MensajeDelRunner, { tipo: 'necesita-login' }>['motivo'];
type ResultadoPrueba = Extract<MensajeDelRunner, { tipo: 'login-terminado' }>['resultado'];

const SesionGuardada = z
  .object({ estado: EstadoSesion, urlComprobacion: z.string().max(2048) })
  .strict();

/** Lo que ata un dato cifrado a su fila (ADR 021). */
export const contextoDetalle = (proyectoId: string, ocurrenciaId: string): string =>
  `hallazgo/${proyectoId}/${ocurrenciaId}/detalle`;
export const contextoUrlPagina = (proyectoId: string, ejecucionId: string): string =>
  `pagina/${proyectoId}/${ejecucionId}/url`;
export const contextoSesion = (proyectoId: string, credencialId: string): string =>
  `sesion/${proyectoId}/${credencialId}`;

/** Lo que el runner necesita para entrar, sin el secreto. */
function aAutenticacion(credencial: CredencialResumen, datos: DatosDeEjecucion): Autenticacion {
  return {
    estrategia: credencial.estrategia,
    urlLogin: credencial.urlLogin,
    pasos: credencial.pasosLogin,
    indicador: credencial.indicadorExito,
    usuario: credencial.usuario,
    dominiosAutenticacion: datos.dominiosAutenticacion,
    sesionMaxMs: datos.sesionMaxMinutos === null ? null : datos.sesionMaxMinutos * 60_000,
    permitirLoginHttp: datos.permitirLoginHttp,
  };
}

interface EnCurso {
  id: string;
  proyectoId: string;
  credencialId: string | null;
  autenticacion: Autenticacion | null;
  /** El alcance más los dominios de autenticación: solo para el proxy de login. */
  politicaLogin: Politica | null;
  proxy?: ProcesoProxy;
  /** Vive solo mientras dura un login. */
  proxyLogin?: ProcesoProxy | undefined;
  /** Por qué no se pudo volver a entrar, para el resumen. */
  motivoSesion: MotivoFinEjecucion | null;
  ultimoFallo: 'fallo' | 'ventana-cerrada' | 'tiempo-agotado' | 'ventana-no-disponible' | null;
  pausa: { motivo: MotivoLogin; temporizador: ReturnType<typeof setTimeout> } | null;
  espera: ProgresoEjecucion['espera'];
  runner?: ProcesoRunner;
  resumen: ResumenEjecucion;
  pendientes: {
    destino: string;
    permitida: boolean;
    regla: string;
    proceso: Proceso;
    fecha: string;
  }[];
  guardadas: number;
  terminada: boolean;
  paginaActual: string | null;
  /** Lo que espera `probarLogin`. */
  alTerminar?: (resultado: ResultadoPrueba | null) => void;
  /** El resultado de una prueba de login: se entrega recién cuando la prueba quedó terminada y limpia. */
  resultadoPrueba?: ResultadoPrueba;
}

type Proceso = 'proxy' | 'navegador' | 'runner';

function aResumen(fila: FilaEjecucion): EjecucionResumen {
  return {
    id: fila.id,
    tipo: fila.tipo,
    estado: fila.estado,
    inicio: fila.inicio,
    fin: fila.fin,
    // Las de semanas anteriores no tienen los campos nuevos.
    resumen: { ...RESUMEN_VACIO, ...(fila.resumen as Partial<ResumenEjecucion>) },
    rol: fila.rol,
  };
}

/**
 * Ciclo de vida de las ejecuciones (especificación 4.4, RN-EJE-01 y 02). Sin Electron: los procesos
 * se inyectan. Una sola ejecución a la vez en todo el equipo; las de otros proyectos esperan en la
 * cola, que vive en la base. Lo que falta o falla cierra: sin proxy, el runner no se lanza.
 */
export class ServicioEjecuciones {
  private actual: EnCurso | null = null;
  /**
   * Las sesiones de los logins, por proyecto y credencial: cifradas con la clave del proyecto y solo
   * en memoria. Se descartan al bloquear, al cambiar la credencial o el alcance, y a las 12 horas.
   */
  private readonly sesiones = new Map<string, { sellado: Buffer; creada: number }>();

  constructor(
    private readonly boveda: ServicioBoveda,
    private readonly proyectos: ServicioProyectos,
    private readonly lanzador: LanzadorDeProcesos,
    private readonly ahora: () => number = Date.now,
    private readonly alProgreso: (progreso: ProgresoEjecucion) => void = () => undefined,
  ) {}

  /** Lo que quedó sin terminar no se relanza solo: no sale tráfico sin una acción del usuario. */
  recuperar(base: BaseCifrada): void {
    const ahora = new Date().toISOString();
    for (const fila of leerEjecucionesActivas(base)) {
      actualizarEjecucion(base, fila.id, {
        estado: 'fallida',
        fin: ahora,
        resumen: { ...(fila.resumen as ResumenEjecucion), motivo: 'interrumpida' },
      });
    }
  }

  lanzarEscaneo(
    proyectoId: string,
    credencialId: string | null = null,
  ): IpcResponse<'ejecuciones:lanzarEscaneo'> {
    if (!this.proyectos.estadoAutorizacion(proyectoId).vigente) {
      return { resultado: 'rechazada', motivo: 'sin-autorizacion' };
    }
    let rol: string | null = null;
    if (credencialId) {
      const credencial = this.proyectos.datosDeLogin(proyectoId, credencialId);
      if (credencial && !estrategiaDisponible(credencial.estrategia)) {
        return { resultado: 'rechazada', motivo: 'estrategia-no-disponible' };
      }
      if (!credencial || !credencialUsable(credencial)) {
        return { resultado: 'rechazada', motivo: 'credencial-no-usable' };
      }
      rol = credencial.rol;
    }
    const id = this.encolar(proyectoId, 'escaneo', credencialId, rol);
    if (!id) return { resultado: 'rechazada', motivo: 'ya-en-curso' };
    this.avanzarCola();
    return { resultado: 'encolada', ejecucionId: id };
  }

  /** RN-EJE-01: la verificación y el alta van juntas, sin un `await` en el medio. */
  private encolar(
    proyectoId: string,
    tipo: FilaEjecucion['tipo'],
    credencialId: string | null = null,
    rol: string | null = null,
  ): string | null {
    return this.boveda.conAcceso((base) => {
      if (leerEjecucionesActivas(base).some((f) => f.objetivoId === proyectoId)) return null;
      const id = randomUUID();
      insertarEjecucion(base, {
        id,
        proyectoId,
        tipo,
        objetivoId: proyectoId,
        navegador: NAVEGADOR,
        estado: 'encolada',
        resumen: RESUMEN_VACIO,
        credencialId,
        rol,
      });
      return id;
    });
  }

  /** Una ejecución pausada vuelve a entrar: la ventana del login asistido, o el enlace nuevo. */
  reanudar(ejecucionId: string): IpcResponse<'ejecuciones:reanudar'> {
    const enCurso = this.actual;
    if (enCurso?.id !== ejecucionId || !enCurso.pausa) return { resultado: 'no-pausada' };
    clearTimeout(enCurso.pausa.temporizador);
    const { motivo } = enCurso.pausa;
    const espera = enCurso.espera;
    enCurso.pausa = null;
    this.marcarEstado(enCurso, 'en-curso');
    void this.hacerLogin(enCurso, motivo, espera === 'enlace-vencido' ? null : 'login-asistido');
    return { resultado: 'reanudada' };
  }

  /** Un cambio de credencial o de alcance: la sesión guardada deja de valer (ADR 026). */
  descartarSesiones(proyectoId: string): void {
    for (const clave of [...this.sesiones.keys()]) {
      if (clave.startsWith(`${proyectoId}/`)) this.sesiones.delete(clave);
    }
  }

  listar(proyectoId: string): EjecucionResumen[] {
    return this.boveda.conAcceso((base) => leerEjecuciones(base, proyectoId).map(aResumen));
  }

  detalle(ejecucionId: string): IpcResponse<'ejecuciones:detalle'> {
    this.volcarConexiones();
    return this.boveda.conAcceso((base) => {
      const fila = leerEjecucion(base, ejecucionId);
      if (!fila) return null;
      const hallazgos = leerHallazgosDeEjecucion(base, ejecucionId);
      const detalles = this.proyectos.descifrarDatos(
        fila.proyectoId,
        hallazgos.flatMap((h) =>
          h.detalleCifrado
            ? [
                {
                  contexto: contextoDetalle(fila.proyectoId, h.ocurrenciaId),
                  sellado: h.detalleCifrado,
                },
              ]
            : [],
        ),
      );
      let siguienteDetalle = 0;
      return {
        ejecucion: aResumen(fila),
        hallazgos: hallazgos.map((h) => ({
          id: h.id,
          tipo: h.tipo as HallazgoVista['tipo'],
          severidad: h.severidad as HallazgoVista['severidad'],
          titulo: h.titulo,
          url: h.url,
          urlOrigen: h.urlOrigen,
          detalle: h.detalleCifrado ? (detalles[siguienteDetalle++] ?? '').slice(0, 2000) : '',
        })),
        paginas: leerPaginasVisitadas(base, ejecucionId).map((p) => ({
          url: p.url,
          status: p.statusHttp,
          tiempoCargaMs: p.tiempoCargaMs,
          profundidad: p.profundidad,
        })),
        conexiones: leerConexionesDeEjecucion(base, ejecucionId).map(
          ({ fecha, proceso, destino, permitida, regla }) => ({
            fecha,
            proceso,
            destino,
            permitida,
            regla,
          }),
        ),
      };
    });
  }

  /** Para el monitor: las conexiones de las ejecuciones, en el formato de la pantalla. */
  conexionesRecientes(limite: number): Omit<ConnectionEntry, 'id'>[] {
    this.volcarConexiones();
    return this.boveda.conAcceso((base) =>
      leerUltimasConexiones(base, limite).map((c) => ({
        timestamp: c.fecha,
        origin: c.proceso,
        destination: c.destino,
        allowed: c.permitida,
        rule: c.regla,
      })),
    );
  }

  cancelar(ejecucionId: string): IpcResponse<'ejecuciones:cancelar'> {
    if (this.actual?.id === ejecucionId) {
      this.finalizar(this.actual, 'cancelada', 'usuario');
      return { resultado: 'cancelada' };
    }
    return this.boveda.conAcceso((base) => {
      const fila = leerEjecucion(base, ejecucionId);
      if (fila?.estado !== 'encolada') return { resultado: 'ya-terminada' };
      actualizarEjecucion(base, fila.id, {
        estado: 'cancelada',
        fin: new Date().toISOString(),
        resumen: { ...RESUMEN_VACIO, motivo: 'usuario' },
      });
      return { resultado: 'cancelada' };
    });
  }

  /** Eliminar el proyecto o cambiarle el alcance corta lo que esté corriendo con el alcance viejo. */
  cortarDeProyecto(proyectoId: string): void {
    if (this.actual?.proyectoId === proyectoId) {
      this.finalizar(this.actual, 'cancelada', 'autorizacion-no-vigente');
    }
  }

  /**
   * Antes de cerrar la base. Síncrono, como el bloqueo. Corta lo que esté en curso, guarda lo que se
   * llegó a registrar y deja cancelada la cola: nada se relanza al desbloquear.
   */
  alBloquearse(base: BaseCifrada): void {
    this.sesiones.clear();
    if (this.actual) this.finalizar(this.actual, 'cancelada', 'bloqueo', base);
    const ahora = new Date().toISOString();
    for (const fila of leerEjecucionesActivas(base)) {
      actualizarEjecucion(base, fila.id, {
        estado: 'cancelada',
        fin: ahora,
        resumen: { ...RESUMEN_VACIO, motivo: 'bloqueo' },
      });
    }
  }

  async probarLogin(
    proyectoId: string,
    credencialId: string,
  ): Promise<IpcResponse<'credenciales:probarLogin'>> {
    const credencial = this.proyectos.datosDeLogin(proyectoId, credencialId);
    if (!credencial) return { resultado: 'fallo', motivo: 'no-se-pudo-ejecutar' };
    if (!estrategiaDisponible(credencial.estrategia)) {
      return { resultado: 'fallo', motivo: 'estrategia-no-disponible' };
    }
    if (credencial.requiereRevision) return { resultado: 'fallo', motivo: 'credencial-a-revisar' };
    if (!credencialUsable(credencial)) {
      return {
        resultado: 'fallo',
        motivo: credencial.indicadorExito === null ? 'sin-indicador' : 'no-se-pudo-ejecutar',
      };
    }
    if (!this.proyectos.estadoAutorizacion(proyectoId).vigente) {
      return { resultado: 'fallo', motivo: 'sin-autorizacion' };
    }
    // El asistido lo hace una persona: el límite cuida de los intentos automáticos (ADR 027).
    const asistido = credencial.estrategia === 'asistido';
    const espera = asistido ? 0 : this.esperaDeIntentos(credencialId);
    if (espera > 0) return { resultado: 'limite', esperaSegundos: espera };
    // Una prueba es un intento real contra el sistema: no espera en la cola para salir más tarde.
    if (this.actual) return { resultado: 'fallo', motivo: 'ocupado' };
    const id = this.encolar(proyectoId, 'prueba-login', credencialId, credencial.rol);
    if (!id) return { resultado: 'fallo', motivo: 'ocupado' };

    const enCurso = this.crearEnCurso(id, proyectoId, credencialId);
    const resultado = await new Promise<ResultadoPrueba | null>((resolver) => {
      enCurso.alTerminar = resolver;
      const datos = this.proyectos.datosDeEjecucion(proyectoId);
      if (!datos) {
        this.finalizar(enCurso, 'fallida', 'autorizacion-no-vigente');
        return;
      }
      // El proxy de la prueba es el de login: alcance más dominios de autenticación.
      void this.prepararProcesos(enCurso, datos.dominiosAutenticacion).then(
        async (configuracion) => {
          if (!configuracion) return;
          const autenticacion = aAutenticacion(credencial, datos);
          enCurso.autenticacion = autenticacion;
          const politicaDelEscaneo = {
            urlBase: datos.urlBase,
            dominios: datos.dominios,
            sistemaInterno: datos.sistemaInterno,
            puertosLocales: datos.puertosLocales,
          };
          const mensaje = {
            tipo: 'probar-login' as const,
            configuracion,
            autenticacion,
            politicaDelEscaneo,
          };
          if (asistido) {
            enCurso.espera = 'login-asistido';
            this.informar(enCurso);
            enCurso.runner?.enviar({ ...mensaje, secreto: null });
            return;
          }
          try {
            await this.conSecreto(enCurso, credencialId, (copia) => {
              enCurso.runner?.enviar({ ...mensaje, secreto: copia });
            });
          } catch (error) {
            this.finalizar(
              enCurso,
              'fallida',
              error instanceof AutorizacionNoVigente ? 'autorizacion-no-vigente' : 'runner-caido',
            );
          }
        },
      );
    });
    if (resultado === null) return { resultado: 'fallo', motivo: 'no-se-pudo-ejecutar' };
    if (resultado === 'funciono') return { resultado: 'funciono' };
    return { resultado: 'fallo', motivo: resultado === 'fallo' ? 'no-confirmado' : resultado };
  }

  /**
   * Descifra el secreto y lo manda en una copia. Antes de mandarlo, el intento queda en la base: un
   * cierre abrupto no lo devuelve. Lo que falló antes, como un proxy que no arrancó, no llegó al
   * sistema y no cuenta.
   */
  private async conSecreto(
    enCurso: EnCurso,
    credencialId: string,
    mandar: (copia: Uint8Array<ArrayBuffer>) => void,
  ): Promise<void> {
    await this.proyectos.usarSecreto(enCurso.proyectoId, credencialId, (secreto) => {
      this.boveda.conAcceso((base) => {
        registrarIntentoLogin(base, {
          proyectoId: enCurso.proyectoId,
          credencialId,
          fecha: new Date(this.ahora()).toISOString(),
        });
      });
      // Una copia con su propio buffer: un Buffer puede compartir memoria con otros datos.
      // `postMessage` la clona; la de acá se borra enseguida, y `secreto`, al volver.
      const copia = new Uint8Array(secreto);
      try {
        mandar(copia);
      } finally {
        copia.fill(0);
      }
    });
  }

  /** Segundos hasta que se libere un intento. 0 si se puede probar. */
  private esperaDeIntentos(credencialId: string): number {
    const ventanaMs = LIMITE_PRUEBAS_LOGIN.ventanaMinutos * 60_000;
    const ahora = this.ahora();
    const intentos = this.boveda.conAcceso((base) =>
      leerIntentosLogin(base, credencialId, new Date(ahora - ventanaMs).toISOString()),
    );
    if (intentos.length < LIMITE_PRUEBAS_LOGIN.intentos) return 0;
    // El que se libera primero, para volver a quedar por debajo del límite.
    const clave = intentos[intentos.length - LIMITE_PRUEBAS_LOGIN.intentos] as string;
    return Math.max(1, Math.ceil((Date.parse(clave) + ventanaMs - ahora) / 1000));
  }

  private crearEnCurso(
    id: string,
    proyectoId: string,
    credencialId: string | null = null,
  ): EnCurso {
    const enCurso: EnCurso = {
      id,
      proyectoId,
      credencialId,
      autenticacion: null,
      politicaLogin: null,
      motivoSesion: null,
      ultimoFallo: null,
      pausa: null,
      espera: null,
      resumen: { ...RESUMEN_VACIO },
      pendientes: [],
      guardadas: 0,
      terminada: false,
      paginaActual: null,
    };
    this.actual = enCurso;
    this.boveda.conAcceso((base) => {
      actualizarEjecucion(base, id, { estado: 'en-curso', inicio: new Date().toISOString() });
    });
    return enCurso;
  }

  private avanzarCola(): void {
    if (this.actual) return;
    const siguiente = this.boveda.conAcceso((base) =>
      leerEjecucionesActivas(base).find((f) => f.estado === 'encolada'),
    );
    if (!siguiente) return;
    const enCurso = this.crearEnCurso(siguiente.id, siguiente.proyectoId, siguiente.credencialId);
    void this.prepararProcesos(enCurso).then((configuracion) => {
      if (!configuracion) return;
      const datos = this.proyectos.datosDeEjecucion(enCurso.proyectoId) as DatosDeEjecucion;
      let autenticacion: Autenticacion | null = null;
      let sesionPrevia: Extract<MensajeAlRunner, { tipo: 'escaneo' }>['sesionPrevia'] = null;
      if (enCurso.credencialId) {
        const credencial = this.proyectos.datosDeLogin(enCurso.proyectoId, enCurso.credencialId);
        if (!credencial || !credencialUsable(credencial)) {
          this.finalizar(enCurso, 'fallida', 'credencial-no-disponible');
          return;
        }
        autenticacion = aAutenticacion(credencial, datos);
        enCurso.autenticacion = autenticacion;
        enCurso.politicaLogin = {
          ...configuracion.politica,
          dominios: [...configuracion.politica.dominios, ...datos.dominiosAutenticacion],
        };
        sesionPrevia = this.sesionGuardada(enCurso.proyectoId, enCurso.credencialId);
      }
      enCurso.runner?.enviar({
        tipo: 'escaneo',
        configuracion,
        maxPaginas: datos.maxPaginas,
        maxProfundidad: datos.maxProfundidad,
        maxMinutos: datos.maxMinutos,
        maxRps: datos.maxRps,
        soloLectura: datos.soloLectura,
        exclusiones: datos.exclusiones,
        autenticacion,
        sesionPrevia,
      });
    });
  }

  /** La sesión de un login anterior, si sigue en memoria y no venció por edad. */
  private sesionGuardada(
    proyectoId: string,
    credencialId: string,
  ): Extract<MensajeAlRunner, { tipo: 'escaneo' }>['sesionPrevia'] {
    const clave = `${proyectoId}/${credencialId}`;
    const guardada = this.sesiones.get(clave);
    if (!guardada) return null;
    const edadMs = this.ahora() - guardada.creada;
    if (edadMs < 0 || edadMs >= VIDA_MAXIMA_SESION_MS) {
      this.sesiones.delete(clave);
      return null;
    }
    try {
      const [texto] = this.proyectos.descifrarDatos(proyectoId, [
        { contexto: contextoSesion(proyectoId, credencialId), sellado: guardada.sellado },
      ]);
      const datos = SesionGuardada.parse(JSON.parse(texto ?? ''));
      return { ...datos, edadMs };
    } catch {
      this.sesiones.delete(clave);
      return null;
    }
  }

  private guardarSesion(
    enCurso: EnCurso,
    sesion: { estado: z.infer<typeof EstadoSesion>; urlComprobacion: string },
  ): void {
    if (!enCurso.credencialId) return;
    try {
      const sellado = this.proyectos.cifrarDato(
        enCurso.proyectoId,
        contextoSesion(enCurso.proyectoId, enCurso.credencialId),
        JSON.stringify({ estado: sesion.estado, urlComprobacion: sesion.urlComprobacion }),
      );
      this.sesiones.set(`${enCurso.proyectoId}/${enCurso.credencialId}`, {
        sellado,
        creada: this.ahora(),
      });
    } catch {
      // Bóveda cerrada: no se guarda, y el próximo escaneo vuelve a entrar.
    }
  }

  /**
   * El orden es el control: autorización, proxy y recién después el runner. Si algo falla, la
   * ejecución termina acá y el navegador nunca llega a abrirse (RN-EJE-02).
   */
  private async prepararProcesos(
    enCurso: EnCurso,
    dominiosExtra: readonly string[] = [],
  ): Promise<Configuracion | null> {
    const datos = this.proyectos.datosDeEjecucion(enCurso.proyectoId);
    if (!datos || !this.proyectos.estadoAutorizacion(enCurso.proyectoId).vigente) {
      this.finalizar(enCurso, 'fallida', 'autorizacion-no-vigente');
      return null;
    }
    const politica = {
      urlBase: datos.urlBase,
      dominios: [...datos.dominios, ...dominiosExtra],
      sistemaInterno: datos.sistemaInterno,
      puertosLocales: datos.puertosLocales,
    };
    const credencial = {
      usuario: randomBytes(16).toString('hex'),
      clave: randomBytes(32).toString('hex'),
    };

    let proxy: ProcesoProxy;
    try {
      proxy = await this.lanzador.iniciarProxy({ politica, credencial }, (registro) => {
        this.anotar(enCurso, 'proxy', registro);
      });
    } catch {
      this.finalizar(enCurso, 'fallida', 'proxy-no-inicio');
      return null;
    }
    // Se pudo bloquear o cancelar mientras arrancaba.
    if (enCurso.terminada) {
      proxy.detener();
      return null;
    }
    enCurso.proxy = proxy;
    proxy.alCaer(() => {
      this.finalizar(enCurso, 'fallida', 'proxy-caido');
    });
    // Pudo caerse antes de que se lo escuchara: entonces el runner no se lanza. El análisis de tipos no
    // sabe que `alCaer` puede cambiar este valor.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (enCurso.terminada) return null;

    const runner = this.lanzador.iniciarRunner(enCurso.id);
    enCurso.runner = runner;
    runner.alMensaje((mensaje) => {
      this.alMensajeDelRunner(enCurso, mensaje);
    });
    runner.alSalir(() => {
      this.finalizar(enCurso, 'fallida', 'runner-caido');
    });
    return {
      politica,
      proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...credencial },
      timeoutPaginaMs: datos.timeoutPaginaSegundos * 1000,
    };
  }

  private alMensajeDelRunner(enCurso: EnCurso, mensaje: MensajeDelRunner): void {
    switch (mensaje.tipo) {
      case 'conexion':
        this.anotar(enCurso, mensaje.proceso, mensaje);
        return;
      case 'pagina':
        this.guardarPagina(enCurso, mensaje);
        return;
      case 'hallazgo':
        this.guardarHallazgo(enCurso, mensaje.hallazgo);
        return;
      case 'necesita-login':
        this.alNecesitarLogin(enCurso, mensaje.motivo, mensaje.reintento);
        return;
      case 'sesion':
        enCurso.proxyLogin?.detener();
        enCurso.proxyLogin = undefined;
        enCurso.espera = null;
        if (mensaje.resultado === 'ok') {
          enCurso.ultimoFallo = null;
          this.guardarSesion(enCurso, mensaje);
        } else {
          enCurso.ultimoFallo = mensaje.resultado;
        }
        this.informar(enCurso);
        return;
      case 'escaneo-terminado': {
        Object.assign(enCurso.resumen, {
          paginasVisitadas: mensaje.paginasVisitadas,
          linksExcluidos: mensaje.linksExcluidos,
          detenido: mensaje.detenido,
          noRecorridosSoloLectura: mensaje.noRecorridosSoloLectura,
          noRecorridosExclusiones: mensaje.noRecorridosExclusiones,
          urlsDescartadas: mensaje.urlsDescartadas,
          websocketDescartados: mensaje.websocketDescartados,
        });
        if (mensaje.detenido === 'sesion') {
          // Lo recorrido queda; si no se llegó a entrar, la ejecución falló.
          this.finalizar(
            enCurso,
            mensaje.paginasVisitadas > 0 ? 'finalizada' : 'fallida',
            enCurso.motivoSesion ?? 'login-fallido',
          );
          return;
        }
        this.finalizar(enCurso, 'finalizada', null);
        return;
      }
      case 'login-terminado':
        enCurso.resultadoPrueba = mensaje.resultado;
        this.finalizar(enCurso, 'finalizada', null);
        return;
      case 'ventana-no-disponible':
        // Como el navegador del escaneo: la causa y las líneas de Chromium sin rutas, nada de la ejecución.
        console.warn(
          `[ejecucion] ventana del navegador no disponible: ${mensaje.causa} ${mensaje.detalle}`,
        );
        enCurso.proxyLogin?.detener();
        enCurso.proxyLogin = undefined;
        enCurso.espera = null;
        enCurso.ultimoFallo = 'ventana-no-disponible';
        enCurso.motivoSesion = 'ventana-no-disponible';
        this.informar(enCurso);
        return;
      case 'navegador-no-disponible':
        // Sin datos de la ejecución: solo la causa, y las líneas de error de Chromium sin rutas.
        console.warn(`[ejecucion] navegador no disponible: ${mensaje.causa} ${mensaje.detalle}`);
        this.finalizar(enCurso, 'fallida', 'navegador-no-disponible');
        return;
      case 'rechazado':
        this.finalizar(enCurso, 'fallida', 'runner-caido');
    }
  }

  /**
   * Los límites de logins de un escaneo (ADR 027): el tope por ejecución cuenta solo los logins por
   * sesión vencida; las renovaciones planificadas no, pero sí el límite por credencial. El login
   * asistido no entra en ese límite: lo hace una persona.
   */
  private alNecesitarLogin(enCurso: EnCurso, motivo: MotivoLogin, reintento: boolean): void {
    const autenticacion = enCurso.autenticacion;
    if (!autenticacion || !enCurso.credencialId) {
      this.denegarLogin(enCurso, 'login-fallido');
      return;
    }
    const { estrategia } = autenticacion;
    if (reintento) {
      // El anterior falló. A mitad del escaneo, el asistido y el enlace esperan a la persona.
      if (motivo !== 'inicial' && (estrategia === 'asistido' || estrategia === 'token-url')) {
        this.pausar(
          enCurso,
          motivo,
          estrategia === 'token-url' ? 'enlace-vencido' : 'sesion-vencida',
        );
        return;
      }
      // Una renovación planificada que falló: se sigue con la sesión que hay.
      const fallo = enCurso.ultimoFallo;
      this.denegarLogin(
        enCurso,
        motivo === 'planificada'
          ? null
          : fallo === null || fallo === 'fallo'
            ? 'login-fallido'
            : fallo,
      );
      return;
    }
    if (motivo === 'vencida') {
      if (enCurso.resumen.loginsInesperados >= LIMITES_SESION.loginsInesperados) {
        this.denegarLogin(enCurso, 'limite-logins');
        return;
      }
      enCurso.resumen.loginsInesperados += 1;
    }
    if (estrategia === 'asistido') {
      if (motivo === 'inicial') void this.hacerLogin(enCurso, motivo, 'login-asistido');
      else this.pausar(enCurso, motivo, 'sesion-vencida');
      return;
    }
    if (this.esperaDeIntentos(enCurso.credencialId) > 0) {
      this.denegarLogin(enCurso, motivo === 'planificada' ? null : 'limite-logins');
      return;
    }
    void this.hacerLogin(enCurso, motivo, null);
  }

  private denegarLogin(enCurso: EnCurso, motivo: MotivoFinEjecucion | null): void {
    if (motivo) enCurso.motivoSesion = motivo;
    try {
      enCurso.runner?.enviar({ tipo: 'login-denegado' });
    } catch {
      // El runner ya no está: la ejecución termina por su lado.
    }
  }

  /** Un proxy de login aparte, solo mientras dura el login, y recién después el secreto (ADR 025). */
  private async hacerLogin(
    enCurso: EnCurso,
    motivo: MotivoLogin,
    espera: ProgresoEjecucion['espera'],
  ): Promise<void> {
    const { autenticacion, politicaLogin, credencialId } = enCurso;
    if (!autenticacion || !politicaLogin || !credencialId) return;
    enCurso.espera = espera;
    this.informar(enCurso);
    const credencial = {
      usuario: randomBytes(16).toString('hex'),
      clave: randomBytes(32).toString('hex'),
    };
    let proxy: ProcesoProxy;
    try {
      proxy = await this.lanzador.iniciarProxy(
        { politica: politicaLogin, credencial },
        (registro) => {
          this.anotar(enCurso, 'proxy', registro);
        },
      );
    } catch {
      this.denegarLogin(enCurso, 'login-fallido');
      return;
    }
    if (enCurso.terminada) {
      proxy.detener();
      return;
    }
    enCurso.proxyLogin?.detener();
    enCurso.proxyLogin = proxy;
    enCurso.resumen.logins += 1;
    if (motivo === 'planificada') enCurso.resumen.renovaciones += 1;
    const mensaje = {
      tipo: 'datos-login' as const,
      proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...credencial },
      politica: politicaLogin,
    };
    if (autenticacion.estrategia === 'asistido') {
      enCurso.runner?.enviar({ ...mensaje, secreto: null });
      return;
    }
    try {
      await this.conSecreto(enCurso, credencialId, (copia) => {
        enCurso.runner?.enviar({ ...mensaje, secreto: copia });
      });
    } catch (error) {
      this.denegarLogin(
        enCurso,
        error instanceof AutorizacionNoVigente
          ? 'autorizacion-no-vigente'
          : 'credencial-no-disponible',
      );
    }
  }

  /**
   * Sin perder lo hecho: la cola queda retenida, el tiempo en pausa no cuenta para el máximo, y si en
   * 15 minutos nadie la reanuda, se cancela.
   */
  private pausar(
    enCurso: EnCurso,
    motivo: MotivoLogin,
    espera: NonNullable<ProgresoEjecucion['espera']>,
  ): void {
    enCurso.espera = espera;
    const temporizador = setTimeout(() => {
      if (!enCurso.pausa) return;
      enCurso.pausa = null;
      enCurso.espera = null;
      this.marcarEstado(enCurso, 'en-curso');
      this.denegarLogin(enCurso, 'pausa-vencida');
    }, PAUSA_MAXIMA_MS);
    temporizador.unref();
    enCurso.pausa = { motivo, temporizador };
    this.marcarEstado(enCurso, 'pausada');
  }

  private marcarEstado(enCurso: EnCurso, estado: 'en-curso' | 'pausada'): void {
    try {
      this.boveda.conAcceso((base) => {
        actualizarEjecucion(base, enCurso.id, { estado });
      });
    } catch {
      // Bóveda cerrada: la ejecución se está cancelando.
    }
    this.informar(enCurso, estado);
  }

  private guardarPagina(
    enCurso: EnCurso,
    pagina: Extract<MensajeDelRunner, { tipo: 'pagina' }>,
  ): void {
    enCurso.paginaActual = sinQuery(pagina.url);
    enCurso.resumen.paginasVisitadas += 1;
    try {
      const completa =
        enCurso.paginaActual === pagina.url
          ? null
          : this.proyectos.cifrarDato(
              enCurso.proyectoId,
              contextoUrlPagina(enCurso.proyectoId, enCurso.id),
              pagina.url,
            );
      this.boveda.conAcceso((base) => {
        agregarPaginaVisitada(base, {
          proyectoId: enCurso.proyectoId,
          ejecucionId: enCurso.id,
          url: enCurso.paginaActual as string,
          urlCompletaCifrada: completa,
          statusHttp: pagina.status,
          tiempoCargaMs: pagina.tiempoCargaMs === null ? null : Math.round(pagina.tiempoCargaMs),
          profundidad: pagina.profundidad,
        });
      });
    } catch {
      // Bóveda cerrada: la ejecución se está cancelando.
    }
    this.informar(enCurso);
  }

  private guardarHallazgo(
    enCurso: EnCurso,
    hallazgo: Extract<MensajeDelRunner, { tipo: 'hallazgo' }>['hallazgo'],
  ): void {
    enCurso.resumen.hallazgos += 1;
    const ocurrenciaId = randomUUID();
    try {
      const detalleCifrado = hallazgo.detalle
        ? this.proyectos.cifrarDato(
            enCurso.proyectoId,
            contextoDetalle(enCurso.proyectoId, ocurrenciaId),
            hallazgo.detalle,
          )
        : null;
      this.boveda.conAcceso((base) => {
        agregarHallazgo(
          base,
          {
            proyectoId: enCurso.proyectoId,
            ejecucionId: enCurso.id,
            tipo: hallazgo.tipo,
            severidad: hallazgo.severidad,
            titulo: hallazgo.titulo,
            descripcion: hallazgo.titulo,
            url: hallazgo.url,
            clave: hallazgo.clave,
          },
          { id: ocurrenciaId, urlOrigen: hallazgo.urlOrigen, detalleCifrado },
        );
      });
    } catch {
      // Bóveda cerrada: la ejecución se está cancelando.
    }
    this.informar(enCurso);
  }

  /** El progreso en vivo, para la interfaz (EJE). */
  private informar(
    enCurso: EnCurso,
    estado: ProgresoEjecucion['estado'] = enCurso.pausa ? 'pausada' : 'en-curso',
  ): void {
    this.alProgreso({
      espera: enCurso.espera,
      ejecucionId: enCurso.id,
      estado,
      paginaActual: enCurso.paginaActual,
      paginasVisitadas: enCurso.resumen.paginasVisitadas,
      hallazgos: enCurso.resumen.hallazgos,
      conexionesBloqueadas: enCurso.resumen.conexionesBloqueadas,
    });
  }

  private anotar(
    enCurso: EnCurso,
    proceso: Proceso,
    { destino, permitida, regla }: { destino: string; permitida: boolean; regla: string },
  ): void {
    if (permitida) enCurso.resumen.conexionesPermitidas += 1;
    else enCurso.resumen.conexionesBloqueadas += 1;
    // El resumen cuenta todo; un sitio que martilla no puede llenar la base.
    const guardable = enCurso.guardadas < MAX_CONEXIONES_GUARDADAS;
    if (guardable) {
      enCurso.guardadas += 1;
      enCurso.pendientes.push({
        destino,
        permitida,
        regla,
        proceso,
        fecha: new Date().toISOString(),
      });
    }
    if (enCurso.terminada) this.guardarTardia(enCurso);
  }

  /**
   * Los mensajes de dos procesos no llegan en orden: un bloqueo puede aparecer después del «terminé».
   * Se guarda igual. Con la bóveda ya cerrada no se puede, y se pierde.
   */
  private guardarTardia(enCurso: EnCurso): void {
    try {
      this.boveda.conAcceso((base) => {
        this.volcarConexiones(base, enCurso);
        actualizarEjecucion(base, enCurso.id, { resumen: enCurso.resumen });
      });
    } catch {
      enCurso.pendientes = [];
    }
  }

  /** Sin `enCurso`, la actual mientras corre: la que está terminando se guarda en `finalizar`. */
  private volcarConexiones(
    base?: BaseCifrada,
    enCurso = this.actual?.terminada ? null : this.actual,
  ): void {
    if (!enCurso || enCurso.pendientes.length === 0) return;
    const filas = enCurso.pendientes.map((p) => ({
      ...p,
      proyectoId: enCurso.proyectoId,
      ejecucionId: enCurso.id,
    }));
    enCurso.pendientes = [];
    if (base) agregarConexiones(base, filas);
    else {
      this.boveda.conAcceso((abierta) => {
        agregarConexiones(abierta, filas);
      });
    }
  }

  private finalizar(
    enCurso: EnCurso,
    estado: 'finalizada' | 'fallida' | 'cancelada',
    motivo: MotivoFinEjecucion | null,
    base?: BaseCifrada,
  ): void {
    if (enCurso.terminada) return;
    enCurso.terminada = true;
    enCurso.resumen.motivo = motivo;
    if (enCurso.pausa) clearTimeout(enCurso.pausa.temporizador);
    enCurso.pausa = null;
    enCurso.espera = null;
    const guardar = (abierta: BaseCifrada): void => {
      this.volcarConexiones(abierta, enCurso);
      actualizarEjecucion(abierta, enCurso.id, {
        estado,
        fin: new Date().toISOString(),
        resumen: enCurso.resumen,
      });
    };
    if (base) {
      // Al bloquear, la base se cierra ya: se guarda ahora. Nadie la ve hasta desbloquear, y la
      // limpieza sigue sola; si la app se cierra antes, la termina el próximo inicio.
      try {
        guardar(base);
      } catch {
        // Al desbloquear queda marcada como interrumpida.
      }
      this.informar(enCurso, estado);
      enCurso.alTerminar?.(enCurso.resultadoPrueba ?? null);
      if (this.actual === enCurso) this.actual = null;
      this.liberarProcesos(enCurso, () => undefined);
      return;
    }
    // La ejecución figura terminada recién cuando el runner y su navegador salieron y el perfil se
    // borró: así, al verla terminada, nada puede volver a escribir en esa carpeta. Hasta entonces sigue
    // siendo la actual, y la cola espera. Lo registrado (conexiones y resumen) se guarda ya.
    this.guardarTardia(enCurso);
    this.liberarProcesos(enCurso, () => {
      try {
        this.boveda.conAcceso((abierta) => {
          // Si mientras tanto se eliminó el proyecto, no queda fila que actualizar.
          if (!leerEjecucion(abierta, enCurso.id)) {
            enCurso.pendientes = [];
            return;
          }
          guardar(abierta);
        });
      } catch {
        // Con la bóveda ya cerrada: al desbloquear queda marcada como interrumpida.
      }
      this.informar(enCurso, estado);
      enCurso.alTerminar?.(enCurso.resultadoPrueba ?? null);
      if (this.actual === enCurso) this.actual = null;
      try {
        this.avanzarCola();
      } catch {
        // Bóveda bloqueada: la cola se marcó al bloquear.
      }
    });
  }

  /**
   * El runner sale solo si puede (cierra su navegador y espera); si no, se lo corta. Después se detiene
   * el proxy y se borra el perfil, y recién entonces `alListo`.
   */
  private liberarProcesos(enCurso: EnCurso, alListo: () => void): void {
    const { runner, proxy, id } = enCurso;
    enCurso.proxyLogin?.detener();
    enCurso.proxyLogin = undefined;
    const limpiar = (): void => {
      proxy?.detener();
      void Promise.resolve()
        .then(() => this.lanzador.limpiarPerfil(id))
        .catch(() => undefined)
        .then(alListo);
    };
    if (!runner) {
      limpiar();
      return;
    }
    let listo = false;
    const limite = setTimeout(() => {
      runner.detener();
      alSalir();
    }, TIEMPO_DE_SALIDA_MS);
    limite.unref();
    const alSalir = (): void => {
      if (listo) return;
      listo = true;
      clearTimeout(limite);
      limpiar();
    };
    runner.alSalir(alSalir);
    try {
      runner.enviar({ tipo: 'cancelar' });
    } catch {
      runner.detener();
    }
  }
}
