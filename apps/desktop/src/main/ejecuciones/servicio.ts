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
  LIMITE_PRUEBAS_LOGIN,
  type ConnectionEntry,
  type EjecucionResumen,
  type HallazgoVista,
  type IpcResponse,
  type MotivoFinEjecucion,
  type ProgresoEjecucion,
  type ResumenEjecucion,
} from '@qatlas/shared';
import type { Configuracion, MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
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
  /** Borra el perfil efímero de la ejecución. */
  limpiarPerfil: (ejecucionId: string) => void;
}

const NAVEGADOR = 'chromium';
const MAX_CONEXIONES_GUARDADAS = 2000;
const TIEMPO_DE_SALIDA_MS = 3000;

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
};

/** Lo que ata un dato cifrado a su fila (ADR 021). */
export const contextoDetalle = (proyectoId: string, ocurrenciaId: string): string =>
  `hallazgo/${proyectoId}/${ocurrenciaId}/detalle`;
export const contextoUrlPagina = (proyectoId: string, ejecucionId: string): string =>
  `pagina/${proyectoId}/${ejecucionId}/url`;

interface EnCurso {
  id: string;
  proyectoId: string;
  proxy?: ProcesoProxy;
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
  alTerminar?: (funciono: boolean | null) => void;
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
  };
}

/**
 * Ciclo de vida de las ejecuciones (especificación 4.4, RN-EJE-01 y 02). Sin Electron: los procesos
 * se inyectan. Una sola ejecución a la vez en todo el equipo; las de otros proyectos esperan en la
 * cola, que vive en la base. Lo que falta o falla cierra: sin proxy, el runner no se lanza.
 */
export class ServicioEjecuciones {
  private actual: EnCurso | null = null;

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

  lanzarEscaneo(proyectoId: string): IpcResponse<'ejecuciones:lanzarEscaneo'> {
    if (!this.proyectos.estadoAutorizacion(proyectoId).vigente) {
      return { resultado: 'rechazada', motivo: 'sin-autorizacion' };
    }
    const id = this.encolar(proyectoId, 'escaneo');
    if (!id) return { resultado: 'rechazada', motivo: 'ya-en-curso' };
    this.avanzarCola();
    return { resultado: 'encolada', ejecucionId: id };
  }

  /** RN-EJE-01: la verificación y el alta van juntas, sin un `await` en el medio. */
  private encolar(proyectoId: string, tipo: FilaEjecucion['tipo']): string | null {
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
        credencialId: null,
        rol: null,
      });
      return id;
    });
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
    if (credencial.requiereRevision) return { resultado: 'fallo', motivo: 'credencial-a-revisar' };
    const { indicadorExito: indicador } = credencial;
    if (!indicador) return { resultado: 'fallo', motivo: 'sin-indicador' };
    if (!this.proyectos.estadoAutorizacion(proyectoId).vigente) {
      return { resultado: 'fallo', motivo: 'sin-autorizacion' };
    }
    const espera = this.esperaDeIntentos(credencialId);
    if (espera > 0) return { resultado: 'limite', esperaSegundos: espera };
    // Una prueba es un intento real contra el sistema: no espera en la cola para salir más tarde.
    if (this.actual) return { resultado: 'fallo', motivo: 'ocupado' };
    const id = this.encolar(proyectoId, 'prueba-login');
    if (!id) return { resultado: 'fallo', motivo: 'ocupado' };

    const enCurso = this.crearEnCurso(id, proyectoId);
    const funciono = await new Promise<boolean | null>((resolver) => {
      enCurso.alTerminar = resolver;
      void this.prepararProcesos(enCurso).then(async (configuracion) => {
        if (!configuracion) return;
        try {
          await this.proyectos.usarSecreto(proyectoId, credencialId, (secreto) => {
            // Antes de mandarlo y en la base: un cierre abrupto no devuelve el intento. Lo que falló
            // antes de este punto, como un proxy que no arrancó, no llegó al sistema y no cuenta.
            this.boveda.conAcceso((base) => {
              registrarIntentoLogin(base, {
                proyectoId,
                credencialId,
                fecha: new Date(this.ahora()).toISOString(),
              });
            });
            // Una copia con su propio buffer: un Buffer puede compartir memoria con otros datos.
            // `postMessage` la clona; la de acá se borra enseguida, y `secreto`, al volver.
            const copia = new Uint8Array(secreto);
            try {
              enCurso.runner?.enviar({
                tipo: 'login',
                configuracion,
                urlLogin: credencial.urlLogin,
                pasos: credencial.pasosLogin,
                indicador,
                usuario: credencial.usuario,
                secreto: copia,
              });
            } finally {
              copia.fill(0);
            }
          });
        } catch (error) {
          this.finalizar(
            enCurso,
            'fallida',
            error instanceof AutorizacionNoVigente ? 'autorizacion-no-vigente' : 'runner-caido',
          );
        }
      });
    });
    if (funciono === null) return { resultado: 'fallo', motivo: 'no-se-pudo-ejecutar' };
    return funciono ? { resultado: 'funciono' } : { resultado: 'fallo', motivo: 'no-confirmado' };
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

  private crearEnCurso(id: string, proyectoId: string): EnCurso {
    const enCurso: EnCurso = {
      id,
      proyectoId,
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
    const enCurso = this.crearEnCurso(siguiente.id, siguiente.proyectoId);
    void this.prepararProcesos(enCurso).then((configuracion) => {
      if (!configuracion) return;
      const datos = this.proyectos.datosDeEjecucion(enCurso.proyectoId) as DatosDeEjecucion;
      enCurso.runner?.enviar({
        tipo: 'escaneo',
        configuracion,
        maxPaginas: datos.maxPaginas,
        maxProfundidad: datos.maxProfundidad,
        maxMinutos: datos.maxMinutos,
        maxRps: datos.maxRps,
        soloLectura: datos.soloLectura,
        exclusiones: datos.exclusiones,
      });
    });
  }

  /**
   * El orden es el control: autorización, proxy y recién después el runner. Si algo falla, la
   * ejecución termina acá y el navegador nunca llega a abrirse (RN-EJE-02).
   */
  private async prepararProcesos(enCurso: EnCurso): Promise<Configuracion | null> {
    const datos = this.proyectos.datosDeEjecucion(enCurso.proyectoId);
    if (!datos || !this.proyectos.estadoAutorizacion(enCurso.proyectoId).vigente) {
      this.finalizar(enCurso, 'fallida', 'autorizacion-no-vigente');
      return null;
    }
    const politica = {
      urlBase: datos.urlBase,
      dominios: datos.dominios,
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
        this.finalizar(enCurso, 'finalizada', null);
        return;
      }
      case 'login-terminado':
        enCurso.alTerminar?.(mensaje.funciono);
        this.finalizar(enCurso, 'finalizada', null);
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
  private informar(enCurso: EnCurso, estado: ProgresoEjecucion['estado'] = 'en-curso'): void {
    this.alProgreso({
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

  private volcarConexiones(base?: BaseCifrada, enCurso = this.actual): void {
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
    const guardar = (abierta: BaseCifrada): void => {
      this.volcarConexiones(abierta, enCurso);
      actualizarEjecucion(abierta, enCurso.id, {
        estado,
        fin: new Date().toISOString(),
        resumen: enCurso.resumen,
      });
    };
    try {
      if (base) guardar(base);
      else this.boveda.conAcceso(guardar);
    } catch {
      // Con la bóveda ya cerrada: al desbloquear queda marcada como interrumpida.
    }
    this.informar(enCurso, estado);
    this.liberarProcesos(enCurso);
    enCurso.alTerminar?.(null);
    if (this.actual === enCurso) this.actual = null;
    if (!base) {
      try {
        this.avanzarCola();
      } catch {
        // Bóveda bloqueada: la cola se marcó al bloquear.
      }
    }
  }

  /** El runner sale solo si puede; si no, se lo corta. El proxy se detiene al final, y el perfil se borra. */
  private liberarProcesos(enCurso: EnCurso): void {
    const { runner, proxy, id } = enCurso;
    const limpiar = (): void => {
      proxy?.detener();
      this.lanzador.limpiarPerfil(id);
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
