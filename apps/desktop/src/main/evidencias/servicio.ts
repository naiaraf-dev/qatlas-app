import { randomUUID } from 'node:crypto';
import { borrar, crearSemillaEvidencia } from '@qatlas/crypto';
import {
  agregarEvidencia,
  agregarRedacciones,
  archivosDeEvidencias,
  borrarEvidencias,
  evidenciasQueNoCumplenModoSensible,
  evidenciasVencidas,
  leerConfiguracion,
  leerEvidenciaParaDescifrar,
  leerEvidenciasDeEjecucion,
  registrarAuditoria,
  type BaseCifrada,
  type MetadatosEvidencia,
  type NuevaRedaccion,
  type TipoEvidencia,
} from '@qatlas/db';
import type { MensajeAlRunner, MensajeDelRunner, OpcionesEvidencias } from '@qatlas/runner';
import {
  contarRedacciones,
  type ComparadorDeSecretos,
  type RegistroRedaccion,
} from '@qatlas/redaction';
import {
  MAX_BYTES_IMAGEN,
  MAX_CARACTERES_TEXTO,
  type EvidenciaVista,
  type IpcResponse,
  type ResumenEjecucion,
  type SeveridadHallazgo,
} from '@qatlas/shared';
import type { ServicioBoveda } from '../boveda/servicio';
import { REDACTOR, type Redactor } from '../ejecuciones/redaccion';
import type { ServicioProyectos } from '../proyectos/servicio';
import {
  borrarArchivo,
  carpetaEvidencias,
  crearEscritor,
  leerDescifrado,
  limpiarHuerfanos,
  type Escritor,
} from './almacen';
import { evidenciasEnReportes, fechaDeCorte } from './retencion';
import {
  CABECERA_TRAZA,
  entradaHar,
  FIN_HAR,
  INICIO_HAR,
  lineaDeSnapshot,
  redactarEvento,
  type Redacciones,
} from './traza';
import {
  CABECERA_VIDEO,
  esJpeg,
  esPng,
  indexarVideo,
  medidasPng,
  registroFotograma,
  registroHueco,
  type Hueco,
} from './video';

/**
 * Las evidencias en el proceso principal (semana 7b, ADR 035 a 038). Recibe del runner los fotogramas,
 * las capturas y los eventos de la traza; redacta el texto, cifra todo en streaming con la clave del
 * proyecto y una semilla por evidencia, y decide qué video se conserva. Es el único que descifra, y solo
 * para mostrar. Sin Electron: se prueba con Vitest y en los E2E de servicios.
 */

export const LIMITES_EVIDENCIAS = {
  capturasPorEjecucion: 200,
  bytesVideoPorEjecucion: 200 * 1024 * 1024,
  /** Lo máximo que se descifra de un video para verlo. */
  bytesVideoVista: 220 * 1024 * 1024,
} as const;

/** EVI-07 y f2: el tramo de una página se conserva con un hallazgo de esta severidad o mayor. */
const SEVERIDADES_QUE_CONSERVAN: ReadonlySet<SeveridadHallazgo> = new Set([
  'critica',
  'alta',
  'media',
]);

type MensajeDeEvidencia = Extract<
  MensajeDelRunner,
  { tipo: 'tramo-inicio' | 'tramo-fin' | 'fotograma' | 'captura' | 'traza' | 'textos-de-captura' }
>;

export type ResumenEvidencias = Pick<
  ResumenEjecucion,
  'capturas' | 'videos' | 'fotogramasPerdidos' | 'topesAlcanzados' | 'secretosRedactados'
>;

const TIPOS_DE_MENSAJE: ReadonlySet<string> = new Set([
  'tramo-inicio',
  'tramo-fin',
  'fotograma',
  'captura',
  'traza',
  'textos-de-captura',
]);
export const esMensajeDeEvidencia = (mensaje: MensajeDelRunner): mensaje is MensajeDeEvidencia =>
  TIPOS_DE_MENSAJE.has(mensaje.tipo);

/** Las opciones que manda el escaneo, según el proyecto (EVI-05). */
export function opcionesDeEvidencias(proyecto: {
  modoDatosSensibles: boolean;
  selectoresSensibles: readonly string[];
}): OpcionesEvidencias {
  const sensible = proyecto.modoDatosSensibles;
  return {
    video: !sensible,
    snapshots: !sensible,
    capturas: true,
    traza: true,
    selectoresSensibles: [...proyecto.selectoresSensibles],
    enmascararFormularios: sensible,
    maxCapturas: LIMITES_EVIDENCIAS.capturasPorEjecucion,
  };
}

interface ArchivoEnCurso {
  id: string;
  semilla: Buffer;
  escritor: Escritor;
}

interface TramoEnCurso {
  numero: number;
  paginaId: string | null;
  conservar: boolean;
  video: ArchivoEnCurso | null;
  ultimoT: number;
  fotogramas: number;
  perdidos: number;
  huecos: Hueco[];
  /** El tope de video llegó en este tramo: no entra nada más. */
  cortado: boolean;
}

export interface ParametrosEjecucion {
  ejecucionId: string;
  proyectoId: string;
  modoSensible: boolean;
  /** Los secretos de las credenciales, por su HMAC (ADR 031): los mismos de la ejecución. */
  comparador: () => ComparadorDeSecretos | null;
  enviarAlRunner: (mensaje: MensajeAlRunner) => void;
}

/** Las evidencias de una ejecución en curso. Todo pasa por una cola, en el orden en que llegó. */
export class EvidenciasDeEjecucion {
  private cola: Promise<void> = Promise.resolve();
  private abortada = false;
  private tramo: TramoEnCurso | null = null;
  private paginaActual: string | null = null;
  private traza: (ArchivoEnCurso & { entradas: number; secretos: number }) | null = null;
  private har: (ArchivoEnCurso & { entradas: number; secretos: number }) | null = null;
  private readonly inicio: number;
  private capturas = 0;
  private videos = 0;
  private perdidos = 0;
  private bytesVideo = 0;
  private secretos = 0;
  private readonly topes = new Set<'capturas' | 'video'>();
  private readonly redacciones = new Map<string, NuevaRedaccion>();

  constructor(
    private readonly servicio: ServicioEvidencias,
    private readonly p: ParametrosEjecucion,
    ahora: number,
  ) {
    this.inicio = ahora;
  }

  private encolar(tarea: () => Promise<void> | void): void {
    this.cola = this.cola
      .then(async () => {
        if (!this.abortada) await tarea();
      })
      .catch(() => undefined);
  }

  /** Cada mensaje de evidencia del runner, en orden. Las capturas nunca se descartan: esperan su turno. */
  recibir(mensaje: MensajeDeEvidencia): void {
    if (mensaje.tipo === 'textos-de-captura') {
      // Fuera de la cola: el runner espera esto para tomar la captura, y no escribe nada.
      this.responderMascaras(mensaje.textos);
      return;
    }
    if (mensaje.tipo === 'fotograma') {
      // El runner libera el lugar recién cuando esto se escribió (f5).
      this.encolar(async () => {
        try {
          await this.fotograma(mensaje);
        } finally {
          this.confirmar();
        }
      });
      return;
    }
    this.encolar(() => this.procesar(mensaje));
  }

  /**
   * Qué textos visibles tienen un secreto, con la misma redacción de todo lo demás (patrones y las
   * credenciales del proyecto). El runner tapa esos elementos en la captura. Nada de esto se guarda.
   */
  private responderMascaras(textos: readonly string[]): void {
    const opciones = { comparador: this.p.comparador() };
    const indices: number[] = [];
    textos.forEach((texto, indice) => {
      if (this.servicio.redactor.texto(texto, opciones).registros.length > 0) indices.push(indice);
    });
    try {
      this.p.enviarAlRunner({ tipo: 'tapar-en-captura', indices });
    } catch {
      // El runner ya salió: no hay captura que tomar.
    }
  }

  private confirmar(): void {
    try {
      this.p.enviarAlRunner({ tipo: 'evidencia-procesada', fotogramas: 1 });
    } catch {
      // El runner ya salió.
    }
  }

  /** La página que se acaba de guardar: sus evidencias se enlazan a ella. */
  alPagina(paginaId: string): void {
    this.encolar(() => {
      this.paginaActual = paginaId;
      if (this.tramo && this.tramo.paginaId === null) this.tramo.paginaId = paginaId;
    });
  }

  /** Un hallazgo de la página en curso: con severidad media o mayor, su video se conserva. */
  alHallazgo(severidad: SeveridadHallazgo): void {
    this.encolar(() => {
      if (this.tramo && SEVERIDADES_QUE_CONSERVAN.has(severidad)) this.tramo.conservar = true;
    });
  }

  private async procesar(
    mensaje: Exclude<MensajeDeEvidencia, { tipo: 'fotograma' | 'textos-de-captura' }>,
  ) {
    switch (mensaje.tipo) {
      case 'tramo-inicio':
        await this.cerrarTramo(false);
        this.tramo = {
          numero: mensaje.tramo,
          paginaId: null,
          conservar: false,
          video: null,
          ultimoT: 0,
          fotogramas: 0,
          perdidos: 0,
          huecos: [],
          cortado: false,
        };
        return;
      case 'tramo-fin': {
        const tramo = this.tramo;
        if (tramo?.numero !== mensaje.tramo) return;
        if (mensaje.perdidosAlFinal > 0) {
          await this.agregarHueco(tramo, tramo.ultimoT, mensaje.perdidosAlFinal);
        }
        if (mensaje.errorNavegacion) tramo.conservar = true;
        await this.cerrarTramo(false);
        return;
      }
      case 'captura':
        await this.captura(mensaje);
        return;
      case 'traza':
        await this.eventoDeTraza(mensaje.evento);
    }
  }

  private nuevoArchivo(): ArchivoEnCurso {
    const id = randomUUID();
    const semilla = crearSemillaEvidencia();
    try {
      return { id, semilla, escritor: this.servicio.escritor(this.p.proyectoId, id, semilla) };
    } catch (error) {
      borrar(semilla);
      throw error;
    }
  }

  private async agregarHueco(tramo: TramoEnCurso, t: number, cantidad: number): Promise<void> {
    tramo.perdidos += cantidad;
    this.perdidos += cantidad;
    tramo.huecos.push({ t, cantidad });
    if (tramo.video) await tramo.video.escritor.escribir(registroHueco(t, cantidad));
  }

  private async fotograma(mensaje: Extract<MensajeDeEvidencia, { tipo: 'fotograma' }>) {
    const tramo = this.tramo;
    if (tramo?.numero !== mensaje.tramo || tramo.cortado) return;
    const datos = Buffer.from(mensaje.datos);
    if (!esJpeg(datos)) return;
    if (this.bytesVideo + datos.length > LIMITES_EVIDENCIAS.bytesVideoPorEjecucion) {
      this.topes.add('video');
      tramo.cortado = true;
      return;
    }
    if (!tramo.video) {
      tramo.video = this.nuevoArchivo();
      await tramo.video.escritor.escribir(CABECERA_VIDEO);
    }
    if (mensaje.perdidosAntes > 0) await this.agregarHueco(tramo, mensaje.t, mensaje.perdidosAntes);
    await tramo.video.escritor.escribir(registroFotograma(mensaje.t, datos));
    this.bytesVideo += datos.length;
    tramo.fotogramas += 1;
    tramo.ultimoT = mensaje.t;
  }

  /** Conserva o descarta el video del tramo. Descartado, su semilla nunca llegó a la base. */
  private async cerrarTramo(errorDelNavegador: boolean): Promise<void> {
    const tramo = this.tramo;
    this.tramo = null;
    if (!tramo?.video) return;
    const video = tramo.video;
    if (!(tramo.conservar || errorDelNavegador) || tramo.fotogramas === 0) {
      this.descartar(video);
      return;
    }
    const guardado = await this.guardar(video, 'video', tramo.paginaId, {
      puedeTenerDatosSensibles: true,
      secretos: 0,
      metadatos: {
        formato: 'qatlas-video',
        duracionMs: tramo.ultimoT,
        fotogramas: tramo.fotogramas,
        fotogramasPerdidos: tramo.perdidos,
        huecos: tramo.huecos,
        modoSensible: this.p.modoSensible,
      },
    });
    if (guardado) this.videos += 1;
  }

  private descartar(archivo: ArchivoEnCurso): void {
    archivo.escritor.descartar();
    borrar(archivo.semilla);
  }

  /** Cierra el archivo y recién entonces guarda su fila con la semilla. Sin fila, se borra. */
  private async guardar(
    archivo: ArchivoEnCurso,
    tipo: TipoEvidencia,
    paginaId: string | null,
    extra: { puedeTenerDatosSensibles: boolean; secretos: number; metadatos: MetadatosEvidencia },
  ): Promise<boolean> {
    try {
      await archivo.escritor.terminar();
      this.servicio.boveda.conAcceso((base) => {
        agregarEvidencia(base, {
          id: archivo.id,
          proyectoId: this.p.proyectoId,
          ejecucionId: this.p.ejecucionId,
          paginaVisitadaId: paginaId,
          tipo,
          archivo: archivo.escritor.archivo,
          semilla: archivo.semilla,
          tamano: archivo.escritor.bytes,
          secretosRedactados: extra.secretos,
          puedeTenerDatosSensibles: extra.puedeTenerDatosSensibles,
          metadatos: extra.metadatos,
        });
      });
      return true;
    } catch {
      // Bóveda cerrada o disco con error: sin fila, el archivo no sirve y se borra.
      archivo.escritor.descartar();
      return false;
    } finally {
      borrar(archivo.semilla);
    }
  }

  private async captura(mensaje: Extract<MensajeDeEvidencia, { tipo: 'captura' }>) {
    const datos = Buffer.from(mensaje.datos);
    if (!esPng(datos)) return;
    if (this.capturas >= LIMITES_EVIDENCIAS.capturasPorEjecucion) {
      this.topes.add('capturas');
      return;
    }
    const archivo = this.nuevoArchivo();
    await archivo.escritor.escribir(datos);
    const medidas = medidasPng(datos);
    const paginaId = this.tramo?.numero === mensaje.tramo ? this.tramo.paginaId : this.paginaActual;
    const guardada = await this.guardar(archivo, 'captura', paginaId, {
      puedeTenerDatosSensibles: false,
      secretos: 0,
      metadatos: {
        formato: 'image/png',
        ...(medidas ? { ancho: medidas.ancho, alto: medidas.alto } : {}),
        enmascarados: mensaje.enmascarados,
        modoSensible: this.p.modoSensible,
      },
    });
    if (guardada) this.capturas += 1;
  }

  private anotarRedacciones(redacciones: readonly Redacciones[]): number {
    let total = 0;
    for (const { origen, registros } of redacciones) {
      total += contarRedacciones(registros);
      for (const registro of registros) this.anotarRegistro(origen, registro);
    }
    this.secretos += total;
    return total;
  }

  private anotarRegistro(origen: string, registro: RegistroRedaccion): void {
    const clave = `${origen}|${registro.regla}|${registro.tipo}`;
    const previo = this.redacciones.get(clave);
    if (previo) previo.cantidad += registro.cantidad;
    else {
      this.redacciones.set(clave, {
        proyectoId: this.p.proyectoId,
        ejecucionId: this.p.ejecucionId,
        origen,
        regla: registro.regla,
        tipo: registro.tipo,
        cantidad: registro.cantidad,
      });
    }
  }

  private async lineaDeTraza(linea: Record<string, unknown>, secretos: number): Promise<void> {
    if (!this.traza) {
      this.traza = { ...this.nuevoArchivo(), entradas: 0, secretos: 0 };
      await this.traza.escritor.escribir(Buffer.from(`${JSON.stringify(CABECERA_TRAZA)}\n`));
    }
    this.traza.entradas += 1;
    this.traza.secretos += secretos;
    await this.traza.escritor.escribir(Buffer.from(`${JSON.stringify(linea)}\n`));
  }

  private async eventoDeTraza(
    evento: Extract<MensajeDeEvidencia, { tipo: 'traza' }>['evento'],
  ): Promise<void> {
    const opciones = { comparador: this.p.comparador() };
    const redactor = this.servicio.redactor;
    if (evento.clase === 'snapshot') {
      // El snapshot es su propia evidencia: se puede borrar sin tocar la traza (f6).
      const html = redactor.texto(evento.html, opciones);
      const secretos = this.anotarRedacciones([{ origen: 'snapshot', registros: html.registros }]);
      const archivo = this.nuevoArchivo();
      await archivo.escritor.escribir(Buffer.from(html.texto, 'utf8'));
      const paginaId =
        this.tramo?.numero === evento.tramo ? this.tramo.paginaId : this.paginaActual;
      const guardada = await this.guardar(archivo, 'snapshot-dom', paginaId, {
        puedeTenerDatosSensibles: true,
        secretos,
        metadatos: {
          formato: 'html-texto',
          enmascarados: evento.enmascarados,
          modoSensible: this.p.modoSensible,
        },
      });
      if (guardada) await this.lineaDeTraza(lineaDeSnapshot(evento.t, evento.tramo, archivo.id), 0);
      return;
    }
    const { linea, redacciones, red } = redactarEvento(evento, redactor, opciones);
    const secretos = this.anotarRedacciones(redacciones);
    await this.lineaDeTraza(linea, secretos);
    if (!red) return;
    if (!this.har) {
      this.har = { ...this.nuevoArchivo(), entradas: 0, secretos: 0 };
      await this.har.escritor.escribir(Buffer.from(INICIO_HAR));
    }
    const separador = this.har.entradas === 0 ? '' : ',';
    this.har.entradas += 1;
    this.har.secretos += secretos;
    await this.har.escritor.escribir(
      Buffer.from(`${separador}${JSON.stringify(entradaHar(red, this.inicio))}`),
    );
  }

  /**
   * Al terminar la ejecución: el tramo abierto se conserva si terminó por un error del navegador; la traza
   * y el HAR se cierran y se guardan, y el registro de redacciones también.
   */
  terminar(errorDelNavegador: boolean): Promise<ResumenEvidencias> {
    this.encolar(async () => {
      await this.cerrarTramo(errorDelNavegador);
      if (this.traza) {
        const traza = this.traza;
        this.traza = null;
        await this.guardar(traza, 'traza', null, {
          puedeTenerDatosSensibles: false,
          secretos: traza.secretos,
          metadatos: {
            formato: 'qatlas-traza',
            entradas: traza.entradas,
            modoSensible: this.p.modoSensible,
          },
        });
      }
      if (this.har) {
        const har = this.har;
        this.har = null;
        await har.escritor.escribir(Buffer.from(FIN_HAR));
        await this.guardar(har, 'har', null, {
          puedeTenerDatosSensibles: false,
          secretos: har.secretos,
          metadatos: { formato: 'har', entradas: har.entradas, modoSensible: this.p.modoSensible },
        });
      }
      const filas = [...this.redacciones.values()];
      this.redacciones.clear();
      if (filas.length > 0) {
        this.servicio.boveda.conAcceso((base) => {
          agregarRedacciones(base, filas);
        });
      }
    });
    return this.cola.then(() => this.resumen());
  }

  resumen(): ResumenEvidencias {
    return {
      capturas: this.capturas,
      videos: this.videos,
      fotogramasPerdidos: this.perdidos,
      topesAlcanzados: [...this.topes].sort(),
      secretosRedactados: this.secretos,
    };
  }

  /** Al bloquear: se corta todo. Lo que no llegó a la base se borra y sus semillas se pierden. */
  abortar(): void {
    this.abortada = true;
    for (const archivo of [this.tramo?.video, this.traza, this.har]) {
      if (archivo) this.descartar(archivo);
    }
    this.tramo = null;
    this.traza = null;
    this.har = null;
    this.redacciones.clear();
  }

  /** Los archivos que se están escribiendo: la limpieza de huérfanos no los toca. */
  enUso(): string[] {
    return [this.tramo?.video, this.traza, this.har]
      .filter((a): a is ArchivoEnCurso => Boolean(a))
      .map((a) => a.escritor.archivo);
  }
}

/** Un video descifrado, para recorrer sus fotogramas sin volver a descifrarlo. Solo el último. */
interface VideoAbierto {
  evidenciaId: string;
  datos: Buffer;
  fotogramas: { t: number; inicio: number; fin: number }[];
}

export class ServicioEvidencias {
  private readonly carpeta: string;
  private readonly activas = new Set<EvidenciasDeEjecucion>();
  private abierto: VideoAbierto | null = null;

  constructor(
    readonly boveda: ServicioBoveda,
    private readonly proyectos: ServicioProyectos,
    carpetaDatos: string,
    readonly redactor: Redactor = REDACTOR,
    private readonly ahora: () => number = Date.now,
  ) {
    this.carpeta = carpetaEvidencias(carpetaDatos);
  }

  escritor(proyectoId: string, evidenciaId: string, semilla: Buffer): Escritor {
    return crearEscritor(
      this.carpeta,
      (uso) => this.proyectos.conClaveProyecto(proyectoId, uso),
      evidenciaId,
      semilla,
    );
  }

  iniciar(parametros: ParametrosEjecucion): EvidenciasDeEjecucion {
    const ejecucion = new EvidenciasDeEjecucion(this, parametros, this.ahora());
    this.activas.add(ejecucion);
    return ejecucion;
  }

  /** Cuando la ejecución terminó del todo (o se abortó). */
  soltar(ejecucion: EvidenciasDeEjecucion): void {
    this.activas.delete(ejecucion);
  }

  listar(ejecucionId: string): EvidenciaVista[] {
    return this.boveda.conAcceso((base) =>
      leerEvidenciasDeEjecucion(base, ejecucionId).map((fila) => ({
        id: fila.id,
        tipo: fila.tipo,
        paginaId: fila.paginaVisitadaId,
        creadaEn: fila.createdAt,
        tamano: fila.tamano,
        secretosRedactados: fila.secretosRedactados,
        revisionPendiente: fila.revisionPendiente,
        puedeTenerDatosSensibles: fila.puedeTenerDatosSensibles,
        ancho: fila.metadatos.ancho ?? null,
        alto: fila.metadatos.alto ?? null,
        duracionMs: fila.metadatos.duracionMs ?? null,
        fotogramas: fila.metadatos.fotogramas ?? null,
        fotogramasPerdidos: fila.metadatos.fotogramasPerdidos ?? 0,
        enmascarados: fila.metadatos.enmascarados ?? null,
        entradas: fila.metadatos.entradas ?? null,
        modoSensible: fila.metadatos.modoSensible ?? false,
      })),
    );
  }

  /** Descifra una evidencia en memoria. La semilla se copia y se borra al terminar. */
  private async descifrar(evidenciaId: string, maximo: number) {
    const fila = this.boveda.conAcceso((base) => leerEvidenciaParaDescifrar(base, evidenciaId));
    if (!fila) return null;
    const semilla = Buffer.from(fila.semilla);
    fila.semilla.fill(0);
    try {
      const datos = await leerDescifrado(
        this.carpeta,
        (uso) => this.proyectos.conClaveProyecto(fila.proyectoId, uso),
        fila.id,
        semilla,
        fila.archivo,
        maximo,
      );
      return { fila, datos };
    } finally {
      borrar(semilla);
    }
  }

  /** Solo para mostrar (3.7): una imagen validada por su firma, el índice de un video o texto redactado. */
  async vista(evidenciaId: string): Promise<IpcResponse<'evidencias:obtenerVista'>> {
    const tipo = this.boveda.conAcceso(
      (base) => leerEvidenciaParaDescifrar(base, evidenciaId)?.tipo ?? null,
    );
    if (!tipo) return null;
    try {
      if (tipo === 'video') {
        const video = await this.abrirVideo(evidenciaId);
        if (!video) return null;
        const indice = indexarVideo(video.datos);
        return {
          tipo: 'video',
          tiempos: video.fotogramas.map((f) => f.t),
          huecos: indice.huecos,
          fotogramasPerdidos: indice.huecos.reduce((total, h) => total + h.cantidad, 0),
        };
      }
      const descifrada = await this.descifrar(
        evidenciaId,
        tipo === 'captura' ? MAX_BYTES_IMAGEN : MAX_CARACTERES_TEXTO,
      );
      if (!descifrada) return null;
      const { datos } = descifrada;
      if (tipo === 'captura') {
        if (!esPng(datos)) return null;
        return { tipo: 'imagen', formato: 'image/png', datos: new Uint8Array(datos) };
      }
      const formato = tipo === 'traza' ? 'traza' : tipo === 'har' ? 'har' : 'html-texto';
      const texto = datos.toString('utf8');
      datos.fill(0);
      return { tipo: 'texto', formato, texto };
    } catch {
      // Un archivo alterado, truncado o sin su semilla: no se muestra nada.
      return null;
    }
  }

  private async abrirVideo(evidenciaId: string): Promise<VideoAbierto | null> {
    if (this.abierto?.evidenciaId === evidenciaId) return this.abierto;
    const descifrada = await this.descifrar(evidenciaId, LIMITES_EVIDENCIAS.bytesVideoVista);
    if (!descifrada) return null;
    const { fotogramas } = indexarVideo(descifrada.datos);
    this.cerrarVideo();
    this.abierto = { evidenciaId, datos: descifrada.datos, fotogramas };
    return this.abierto;
  }

  async fotograma(
    evidenciaId: string,
    indice: number,
  ): Promise<IpcResponse<'evidencias:obtenerFotograma'>> {
    try {
      const video = await this.abrirVideo(evidenciaId);
      const fotograma = video?.fotogramas[indice];
      if (!video || !fotograma) return null;
      const datos = video.datos.subarray(fotograma.inicio, fotograma.fin);
      if (!esJpeg(datos)) return null;
      return { datos: new Uint8Array(datos), t: fotograma.t };
    } catch {
      return null;
    }
  }

  /** Al bloquear: lo descifrado se borra de memoria. */
  cerrarVideo(): void {
    this.abierto?.datos.fill(0);
    this.abierto = null;
  }

  alBloquear(): void {
    this.cerrarVideo();
    for (const ejecucion of this.activas) ejecucion.abortar();
    this.activas.clear();
  }

  /** Los archivos de filas ya borradas (borrado criptográfico): sin semilla, son ilegibles. */
  private eliminarArchivos(filas: readonly { id: string; archivo: string }[]): void {
    if (filas.some((f) => f.id === this.abierto?.evidenciaId)) this.cerrarVideo();
    for (const { archivo } of filas) borrarArchivo(this.carpeta, archivo);
  }

  noCumplenModoSensible(proyectoId: string): IpcResponse<'evidencias:noCumplenModoSensible'> {
    return this.boveda.conAcceso((base) => {
      const filas = evidenciasQueNoCumplenModoSensible(base, proyectoId);
      return {
        videos: filas.filter((f) => f.tipo === 'video').length,
        snapshots: filas.filter((f) => f.tipo === 'snapshot-dom').length,
      };
    });
  }

  /** f6: eliminar con borrado criptográfico o conservar. Las dos quedan en la auditoría, solo la cantidad. */
  resolverModoSensible(
    proyectoId: string,
    accion: 'eliminar' | 'conservar',
  ): IpcResponse<'evidencias:resolverModoSensible'> {
    return this.boveda.conAcceso((base) => {
      const filas = evidenciasQueNoCumplenModoSensible(base, proyectoId);
      base.transaction(() => {
        if (accion === 'eliminar') {
          borrarEvidencias(
            base,
            filas.map((f) => f.id),
          );
        }
        registrarAuditoria(base, {
          accion:
            accion === 'eliminar'
              ? 'evidencias.modo-sensible-eliminar'
              : 'evidencias.modo-sensible-conservar',
          entidad: 'proyecto',
          entidadId: proyectoId,
          detalle: { cantidad: filas.length },
        });
      })();
      if (accion === 'eliminar') this.eliminarArchivos(filas);
      return { cantidad: filas.length };
    });
  }

  /**
   * EVI-06: lo de más de N días (configurable en la bóveda) se elimina con borrado criptográfico, salvo
   * lo que está en reportes. Corre al desbloquear y queda en la auditoría, una fila por proyecto.
   */
  aplicarRetencion(base: BaseCifrada): number {
    const { retencionDias } = leerConfiguracion(base);
    const vencidas = evidenciasVencidas(
      base,
      fechaDeCorte(this.ahora(), retencionDias),
      evidenciasEnReportes(base),
    );
    if (vencidas.length === 0) return 0;
    const porProyecto = new Map<string, number>();
    for (const fila of vencidas) {
      porProyecto.set(fila.proyectoId, (porProyecto.get(fila.proyectoId) ?? 0) + 1);
    }
    base.transaction(() => {
      borrarEvidencias(
        base,
        vencidas.map((f) => f.id),
      );
      for (const [proyectoId, cantidad] of porProyecto) {
        registrarAuditoria(base, {
          accion: 'evidencias.retencion',
          entidad: 'proyecto',
          entidadId: proyectoId,
          detalle: { cantidad },
        });
      }
    })();
    // Recién con las filas (y sus semillas) borradas, los archivos.
    this.eliminarArchivos(vencidas);
    return vencidas.length;
  }

  /**
   * Lo que está en la carpeta sin fila (una ejecución cortada, un proyecto eliminado) es ilegible: se
   * borra. Nunca lo que una ejecución en curso está escribiendo.
   */
  limpiarHuerfanos(base: BaseCifrada): number {
    const conservar = archivosDeEvidencias(base);
    for (const ejecucion of this.activas) {
      for (const archivo of ejecucion.enUso()) conservar.add(archivo);
    }
    return limpiarHuerfanos(this.carpeta, conservar);
  }

  /** EVI-06: cambiar cuántos días se guardan queda en la auditoría, sin el valor. */
  registrarCambioDeRetencion(): void {
    this.boveda.conAcceso((base) => {
      registrarAuditoria(base, {
        accion: 'configuracion.editar',
        entidad: 'configuracion',
        entidadId: 'boveda',
        detalle: { campos: ['retencionDias'] },
      });
    });
  }

  /** Al abrir la base: restos y retención. */
  alAbrir(base: BaseCifrada): void {
    this.aplicarRetencion(base);
    this.limpiarHuerfanos(base);
  }

  /** Después de eliminar un proyecto: sus filas ya no están, y sus archivos se borran. */
  despuesDeEliminarProyecto(): void {
    this.boveda.conAcceso((base) => this.limpiarHuerfanos(base));
  }
}
